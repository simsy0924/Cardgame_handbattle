// 핸드배틀 엔진 프로토타입 (카드 이름을 모르고, JSON 효과 데이터와 이벤트만 안다)
export const OTHER = (p) => (p === 'A' ? 'B' : 'A');
const ZONES = ['hand', 'deck', 'grave', 'banished', 'keydeck', 'field'];
const FIELD_MAX = 5;

export class Engine {
  constructor(cardDefs, opts = {}) {
    this.defs = Object.fromEntries(cardDefs.map((c) => [c.id, c]));
    this.choose = opts.choose || autoChoose; // ({kind,player,id,options,min,max}) => uid[] | number
    this.confirm = opts.confirm || (() => true); // ({player,uid,effect}) => bool
    this.respond = opts.respond || (() => null); // ({player,options,chain}) => option | null (null = 패스)
    this.again = opts.again || (() => false); // 반복 블록: 한 번 더?
    this.option = opts.option || (() => false); // 처리 시점 선택 효과("무효로 할 수 있다")를 쓸지
    this.effectFilters = opts.effectFilters || {};
    this.counterRules = opts.counterRules || {};
    this.rngState = opts.seed ?? 12345;
    this.dry = false;
    this.log = [];
    this.state = {
      seq: 0,
      cards: {},
      turn: { player: 'A', phase: 'deploy', number: 1 },
      players: { A: emptyP(), B: emptyP() },
      usage: { turn: {}, game: {} },
      draws: { A: 0, B: 0 },
      pending: [],
      chain: [],
      turnLog: { applied: {}, graveBy: {}, attacked: [] },
      restrictions: [],
      limitBonus: {},
      delayed: [],
      lost: {},
      immunities: [],
      appUsage: {},
      disabled: {},
      temp: [],
      combat: null,
    };
  }
  rng() { let t = (this.rngState += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  shuffle(p) { const a = this.S.players[p].deck; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  say(m) { if (!this.dry) this.log.push(m); }
  get S() {
    const s = this.state;
    s.players ||= { A: emptyP(), B: emptyP() };
    for (const p of ['A', 'B']) {
      s.players[p] ||= emptyP();
      for (const z of ['hand', 'deck', 'grave', 'banished', 'keydeck', 'field', 'field_zone']) s.players[p][z] ||= [];
    }
    s.usage ||= { turn: {}, game: {} };
    s.usage.turn ||= {};
    s.usage.game ||= {};
    s.draws ||= { A: 0, B: 0 };
    s.pending ||= [];
    s.chain ||= [];
    s.turnLog ||= { applied: {}, graveBy: {}, attacked: [] };
    s.turnLog.applied ||= {};
    s.turnLog.graveBy ||= {};
    s.turnLog.attacked ||= [];
    s.restrictions ||= [];
    s.limitBonus ||= {};
    s.delayed ||= [];
    s.lost ||= {};
    s.immunities ||= [];
    s.appUsage ||= {};
    s.disabled ||= {};
    s.temp ||= [];
    return s;
  }

  // ---------- 카드/존 ----------
  addCard(id, owner, zone, revealed = false) {
    const uid = `${id}#${++this.S.seq}`;
    this.S.cards[uid] = { uid, id, owner, zone, revealed: false, bonus: 0 };
    this.S.players[owner][zone].push(uid);
    if (zone === 'hand') this.S.cards[uid].revealed = revealed;
    return uid;
  }
  def(uid) {
    const c = this.S.cards[uid], base = this.defs[c.id];
    if (!c.copy) return base;
    const t = this.defs[c.copy.id]; // 복사한 이름/공격력/효과 (그 외는 원래 카드)
    return { ...base, name: t.name, attack: t.attack, effects: t.effects };
  }
  nm(uid) { const c = this.S.cards[uid]; return `${this.def(uid).name}(${c.owner}:${c.zone})`; }
  effectiveName(uid) {
    const c = this.S.cards[uid], d = this.def(uid);
    for (const a of d.name_alias || []) if (a.locations.includes(c.zone)) return a.as;
    return d.name;
  }
  attack(uid) {
    let a = (this.def(uid).attack ?? 0) + this.S.cards[uid].bonus;
    const cs = this.S.cards[uid].counters;
    if (cs) { let any = false; for (const [k, n] of Object.entries(cs)) { const r = this.counterRules[k]; if (r?.attack_per && n > 0) { a += r.attack_per * n; any = true; } } if (any) a = Math.max(0, a); }
    return a;
  }
  ctrl(uid) { const c = this.S.cards[uid]; return c.zone === 'field' ? (c.ctrl ?? c.owner) : c.owner; }
  noteSummoned(uid) { const m = (this.S.turnLog.summoned ||= {}); const id = this.S.cards[uid].id; m[id] = (m[id] || 0) + 1; }
  counterKindsOf(ctx, ref) { return [...new Set([].concat(ref).flatMap((r) => this.ref(ctx, r)).map((u) => this.def(u).counter_type).filter(Boolean))]; }
  counterTotals(player) { const t = {}; for (const u of this.S.players[player].field) for (const [k, n] of Object.entries(this.S.cards[u].counters || {})) if (n > 0) t[k] = (t[k] || 0) + n; return t; }
  zoneList(p, z) { return this.S.players[p][z]; }
  moveCard(uid, zone, { revealed = false, to } = {}) {
    const c = this.S.cards[uid];
    const from = c.zone;
    const L = this.zoneList(from === 'field' ? this.ctrl(uid) : c.owner, from);
    L.splice(L.indexOf(uid), 1);
    c.zone = zone;
    if (from === 'grave') delete this.S.turnLog.graveBy[uid];
    const ctl = zone === 'field' ? (to || c.owner) : c.owner;
    this.zoneList(ctl, zone).push(uid);
    if (zone === 'field') c.ctrl = ctl; else delete c.ctrl;
    c.revealed = zone === 'hand' ? revealed : false;
    if (zone !== 'field') { c.bonus = 0; delete c.copy; delete c.counters; if (c.negated) { delete c.negated; delete this.S.disabled[uid]; } }
    const a = this.actor || {};
    this.emit({ type: 'moved_to_zone', uid, from, to: zone, player: c.owner, cause: a.kind || null, cause_player: a.player || null, cause_uid: a.uid || null });
    return from;
  }
  emit(ev) { this.S.pending.push(ev); }

  // ---------- 필터/참조 ----------
  fromList(ctx, from) {
    if (Array.isArray(from)) return from.flatMap((f) => this.fromList(ctx, f));
    const me = ctx.player, op = OTHER(me);
    const P = this.S.players;
    switch (from) {
      case 'hand': case 'deck': case 'grave': case 'banished': case 'keydeck': return [...P[me][from]];
      case 'own_field': case 'own_monster_zone': return [...P[me].field];
      case 'opponent_field': return [...P[op].field];
      case 'opponent_hand': return [...P[op].hand];
      case 'own_field_zone': return [...P[me].field_zone];
      case 'opponent_field_zone': return [...P[op].field_zone];
      case 'field_all': return [...P[me].field, ...P[op].field, ...P[me].field_zone, ...P[op].field_zone];
      case 'own_field_all': return [...P[me].field, ...P[me].field_zone];
      case 'opponent_field_all': return [...P[op].field, ...P[op].field_zone];
      case 'grave_both': return [...P[me].grave, ...P[op].grave];
      case 'banished_both': return [...P[me].banished, ...P[op].banished];
      default: throw new Error('unknown from ' + from);
    }
  }
  matches(uid, f, ctx) {
    if (!f) return true;
    const d = this.def(uid);
    if (f.type && d.type !== f.type) return false;
    if (f.tag && !(d.tags || []).includes(f.tag)) return false;
    if (f.name && this.effectiveName(uid) !== f.name) return false;
    if (f.card_id && d.id !== f.card_id) return false;
    if (f.not_card_id && d.id === f.not_card_id) return false;
    if (f.has_counter_written_on) { const ks = this.counterKindsOf(ctx, f.has_counter_written_on), cs = this.S.cards[uid].counters || {}; if (!ks.some((k) => cs[k] > 0)) return false; }
    if (f.has_counter) { const cs = this.S.cards[uid].counters || {}; if (!(cs[f.has_counter] > 0)) return false; }
    if (f.sent_to_grave_by && this.S.turnLog.graveBy[uid] !== f.sent_to_grave_by) return false;
    if (f.exclude) for (const x of [].concat(f.exclude)) if (x === 'self' ? uid === ctx.uid : (ctx.sel[x] || []).includes(uid)) return false;
    return true;
  }
  ref(ctx, r) {
    if (r === 'self') return [ctx.uid];
    if (r === 'event.card') return ctx.event ? [ctx.event.uid] : [];
    if (r === 'chain.last.source') { const t = this.S.chain[ctx.linkIndex - 1]; return t && t.kind === 'effect' ? [t.uid] : []; }
    if (ctx.sel[r]) return ctx.sel[r];
    return []; // 선택이 실패해서 비어 있는 경우
  }
  cardOf(ctx, name) {
    if (name.startsWith('event.')) return ctx.event?.[name.slice(6)];
    return ctx.sel[name]?.[0];
  }
  cmp(ctx, c) {
    const l = this.num(ctx, c.left), r = this.num(ctx, c.right);
    return { '>=': l >= r, '<=': l <= r, '>': l > r, '<': l < r, '==': l === r }[c.op];
  }
  num(ctx, e) {
    if (typeof e === 'number') return e;
    if (e.var) return ctx.vars?.[e.var] ?? 0;
    if (e.count_of) { const L = ctx.sel[e.count_of] || []; return e.filter ? L.filter((u) => this.matches(u, e.filter, ctx)).length : L.length; }
    if (e.memory) return this.S.cards[ctx.uid]?.memory?.[e.memory] ?? 0;
    if (e.count === 'own_hand') return this.S.players[ctx.player].hand.length;
    if (e.card) { const u = this.cardOf(ctx, e.card); return u ? this.attack(u) : NaN; }
    if (e.op === 'abs_diff') return Math.abs(this.num(ctx, e.a) - this.num(ctx, e.b));
    if (e.op === 'half_ceil') return Math.ceil(this.num(ctx, e.of) / 2);
    if (e.op === 'sub') return this.num(ctx, e.a) - this.num(ctx, e.b);
    if (e.stat === 'draws_this_turn') return this.S.draws[e.player === 'opponent' ? OTHER(ctx.player) : ctx.player];
    if (e.effect_applied_count) return this.S.turnLog.applied[`${e.effect_applied_count.card_id}:${e.effect_applied_count.effect}`] || 0;
    throw new Error('bad expr ' + JSON.stringify(e));
  }

  // ---------- 소환 가능 판정 ----------
  summonRestrictionOk(uid, ctx) {
    const r = this.def(uid).summon_restriction;
    if (!r) return true;
    if (r.only_by_own_effects) return !!ctx.uid && ctx.uid === uid; // 자신의 효과(코스트/처리)로만
    if (!ctx.uid) return false;
    const list = r.only_by_effects_of || [];
    return list.some((x) => (x.card_id && x.card_id === this.S.cards[ctx.uid] && false) ||
      (x.card_id && this.S.cards[ctx.uid].id === x.card_id) ||
      (x.name && this.effectiveName(ctx.uid) === x.name)); // 처리 시점의 이름
  }
  canSummon(uid, ctx, from, opts = {}) {
    const c = this.S.cards[uid], d = this.def(uid);
    if (d.type !== 'monster') return false;
    if (c.zone === 'field') return false;
    if (from && ![].concat(from).includes(c.zone)) return false;
    if (this.S.restrictions.some((r) => r.what === 'summon_limit' && r.player === c.owner && r.remaining <= 0)) return false;
    if (d.summon_once_per_turn && (this.S.turnLog.summoned?.[c.id] || 0) >= 1) return false;
    if (d.summon_condition_required && !opts.ignoreConditions && !opts.procedure) return false; // 소환 조건이 있는 카드는 절차/조건 무시 효과로만
    return this.S.players[opts.ctrl || c.owner].field.length < FIELD_MAX && this.summonRestrictionOk(uid, ctx);
  }
  consumeSummon(owner) { for (const r of this.S.restrictions) if (r.what === 'summon_limit' && r.player === owner && r.remaining > 0) r.remaining--; }
  protectedGrave(u) {
    const c = this.S.cards[u];
    if (c.zone !== 'field' && c.zone !== 'field_zone') return false;
    return this.def(u).effects.some((e) => [].concat(e.continuous || []).some((i) => i.type === 'protection' && i.what === 'cannot_be_sent_to_grave') && this.conditionOk(e, u) && !this.S.disabled[u]);
  }
  unchangeable(uid, eid) { return (this.def(uid).unchangeable_effects || []).includes(eid); }
  cannotLeave(u) {
    const c = this.S.cards[u];
    if (!c || c.zone !== 'field') return false;
    if (this.S.restrictions.some((r) => r.what === 'cannot_leave_field' && r.uid === u)) return true;
    if (this.S.disabled[u]) return false;
    return this.def(u).effects.some((e) => [].concat(e.continuous || []).some((i) => i.type === 'protection' && i.what === 'cannot_leave_field') && this.conditionOk(e, u));
  }
  // 필드 존의 '무효화되지 않는다' 지속 효과 (자신이 발동한 특정 종류의 효과)
  unnegatable(link) {
    for (const u of this.S.players[link.player].field_zone) {
      if (this.S.disabled[u]) continue;
      for (const e of this.def(u).effects) for (const it of [].concat(e.continuous || []))
        if (it.type === 'unnegatable' && this.conditionOk(e, u) && this.effectFilterOk({ uid: link.uid, eid: link.eid }, it.effect_filter)) return true;
    }
    return false;
  }
  locked(link) { return this.unchangeable(link.uid, link.eid) || this.unnegatable(link); }
  activationBanned(uid, effect) {
    const opp = OTHER(this.S.cards[uid].owner);
    for (const z of ['field', 'field_zone']) for (const src of this.S.players[opp][z]) {
      if (this.S.disabled[src]) continue;
      for (const e of this.def(src).effects) for (const it of [].concat(e.continuous || []))
        if (it.type === 'activation_ban' && this.conditionOk(e, src) && this.effectFilterOk({ uid, eid: effect.id }, it.effect_filter)) return true;
    }
    return false;
  }

  // ---------- 스텝 ----------
  runStep(step, ctx, laterSteps = []) {
    const prev = this.actor;
    this.actor = { kind: 'effect', player: ctx.player, uid: ctx.uid };
    try { return this.runStepInner(step, ctx, laterSteps); } finally { this.actor = prev; }
  }
  // 선택: 효과 선택/코스트 선택 공용 (상대 패 프라이버시, 랜덤, 선택 생략 지원)
  doSelect(ctx, s, later, isCost) {
    const P = ctx.player;
    if (s.from === 'deck_top' || s.from === 'opponent_deck_top') {
      const who = s.from === 'deck_top' ? P : OTHER(P), n = this.count(ctx, s.count).min, deck = this.S.players[who].deck;
      if (deck.length < n) return null;
      return (ctx.sel[s.id] = deck.slice(0, n));
    }
    const chooserP = s.chooser === 'opponent' ? OTHER(P) : P;
    const foreign = (u) => this.S.cards[u].zone === 'hand' && this.S.cards[u].owner !== chooserP;
    const hiddenF = (u) => foreign(u) && !this.S.cards[u].revealed;
    let cands = this.fromList(ctx, s.from).filter((u) => this.matches(u, { ...(s.filter || {}), exclude: s.exclude }, ctx) && (isCost || !this.immune(u, ctx)));
    const ls = later.find((x) => x.type === 'summon' && x.card === s.id);
    if (!isCost && ls) cands = cands.filter((u) => this.canSummon(u, ctx, null, { ctrl: ls.to === 'opponent_field' ? OTHER(P) : null, ignoreConditions: !!ls.ignore_conditions }));
    if (s.distinct_names) { const seen = new Set(); cands = cands.filter((u) => { const n = this.effectiveName(u); if (seen.has(n)) return false; seen.add(n); return true; }); }
    if (s.revealed_only) cands = cands.filter((u) => !foreign(u) || this.S.cards[u].revealed);
    let pool = [];
    if (s.hidden_only) cands = cands.filter(hiddenF);
    else if (s.hidden_hand === 'random') { pool = cands.filter(hiddenF); cands = cands.filter((u) => !hiddenF(u)); if (pool.length) cands.push('RANDOM_HIDDEN'); }
    const cnt = this.count(ctx, s.count);
    if (s.optional) cnt.min = 0;
    if (cnt.max < cnt.min && !cnt.all) return null;
    if (cnt.all) {
      const groups = {};
      for (const u of cands) (groups[s.unique_by_name ? this.effectiveName(u) : u] ||= []).push(u);
      const picked = Object.values(groups).map((g) => g.length === 1 ? g[0] : this.choose({ kind: 'cards', player: chooserP, id: s.id, options: g, min: 1, max: 1, ctx: this.describe(ctx) })[0]);
      ctx.sel[s.id] = picked;
      return picked.length >= 1 ? picked : null;
    }
    if (cands.length < cnt.min) return null;
    const max = Math.min(cnt.max, cands.length);
    let pick;
    if (s.selection === 'random' || (s.hidden_only && s.selection !== 'choose')) {
      const a = [...cands]; pick = [];
      for (let i = 0; i < Math.min(max, a.length) && i < Math.max(cnt.min, 1); i++) pick.push(a.splice(Math.floor(this.rng() * a.length), 1)[0]);
    } else pick = this.choose({ kind: 'cards', player: chooserP, id: s.id, options: cands, min: cnt.min, max, ctx: this.describe(ctx) });
    pick = pick.map((u) => { if (u !== 'RANDOM_HIDDEN') return u; const i = Math.floor(this.rng() * pool.length); return pool.splice(i, 1)[0]; });
    ctx.sel[s.id] = pick;
    return pick.length >= cnt.min ? pick : null;
  }
  runStepInner(step, ctx, laterSteps = []) {
    const P = ctx.player;
    switch (step.type) {
      case 'select': return this.doSelect(ctx, step, laterSteps, false) !== null;
      case 'summon': {
        const so = { ctrl: step.to === 'opponent_field' ? OTHER(P) : null, ignoreConditions: !!step.ignore_conditions };
        const us = this.ref(ctx, step.card).filter((u) => this.canSummon(u, ctx, step.from, so));
        if (!us.length) return false;
        let n = 0;
        for (const u of us) {
          const owner = this.S.cards[u].owner, ctl = so.ctrl || owner;
          if (this.S.players[ctl].field.length >= FIELD_MAX || !this.canSummon(u, ctx, step.from, so)) break;
          const from = this.moveCard(u, 'field', { to: ctl });
          this.consumeSummon(owner); this.noteSummoned(u);
          n++;
          this.say(`  소환: ${this.nm(u)} (from ${from})${ctl !== owner ? ' -> 상대 필드' : ''}${step.negated ? ' [효과 무효]' : ''}`);
          if (step.negated) { this.S.cards[u].negated = true; this.S.disabled[u] = true; }
          this.emit({ type: 'summoned', uid: u, from, player: owner, suppress: !!step.suppress_trigger });
        }
        return n > 0;
      }
      case 'add_to_hand': {
        const us = this.ref(ctx, step.card).filter((u) => !this.immune(u, ctx) && !(this.S.cards[u].zone === 'deck' && this.restricted('add_to_hand_from_deck')));
        if (!us.length) return false;
        for (const u of us) {
          const from = this.moveCard(u, 'hand', { revealed: true });
          this.say(`  패에 넣음(공개): ${this.nm(u)}`);
          this.emit({ type: 'added_to_hand', uid: u, from, player: this.S.cards[u].owner, revealed: true });
        }
        return true;
      }
      case 'return_to_hand': return this.moveAll(ctx, step, (u) => { const from = this.moveCard(u, 'hand', { revealed: true }); this.say(`  패로 되돌림(공개): ${this.nm(u)}`); this.emit({ type: 'added_to_hand', uid: u, from, player: this.S.cards[u].owner, revealed: true, returned: true }); }, ['field', 'field_zone', 'grave', 'banished']);
      case 'return_to_deck': return this.moveAll(ctx, step, (u) => { this.moveCard(u, 'deck'); this.shuffle(this.S.cards[u].owner); this.say('  덱으로(섞음): 카드 1장'); }, null);
      case 'banish': return this.restricted('banish') ? false : this.moveAll(ctx, step, (u) => { this.moveCard(u, 'banished'); this.say(`  제외: ${this.nm(u)}`); }, null);
      case 'discard': return this.moveAll(ctx, step, (u) => this.discardCard(u, ctx, step.cause, { ignoreReplacement: step.ignore_replacement }), ['hand']);
      case 'send_to_grave': return this.moveAll(ctx, step, (u) => this.toGrave(u, ctx, step.cause), ['hand', 'deck', 'field', 'field_zone', 'banished', 'keydeck']);
      case 'draw': {
        const whos = step.player === 'both' ? [P, OTHER(P)] : [step.player === 'opponent' ? OTHER(P) : P];
        if (this.restricted('add_to_hand_from_deck')) return false; // 드로우도 "덱에서 패에 넣는 것"
        const plan = [];
        for (const who of whos) {
          const deck = this.S.players[who].deck;
          const cc = this.count(ctx, step.count ?? 1);
          if (cc.max < cc.min || deck.length < cc.min) return false;
          const hi = Math.min(cc.max, deck.length);
          plan.push([who, hi === cc.min ? hi : this.choose({ kind: 'number', player: who, id: 'draw', min: cc.min, max: hi })]);
        }
        for (const [who, n] of plan) for (let i = 0; i < n; i++) {
          const u = this.S.players[who].deck[0];
          this.moveCard(u, 'hand', { revealed: false });
          this.S.draws[who]++;
          // Drawn cards are hidden information. The public event log records the draw count only.
          this.say(`  드로우: ${who} 1장`);
          this.emit({ type: 'added_to_hand', uid: u, from: 'deck', player: who, by_draw: true, revealed: false });
        }
        return true;
      }
      case 'modify_attack': {
        let us;
        if (step.scope) us = this.fromList(ctx, step.scope).filter((u) => this.matches(u, step.filter, ctx));
        else us = this.ref(ctx, step.card).filter((u) => this.S.cards[u].zone === 'field');
        us = us.filter((u) => !this.immune(u, ctx));
        const amt = this.num(ctx, step.amount);
        if (!us.length) return false;
        for (const u of us) { this.S.cards[u].bonus += amt; this.say(`  공격력 +${amt}: ${this.nm(u)} -> ${this.attack(u)}`); }
        return true;
      }
      case 'reveal_hand': {
        const who = step.player === 'opponent' ? OTHER(P) : P;
        for (const u of this.S.players[who].hand) this.S.cards[u].revealed = true;
        this.say(`  ${who}의 패 전체 공개`);
        return true;
      }
      case 'negate_effect': {
        if (step.effect !== 'chain.last') throw new UnsupportedError('negate:' + step.effect);
        const t = this.S.chain[ctx.linkIndex - 1];
        if (!t || t.kind !== 'effect' || t.negated || this.locked(t)) return false;
        t.negated = true; this.say(`  무효: 체인 ${ctx.linkIndex} ${this.def(t.uid).name} ${t.eid}`);
        return true;
      }
      case 'restrict': { // 잔존 효과: 체인을 만들지 않고 턴 끝까지 유지
        if (step.what === 'summon_limit') {
          const pl = step.players === 'opponent' ? OTHER(P) : P;
          this.S.restrictions.push({ what: 'summon_limit', player: pl, remaining: step.count, id: step.id, source: { name: this.def(ctx.uid).name, eid: ctx.eid, turn: this.S.turn.number } });
          this.say(`  제한: 이 턴 ${pl}은 ${step.count}회까지만 몬스터를 소환할 수 있음`);
          return true;
        }
        if (step.what === 'cannot_leave_field') { const u = this.ref(ctx, step.card)[0]; this.S.restrictions.push({ what: step.what, uid: u }); this.say(`  이 턴 필드에서 벗어나지 않음: ${this.nm(u)}`); return true; }
        this.S.restrictions.push({ what: step.what, players: step.players });
        this.say(`  제한: 이 턴 서로 ${step.what} 불가`);
        return true;
      }
      case 'disable_effects': {
        const us = this.ref(ctx, step.card).filter((u) => ['field', 'field_zone'].includes(this.S.cards[u].zone) && !this.immune(u, ctx));
        if (!us.length) return false;
        us.forEach((u) => { this.S.disabled[u] = true; this.say(`  효과 무효(턴 종료시까지): ${this.nm(u)}`); });
        return true;
      }
      case 'register_effect': {
        this.S.temp.push({ uid: ctx.uid, player: ctx.player, effect: step.effect, uses_chain: step.uses_chain !== false });
        this.say(`  임시 효과 등록: ${this.def(ctx.uid).name} ${step.effect.id}`);
        return true;
      }
      case 'place_in_field_zone': {
        const us = this.ref(ctx, step.card);
        if (!us.length) return false;
        for (const old of [...this.S.players[P].field_zone]) this.toGrave(old, ctx, null);
        this.moveCard(us[0], 'field_zone'); this.say(`  필드 존에 놓음: ${this.nm(us[0])}`);
        return true;
      }
      case 'copy_card': {
        const me = this.ref(ctx, step.card)[0], src = this.ref(ctx, step.from)[0];
        if (!me || !src || this.S.cards[me].zone !== 'field') return false;
        this.S.cards[me].copy = { id: this.S.cards[src].copy?.id ?? this.S.cards[src].id };
        this.say(`  ${this.nm(me)} 가 ${this.def(src).name} 의 이름/공격력/효과를 얻음`);
        return true;
      }
      case 'replace_effect': {
        const t = this.S.chain[ctx.linkIndex - 1];
        if (!t || t.kind !== 'effect' || t.negated || this.unchangeable(t.uid, t.eid)) return false;
        t.replaced = { action: step.with }; this.say(`  체인 ${ctx.linkIndex}의 효과가 다른 효과로 바뀜`);
        return true;
      }
      case 'transform_lingering': {
        const tg = step.target;
        const i = this.S.restrictions.findIndex((r) => r.what === 'summon_limit' && r.source && r.source.name === tg.source_name && r.source.eid === tg.effect && (!tg.this_turn || r.source.turn === this.S.turn.number));
        if (i < 0) return false;
        const r = this.S.restrictions.splice(i, 1)[0];
        this.S.delayed.push({ type: 'loss', player: r.player, at: r.source.turn + step.to.turns });
        this.say(`  잔존 효과가 변형됨: ${r.player}는 턴 ${r.source.turn + step.to.turns} 에 패배`);
        return true;
      }
      case 'choose_number': {
        let max = step.max;
        for (const f of step.limit_by || []) max = Math.min(max, this.fromList(ctx, f).length);
        if (max < step.min) return false;
        (ctx.vars ||= {})[step.id] = max === step.min ? max : this.choose({ kind: 'number', player: P, id: step.id, min: step.min, max });
        return true;
      }
      case 'discard_down_to': {
        const who = step.player === 'opponent' ? OTHER(P) : P, hand = this.S.players[who].hand;
        const extra = hand.length - step.remaining;
        if (extra <= 0) return true; // 패가 충분히 적으면 버리지 않음
        const pick = this.choose({ kind: 'cards', player: who, id: 'down', options: [...hand], min: extra, max: extra, ctx: this.describe(ctx) });
        pick.forEach((u) => this.discardCard(u, ctx, null));
        return true;
      }
      case 'modify_limit': {
        const us = this.ref(ctx, step.card);
        if (!us.length) return false;
        const k = `${P}|${this.S.cards[us[0]].id}`;
        this.S.limitBonus[k] = (this.S.limitBonus[k] || 0) + step.amount;
        this.say(`  ${this.def(us[0]).name}의 효과들은 이 턴 발동 횟수 +${step.amount}`);
        return true;
      }
      case 'return_to_keydeck': return this.moveAll(ctx, step, (u) => { this.moveCard(u, 'keydeck'); this.say(`  키 카드 덱으로: ${this.nm(u)}`); }, null);
      case 'grant_immunity': {
        const us = this.ref(ctx, step.card).filter((u) => this.S.cards[u].zone === 'field');
        if (!us.length) return false;
        us.forEach((u) => { this.S.immunities.push({ uid: u, from: step.from }); this.say(`  이 턴 면역 부여(${step.from}): ${this.nm(u)}`); });
        return true;
      }
      case 'set_battle_damage': {
        if (!this.S.combat) return false;
        this.S.combat.override = step.amount; this.say(`  전투 데미지 ${step.amount}으로`);
        return true;
      }
      case 'place_counter': {
        const kinds = step.counter === 'present' ? null : typeof step.counter === 'string' ? [step.counter] : this.counterKindsOf(ctx, step.counter.written_on);
        let total = 0;
        const oppM = this.S.players[OTHER(P)].field.filter((u) => this.def(u).type === 'monster' && !this.immune(u, ctx));
        if (step.distribute) {
          if (!oppM.length) return false;
          const plan = [];
          if (step.distribute.mirror) { for (const [k, n] of Object.entries(this.counterTotals(OTHER(P)))) plan.push([k, n]); }
          else for (const k of kinds || []) { const n = this.choose({ kind: 'number', player: P, id: 'cn_' + k, min: 0, max: step.distribute.max_per_kind }); if (n > 0) plan.push([k, n]); }
          for (const [k, n] of plan) for (let i = 0; i < n; i++) {
            const t = oppM.length === 1 ? oppM[0] : this.choose({ kind: 'cards', player: P, id: 'cdist', options: oppM, min: 1, max: 1 })[0];
            this.addCounter(t, k, 1, ctx); total++;
          }
        } else {
          const targets = step.to === 'all_opponent_monsters' ? oppM : this.ref(ctx, step.to).filter((u) => this.S.cards[u].zone === 'field' && this.def(u).type === 'monster' && !this.immune(u, ctx));
          if (!kinds || !kinds.length || !targets.length) return false;
          const n = this.num(ctx, step.count ?? 1);
          for (const u of targets) for (const k of kinds) { this.addCounter(u, k, n, ctx); total += n; }
        }
        (ctx.vars ||= {})[step.store_as || 'placed'] = total;
        return total > 0;
      }
      case 'remove_counter': {
        const holders = () => (step.from === 'field_all' ? [...this.S.players.A.field, ...this.S.players.B.field] : this.S.players[step.from === 'opponent_field' ? OTHER(P) : P].field);
        const avail = (k) => holders().reduce((a, u) => a + (this.S.cards[u].counters?.[k] || 0), 0);
        const unit = (kinds) => {
          const opts = []; for (const u of holders()) for (const k of kinds) if ((this.S.cards[u].counters?.[k] || 0) > 0) opts.push(`${u}|${k}`);
          if (!opts.length) return null;
          const pick = opts.length === 1 ? opts[0] : this.choose({ kind: 'counter', player: P, id: step.id || 'rm', options: opts, min: 1, max: 1 })[0];
          const [u, k] = pick.split('|'); this.S.cards[u].counters[k]--; if (!this.S.cards[u].counters[k]) delete this.S.cards[u].counters[k];
          this.say(`  카운터 제거: ${k} @ ${this.nm(u)}`); return k;
        };
        let plan = [];
        if (step.per_kind) { for (const k of step.kinds) { if (avail(k) < step.per_kind) return false; plan.push([[k], step.per_kind]); } }
        else if (step.distinct_kinds) {
          const ok = Object.keys(this.counterRules).filter((k) => avail(k) > 0);
          if (ok.length < step.distinct_kinds) return false;
          const ks = ok.length === step.distinct_kinds ? ok : this.choose({ kind: 'kinds', player: P, id: step.id || 'rm', options: ok, min: step.distinct_kinds, max: step.distinct_kinds });
          for (const k of ks) plan.push([[k], 1]);
        } else {
          const kinds = step.kinds || [step.counter];
          const have = kinds.reduce((a, k) => a + avail(k), 0), cnt = this.count(ctx, step.count ?? 1);
          if (have < cnt.min) return false;
          const hi = Math.min(cnt.max, have);
          const n = hi === cnt.min ? hi : this.choose({ kind: 'number', player: P, id: (step.id || 'rm') + '_n', min: cnt.min, max: hi });
          for (let i = 0; i < n; i++) plan.push([kinds, 1]);
        }
        let total = 0;
        for (const [kinds, n] of plan) for (let i = 0; i < n; i++) { if (unit(kinds) === null) return false; total++; }
        (ctx.vars ||= {})[step.id || 'removed'] = total;
        return total > 0;
      }
      case 'choose_branch': {
        const okb = step.branches.filter((b) => this.branchFeasible(b, ctx));
        if (!okb.length) return false;
        let br = okb[0];
        if (okb.length > 1) { const id = this.choose({ kind: 'branch', player: P, id: step.id, options: okb.map((b) => b.id), min: 1, max: 1 })[0]; br = okb.find((b) => b.id === id) || okb[0]; }
        this.say(`  선택: ${br.id}`);
        return this.runGroup({ steps: br.steps, apply: 'simultaneous', allow_partial: false }, ctx);
      }
      case 'use_summon_effects': {
        const us = this.ref(ctx, step.cards).filter((u) => this.S.cards[u].zone === 'field');
        let any = false;
        for (const u of us) for (const e of this.def(u).effects) {
          const ev = e.timing?.event;
          if (!ev || ev.type !== 'summoned' || ev.card !== 'self') continue;
          if (!this.confirm({ player: P, uid: u, effect: e, event: { type: 'use_as_effect' } })) continue;
          this.say(`  ${this.def(u).name} ${e.id} 를 ${this.def(ctx.uid).name} 의 효과로 사용`);
          const res = this.runActions(e, { player: P, uid: ctx.uid, eid: ctx.eid, sel: {}, linkIndex: ctx.linkIndex, targeted: [], event: ctx.event });
          if (res.results[0]) any = true;
        }
        return any;
      }
      case 'hand_or_summon': {
        const us = this.ref(ctx, step.card);
        if (!us.length) return false;
        let did = false;
        for (const u of us) {
          const t = { ...ctx, sel: { ...ctx.sel, __t: [u] } };
          const isMon = this.def(u).type === 'monster', canS = isMon && this.canSummon(u, ctx, null);
          let mode;
          if (step.mode === 'monster_summon_else_hand') { if (isMon && !canS) return false; mode = isMon ? 'summon' : 'hand'; }
          else mode = canS ? this.choose({ kind: 'branch', player: P, id: 'hs', options: ['hand', 'summon'], min: 1, max: 1 })[0] : 'hand';
          if (this.runStepInner({ type: mode === 'summon' ? 'summon' : 'add_to_hand', card: '__t' }, t)) did = true;
        }
        return did;
      }
      case 'conceal_in_hand': { const c = this.S.cards[this.ref(ctx, step.card)[0]]; if (!c || c.zone !== 'hand') return false; c.revealed = false; this.say('  일반 패로 되돌림(비공개): 카드 1장'); return true; }
      case 'store_var': { const c = this.S.cards[ctx.uid]; (c.memory ||= {})[step.key] = ctx.vars?.[step.var] ?? 0; return true; }
      default: throw new UnsupportedError('step:' + step.type);
    }
  }
  branchFeasible(br, ctx) {
    for (let r = 0; r < 3; r++) {
      const sim = this.fork(r);
      try { if (sim.runGroup({ steps: br.steps, allow_partial: false }, structuredClone(ctx))) return true; } catch (e) { if (!(e instanceof UnsupportedError)) throw e; }
    }
    return false;
  }
  addCounter(u, kind, n, ctx) {
    const c = this.S.cards[u];
    c.counters ||= {};
    const before = c.counters[kind] || 0;
    c.counters[kind] = before + n;
    this.say(`  카운터 ${kind} +${n}: ${this.nm(u)} (현재 ${c.counters[kind]})`);
    const r = this.counterRules[kind];
    if (r?.every) {
      const times = Math.floor(c.counters[kind] / r.every.count) - Math.floor(before / r.every.count);
      for (let i = 0; i < times; i++) this.runGroup({ steps: r.every.steps, allow_partial: true }, { player: ctx.player, uid: ctx.uid, eid: ctx.eid, sel: {}, linkIndex: ctx.linkIndex, targeted: [] });
    }
  }
  // 상시 효과: 필드의 이 카드는 상대 카드 효과를 받지 않음 (이 카드를 대상으로 하는 효과 제외)
  passiveOn(u, p) { return !this.S.disabled[u] && (!p.condition || this.locOk(u, p.condition.card_location)); }
  restricted(what) { return this.S.restrictions.some((r) => r.what === what); }
  untargetable(u, ctx = {}) {
    if ((this.def(u).passive || []).some((p) => p.untargetable && this.passiveOn(u, p))) return true;
    const c = this.S.cards[u];
    if (c.zone !== 'field') return false;
    if (!this.S.disabled[u]) for (const e of this.def(u).effects) for (const it of [].concat(e.continuous || []))
      if (it.type === 'untargetable' && it.scope === 'self' && this.conditionOk(e, u) && (it.from === 'effects' || (ctx.player && ctx.player !== this.ctrl(u)))) return true;
    for (const src of this.S.players[this.ctrl(u)].field) for (const e of this.def(src).effects) for (const it of [].concat(e.continuous || [])) {
      if (it.type !== 'untargetable' || it.scope !== 'own_field_other_cards' || src === u) continue;
      if (this.S.disabled[src] || !this.conditionOk(e, src)) continue;
      if (it.filter && !this.matches(u, it.filter, { sel: {} })) continue;
      if (it.from === 'effects' || (it.from === 'opponent_card_effects' && ctx.player && ctx.player !== this.ctrl(u))) return true;
    }
    return false;
  }
  immune(u, ctx) {
    const c = this.S.cards[u];
    for (const p of this.def(u).passive || []) // 카드 단위 패시브 (예: 묘지에서 다른 카드의 효과를 받지 않음)
      if (p.immunity?.from === 'all_other_card_effects' && this.passiveOn(u, p) && ctx.uid !== u && ctx.uid) return true;
    for (const g of this.S.immunities) // 이번 턴 부여된 면역
      if (g.uid === u && g.from === 'other_cards_of_its_controller' && ctx.uid && ctx.uid !== u && this.S.cards[ctx.uid].owner === this.ctrl(u)) return true;
    if (this.S.disabled[u] || c.zone !== 'field' || !ctx.player) return false;
    for (const e of this.def(u).effects) for (const it of [].concat(e.continuous || [])) {
      if (it.type !== 'immunity' || !this.conditionOk(e, u)) continue;
      if (it.from === 'all_other_card_effects' && ctx.uid && ctx.uid !== u) return true;
      if (it.from === 'opponent_card_effects' && ctx.player !== this.ctrl(u) && !(it.except === 'targeting_this_card' && (ctx.targeted || []).includes(u))) return true;
    }
    return false;
  }
  moveAll(ctx, step, fn, requireZones) {
    const us = this.ref(ctx, step.card).filter((u) => (!requireZones || requireZones.includes(this.S.cards[u].zone)) && !this.immune(u, ctx) && !(step.type === 'send_to_grave' && this.protectedGrave(u)) && !(['send_to_grave', 'banish', 'return_to_hand', 'return_to_deck', 'return_to_keydeck'].includes(step.type) && this.cannotLeave(u)));
    if (!us.length) return false;
    us.forEach(fn);
    return true;
  }
  // 버리기: 'would_discard' 대체 효과가 있으면 대신 처리 (체인에 올라가지 않음)
  discardCard(u, ctx, cause, { ignoreReplacement = false } = {}) {
    const c = this.S.cards[u];
    if (ignoreReplacement) { this.toGrave(u, ctx, cause, 'discard'); return; }
    for (const e of this.def(u).effects) {
      const ev = e.timing?.event;
      if (!ev || ev.type !== 'would_discard' || c.zone !== 'hand') continue;
      if (ev.card_state === 'revealed' && !c.revealed) continue;
      if (!this.conditionOk(e, u) || !this.limitOk(e, u)) continue;
      if (!this.feasible(u, e)) continue;
      if (!this.confirm({ player: c.owner, uid: u, effect: e, event: { type: 'would_discard' } })) continue;
      this.say(`  대체 효과: ${this.nm(u)} ${e.id} (버려지는 대신 처리)`);
      this.useLimit(e, u);
      const rctx = { player: c.owner, uid: u, eid: e.id, sel: {}, linkIndex: this.S.chain.length, targeted: [] };
      const res = this.runActions(e, rctx);
      if (res.results[0]) { this.noteApplied(rctx); return; }
    }
    this.toGrave(u, ctx, cause, 'discard');
  }
  toGrave(u, ctx, cause, reason = null) {
    if (this.protectedGrave(u) || this.cannotLeave(u)) return; // 묘지로 보내지지 않는다 / 필드에서 벗어날 수 없다
    const from = this.moveCard(u, 'grave');
    const cz = cause || (ctx.uid ? `${this.S.cards[ctx.uid].id}:${ctx.eid}` : null);
    this.S.turnLog.graveBy[u] = cz;
    this.say(`  묘지로: ${this.nm(u)} (from ${from})`);
    this.emit({ type: 'sent_to_grave', uid: u, from, cause: cz, reason, player: ctx.player });
  }
  count(ctx, c) {
    if (typeof c === 'number') return { min: c, max: c };
    if (c === 'all_possible') return { min: 1, max: Infinity, all: true };
    if (c.min === undefined && c.max === undefined) { const n = this.num(ctx, c); return { min: n, max: n }; } // 수식 = 정확히 그 수
    const min = c.min ?? 1;
    const max = c.max === undefined ? min : c.max === null ? Infinity : this.num(ctx, c.max);
    return { min, max };
  }
  describe(ctx) { return `${ctx.uid}:${ctx.eid}`; }

  // ---------- 그룹/처리 ----------
  runGroup(g, ctx) {
    const snap = structuredClone(this.S);
    const selSnap = { ...ctx.sel };
    let ok = true, any = false;
    for (let i = 0; i < g.steps.length; i++) {
      const r = this.runStep(g.steps[i], ctx, g.steps.slice(i + 1));
      if (r) any = true;
      if (!r) { ok = false; if (!g.allow_partial) break; }
    }
    if (g.allow_partial) ok = any; // 일부만 처리돼도 처리된 것으로 본다
    if (!ok && !g.allow_partial) { // 동시 처리: 하나라도 실패하면 그룹 전체 롤백
      const events = snap.pending;
      this.state = snap; ctx.sel = selSnap; this.S.pending = events;
    }
    return ok;
  }
  noteApplied(ctx) { const k = `${this.S.cards[ctx.uid].id}:${ctx.eid}`; this.S.turnLog.applied[k] = (this.S.turnLog.applied[k] || 0) + 1; }
  runActions(effect, ctx) {
    let prevFailed = false, firstResult = null;
    const results = [];
    for (let i = 0; i < effect.action.length; i++) {
      const g = effect.action[i];
      if (g.repeat?.rounds) { // 라운드 반복: 서로 번갈아, 정해진 라운드 수만큼
        const R = g.repeat;
        const rounds = this.num(ctx, R.rounds);
        let ended = false, did = 0;
        for (let r = 0; r < rounds && !ended; r++) for (const who of R.player_order) {
          const pl = who === 'opponent' ? OTHER(ctx.player) : ctx.player;
          const res = this.runActions({ action: R.body }, { ...ctx, player: pl, sel: {} });
          results.push(...res.results);
          if (!res.results[0]) { ended = true; break; }
          did++;
        }
        if (i === 0) firstResult = did > 0;
        continue;
      }
      if (g.repeat) { // 반복 블록: 최소 1회, 매 회 끝나고 더 할지 선택, 도중 실패하면 종료
        const R = g.repeat; let loops = 0;
        for (;;) {
          const r = this.runActions({ action: R.body }, ctx);
          loops++;
          results.push(...r.results);
          if (!r.results[0]) break;
          if (R.max && loops >= R.max) break;
          if (!this.again({
            player: ctx.player,
            loops,
            uid: ctx.uid,
            effect: this.def(ctx.uid).effects.find((item) => item.id === ctx.eid),
            event: ctx.event,
            ctx: this.describe(ctx),
          })) break;
        }
        if (i === 0) firstResult = loops > 0;
        continue;
      }
      if (i > 0 && prevFailed && (g.on_prev_fail ?? 'stop') === 'stop') break;
      const ok = this.runGroup(g, ctx);
      results.push(ok);
      prevFailed = !ok;
      if (i === 0) firstResult = ok || !!g.optional;
    }
    return { firstOk: firstResult, results };
  }

  // ---------- 코스트 ----------
  payCost(effect, ctx) {
    const prev = this.actor;
    this.actor = { kind: 'cost', player: ctx.player, uid: ctx.uid };
    try { return this.payCostInner(effect, ctx); } finally { this.actor = prev; }
  }
  payCostInner(effect, ctx) {
    const cost = effect.cost;
    if (!cost) return true;
    for (const t of cost.targets || []) {
      if (t.kind !== 'card') throw new UnsupportedError('target:' + t.kind);
      const c = this.fromList(ctx, t.from).filter((u) => this.matches(u, t.filter, ctx) && !this.untargetable(u, ctx));
      if (!c.length) return false;
      ctx.sel[t.id] = this.choose({ kind: 'cards', player: ctx.player, id: t.id, options: c, min: t.count ?? 1, max: t.count ?? 1, ctx: this.describe(ctx) });
      ctx.targeted.push(...ctx.sel[t.id]);
      for (const u of ctx.sel[t.id]) (ctx.targetZone ||= {})[u] = this.S.cards[u].zone;
    }
    for (const p of cost.pay || []) {
      switch (p.type) {
        case 'reveal': {
          const c = this.S.cards[ctx.uid];
          if (c.zone !== 'hand') break; // 패가 아닌 곳에서 발동하면 공개할 필요 없음
          if (!c.revealed) { c.revealed = true; this.say(`  공개: ${this.nm(ctx.uid)}`); }
          break;
        }
        case 'return_to_deck': {
          const us = !p.card || p.card === 'self' ? [ctx.uid] : this.ref(ctx, p.card);
          if (!us.length || (p.card === 'self' || !p.card) && this.S.cards[ctx.uid].zone !== 'hand') return false;
          us.forEach((u) => { const o = this.S.cards[u].owner; this.moveCard(u, 'deck'); this.shuffle(o); this.say('  코스트: 덱으로(섞음) 카드 1장'); });
          break;
        }
        case 'banish': {
          const us = this.ref(ctx, p.card);
          if (!us.length || this.restricted('banish')) return false;
          us.forEach((u) => { this.moveCard(u, 'banished'); this.say(`  코스트 제외: ${this.nm(u)}`); });
          break;
        }
        case 'discard': {
          const us = this.ref(ctx, p.card);
          if (!us.length) return false;
          us.forEach((u) => this.discardCard(u, ctx, null, { ignoreReplacement: p.ignore_replacement }));
          break;
        }
        case 'select': {
          if (this.doSelect(ctx, p, [], true) === null) return false;
          break;
        }
        case 'summon': case 'send_to_grave': case 'draw': case 'disable_effects': case 'return_to_hand': case 'add_to_hand': case 'remove_counter':
          if (p.type === 'send_to_grave' && this.ref(ctx, p.card).some((u) => this.protectedGrave(u))) return false;
          if (!this.runStepInner(p, ctx)) return false;
          break;
        default: throw new UnsupportedError('cost:' + p.type);
      }
    }
    return true;
  }

  // ---------- 조건/타이밍/제한 ----------
  locOk(uid, loc) {
    if (Array.isArray(loc)) return loc.some((l) => this.locOk(uid, l));
    const c = this.S.cards[uid];
    if (loc === 'hand_hidden') return c.zone === 'hand' && !c.revealed;
    if (loc === 'hand_revealed') return c.zone === 'hand' && c.revealed;
    return c.zone === loc;
  }
  conditionOk(effect, uid, ev) {
    const cd = effect.condition;
    if (!cd) return true;
    const ctx = { player: this.S.cards[uid].owner, uid, sel: {}, event: ev };
    if (cd.card_location && !this.locOk(uid, cd.card_location)) return false;
    if (cd.expr?.compare && !this.cmp(ctx, cd.expr.compare)) return false;
    if (cd.controller_field_has_other) { const ctl = this.ctrl(uid); if (!this.S.players[ctl].field.some((x) => x !== uid && this.matches(x, cd.controller_field_has_other, { sel: {} }))) return false; }
    if (cd.event_card_in && !(ev && this.locOk(ev.uid, cd.event_card_in))) return false;
    if (cd.empty && this.fromList(ctx, cd.empty).length) return false;
    if (cd.any_of && !cd.any_of.some((sub) => this.conditionOk({ condition: sub }, uid, ev))) return false;
    if (cd.exists) {
      const e = cd.exists;
      if (e.card_id) {
        const L = this.S.players[ctx.player].hand.filter((u) => this.def(u).id === e.card_id && (e.location !== 'hand_revealed' || this.S.cards[u].revealed));
        if (!L.length) return false;
      } else if (e.location) {
        if (!this.fromList(ctx, e.location).some((u) => this.matches(u, e.filter, ctx))) return false;
      }
    }
    return true;
  }
  wins(effect) { return effect.timing?.any_of ?? (effect.timing ? [effect.timing] : []); }
  windowOk(w, uid) {
    const c = this.S.cards[uid];
    if (!w || w.event || w.turn === null || w.turn === undefined) return false;
    const mine = this.S.turn.player === c.owner;
    if (w.turn === 'self' && !mine) return false;
    if (w.turn === 'opponent' && mine) return false;
    return w.phase === 'all' || w.phase === this.S.turn.phase;
  }
  timingOk(effect, uid) { return this.wins(effect).some((w) => this.windowOk(w, uid)); }
  cardKey(uid) { const c = this.S.cards[uid]; return `${c.owner}|${c.copy?.id ?? c.id}`; } // 효과로 복사한 카드는 원본과 횟수 공유
  limitKey(effect, uid) {
    const l = effect.limit, g = l.group;
    if (g === 'card_id') return this.cardKey(uid);
    if (g && g.startsWith('shared:')) return `${this.cardKey(uid)}#${g}`;
    return `${this.cardKey(uid)}:${effect.id}`;
  }
  limitOk(effect, uid) {
    const l = effect.limit;
    if (!l) return true;
    const key = this.limitKey(effect, uid);
    if (l.kind === 'application') return (this.S.appUsage[key] || 0) < l.count;
    return (this.S.usage[l.scope][key] || 0) < l.count + (this.S.limitBonus[this.cardKey(uid)] || 0);
  }
  useLimit(effect, uid) {
    const l = effect.limit; if (!l) return;
    const key = this.limitKey(effect, uid);
    this.S.usage[l.scope][key] = (this.S.usage[l.scope][key] || 0) + 1;
  }

  // ---------- 발동 / 체인 ----------
  fork(rot = 0) {
    const rotChoose = ({ kind, options, min, max }) => {
      if (kind === 'number') return max;
      const n = Math.max(min, Math.min(max, options.length)), o = options.length ? rot % options.length : 0;
      return [...options.slice(o), ...options.slice(0, o)].slice(0, n);
    };
    const e = new Engine(Object.values(this.defs), { choose: rotChoose, effectFilters: this.effectFilters, counterRules: this.counterRules });
    e.state = structuredClone(this.state); e.state.pending = []; e.dry = true;
    return e;
  }
  // 선택지를 바꿔가며(회전) 하나라도 처리 가능하면 가능
  feasible(uid, effect, ev) {
    for (let r = 0; r < 6; r++) if (this.feasibleOnce(uid, effect, ev, r)) return true;
    return false;
  }
  feasibleOnce(uid, effect, ev, rot) {
    const sim = this.fork(rot);
    const ctx = { player: this.S.cards[uid].owner, uid, eid: effect.id, sel: {}, linkIndex: this.S.chain.length, targeted: [], event: ev };
    try {
      if (!sim.payCost(effect, ctx)) return false;
      const g = effect.action[0];
      if (g.repeat) return sim.runGroup(g.repeat.body[0], ctx) || !!g.repeat.body[0].optional;
      return sim.runGroup(g, ctx) || !!g.optional;
    } catch (e) { if (e instanceof UnsupportedError) return false; throw e; }
  }
  canActivate(uid, effect, ev, { asActivation = false } = {}) {
    if (!effect) return false;
    const d = this.def(uid);
    if (d.type === 'field' && d.activation_effect === effect.id && !asActivation) return false;
    if (effect.continuous || this.S.disabled[uid]) return false;
    if (!this.conditionOk(effect, uid, ev)) return false;
    if (this.activationBanned(uid, effect)) return false;
    if (!this.limitOk(effect, uid)) return false;
    return true;
  }
  // 우선권이 있을 때(체인 없음) 발동 가능한 기동 효과
  activatableEffects(player) { return this.options(player, false); }
  activatableIgnitions(player) {
    return this.options(player, false);
  }
  // 체인이 비어 있을 때 필드 카드를 카드 발동으로 체인에 올린다.
  fieldActivationOptions(player) {
    return this.S.players[player].hand
      .filter((uid) => this.canActivateFieldCard(player, uid))
      .map((uid) => ({ fieldActivation: true, uid }));
  }
  canActivateFieldCard(player, uid) {
    const c = this.S.cards[uid], d = this.def(uid);
    if (!c || c.owner !== player || c.zone !== 'hand' || this.S.chain.length) return false;
    if (d.type !== 'field' && d.activation_zone !== 'field_zone') return false;
    const timing = d.activation_timing || { turn: 'self', phase: 'deploy', event: null };
    if (this.wins({ timing }).some((w) => w.event)) return false;
    if (!this.wins({ timing }).some((w) => this.windowOk(w, uid))) return false;
    const activationEffect = d.activation_effect && d.effects.find((e) => e.id === d.activation_effect);
    if (d.activation_effect && !activationEffect) return false;
    if (!activationEffect) return true;
    return this.canActivate(uid, activationEffect, undefined, { asActivation: true }) && this.feasible(uid, activationEffect);
  }
  // 체인 위에서는 빠른 효과와 현재 체인에 반응하는 유발 효과만 허용한다.
  options(player, inChain, { fastOnly = false } = {}) {
    const out = [];
    const last = this.S.chain[this.S.chain.length - 1];
    for (const z of ['hand', 'field', 'field_zone', 'grave', 'banished', 'keydeck']) for (const uid of this.S.players[player][z])
      for (const e of this.def(uid).effects) {
        if (this.S.cards[uid].owner !== player) continue;
        if (e.continuous) continue;
        if (this.def(uid).type === 'field' && this.def(uid).activation_effect === e.id) continue;
        const ok = this.wins(e).some((w) => w.event
          ? inChain && last && w.event.type === 'effect_activated' && this.activatedMatches(w.event, last, player)
          : this.windowOk(w, uid) && (!inChain || !(w.turn === 'self' && w.phase === 'deploy')));
        if (!ok || (fastOnly && !this.isFastEffect(e, uid)) || !this.canActivate(uid, e) || !this.feasible(uid, e)) continue;
        out.push({ uid, eid: e.id });
      }
    return out;
  }
  isFastEffect(effect, uid) {
    if (effect.activation_type === 'quick') return true;
    if (effect.activation_type === 'ignition' || this.wins(effect).some((w) => w.event)) return false;
    if (this.def(uid).type === 'trap') return true;
    return this.wins(effect).some((w) =>
      w.turn === 'opponent' || w.turn === 'both' || w.phase === 'all' ||
      ['draw', 'attack', 'end'].includes(w.phase));
  }
  activatedMatches(ev, link, player) {
    if (!['effect', 'field_activation'].includes(link.kind)) return false;
    if (ev.by === 'opponent' && link.player === player) return false;
    if (ev.by === 'self' && link.player !== player) return false;
    if (ev.turn === 'self' && this.S.turn.player !== player) return false;
    if (ev.turn === 'opponent' && this.S.turn.player === player) return false;
    return this.effectFilterOk(link, ev.effect_filter);
  }
  effectFilterOk(link, f) {
    if (!f) return true;
    if (f.ref) return this.effectFilterOk(link, this.effectFilters[f.ref]);
    if (f.source_type && this.def(link.uid).type !== f.source_type) return false;
    if (f.card_name && this.effectiveName(link.uid) !== f.card_name) return false;
    if (f.contains_step) { const effect = this.def(link.uid).effects.find((e) => e.id === link.eid); return effect ? this.effectContains(effect, f.contains_step) : false; }
    if (f.includes_any) {
      const effect = this.def(link.uid).effects.find((e) => e.id === link.eid);
      if (!effect) return false;
      const sigs = this.effectSignature(effect);
      return f.includes_any.some((p) => sigs.some((g) => g.step === p.step && (!p.from || (g.from && g.from.some((z) => p.from.includes(z))))));
    }
    return true;
  }
  effectContains(effect, types) {
    const walk = (o) => Array.isArray(o) ? o.some(walk) : o && typeof o === 'object' ? (types.includes(o.type) || Object.values(o).some(walk)) : false;
    return walk(effect.action || []) || walk(effect.cost?.pay || []);
  }
  // 효과 텍스트(스텝)를 정적으로 분석해서 "무엇을 포함하는 효과인지" 판정하기 위한 목록
  effectSignature(effect) {
    const norm = (f) => [].concat(f).map((x) => (x === 'deck_top' ? 'deck' : x));
    const fromOf = {}, sigs = [];
    for (const t of effect.cost?.targets || []) fromOf[t.id] = norm(t.from);
    for (const p of effect.cost?.pay || []) if (p.type === 'select') fromOf[p.id] = norm(p.from);
    for (const p of effect.cost?.pay || []) if (p.type !== 'select' && p.type !== 'reveal') sigs.push({ step: p.type, from: typeof p.card === 'string' ? fromOf[p.card] || null : null });
    const groups = (acts) => acts.flatMap((g) => (g.repeat ? groups(g.repeat.body) : [g]));
    const gs = groups(effect.action || []);
    for (const g of gs) for (const st of g.steps) if (st.type === 'select') fromOf[st.id] = norm(st.from);
    for (const g of gs) for (const st of g.steps) {
      if (st.type === 'select') continue;
      const from = st.from ? norm(st.from) : typeof st.card === 'string' ? fromOf[st.card] || null : null;
      sigs.push({ step: st.type, from: st.type === 'draw' ? ['deck'] : from });
    }
    return sigs;
  }
  // 발동 선언: 코스트 지불 -> 체인에 올림 (처리는 체인 종료 시)
  declare(uid, eid, { check = 'timing', event } = {}) {
    const effect = this.def(uid).effects.find((e) => e.id === eid);
    const player = this.S.cards[uid].owner;
    if (check === 'timing' && !this.timingOk(effect, uid)) throw new Error('타이밍 아님: ' + this.nm(uid) + ' ' + eid);
    if (!this.canActivate(uid, effect, event)) throw new Error('발동 불가(조건/제한): ' + this.nm(uid) + ' ' + eid);
    if (!this.feasible(uid, effect, event)) throw new Error('처리 불가: ' + this.nm(uid) + ' ' + eid);
    const ctx = { player, uid, eid, sel: {}, linkIndex: this.S.chain.length, targeted: [], event };
    const snap = structuredClone(this.S);
    if (!this.payCost(effect, ctx)) { this.state = snap; throw new Error('코스트 지불 실패'); }
    this.useLimit(effect, uid);
    // 일반/마법/함정 카드: 발동과 동시에 묘지로 (마함존 없음)
    if (this.def(uid).type !== 'monster' && this.S.cards[uid].zone === 'hand') {
      if (this.def(uid).activation_zone === 'field_zone') { // 필드 카드: 필드 존에 놓임, 기존 카드는 묘지로
        for (const old of [...this.S.players[player].field_zone]) { this.toGrave(old, { player, uid, eid }, null); }
        this.moveCard(uid, 'field_zone'); this.say(`  필드 존에 놓임: ${this.nm(uid)}`);
      } else { this.moveCard(uid, 'grave'); this.say(`  발동과 동시에 묘지로: ${this.nm(uid)}`); }
    }
    this.S.chain.push({ kind: 'effect', uid, eid, player, ctx, negated: false });
    this.say(`${'  '.repeat(0)}체인 ${this.S.chain.length}: ${player} ${this.def(uid).name} ${eid}`);
  }
  declareFieldActivation(uid) {
    const player = this.S.cards[uid]?.owner;
    if (!this.canActivateFieldCard(player, uid)) throw new Error('필드 카드 발동 불가: ' + this.nm(uid));
    const d = this.def(uid);
    const effect = d.activation_effect ? d.effects.find((e) => e.id === d.activation_effect) : null;
    const ctx = effect ? { player, uid, eid: effect.id, sel: {}, linkIndex: this.S.chain.length, targeted: [] } : null;
    const snap = structuredClone(this.S);
    if (effect && !this.payCost(effect, ctx)) { this.state = snap; throw new Error('필드 카드 발동 코스트 지불 실패'); }
    if (effect) this.useLimit(effect, uid);
    for (const old of [...this.S.players[player].field_zone]) this.toGrave(old, { player, uid, eid: effect?.id ?? 'activation' }, null);
    this.moveCard(uid, 'field_zone');
    this.say(`  필드 존에 발동: ${this.nm(uid)}`);
    this.S.chain.push({ kind: 'field_activation', uid, eid: effect?.id ?? null, player, ctx, negated: false });
    this.say(`체인 ${this.S.chain.length}: ${player} ${d.name} 카드 발동`);
  }
  activateFieldCard(uid) { this.declareFieldActivation(uid); this.runChain(); }
  activate(uid, eid) {
    const d = this.def(uid);
    if (d.type === 'field' && d.activation_effect === eid && this.S.cards[uid].zone === 'hand') return this.activateFieldCard(uid);
    this.declare(uid, eid); this.runChain();
  }
  activateCard(uid, eid) { return this.activate(uid, eid); } // 호환용

  // 체인 진행: 응답 창 -> 역순 처리 -> 유발 효과로 새 체인, 이어서 빠른 효과 창
  runChain({ window = 'after_resolution' } = {}) {
    this.resolveChains();
    this.quickEffectWindow({ window });
  }
  resolveChains() {
    let guard = 0;
    while (this.S.chain.length && guard++ < 50) {
      this.responseWindow();
      while (this.S.chain.length) this.resolveLink(this.S.chain.pop());
      this.collectTriggers();
    }
  }
  responseWindow() {
    const top = this.S.chain[this.S.chain.length - 1];
    if (['effect', 'field_activation'].includes(top.kind) && this.def(top.uid).effects.find((e) => e.id === top.eid)?.no_response) return; // 서로 이 효과에 응답할 수 없다
    let passes = 0;
    let p = OTHER(this.S.chain[this.S.chain.length - 1].player);
    let guard = 0;
    while (passes < 2 && guard++ < 50) {
      const opts = this.options(p, true);
      const f = this.fetchOptions(p);
      const all = [...opts, ...f];
      const pick = all.length ? this.respond({ player: p, options: all, chain: this.S.chain.map((l) => ({ ...l, ctx: undefined })), window: 'chain_response' }) : null;
      if (pick) {
        if (pick.fetch) this.declareFetch(p, pick.uid);
        else if (pick.fieldActivation) this.declareFieldActivation(pick.uid);
        else this.declare(pick.uid, pick.eid, { check: 'none' });
        passes = 0;
      } else passes++;
      p = OTHER(p);
    }
  }
  activateResponse(player, pick) {
    if (pick.fetch) this.declareFetch(player, pick.uid);
    else if (pick.fieldActivation) this.declareFieldActivation(pick.uid);
    else this.declare(pick.uid, pick.eid, { check: 'none' });
  }
  quickEffectWindow({ window = 'after_resolution', firstPlayer = this.S.turn.player } = {}) {
    let passes = 0, player = firstPlayer, guard = 0;
    while (passes < 2 && guard++ < 50) {
      const options = this.options(player, false, { fastOnly: true });
      const pick = options.length ? this.respond({ player, options, chain: [], window }) : null;
      if (pick) {
        this.activateResponse(player, pick);
        this.resolveChains();
        passes = 0;
        player = this.S.turn.player;
      } else {
        passes += 1;
        player = OTHER(player);
      }
    }
  }
  phaseBoundaryWindow() {
    const turnPlayer = this.S.turn.player;
    const responder = OTHER(turnPlayer);
    const options = this.options(responder, false, { fastOnly: true });
    const pick = options.length ? this.respond({ player: responder, options, chain: [], window: 'phase_end' }) : null;
    if (!pick) return;
    this.activateResponse(responder, pick);
    this.resolveChains();
    this.quickEffectWindow({ window: 'after_resolution', firstPlayer: turnPlayer });
  }
  resolveLink(link) {
    const n = this.S.chain.length + 1;
    if (link.kind === 'fetch') {
      this.say(`처리(체인 ${n}): 가져오기`);
      if (this.S.cards[link.uid].zone === 'keydeck') { this.moveCard(link.uid, 'hand', { revealed: true }); this.say(`  가져옴(공개): ${this.nm(link.uid)}`); }
      return;
    }
    const isFieldActivation = link.kind === 'field_activation';
    const effect = link.eid == null ? null : this.def(link.uid).effects.find((e) => e.id === link.eid);
    if (!effect && !isFieldActivation) throw new UnsupportedError(`chain-link:${link.kind}`);
    if (this.S.disabled[link.uid] && !this.locked(link)) link.negated = true; // 자물쇠 등으로 효과가 무효가 된 카드의 체인 위 효과도 처리 시 무효
    this.say(`처리(체인 ${n}): ${this.def(link.uid).name}${effect ? ` ${link.eid}` : ' 카드 발동'}${link.negated ? ' [무효]' : ''}`);
    if (link.negated) return;
    if (!effect) { this.say('  발동만 처리 (효과 없음)'); return; }
    const ctx = link.ctx;
    // 상시 선택 효과: 자신이 발동한 몬스터 효과의 처리 시점에 무효로 할 수 있다 (체인 없음)
    for (const u of this.S.players[link.player].field_zone) for (const e of this.def(u).effects) {
      const it = e.continuous;
      if (!it || it.type !== 'resolution_option' || this.S.disabled[u] || !this.conditionOk(e, u)) continue;
      if (!this.matches(link.uid, it.when?.source_filter, { sel: {} })) continue;
      const k = this.limitKey(e, u);
      if (e.limit && (this.S.appUsage[k] || 0) >= e.limit.count) continue;
      if (this.option({ player: link.player, uid: u, eid: e.id, link })) {
        this.S.appUsage[k] = (this.S.appUsage[k] || 0) + 1;
        this.say(`  처리 시 무효 선택: ${this.def(u).name} ${e.id}`);
        return;
      }
    }
    if (link.replaced) {
      this.noteApplied(ctx);
      this.runActions({ action: link.replaced.action }, { ...ctx, player: link.player, sel: {}, targeted: [] });
      return;
    }
    if ((effect.cost?.targets || []).some((t) => (ctx.sel[t.id] || []).some((u) => this.S.cards[u].zone !== (ctx.targetZone?.[u] ?? this.S.cards[u].zone) || (ctx.targetZone?.[u] === undefined && !['field', 'field_zone'].includes(this.S.cards[u].zone))))) { this.say('  불발(대상 소실)'); return; }
    this.noteApplied(ctx);
    const res = this.runActions(effect, ctx);
    this.say(`  처리 결과: ${JSON.stringify(res.results)}`);
  }

  // ---------- 유발 ----------
  eventMatches(ev, effect, uid) {
    return this.wins(effect).some((w) => w.event && this.eventMatchesOne(ev, w.event, uid));
  }
  eventMatchesOne(ev, t, uid) {
    if (t.type !== ev.type) return false;
    if (ev.suppress && t.type === 'summoned' && t.card === 'self' && ev.uid === uid) return false; // 소환 시의 효과는 발동하지 않는다
    const owner = this.S.cards[uid].owner;
    if (t.by === 'opponent' && ev.player === owner) return false;
    if (t.by === 'self' && ev.player !== owner) return false;
    if (t.from && ev.from !== t.from) return false;
    if (t.card === 'self' && ev.uid !== uid && ev.type !== 'effect_activated') return false;
    if (t.card_filter && !this.matches(ev.uid, t.card_filter, { sel: {} })) return false;
    switch (ev.type) {
      case 'summoned': return true;
      case 'sent_to_grave':
        if (t.reason && ev.reason !== t.reason) return false;
        if (t.cause_card && (ev.cause || '').split(':')[0] !== t.cause_card) return false;
        return true;
      case 'moved_to_zone':
        if (t.to && !t.to.includes(ev.to)) return false;
        if (t.owner === 'self' && ev.player !== owner) return false;
        if (t.cause && ev.cause !== t.cause) return false;
        if (t.cause_player === 'opponent' && (!ev.cause_player || ev.cause_player === owner)) return false;
        if (t.cause_card === 'self' && ev.cause_uid !== uid) return false;
        return true;
      case 'added_to_hand':
        if (t.revealed !== undefined && !!ev.revealed !== t.revealed) return false;
        return true;
      case 'attack_declared': return true;
      default: throw new UnsupportedError('event:' + t.type);
    }
  }
  // 체인 처리 후 쌓인 이벤트로 유발 효과를 모아 새 체인으로 올린다 (턴 플레이어 먼저)
  collectTriggers() {
    const evs = this.S.pending.splice(0);
    if (!evs.length) return;
    // 1) 잔존 효과(체인을 만들지 않는 임시 유발 효과)는 조건이 되면 즉시 처리
    for (const ev of evs) for (const t of [...this.S.temp]) {
      const te = t.effect.timing.event;
      if (!te || te.type !== ev.type) continue;
      if (te.by === 'opponent' && ev.player === t.player) continue;
      if (te.by === 'self' && ev.player !== t.player) continue;
      if (te.from && ev.from !== te.from) continue;
      this.say(`잔존 효과 처리(체인 없음): ${this.def(t.uid).name} ${t.effect.id}`);
      const ctx = { player: t.player, uid: t.uid, eid: t.effect.id, sel: {}, linkIndex: this.S.chain.length, targeted: [], event: ev };
      this.runActions(t.effect, ctx);
    }
    // 2) 일반 유발 효과: 턴 플레이어 먼저 새 체인으로
    const order = [this.S.turn.player, OTHER(this.S.turn.player)];
    const used = new Set();
    for (const p of order) for (const ev of evs) {
      for (const z of ['field', 'field_zone', 'hand', 'grave', 'banished', 'keydeck'])
        for (const uid of [...this.S.players[p][z]])
          for (const e of this.def(uid).effects) {
            if (!this.wins(e).some((w) => w.event)) continue;
            let m; try { m = this.eventMatches(ev, e, uid); } catch (x) { if (x instanceof UnsupportedError) continue; throw x; }
            const key = `${uid}:${e.id}:${ev.uid}:${ev.type}`;
            if (!m || used.has(key) || !this.canActivate(uid, e, ev) || !this.feasible(uid, e, ev)) continue;
            if (!e.mandatory && !this.confirm({ player: this.S.cards[uid].owner, uid, effect: e, event: ev })) continue;
            used.add(key);
            this.say(`유발: ${this.nm(uid)} ${e.id} <- ${ev.type}`);
            this.declare(uid, e.id, { check: 'none', event: ev });
          }
    }
  }
  processTriggers({ window = 'after_action' } = {}) {
    this.collectTriggers();
    if (this.S.chain.length) this.runChain({ window });
    else this.quickEffectWindow({ window });
  }

  // ---------- 가져오기(키 카드): 체인에 올라가지만 무효 불가, 같은 체인에 1개만 ----------
  fetchOk(player, uid) {
    const c = this.S.cards[uid], d = this.def(uid);
    if (c.zone !== 'keydeck' || c.owner !== player || d.fetch?.forbidden) return false;
    if (this.S.chain.some((l) => l.kind === 'fetch')) return false;
    const cond = d.fetch?.condition;
    if (cond) {
      const ctx = { player, sel: {} };
      if (cond.own_field?.has && !this.fromList(ctx, 'own_field').some((u) => this.def(u).type === cond.own_field.has)) return false;
      if (cond.opponent_field?.has && !this.fromList(ctx, 'opponent_field').some((u) => this.def(u).type === cond.opponent_field.has)) return false;
    }
    return true;
  }
  fetchOptions(player) { return this.S.players[player].keydeck.filter((u) => this.fetchOk(player, u)).map((uid) => ({ fetch: true, uid })); }
  declareFetch(player, uid) {
    if (!this.fetchOk(player, uid)) throw new Error('가져오기 불가');
    this.S.chain.push({ kind: 'fetch', uid, player, negated: false });
    this.say(`체인 ${this.S.chain.length}: ${player} 가져오기 선언 (카드 비공개)`);
  }
  fetchKeyCard(player, uid) { this.declareFetch(player, uid); this.runChain(); }

  // ---------- 키 카드 소환 절차 (체인을 만들지 않고 조건이 되면 즉시) ----------
  subsetsFor(player, item, used) {
    const ctx = { player, sel: {} };
    const cands = this.fromList(ctx, item.from).filter((u) => !used.has(u) && this.matches(u, item.filter, ctx));
    const cnt = this.count(ctx, item.count);
    const out = [];
    const rec = (i, cur) => {
      if (cur.length >= cnt.min && cur.length <= cnt.max) {
        const sum = cur.reduce((a, u) => a + this.attack(u), 0);
        if (!item.constraint || (item.constraint.op === '>=' && sum >= item.constraint.value)) out.push([...cur]);
      }
      if (cur.length >= cnt.max) return;
      for (let j = i; j < cands.length; j++) { cur.push(cands[j]); rec(j + 1, cur); cur.pop(); }
    };
    rec(0, []);
    return out;
  }
  keySummonFeasible(player, uid, from = 0, used = new Set()) {
    const sp = this.def(uid).summon_procedure, pay = sp.cost.pay;
    if (from === pay.length) return true;
    if (pay[from].type === 'remove_counter') {
      const sim = this.fork();
      try { if (!sim.runStepInner({ ...pay[from], id: 'proc' }, { player, uid, eid: 'procedure', sel: {}, vars: {}, targeted: [], linkIndex: 0 })) return false; } catch (e) { if (e instanceof UnsupportedError) return false; throw e; }
      return this.keySummonFeasible(player, uid, from + 1, used);
    }
    return this.subsetsFor(player, pay[from], used).some((sub) => this.keySummonFeasible(player, uid, from + 1, new Set([...used, ...sub])));
  }
  canKeySummon(player, uid) {
    const c = this.S.cards[uid], sp = this.def(uid).summon_procedure;
    if (!sp || !(sp.from ? [].concat(sp.from) : ['keydeck']).includes(c.zone) || c.owner !== player || this.S.chain.length) return false;
    const d = this.def(uid), ctl = sp.to === 'opponent_field' ? OTHER(player) : player;
    if (sp.to === 'opponent_field' && this.S.players[ctl].field.length >= FIELD_MAX) return false;
    if (d.summon_once_per_turn && (this.S.turnLog.summoned?.[c.id] || 0) >= 1) return false;
    if (sp.condition?.exists) { const cx = { player, sel: {} }; if (!this.fromList(cx, sp.condition.exists.location).some((u) => this.matches(u, sp.condition.exists.filter, cx))) return false; }
    if (sp.timing) {
      const mine = this.S.turn.player === player;
      if ((sp.timing.turn === 'self' && !mine) || (sp.timing.turn === 'opponent' && mine)) return false;
      if (sp.timing.phase !== 'all' && sp.timing.phase !== this.S.turn.phase) return false;
    }
    return this.keySummonFeasible(player, uid);
  }
  keySummon(player, uid) {
    if (!this.canKeySummon(player, uid)) throw new Error('키 카드 소환 불가: ' + this.nm(uid));
    const pay = this.def(uid).summon_procedure.cost.pay;
    const used = new Set();
    for (let i = 0; i < pay.length; i++) {
      if (pay[i].type === 'remove_counter') {
        if (!this.runStepInner({ ...pay[i], id: 'proc' }, { player, uid, eid: 'procedure', sel: {}, vars: {}, targeted: [], linkIndex: 0 })) throw new Error('카운터 제거 실패');
        continue;
      }
      const subs = this.subsetsFor(player, pay[i], used).filter((sub) => this.keySummonFeasible(player, uid, i + 1, new Set([...used, ...sub])));
      const pick = subs.length === 1 ? subs[0] : this.choose({ kind: 'subset', player, id: 'ks' + i, options: subs, min: 1, max: 1 });
      const chosen = Array.isArray(pick[0]) ? pick[0] : pick;
      chosen.forEach((u) => used.add(u));
      for (const u of chosen) this.toGrave(u, { player }, 'summon_procedure');
    }
    const sp2 = this.def(uid).summon_procedure, fromZ = this.S.cards[uid].zone;
    this.moveCard(uid, 'field', { to: sp2.to === 'opponent_field' ? OTHER(player) : player });
    this.noteSummoned(uid);
    this.say(`키 카드 소환: ${player} ${this.nm(uid)}${sp2.to === 'opponent_field' ? ' -> 상대 필드' : ''}`);
    this.emit({ type: 'summoned', uid, from: fromZ, player });
    this.processTriggers();
  }

  // ---------- 전투 ----------
  attackLimit() {
    let lim = Infinity;
    for (const p of ['A', 'B']) for (const u of this.S.players[p].field_zone) for (const e of this.def(u).effects)
      if (e.continuous?.restriction === 'attack_limit' && !this.S.disabled[u] && this.conditionOk(e, u)) lim = Math.min(lim, e.continuous.max_attackers);
    return lim;
  }
  canAttack(attacker, target) {
    const A = this.S.cards[attacker]; const p = this.ctrl(attacker);
    if (this.S.turn.player !== p || this.S.turn.phase !== 'attack' || this.S.chain.length) return false;
    if (A.zone !== 'field' || this.S.turnLog.attacked.includes(attacker)) return false;
    const opf = this.S.players[OTHER(p)].field;
    if (target ? !opf.includes(target) : opf.length > 0) return false;
    if (target && this.def(target).effects.some((e) => [].concat(e.continuous || []).some((i) => i.type === 'protection' && i.what === 'cannot_be_attacked') && this.conditionOk(e, target) && !this.S.disabled[target])) return false;
    const n = new Set(this.S.turnLog.attacked).size;
    return n < this.attackLimit();
  }
  declareAttack(attacker, target = null) {
    if (!this.canAttack(attacker, target)) throw new Error('공격 불가');
    const p = this.ctrl(attacker);
    this.S.turnLog.attacked.push(attacker);
    this.S.combat = { attacker, target, override: null };
    this.say(`공격 선언: ${this.nm(attacker)} -> ${target ? this.nm(target) : '직접 공격'}`);
    this.emit({ type: 'attack_declared', by: p, player: p, attacker, target });
    this.processTriggers();
    const cb = this.S.combat; this.S.combat = null;
    if (!cb || this.S.cards[attacker].zone !== 'field' || (target && this.S.cards[target].zone !== 'field')) { this.say('  공격 불발'); return { cancelled: true }; }
    const atk = this.attack(attacker);
    const def = target ? this.attack(target) : 0;
    let shield = 0; // 물 카운터: 공격받은 몬스터는 전투로 묘지로 보내지지 않고, 전투 후 그 개수만큼 공격력이 오른다
    if (target) for (const [k, n] of Object.entries(this.S.cards[attacker].counters || {})) if (this.counterRules[k]?.shield_defender) shield += n;
    const after = () => { if (shield && this.S.cards[target].zone === 'field') { this.S.cards[target].bonus += shield; this.say(`  물 카운터 ${shield}개: ${this.nm(target)} 공격력 +${shield}`); } };
    const rawDiff = atk - def; // + : 공격 측이 큼
    if (rawDiff === 0) { // 공격력 동일: 둘 다 0이면 아무 일 없음, 그 외엔 서로 묘지로 (데미지 없음)
      if (atk === 0 && def === 0) { this.say('  공격력 둘 다 0: 아무 일도 없음'); return { damage: 0 }; }
      this.say('  공격력 동일: 서로 묘지로');
      if (target) for (const u of [attacker, target]) if (this.S.cards[u].zone === 'field' && !(shield && u === target)) this.toGrave(u, { player: this.ctrl(u) }, 'battle');
      after();
      this.processTriggers();
      return { damage: 0, bothDestroyed: !!target };
    }
    const loser = rawDiff > 0 ? OTHER(p) : p; // 공격력이 낮은 쪽이 진다
    const n = cb.override !== null ? cb.override : Math.abs(rawDiff); // 데미지: 차이만큼 패 버리기
    const hand = this.S.players[loser].hand;
    const k = Math.min(n, hand.length);
    if (k) {
      const pick = this.choose({ kind: 'cards', player: loser, id: 'battle', options: [...hand], min: k, max: k });
      this.say(`  전투 데미지: ${loser} 패 ${n}장 버림`);
      for (const u of pick) this.discardCard(u, { player: loser }, 'battle');
    } else this.say('  전투 데미지 0');
    const loserMon = target ? (rawDiff > 0 ? target : attacker) : null; // 진 쪽 몬스터는 묘지로 (직접 공격이면 없음)
    if (loserMon && this.S.cards[loserMon].zone === 'field' && !(shield && loserMon === target)) { this.say(`  전투로 패배: ${this.nm(loserMon)}`); this.toGrave(loserMon, { player: this.ctrl(loserMon) }, 'battle'); }
    after();
    this.processTriggers();
    return { damage: n, loser };
  }

  // ---------- 턴 ----------
  setPhase(phase) { this.S.turn.phase = phase; }
  startTurn(player, { first = false } = {}) {
    this.S.turn = { player, phase: 'draw', number: this.S.turn.number + 1 };
    this.S.usage.turn = {};
    this.S.draws = { A: 0, B: 0 };
    this.S.turnLog = { applied: {}, graveBy: {}, attacked: [], summoned: {} };
    this.S.restrictions = []; this.S.disabled = {};
    for (const p of ['A', 'B']) for (const u of this.S.players[p].field) if (this.S.cards[u].negated) this.S.disabled[u] = true; this.S.temp = []; this.S.limitBonus = {}; this.S.immunities = []; this.S.appUsage = {};
    for (const d of this.S.delayed) if (this.S.turn.number >= d.at && !this.S.lost[d.player]) { this.S.lost[d.player] = true; this.say(`지연 효과: ${d.player} 패배`); } // 턴 종료시까지의 잔존 효과 해제
    if (!first) {
      this.quickEffectWindow({ window: 'draw_start' });
      this.runStep({ type: 'draw', count: 1 }, { player, sel: {} });
      this.processTriggers({ window: 'draw_end' });
    }
    this.S.turn.phase = 'deploy';
    this.quickEffectWindow({ window: 'phase_start' });
  }
  loser() {
    for (const p of ['A', 'B']) if (this.S.lost[p]) return p;
    for (const p of ['A', 'B']) if (this.S.players[p].hand.length === 0) return p;
    return null;
  }
}

export class UnsupportedError extends Error {}
function emptyP() { return { hand: [], deck: [], grave: [], banished: [], keydeck: [], field: [], field_zone: [] }; }
function autoChoose({ kind, options, min, max }) {
  if (kind === 'number') return max; return options.slice(0, Math.max(min, Math.min(max, options.length))); }

// 효과가 프로토타입에서 지원되지 않는 기능을 쓰는지 검사
export function unsupportedFeatures(effect) {
  const bad = new Set();
  const SUP_STEP = new Set(['place_counter', 'remove_counter', 'choose_branch', 'use_summon_effects', 'hand_or_summon', 'store_var', 'conceal_in_hand', 'select', 'summon', 'add_to_hand', 'draw', 'discard', 'send_to_grave', 'banish', 'return_to_hand', 'return_to_deck', 'reveal_hand', 'modify_attack', 'negate_effect', 'restrict', 'disable_effects', 'register_effect', 'set_battle_damage', 'place_in_field_zone', 'copy_card', 'replace_effect', 'transform_lingering', 'choose_number', 'discard_down_to', 'modify_limit', 'return_to_keydeck', 'grant_immunity']);
  const SUP_COST = new Set(['remove_counter', 'add_to_hand', 'reveal', 'banish', 'discard', 'select', 'return_to_deck', 'summon', 'send_to_grave', 'draw', 'disable_effects', 'return_to_hand']);
  const SUP_EV = new Set(['summoned', 'sent_to_grave', 'effect_activated', 'would_discard', 'moved_to_zone', 'added_to_hand', 'attack_declared']);
  for (const it of [].concat(effect.continuous || [])) if (!['immunity', 'restriction', 'resolution_option', 'protection', 'untargetable', 'activation_ban', 'unnegatable'].includes(it.type)) bad.add('continuous:' + it.type);
  for (const w of effect.timing?.any_of ?? [effect.timing || {}]) if (w.event && !SUP_EV.has(w.event.type)) bad.add('event:' + w.event.type);
  for (const p of effect.cost?.pay || []) if (!SUP_COST.has(p.type)) bad.add('cost:' + p.type);
  for (const t of effect.cost?.targets || []) if (t.kind !== 'card') bad.add('target:' + t.kind);
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.type && (o.card !== undefined || o.counter !== undefined || o.branches || o.cards !== undefined) || o.type === 'draw' || o.type === 'select' || o.type === 'reveal_hand' || o.type === 'negate_effect') if (!SUP_STEP.has(o.type)) bad.add('step:' + o.type);
    for (const k in o) walk(o[k]);
  };
  walk(effect.action || []);
  return [...bad];
}

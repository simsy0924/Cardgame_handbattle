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
    this.effectFilters = opts.effectFilters || {};
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
      disabled: {},
      temp: [],
      combat: null,
    };
  }
  rng() { let t = (this.rngState += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  shuffle(p) { const a = this.S.players[p].deck; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  say(m) { if (!this.dry) this.log.push(m); }
  get S() { return this.state; }

  // ---------- 카드/존 ----------
  addCard(id, owner, zone, revealed = false) {
    const uid = `${id}#${++this.S.seq}`;
    this.S.cards[uid] = { uid, id, owner, zone, revealed: false, bonus: 0 };
    this.S.players[owner][zone].push(uid);
    if (zone === 'hand') this.S.cards[uid].revealed = revealed;
    return uid;
  }
  def(uid) { return this.defs[this.S.cards[uid].id]; }
  nm(uid) { const c = this.S.cards[uid]; return `${this.def(uid).name}(${c.owner}:${c.zone})`; }
  effectiveName(uid) {
    const c = this.S.cards[uid], d = this.def(uid);
    for (const a of d.name_alias || []) if (a.locations.includes(c.zone)) return a.as;
    return d.name;
  }
  attack(uid) { return (this.def(uid).attack ?? 0) + this.S.cards[uid].bonus; }
  zoneList(p, z) { return this.S.players[p][z]; }
  moveCard(uid, zone, { revealed = false, to } = {}) {
    const c = this.S.cards[uid];
    const from = c.zone;
    const L = this.zoneList(c.owner, from);
    L.splice(L.indexOf(uid), 1);
    c.zone = zone;
    if (from === 'grave') delete this.S.turnLog.graveBy[uid];
    this.zoneList(c.owner, zone).push(uid);
    c.revealed = zone === 'hand' ? revealed : false;
    if (zone !== 'field') c.bonus = 0;
    this.emit({ type: 'moved_to_zone', uid, from, to: zone, player: c.owner });
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
    if (f.sent_to_grave_by && this.S.turnLog.graveBy[uid] !== f.sent_to_grave_by) return false;
    if (f.exclude) for (const x of [].concat(f.exclude)) if (x === 'self' ? uid === ctx.uid : (ctx.sel[x] || []).includes(uid)) return false;
    return true;
  }
  ref(ctx, r) {
    if (r === 'self') return [ctx.uid];
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
    if (e.count_of) { const L = ctx.sel[e.count_of] || []; return e.filter ? L.filter((u) => this.matches(u, e.filter, ctx)).length : L.length; }
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
    if (!ctx.uid) return false;
    const list = r.only_by_effects_of || [];
    return list.some((x) => (x.card_id && x.card_id === this.S.cards[ctx.uid] && false) ||
      (x.card_id && this.S.cards[ctx.uid].id === x.card_id) ||
      (x.name && this.effectiveName(ctx.uid) === x.name)); // 처리 시점의 이름
  }
  canSummon(uid, ctx) {
    const c = this.S.cards[uid];
    if (this.def(uid).type !== 'monster') return false;
    if (c.zone === 'field') return false;
    return this.S.players[ctx.player].field.length < FIELD_MAX && this.summonRestrictionOk(uid, ctx);
  }

  // ---------- 스텝 ----------
  runStep(step, ctx, laterSteps = []) {
    const P = ctx.player;
    switch (step.type) {
      case 'select': {
        if (step.from === 'deck_top') { // 덱 위에서 N장 (선택 없음)
          const n = this.count(ctx, step.count).min, deck = this.S.players[P].deck;
          if (deck.length < n) return false;
          ctx.sel[step.id] = deck.slice(0, n);
          return true;
        }
        let cands = this.fromList(ctx, step.from).filter((u) => this.matches(u, step.filter, ctx) && !this.immune(u, ctx));
        // 뒤에 이 선택을 소환하는 스텝이 있으면 소환 불가한 카드는 후보에서 제외
        if (laterSteps.some((s) => s.type === 'summon' && s.card === step.id))
          cands = cands.filter((u) => this.canSummon(u, ctx));
        const cnt = this.count(ctx, step.count);
        if (cnt.max < cnt.min) return false;
        if (cnt.all) {
          const groups = {};
          for (const u of cands) (groups[step.unique_by_name ? this.effectiveName(u) : u] ||= []).push(u);
          const picked = Object.values(groups).map((g) => g.length === 1 ? g[0]
            : this.choose({ kind: 'cards', player: P, id: step.id, options: g, min: 1, max: 1, ctx: this.describe(ctx) })[0]);
          ctx.sel[step.id] = picked;
          return picked.length >= 1;
        }
        if (cands.length < cnt.min) return false;
        const max = Math.min(cnt.max, cands.length);
        const pick = this.choose({ kind: 'cards', player: step.chooser === 'opponent' ? OTHER(P) : P, id: step.id, options: cands, min: cnt.min, max, ctx: this.describe(ctx) });
        ctx.sel[step.id] = pick;
        return pick.length >= cnt.min;
      }
      case 'summon': {
        const us = this.ref(ctx, step.card).filter((u) => this.canSummon(u, ctx));
        if (!us.length) return false;
        let n = 0;
        for (const u of us) {
          if (this.S.players[P].field.length >= FIELD_MAX) break;
          const from = this.moveCard(u, 'field');
          // 소환은 사용자 필드로 (카드 소유자 기준 필드)
          n++;
          this.say(`  소환: ${this.nm(u)} (from ${from})`);
          this.emit({ type: 'summoned', uid: u, from, player: P });
        }
        return n > 0;
      }
      case 'add_to_hand': {
        const us = this.ref(ctx, step.card).filter((u) => !this.immune(u, ctx) && !(this.S.cards[u].zone === 'deck' && this.restricted('add_to_hand_from_deck')));
        if (!us.length) return false;
        for (const u of us) {
          const from = this.moveCard(u, 'hand', { revealed: true });
          this.say(`  패에 넣음(공개): ${this.nm(u)}`);
          this.emit({ type: 'added_to_hand', uid: u, from, player: this.S.cards[u].owner });
        }
        return true;
      }
      case 'return_to_hand': return this.moveAll(ctx, step, (u) => { this.moveCard(u, 'hand', { revealed: true }); this.say(`  패로 되돌림(공개): ${this.nm(u)}`); }, ['field', 'grave', 'banished']);
      case 'return_to_deck': return this.moveAll(ctx, step, (u) => { this.moveCard(u, 'deck'); this.shuffle(this.S.cards[u].owner); this.say(`  덱으로(섞음): ${this.nm(u)}`); }, null);
      case 'banish': return this.restricted('banish') ? false : this.moveAll(ctx, step, (u) => { this.moveCard(u, 'banished'); this.say(`  제외: ${this.nm(u)}`); }, null);
      case 'discard': return this.moveAll(ctx, step, (u) => this.discardCard(u, ctx, step.cause), ['hand']);
      case 'send_to_grave': return this.moveAll(ctx, step, (u) => this.toGrave(u, ctx, step.cause), ['hand', 'deck', 'field', 'field_zone', 'banished', 'keydeck']);
      case 'draw': {
        const who = step.player === 'opponent' ? OTHER(P) : P;
        const deck = this.S.players[who].deck;
        if (this.restricted('add_to_hand_from_deck')) return false; // 드로우도 "덱에서 패에 넣는 것"
        const cc = this.count(ctx, step.count ?? 1);
        if (cc.max < cc.min || deck.length < cc.min) return false;
        const hi = Math.min(cc.max, deck.length);
        const n = hi === cc.min ? hi : this.choose({ kind: 'number', player: who, id: 'draw', min: cc.min, max: hi });
        for (let i = 0; i < n; i++) {
          const u = deck[0];
          this.moveCard(u, 'hand', { revealed: false });
          this.S.draws[who]++;
          this.say(`  드로우: ${who} ${this.nm(u)}`);
          this.emit({ type: 'added_to_hand', uid: u, from: 'deck', player: who, by_draw: true });
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
        if (!t || t.kind !== 'effect' || t.negated) return false;
        t.negated = true; this.say(`  무효: 체인 ${ctx.linkIndex} ${this.def(t.uid).name} ${t.eid}`);
        return true;
      }
      case 'restrict': { // 잔존 효과: 체인을 만들지 않고 턴 끝까지 유지
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
      case 'set_battle_damage': {
        if (!this.S.combat) return false;
        this.S.combat.override = step.amount; this.say(`  전투 데미지 ${step.amount}으로`);
        return true;
      }
      default: throw new UnsupportedError('step:' + step.type);
    }
  }
  // 상시 효과: 필드의 이 카드는 상대 카드 효과를 받지 않음 (이 카드를 대상으로 하는 효과 제외)
  passiveOn(u, p) { return !this.S.disabled[u] && (!p.condition || this.locOk(u, p.condition.card_location)); }
  restricted(what) { return this.S.restrictions.some((r) => r.what === what); }
  untargetable(u) { return (this.def(u).passive || []).some((p) => p.untargetable && this.passiveOn(u, p)); }
  immune(u, ctx) {
    const c = this.S.cards[u];
    for (const p of this.def(u).passive || []) // 카드 단위 패시브 (예: 묘지에서 다른 카드의 효과를 받지 않음)
      if (p.immunity?.from === 'all_other_card_effects' && this.passiveOn(u, p) && ctx.uid !== u && ctx.uid) return true;
    if (this.S.disabled[u] || c.zone !== 'field' || !ctx.player || ctx.player === c.owner) return false;
    if ((ctx.targeted || []).includes(u)) return false;
    return this.def(u).effects.some((e) => e.continuous?.type === 'immunity' && e.continuous.from === 'opponent_card_effects' && this.conditionOk(e, u));
  }
  moveAll(ctx, step, fn, requireZones) {
    const us = this.ref(ctx, step.card).filter((u) => (!requireZones || requireZones.includes(this.S.cards[u].zone)) && !this.immune(u, ctx));
    if (!us.length) return false;
    us.forEach(fn);
    return true;
  }
  // 버리기: 'would_discard' 대체 효과가 있으면 대신 처리 (체인에 올라가지 않음)
  discardCard(u, ctx, cause) {
    const c = this.S.cards[u];
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
          if (!this.again({ player: ctx.player, loops })) break;
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
    const cost = effect.cost;
    if (!cost) return true;
    for (const t of cost.targets || []) {
      if (t.kind !== 'card') throw new UnsupportedError('target:' + t.kind);
      const c = this.fromList(ctx, t.from).filter((u) => this.matches(u, t.filter, ctx) && !this.untargetable(u));
      if (!c.length) return false;
      ctx.sel[t.id] = this.choose({ kind: 'cards', player: ctx.player, id: t.id, options: c, min: t.count ?? 1, max: t.count ?? 1, ctx: this.describe(ctx) });
      ctx.targeted.push(...ctx.sel[t.id]);
    }
    for (const p of cost.pay || []) {
      switch (p.type) {
        case 'reveal': {
          const c = this.S.cards[ctx.uid];
          if (c.zone !== 'hand') return false;
          if (!c.revealed) { c.revealed = true; this.say(`  공개: ${this.nm(ctx.uid)}`); }
          break;
        }
        case 'return_to_deck': {
          const c = this.S.cards[ctx.uid];
          if (c.zone !== 'hand') return false;
          this.moveCard(ctx.uid, 'deck'); this.shuffle(c.owner); this.say(`  코스트: 덱으로(섞음) ${this.nm(ctx.uid)}`);
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
          us.forEach((u) => this.discardCard(u, ctx));
          break;
        }
        case 'select': {
          const cands = this.fromList(ctx, p.from).filter((u) => this.matches(u, { ...p.filter, exclude: p.exclude }, ctx));
          const n = this.count(ctx, p.count);
          if (cands.length < n.min) return false;
          ctx.sel[p.id] = this.choose({ kind: 'cards', player: ctx.player, id: p.id, options: cands, min: n.min, max: Math.min(n.max, cands.length), ctx: this.describe(ctx) });
          break;
        }
        default: throw new UnsupportedError('cost:' + p.type);
      }
    }
    return true;
  }

  // ---------- 조건/타이밍/제한 ----------
  locOk(uid, loc) {
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
  timingOk(effect, uid) {
    const t = effect.timing, c = this.S.cards[uid];
    if (!t || t.event) return false;
    if (t.turn === null) return false;
    const mine = this.S.turn.player === c.owner;
    if (t.turn === 'self' && !mine) return false;
    if (t.turn === 'opponent' && mine) return false;
    return t.phase === 'all' || t.phase === this.S.turn.phase;
  }
  isFastEffect(effect, uid) {
    if (effect.activation_type === 'quick') return true;
    if (effect.activation_type === 'ignition') return false;
    if (effect.timing?.event) return false;

    const timing = effect.timing;
    if (this.def(uid).type === 'trap') return true;
    if (timing?.turn === 'opponent' || timing?.turn === 'both') return true;
    if (timing?.phase === 'all') return true;
    return ['draw', 'attack', 'end'].includes(timing?.phase);
  }
  limitKey(effect, uid) { const l = effect.limit; return `${this.S.cards[uid].owner}|${this.def(uid).id}${l.group === 'card_id' ? '' : ':' + effect.id}`; }
  limitOk(effect, uid) {
    const l = effect.limit;
    if (!l) return true;
    const key = this.limitKey(effect, uid);
    return (this.S.usage[l.scope][key] || 0) < l.count;
  }
  useLimit(effect, uid) {
    const l = effect.limit; if (!l) return;
    const key = this.limitKey(effect, uid);
    this.S.usage[l.scope][key] = (this.S.usage[l.scope][key] || 0) + 1;
  }

  // ---------- 발동 / 체인 ----------
  fork() {
    const e = new Engine(Object.values(this.defs), { choose: autoChoose, effectFilters: this.effectFilters });
    e.state = structuredClone(this.state); e.state.pending = []; e.dry = true;
    return e;
  }
  feasible(uid, effect, ev) {
    const sim = this.fork();
    const ctx = { player: this.S.cards[uid].owner, uid, eid: effect.id, sel: {}, linkIndex: this.S.chain.length, targeted: [], event: ev };
    try {
      if (!sim.payCost(effect, ctx)) return false;
      const g = effect.action[0];
      if (g.repeat) return sim.runGroup(g.repeat.body[0], ctx) || !!g.repeat.body[0].optional;
      return sim.runGroup(g, ctx) || !!g.optional;
    } catch (e) { if (e instanceof UnsupportedError) return false; throw e; }
  }
  canActivate(uid, effect, ev) {
    if (effect.continuous || this.S.disabled[uid]) return false;
    if (!this.conditionOk(effect, uid, ev)) return false;
    if (!this.limitOk(effect, uid)) return false;
    return true;
  }
  // 열린 상태에서 턴 플레이어가 사용할 수 있는 효과(기동 효과와 빠른 효과)
  activatableEffects(player) {
    return this.options(player, false);
  }
  // 이전 호출 이름과의 호환성을 유지한다.
  activatableIgnitions(player) {
    return this.activatableEffects(player);
  }
  // 체인 중에는 Spell Speed 2 이상의 효과와 현재 체인에 반응하는 유발 효과만 허용한다.
  options(player, inChain, { fastOnly = false } = {}) {
    const out = [];
    const last = this.S.chain[this.S.chain.length - 1];
    for (const z of ['hand', 'field', 'field_zone', 'grave', 'banished']) for (const uid of this.S.players[player][z])
      for (const e of this.def(uid).effects) {
        if (e.continuous) continue;
        const ev = e.timing?.event;
        let ok = false;
        if (ev) ok = inChain && last && ev.type === 'effect_activated' && this.activatedMatches(ev, last, player);
        else {
          ok = this.timingOk(e, uid);
          if (ok && (fastOnly || inChain)) ok = this.isFastEffect(e, uid);
        }
        if (!ok || !this.canActivate(uid, e) || !this.feasible(uid, e)) continue;
        out.push({ uid, eid: e.id });
      }
    return out;
  }
  activatedMatches(ev, link, player) {
    if (link.kind !== 'effect') return false;
    if (ev.by === 'opponent' && link.player === player) return false;
    if (ev.by === 'self' && link.player !== player) return false;
    return this.effectFilterOk(link, ev.effect_filter);
  }
  effectFilterOk(link, f) {
    if (!f) return true;
    if (f.ref) return this.effectFilterOk(link, this.effectFilters[f.ref]);
    if (f.source_type && this.def(link.uid).type !== f.source_type) return false;
    if (f.card_name && this.effectiveName(link.uid) !== f.card_name) return false;
    if (f.includes_any) {
      const effect = this.def(link.uid).effects.find((e) => e.id === link.eid);
      const sigs = this.effectSignature(effect);
      return f.includes_any.some((p) => sigs.some((g) => g.step === p.step && (!p.from || (g.from && g.from.some((z) => p.from.includes(z))))));
    }
    return true;
  }
  // 효과 텍스트(스텝)를 정적으로 분석해서 "무엇을 포함하는 효과인지" 판정하기 위한 목록
  effectSignature(effect) {
    const norm = (f) => [].concat(f).map((x) => (x === 'deck_top' ? 'deck' : x));
    const fromOf = {}, sigs = [];
    for (const t of effect.cost?.targets || []) fromOf[t.id] = norm(t.from);
    for (const p of effect.cost?.pay || []) if (p.type === 'select') fromOf[p.id] = norm(p.from);
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
  activate(uid, eid) { this.declare(uid, eid); this.runChain(); }
  activateCard(uid, eid) { return this.activate(uid, eid); } // 호환용

  // 체인을 역순으로 처리하고, 유발 체인이 더 없을 때 빠른 효과 창을 연다.
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
  activateResponse(player, pick) {
    if (pick.fetch) this.declareFetch(player, pick.uid);
    else this.declare(pick.uid, pick.eid, { check: 'none' });
  }
  quickEffectWindow({ window = 'fast_timing', firstPlayer = this.S.turn.player } = {}) {
    let passes = 0, p = firstPlayer, guard = 0;
    while (passes < 2 && guard++ < 50) {
      const options = [...this.options(p, false, { fastOnly: true }), ...this.fetchOptions(p)];
      const pick = options.length ? this.respond({ player: p, options, chain: [], window }) : null;
      if (pick) {
        this.activateResponse(p, pick);
        this.resolveChains();
        passes = 0;
        p = this.S.turn.player;
      } else {
        passes++;
        p = OTHER(p);
      }
    }
  }
  // 턴 플레이어가 다음 단계로 넘어가려 하면 상대가 먼저 빠른 효과를 쓸 수 있다.
  phaseBoundaryWindow() {
    const turnPlayer = this.S.turn.player;
    const responder = OTHER(turnPlayer);
    const options = [...this.options(responder, false, { fastOnly: true }), ...this.fetchOptions(responder)];
    const pick = options.length
      ? this.respond({ player: responder, options, chain: [], window: 'phase_end' })
      : null;
    if (!pick) return;
    this.activateResponse(responder, pick);
    this.resolveChains();
    this.quickEffectWindow({ window: 'after_resolution', firstPlayer: turnPlayer });
  }
  responseWindow() {
    let passes = 0;
    let p = OTHER(this.S.chain[this.S.chain.length - 1].player);
    let guard = 0;
    while (passes < 2 && guard++ < 50) {
      const opts = this.options(p, true);
      const f = this.fetchOptions(p);
      const all = [...opts, ...f];
      const pick = all.length ? this.respond({
        player: p,
        options: all,
        chain: this.S.chain.map((l) => ({ ...l, ctx: undefined })),
        window: 'chain_response',
      }) : null;
      if (pick) {
        this.activateResponse(p, pick);
        passes = 0;
      } else passes++;
      p = OTHER(p);
    }
  }
  resolveLink(link) {
    const n = this.S.chain.length + 1;
    if (link.kind === 'fetch') {
      this.say(`처리(체인 ${n}): 가져오기`);
      if (this.S.cards[link.uid].zone === 'keydeck') { this.moveCard(link.uid, 'hand', { revealed: true }); this.say(`  가져옴(공개): ${this.nm(link.uid)}`); }
      return;
    }
    const effect = this.def(link.uid).effects.find((e) => e.id === link.eid);
    if (this.S.disabled[link.uid]) link.negated = true; // 자물쇠 등으로 효과가 무효가 된 카드의 체인 위 효과도 처리 시 무효
    this.say(`처리(체인 ${n}): ${this.def(link.uid).name} ${link.eid}${link.negated ? ' [무효]' : ''}`);
    if (link.negated) return;
    const ctx = link.ctx;
    if ((effect.cost?.targets || []).some((t) => (ctx.sel[t.id] || []).some((u) => !['field', 'field_zone'].includes(this.S.cards[u].zone)))) { this.say('  불발(대상 소실)'); return; }
    this.noteApplied(ctx);
    const res = this.runActions(effect, ctx);
    this.say(`  처리 결과: ${JSON.stringify(res.results)}`);
  }

  // ---------- 유발 ----------
  eventMatches(ev, effect, uid) {
    const t = effect.timing.event;
    if (!t || t.type !== ev.type) return false;
    const owner = this.S.cards[uid].owner;
    if (t.by === 'opponent' && ev.player === owner) return false;
    if (t.by === 'self' && ev.player !== owner) return false;
    if (t.from && ev.from !== t.from) return false;
    switch (ev.type) {
      case 'summoned':
        if (t.card === 'self' && ev.uid !== uid) return false;
        return true;
      case 'sent_to_grave':
        if (t.card === 'self' && ev.uid !== uid) return false;
        if (t.reason && ev.reason !== t.reason) return false;
        if (t.card_filter && !this.matches(ev.uid, t.card_filter, { sel: {} })) return false;
        if (t.cause_card && (ev.cause || '').split(':')[0] !== t.cause_card) return false;
        return true;
      case 'moved_to_zone':
        if (t.card === 'self' && ev.uid !== uid) return false;
        return !t.to || t.to.includes(ev.to);
      case 'added_to_hand':
        return true;
      case 'attack_declared':
        return true;
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
      for (const z of ['field', 'field_zone', 'hand', 'grave', 'banished'])
        for (const uid of [...this.S.players[p][z]])
          for (const e of this.def(uid).effects) {
            if (!e.timing?.event) continue;
            let m; try { m = this.eventMatches(ev, e, uid); } catch (x) { if (x instanceof UnsupportedError) continue; throw x; }
            const key = `${uid}:${e.id}:${ev.uid}:${ev.type}`;
            if (!m || used.has(key) || !this.canActivate(uid, e, ev) || !this.feasible(uid, e, ev)) continue;
            if (!e.mandatory && !this.confirm({ player: p, uid, effect: e, event: ev })) continue;
            used.add(key);
            this.say(`유발: ${this.nm(uid)} ${e.id} <- ${ev.type}`);
            this.declare(uid, e.id, { check: 'none', event: ev });
          }
    }
  }
  processTriggers({ window = 'after_action' } = {}) {
    this.collectTriggers();
    if (this.S.chain.length) this.runChain();
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
    return this.subsetsFor(player, pay[from], used).some((sub) => this.keySummonFeasible(player, uid, from + 1, new Set([...used, ...sub])));
  }
  canKeySummon(player, uid) {
    const c = this.S.cards[uid], sp = this.def(uid).summon_procedure;
    if (!sp || c.zone !== 'keydeck' || c.owner !== player || this.S.chain.length) return false;
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
      const subs = this.subsetsFor(player, pay[i], used).filter((sub) => this.keySummonFeasible(player, uid, i + 1, new Set([...used, ...sub])));
      const pick = subs.length === 1 ? subs[0] : this.choose({ kind: 'subset', player, id: 'ks' + i, options: subs, min: 1, max: 1 });
      const chosen = Array.isArray(pick[0]) ? pick[0] : pick;
      chosen.forEach((u) => used.add(u));
      for (const u of chosen) this.toGrave(u, { player }, 'summon_procedure');
    }
    this.moveCard(uid, 'field');
    this.say(`키 카드 소환: ${player} ${this.nm(uid)}`);
    this.emit({ type: 'summoned', uid, from: 'keydeck', player });
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
    const A = this.S.cards[attacker]; const p = A.owner;
    if (this.S.turn.player !== p || this.S.turn.phase !== 'attack' || this.S.chain.length) return false;
    if (A.zone !== 'field' || this.S.turnLog.attacked.includes(attacker)) return false;
    const opf = this.S.players[OTHER(p)].field;
    if (target ? !opf.includes(target) : opf.length > 0) return false;
    const n = new Set(this.S.turnLog.attacked).size;
    return n < this.attackLimit();
  }
  declareAttack(attacker, target = null) {
    if (!this.canAttack(attacker, target)) throw new Error('공격 불가');
    const p = this.S.cards[attacker].owner;
    this.S.turnLog.attacked.push(attacker);
    this.S.combat = { attacker, target, override: null };
    this.say(`공격 선언: ${this.nm(attacker)} -> ${target ? this.nm(target) : '직접 공격'}`);
    this.emit({ type: 'attack_declared', by: p, player: p, attacker, target });
    this.processTriggers();
    const cb = this.S.combat; this.S.combat = null;
    if (!cb || this.S.cards[attacker].zone !== 'field' || (target && this.S.cards[target].zone !== 'field')) { this.say('  공격 불발'); return { cancelled: true }; }
    const atk = this.attack(attacker);
    const def = target ? this.attack(target) : 0;
    const rawDiff = atk - def; // + : 공격 측이 큼
    if (rawDiff === 0) { // 공격력 동일: 둘 다 0이면 아무 일 없음, 그 외엔 서로 묘지로 (데미지 없음)
      if (atk === 0 && def === 0) { this.say('  공격력 둘 다 0: 아무 일도 없음'); return { damage: 0 }; }
      this.say('  공격력 동일: 서로 묘지로');
      if (target) for (const u of [attacker, target]) if (this.S.cards[u].zone === 'field') this.toGrave(u, { player: this.S.cards[u].owner }, 'battle');
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
    if (loserMon && this.S.cards[loserMon].zone === 'field') { this.say(`  전투로 패배: ${this.nm(loserMon)}`); this.toGrave(loserMon, { player: this.S.cards[loserMon].owner }, 'battle'); }
    this.processTriggers();
    return { damage: n, loser };
  }

  // ---------- 턴 ----------
  setPhase(phase) { this.S.turn.phase = phase; }
  startTurn(player, { first = false } = {}) {
    this.S.turn = { player, phase: 'draw', number: this.S.turn.number + 1 };
    this.S.usage.turn = {};
    this.S.draws = { A: 0, B: 0 };
    this.S.turnLog = { applied: {}, graveBy: {}, attacked: [] };
    this.S.restrictions = []; this.S.disabled = {}; this.S.temp = []; // 턴 종료시까지의 잔존 효과 해제
    if (!first) {
      this.quickEffectWindow({ window: 'draw_start' });
      this.runStep({ type: 'draw', count: 1 }, { player, sel: {} });
      this.processTriggers({ window: 'draw_end' });
    }
    this.S.turn.phase = 'deploy';
    this.quickEffectWindow({ window: 'phase_start' });
  }
  loser() {
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
  const SUP_STEP = new Set(['select', 'summon', 'add_to_hand', 'draw', 'discard', 'send_to_grave', 'banish', 'return_to_hand', 'return_to_deck', 'reveal_hand', 'modify_attack', 'negate_effect', 'restrict', 'disable_effects', 'register_effect', 'set_battle_damage']);
  const SUP_COST = new Set(['reveal', 'banish', 'discard', 'select', 'return_to_deck']);
  const SUP_EV = new Set(['summoned', 'sent_to_grave', 'effect_activated', 'would_discard', 'moved_to_zone', 'added_to_hand', 'attack_declared']);
  if (effect.continuous && !['immunity', 'restriction'].includes(effect.continuous.type)) bad.add('continuous');
  if (effect.timing?.event && !SUP_EV.has(effect.timing.event.type)) bad.add('event:' + effect.timing.event.type);
  for (const p of effect.cost?.pay || []) if (!SUP_COST.has(p.type)) bad.add('cost:' + p.type);
  for (const t of effect.cost?.targets || []) if (t.kind !== 'card') bad.add('target:' + t.kind);
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.type && o.card !== undefined || o.type === 'draw' || o.type === 'select' || o.type === 'reveal_hand' || o.type === 'negate_effect') if (!SUP_STEP.has(o.type)) bad.add('step:' + o.type);
    for (const k in o) walk(o[k]);
  };
  walk(effect.action || []);
  return [...bad];
}

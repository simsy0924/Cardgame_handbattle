import fs from 'fs';
import { Engine, unsupportedFeatures } from '../src/engine.mjs';
const pen = JSON.parse(fs.readFileSync(new URL('../src/cards/penguin_deck.json', import.meta.url), 'utf8'));
const gen = JSON.parse(fs.readFileSync(new URL('../src/cards/generic_deck.json', import.meta.url), 'utf8'));
const ele = JSON.parse(fs.readFileSync(new URL('../src/cards/elements_deck.json', import.meta.url), 'utf8'));
const cth = JSON.parse(fs.readFileSync(new URL('../src/cards/cthulhu_deck.json', import.meta.url), 'utf8'));
const defs = [...pen, ...gen.cards, ...ele.cards, ...cth.cards];
const SHORT = { 불: '엘리멘츠의 불꽃정령', 물: '엘리멘츠의 물정령', 전기: '엘리멘츠의 전기정령', 바람: '엘리멘츠의 바람정령', 무지개: '엘리멘츠 in rainbow forest', 요정: '엘리멘츠 is fairy!!!', MAGIC: '엘리멘츠의 M∀GIC', TRAP: '엘리멘츠의 TR∀P', 카드: '엘리멘츠의 ♤♡◇♧', 궁극신: '엘리멘츠의 궁극신', 마법: '엘리멘츠의 마법', 창조신: '엘리멘츠의 궁극 창조신', 궁극의: '궁극의 엘리멘츠', 어둠: '엘리멘츠의 어둠정령', 빛: '엘리멘츠의 빛정령', 재창조: '재창조의 엘리멘츠' };
const N = (s) => defs.find((d) => d.name === (SHORT[s] || s))?.id;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + m); };
const opts = { effectFilters: { ...gen.effect_filters, ...ele.effect_filters }, counterRules: ele.counter_rules };
function setup(spec, picker, extra = {}) {
  const e = new Engine(defs, { ...opts, ...extra,
    choose: (q) => picker ? picker(q, e) : (q.kind === 'number' ? q.max : q.options.slice(0, q.kind === 'subset' ? 1 : Math.min(q.max, q.options.length))) });
  for (const [p, zones] of Object.entries(spec)) for (const [z, names] of Object.entries(zones))
    for (const n of names) { if (!N(n)) throw new Error('no card ' + n); e.addCard(N(n), p, z); }
  return e;
}
const nm = (e, u) => e.def(u).name;
const find = (e, p, z, name) => e.S.players[p][z].find((u) => nm(e, u) === (SHORT[name] || name));
const has = (e, p, z, name) => !!find(e, p, z, name);
const cnt = (e, p, z) => e.S.players[p][z].length;
const show = (e) => console.log(e.log.join('\n'));
const turn = (e, player, phase) => { e.S.turn = { player, phase, number: 5 }; };
const act = (e, p, z, name, eid) => e.activate(find(e, p, z, name), eid);
const tryAct = (e, p, z, name, eid) => { try { act(e, p, z, name, eid); return true; } catch (x) { return false; } };
const ctr = (e, u, k) => e.S.cards[u].counters?.[k] || 0;
const give = (e, u, k, n = 1) => { e.S.cards[u].counters = { ...(e.S.cards[u].counters || {}), [k]: n }; };
const first = (e, p, z, name) => find(e, p, z, name);
// 선택 지정: 이름 우선순위, 문자열(옵션) 선택 처리
const pick = (...order) => (q, e) => {
  if (q.kind === 'number') return q.max;
  if (q.kind === 'branch') { for (const o of order) if (q.options.includes(o)) return [o]; return [q.options[0]]; }
  if (q.kind === 'kinds') return q.options.slice(0, q.min);
  if (q.options.some((x) => typeof x === 'string' && x.includes('|'))) return [q.options[0]];
  for (const n of order) { const u = q.options.find?.((x) => typeof x !== 'string' && nm(e, x) === (SHORT[n] || n)); if (u) return [u]; }
  return q.options.slice(0, q.kind === 'subset' ? 1 : q.max);
};

console.log('E0: 지원 여부');
{ let n = 0; for (const c of ele.cards) for (const ef of c.effects) if (unsupportedFeatures(ef).length) n++; ok(n === 0, '미지원 기능 0개'); }

console.log('E1: 불꽃정령');
{
  const e = setup({ A: { hand: ['불'], deck: ['물'] }, B: { field: ['꼬마 펭귄'] } }, pick('counter'));
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '불', 'e1');
  const t = find(e, 'B', 'field', '꼬마 펭귄');
  ok(has(e, 'A', 'field', '불'), 'e1 소환 (필드가 비어서 가능)');
  ok(ctr(e, t, '화염') === 1, 'e2 화염 카운터 1개');
  ok(e.attack(t) === e.def(t).attack - 1, '화염 카운터 1개당 공격력 -1 (' + e.attack(t) + ')');
}
{
  const e = setup({ A: { hand: ['불'], field: ['꼬마 펭귄'] }, B: {} });
  turn(e, 'A', 'deploy');
  ok(!tryAct(e, 'A', 'hand', '불', 'e1'), '내 필드에 엘리멘츠가 아닌 카드만 있으면 e1 불가');
}
{
  const e = setup({ A: { hand: ['불', '물'], field: ['전기'], deck: ['바람'] }, B: {} }, pick('search'));
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '불', 'e1');
  ok(has(e, 'A', 'field', '불') && has(e, 'A', 'hand', '바람'), '엘리멘츠가 있으면 e1 가능 + e2 서치 분기 (상대 몬스터 없음)');
}
{
  // e3: 패의 이 카드를 보여주고 - 상대 필드 카운터 2개까지 제거, 제거한 수만큼 서치
  const e = setup({ A: { hand: ['불'], deck: ['물', '전기', '바람'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  const [t1, t2] = e.S.players.B.field; give(e, t1, '화염', 1); give(e, t2, '물', 1);
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '불', 'e3');
  show(e);
  ok(ctr(e, t1, '화염') + ctr(e, t2, '물') === 0, '카운터 2개 제거');
  ok(cnt(e, 'A', 'hand') === 3, '제거한 수(2)만큼 서치 -> 패 3장 (불 + 2장)');
}
{
  const e = setup({ A: { hand: ['불'], deck: ['물', '전기'] }, B: { field: ['꼬마 펭귄'] } });
  e.S.cards[find(e, 'A', 'hand', '불')].revealed = true;
  turn(e, 'A', 'deploy');
  ok(!tryAct(e, 'A', 'hand', '불', 'e3'), 'e3 공개 상태에서는 불가(보여주고 발동 = 비공개일 때만)');
}

console.log('E2: 물정령');
{
  const e = setup({ A: { hand: ['불'], field: ['물'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  turn(e, 'A', 'deploy');
  const atk = find(e, 'B', 'field', '펭귄 부부'), mine = find(e, 'A', 'field', '물');
  give(e, atk, '물', 2);
  const mine2 = e.addCard(N('전기'), 'A', 'field');
  turn(e, 'B', 'attack');
  const before = e.attack(mine2);
  e.declareAttack(atk, mine2);
  ok(e.S.cards[mine2].zone === 'field', '물 카운터가 있는 몬스터에게 공격받은 몬스터는 전투로 묘지로 가지 않음');
  ok(e.attack(mine2) === before + 2, '전투 후 카운터 개수(2)만큼 공격력 상승: ' + e.attack(mine2));
}
{
  // e3: 공개 패에 넣어졌을 때 -> 덱의 엘리멘츠 1장 묘지로 + 이 카드는 일반(비공개) 패로
  const e = setup({ A: { hand: ['불'], deck: ['물', '전기', '바람'] }, B: { field: ['꼬마 펭귄'] } });
  give(e, e.S.players.B.field[0], '화염', 1);
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '불', 'e3');
  ok(has(e, 'A', 'hand', '물') && e.S.cards[find(e, 'A', 'hand', '물')].revealed === false, '물정령: 공개 패로 들어오자 e3로 일반 패로 되돌아감');
  ok(cnt(e, 'A', 'grave') === 1, '덱의 엘리멘츠 1장이 묘지로');
}

console.log('E3: 전기정령');
{
  // e3: 패에서 묘지로 보내고 상대 몬스터 전부에 전기 카운터 1개 + 2개 되면 상대 패 1장 버림
  const e = setup({ A: { hand: ['전기'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'], hand: ['펭귄 마을', '현자 펭귄'] } });
  const [t1, t2] = e.S.players.B.field; give(e, t1, '전기', 1);
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '전기', 'e3');
  ok(has(e, 'A', 'grave', '전기'), '코스트로 자신 묘지로');
  ok(ctr(e, t1, '전기') === 2 && ctr(e, t2, '전기') === 1, '전기 카운터 1개씩 (2개, 1개)');
  ok(cnt(e, 'B', 'hand') === 1 && cnt(e, 'B', 'grave') === 1, '2개가 된 몬스터 때문에 상대 패 1장 버림');
}
{
  const e = setup({ A: { field: ['전기'], deck: ['물'] }, B: { field: ['꼬마 펭귄'], hand: ['펭귄 마을', '현자 펭귄'] } });
  e.S.players.A.field.length;
  turn(e, 'A', 'deploy');
  const u = find(e, 'B', 'field', '꼬마 펭귄'); give(e, u, '전기', 1);
  e.moveCard(find(e, 'A', 'field', '전기'), 'grave'); e.moveCard(find(e, 'A', 'grave', '전기'), 'hand');
  e.S.turn.number = 5;
  act(e, 'A', 'hand', '전기', 'e1'); // 소환 -> e2 (카운터 분기가 자동 선택됨)
  ok(ctr(e, u, '전기') === 2, 'e2 전기 카운터 -> 2개');
  ok(cnt(e, 'B', 'hand') === 1, '숨겨진 상대 패는 랜덤으로 1장 버림 (패 1장 남음)');
}

console.log('E4: 바람정령');
{
  const e = setup({ A: { hand: ['바람'], deck: ['물', '전기'] }, B: { field: ['꼬마 펭귄'] } });
  const u = find(e, 'B', 'field', '꼬마 펭귄'); give(e, u, '바람', 1);
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '바람', 'e1');
  ok(ctr(e, u, '바람') === 2 && cnt(e, 'A', 'hand') === 1, '바람 카운터 2개 -> 1장 드로우');
}
{
  const e = setup({ A: { field: ['바람'], deck: ['무지개', '물'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.toGrave(find(e, 'A', 'field', '바람'), { player: 'A' }, null);
  e.processTriggers();
  ok(has(e, 'A', 'hand', '무지개'), 'e3 묘지로 보내졌을 때 rainbow forest 서치');
}

console.log('E5: 엘리멘츠 in rainbow forest');
{
  const e = setup({ A: { hand: ['무지개'], deck: ['불'], field_zone: [] }, B: {} });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '무지개', 'e1');
  ok(has(e, 'A', 'field_zone', '무지개') && has(e, 'A', 'hand', '불'), 'e1 필드 존에 발동 + 처리 시 몬스터 서치');
}
{
  // e2: 내가 발동한 카운터 효과는 무효화되지 않는다 (흑기사 e2 가 무효로 하려 해도)
  const mk = (withForest) => setup({ A: { hand: ['불'], field_zone: withForest ? ['무지개'] : [] }, B: { field: ['카드의 흑기사', '꼬마 펭귄'] } }, pick('counter'),
    { respond: ({ player, options, chain }) => player === 'B' && chain.at(-1)?.eid === 'e2' ? options.find((o) => nm(e2, o.uid) === '카드의 흑기사' && o.eid === 'e2') || null : null });
  var e2 = mk(true);
  turn(e2, 'A', 'deploy');
  act(e2, 'A', 'hand', '불', 'e1'); // e1 은 소환만. 이어지는 e2(카운터)가 흑기사 e2 의 응답 대상
  const sumC = (e) => e.S.players.B.field.reduce((a, u) => a + ctr(e, u, '화염'), 0);
  ok(sumC(e2) === 1, 'rainbow 가 있으면 카운터 효과(e2)는 무효화되지 않아 카운터가 놓임');
  const sumC2 = sumC; var e3 = mk(false); e2 = e3;
  turn(e3, 'A', 'deploy');
  act(e3, 'A', 'hand', '불', 'e1');
  ok(sumC(e3) === 0, 'rainbow 가 없으면 흑기사 e2 로 무효 (카운터 없음)');
}
{
  const e = setup({ A: { field_zone: ['무지개'], grave: ['불', '물'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.toGrave(find(e, 'A', 'field_zone', '무지개'), { player: 'A' }, null);
  e.processTriggers();
  ok(cnt(e, 'A', 'hand') === 1, 'e3 묘지로 보내졌을 때 묘지의 엘리멘츠 1장을 패에');
}

console.log('E6: 엘리멘츠 is fairy!!!');
{
  const e = setup({ A: { hand: ['요정'], deck: ['불', '물', '전기'] }, B: { field: ['꼬마 펭귄', '펭귄 부부', '현자 펭귄'] } });
  const [a, b, c] = e.S.players.B.field; give(e, a, '화염', 1); give(e, b, '물', 2); give(e, c, '전기', 1);
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '요정', 'e1'); // 기본 선택: 덱의 첫 2장(불, 물)
  ok(!has(e, 'B', 'field', '꼬마 펭귄') && !has(e, 'B', 'field', '펭귄 부부') && has(e, 'B', 'field', '현자 펭귄'), '확인한 카드(불, 물)의 카운터가 놓인 몬스터만 묘지로');
}
{
  const e = setup({ A: { grave: ['요정'], deck: ['불', '물', '전기', '바람'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'grave', '요정', 'e2');
  const t = e.S.players.B.field;
  ok(t.every((u) => ctr(e, u, '화염') === 1 && ctr(e, u, '물') === 1 && ctr(e, u, '전기') === 1 && ctr(e, u, '바람') === 1), 'e2 4종 카운터가 상대 몬스터 전부에 1개씩');
  ok(has(e, 'A', 'banished', '요정'), '코스트: 묘지의 이 카드 제외');
}
{
  const e = setup({ A: { grave: ['요정'], deck: ['불', '불', '물', '전기'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e, 'A', 'deploy');
  ok(!tryAct(e, 'A', 'grave', '요정', 'e2'), '카드명이 다른 4장이 없으면 e2 불가');
}

console.log('E7: 엘리멘츠의 M∀GIC');
{
  const e = setup({ A: { hand: ['MAGIC'], deck: ['불', '물', '전기'] }, B: {} });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', 'MAGIC', 'e1');
  ok(cnt(e, 'A', 'banished') === 1 && has(e, 'A', 'grave', '물') , 'e1 덱에서 제외(코스트) + 덱에서 묘지로');
}
{
  const e = setup({ A: { grave: ['MAGIC'], banished: ['불', '무지개'] }, B: {} }, pick('hand', 'summon'));
  turn(e, 'A', 'deploy');
  act(e, 'A', 'grave', 'MAGIC', 'e2');
  ok(has(e, 'A', 'field', '불') === false && cnt(e, 'A', 'hand') >= 1, 'e2 제외된 카드 2장까지 패에 넣거나 소환');
  show(e);
}

console.log('E8: 엘리멘츠의 TR∀P');
{
  // e1: 상대 턴에 상대 효과 발동 -> 상대 필드 이름이 다른 카운터 4개 제거하고 무효 + 그 카드 묘지로
  const e = setup({ A: { hand: ['TRAP'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'], hand: ['펭귄 마을'], deck: ['펭귄 부부'] } }, null,
    { respond: ({ player, options }) => player === 'A' ? options.find((o) => nm(e, o.uid) === '엘리멘츠의 TR∀P' && o.eid === 'e1') || null : null });
  const [a, b] = e.S.players.B.field; give(e, a, '화염', 1); give(e, a, '물', 1); give(e, b, '전기', 1); e.S.cards[b].counters['바람'] = 1;
  turn(e, 'B', 'deploy');
  act(e, 'B', 'hand', '펭귄 마을', 'e1');
  show(e);
  ok(has(e, 'A', 'grave', 'TRAP') || cnt(e, 'A', 'hand') === 0, 'TRAP 사용됨');
  ok(Object.keys(e.S.cards[a].counters || {}).length + Object.keys(e.S.cards[b].counters || {}).length === 0, '카운터 4종 제거(코스트)');
  ok(cnt(e, 'B', 'hand') === 0 && has(e, 'B', 'grave', '펭귄 마을'), '효과 무효 (드로우 안 함)');
}
{
  const e = setup({ A: { grave: ['TRAP'], deck: ['불', '물', '전기', '바람'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e, 'B', 'deploy');
  act(e, 'A', 'grave', 'TRAP', 'e2');
  const u = e.S.players.B.field[0];
  ok(ctr(e, u, '화염') + ctr(e, u, '물') + ctr(e, u, '전기') + ctr(e, u, '바람') === 4, 'e2 상대 턴에 4종 카운터 1개씩');
  const e2 = setup({ A: { grave: ['TRAP'], deck: ['불', '물', '전기', '바람'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e2, 'A', 'deploy');
  ok(!tryAct(e2, 'A', 'grave', 'TRAP', 'e2'), '내 턴에는 e2 불가');
}

console.log('E9: 엘리멘츠의 ♤♡◇♧');
{
  const e = setup({ A: { hand: ['카드'], deck: ['불', '물'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } }, pick('search'));
  turn(e, 'B', 'attack');
  act(e, 'A', 'hand', '카드', 'e1');
  ok(has(e, 'A', 'field', '불') && e.S.players.B.field.every((u) => ctr(e, u, '화염') === 1), 'e1 상대 턴에도 발동: 소환 + 상대 몬스터 전부에 그 카운터 1개씩');
  const c = find(e, 'A', 'grave', '카드');
  ok(e.S.cards[c].memory.placed === 2, '놓은 카운터 수(2) 기록');
  e.S.players.A.deck.push(...[N('바람'), N('전기'), N('물')].map((id) => e.addCard(id, 'A', 'deck')).slice(0, 0));
  e.addCard(N('바람'), 'A', 'deck'); e.addCard(N('전기'), 'A', 'deck');
  turn(e, 'A', 'deploy');
  const h0 = cnt(e, 'A', 'hand');
  act(e, 'A', 'grave', '카드', 'e2');
  ok(cnt(e, 'A', 'hand') === h0 + 2 - 1, 'e2 기록한 수(2)만큼 드로우하고 1장 버림');
}

console.log('E10: 엘리멘츠의 궁극신');
const bigCounters = (e, n) => { const u = e.S.players.B.field; for (const k of ['화염', '물', '전기', '바람']) give(e, u[0], k, n); e.S.cards[u[0]].counters; };
{
  const e = setup({ A: { hand: ['궁극신'], field: ['불'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  bigCounters(e, 2); give(e, e.S.players.B.field[1], '화염', 1);
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'hand', '궁극신');
  ok(e.canKeySummon('A', k), '4종 2개씩 제거 조건 만족 -> 패에서 소환 가능');
  e.keySummon('A', k);
  ok(has(e, 'A', 'field', '궁극신'), '소환됨');
  ok(!has(e, 'A', 'field', '불') && has(e, 'A', 'hand', '불') && !has(e, 'B', 'field', '꼬마 펭귄') && has(e, 'B', 'hand', '꼬마 펭귄'), 'e1 소환했을 때 다른 몬스터 전부 패로 (양쪽)');
  ok(e.S.cards[e.S.players.B.hand[0]].zone === 'hand', '(상대 몬스터는 주인의 패로)');
  ok(ctr(e, find(e, 'B', 'hand', '펭귄 부부') || 'x', '화염') === 0, '패로 돌아가면 카운터 사라짐');
}
{
  const e = setup({ A: { hand: ['궁극신'] }, B: { field: ['꼬마 펭귄'] } });
  bigCounters(e, 1);
  turn(e, 'A', 'deploy');
  ok(!e.canKeySummon('A', find(e, 'A', 'hand', '궁극신')), '카운터가 1개씩이면 소환 불가');
}
{
  // 다른 카드 효과로는 소환 불가 (조건 필요)
  const e = setup({ A: { grave: ['궁극신', '마법'], hand: ['마법'] }, B: {} });
  const k = find(e, 'A', 'grave', '궁극신');
  turn(e, 'A', 'deploy');
  const ctx = { player: 'A', uid: find(e, 'A', 'hand', '마법'), sel: {} };
  ok(!e.canSummon(k, ctx, null), '일반 소환 효과로는 소환 불가');
  ok(e.canSummon(k, ctx, null, { ignoreConditions: true }), '조건 무시 효과로는 가능');
}
{
  // e2: 패에서 이름이 다른 엘리멘츠 몬스터 4장까지 소환, 소환시 효과(e2)를 이 카드의 효과로 사용, 궁극 카운터 +1, 서로 응답 불가
  const e = setup({ A: { field: ['궁극신'], hand: ['불', '물', '전기', '바람'], deck: ['불', '물', '전기'] }, B: { field: ['꼬마 펭귄'], hand: ['카드의 흑기사'] } }, pick('counter'),
    { respond: ({ player, options }) => player === 'B' ? options.find((o) => o.eid === 'e2' && nm(e, o.uid) === '카드의 흑기사') || null : null });
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'field', '궁극신');
  act(e, 'A', 'field', '궁극신', 'e2');
  show(e);
  ok(e.S.players.A.field.length === 5, '정령 4장 소환 (궁극신 포함 5장)');
  ok(ctr(e, k, '궁극') === 1 && e.attack(k) === 8, '궁극 카운터 1개 -> 공격력 8');
  ok(ctr(e, e.S.players.B.field[0], '화염') + ctr(e, e.S.players.B.field[0], '물') + ctr(e, e.S.players.B.field[0], '전기') + ctr(e, e.S.players.B.field[0], '바람') >= 1, '소환시 효과가 이 카드의 효과로 처리됨 (카운터 놓임)');
}
{
  // e3 무효, e4 제외되면 패로 + 상대 패 제외
  const e = setup({ A: { field: ['궁극신'] }, B: { hand: ['카드의 흑기사', '펭귄 마을'], field: ['꼬마 펭귄'], deck: ['펭귄 부부'] } }, null,
    { respond: ({ player, options }) => player === 'A' ? options.find((o) => nm(e, o.uid) === '엘리멘츠의 궁극신' && o.eid === 'e3') || null : null });
  turn(e, 'B', 'deploy');
  act(e, 'B', 'hand', '펭귄 마을', 'e1');
  ok(cnt(e, 'B', 'hand') === 1 && has(e, 'B', 'grave', '펭귄 마을'), 'e3 상대 효과 무효 (드로우 안 함)');
  const k = find(e, 'A', 'field', '궁극신');
  e.S.players.B.hand.forEach((u) => (e.S.cards[u].revealed = true));
  e.moveCard(k, 'banished'); e.emit({ type: 'moved_to_zone', uid: k, from: 'field', to: 'banished', player: 'A' }); e.processTriggers();
  ok(has(e, 'A', 'hand', '궁극신') && cnt(e, 'B', 'banished') === 1, 'e4 제외되면 패로 + 상대 패 1장 제외');
}
{
  // e2 응답 불가: 상대가 흑기사를 가지고 있어도 e2 에는 효과를 발동하지 못한다
  const e = setup({ A: { field: ['궁극신'], hand: ['불'] }, B: { field: ['카드의 흑기사'] } }, pick('counter'),
    { respond: ({ player, options }) => player === 'B' ? options.find((o) => o.eid === 'e2' && nm(e, o.uid) === '카드의 흑기사') || null : null });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'field', '궁극신', 'e2');
  ok(!e.log.some((l) => l.includes('체인 2: B')), 'e2 에는 체인 응답이 없음');
}

console.log('E11: 엘리멘츠의 마법');
{
  const e = setup({ A: { hand: ['마법'], grave: ['불'], deck: ['물'] }, B: { field: ['꼬마 펭귄'] } }, pick('불', '물'));
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '마법', 'e1');
  ok(has(e, 'A', 'field', '불') && has(e, 'A', 'field', '물'), '묘지의 몬스터 소환 + 덱에서 소환');
  const t = e.S.players.B.field[0];
  ok(ctr(e, t, '물') === 3 && ctr(e, t, '화염') === 1, '2개 놓음 + 소환된 정령들의 e2 카운터가 이어서 놓임 (물 3, 화염 1)');
}
{
  const e = setup({ A: { hand: ['마법'], banished: ['무지개'], deck: ['물'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '마법', 'e1');
  ok(has(e, 'A', 'hand', '무지개') && has(e, 'A', 'field', '물'), '몬스터가 아니면 패에 넣는다');
}

console.log('E12: 엘리멘츠의 궁극 창조신');
{
  const e = setup({ A: { hand: ['창조신'], grave: ['불', '물', '전기'], field: ['불'] }, B: { field: ['꼬마 펭귄', '펭귄 부부', '현자 펭귄'], field_zone: [] } });
  const B1 = e.S.players.B.field[0]; for (const k of ['화염', '물', '전기', '바람']) give(e, B1, k, 4);
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'hand', '창조신');
  ok(e.canKeySummon('A', k), '4종 4개씩 제거 조건 -> 소환 가능');
  e.keySummon('A', k);
  show(e);
  ok(has(e, 'A', 'field', '창조신'), '소환됨');
  ok(e.S.players.B.field.length === 0 && cnt(e, 'B', 'hand') === 3, 'e1 상대 필드 3장 이상 + 내 묘지 합계 7장까지 패로 (상대 필드 3장)');
  ok(cnt(e, 'A', 'hand') >= 3, '내 묘지의 카드도 내 패로 (4장까지 추가)');
  const k2 = e.addCard(N('창조신'), 'A', 'hand'); for (const kk of ['화염', '물', '전기', '바람']) give(e, e.S.players.B.field[0] || e.addCard(N('꼬마 펭귄'), 'B', 'field'), kk, 4);
  ok(!e.canKeySummon('A', k2), '1턴에 1번만 소환 가능');
}
{
  const e = setup({ A: { field: ['창조신'], hand: ['불', '물', '전기', '바람'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'], hand: ['펭귄 마을'] } }, pick('counter'));
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'field', '창조신');
  act(e, 'A', 'field', '창조신', 'e2');
  ok(ctr(e, k, '궁극') === 1, 'e2 궁극 카운터 1개');
  const tot = (kn) => e.S.players.B.field.reduce((a, u) => a + ctr(e, u, kn), 0);
  ok(tot('화염') >= 1 && tot('물') >= 1, 'e2 카운터 놓임 (소환시 효과 + 종류별 2개까지 분배): 화염 ' + tot('화염') + ' 물 ' + tot('물'));
}
{
  // e3: 상대는 자신의 패를 버리는 효과를 발동 못함, 효과의 대상이 되지 않음
  const e = setup({ A: { field: ['창조신'] }, B: { hand: ['펭귄!돌격!', '꼬마 펭귄'], deck: ['펭귄 부부'], field: ['꼬마 펭귄'] } });
  turn(e, 'B', 'deploy');
  const k = find(e, 'A', 'field', '창조신');
  ok(e.untargetable(k, { player: 'B' }), '상대 효과의 대상이 되지 않음');
  ok(!e.untargetable(k, { player: 'A' }), '내 효과에는 대상이 됨');
  const e2 = setup({ A: { field: ['창조신'] }, B: { hand: ['그레이트 올드 원-크아이가', '꼬마 펭귄'], deck: ['펭귄 부부'] } });
  turn(e2, 'B', 'deploy');
  ok(!e2.canActivate(find(e2, 'B', 'hand', '그레이트 올드 원-크아이가'), e2.def(find(e2, 'B', 'hand', '그레이트 올드 원-크아이가')).effects[0]), 'e3 상대는 자신의 패를 버리는 효과를 발동할 수 없음');
  const e3 = setup({ A: { field: ['불'] }, B: { hand: ['그레이트 올드 원-크아이가'], deck: ['펭귄 부부'] } });
  turn(e3, 'B', 'deploy');
  ok(e3.canActivate(find(e3, 'B', 'hand', '그레이트 올드 원-크아이가'), e3.def(find(e3, 'B', 'hand', '그레이트 올드 원-크아이가')).effects[0]), '(창조신이 없으면 발동 가능)');
}
{
  // e4: 제외되면 소환 조건 무시 소환 + 궁극 카운터 / e5: 궁극 카운터 3개 제거 -> 공격력 +7, 이 턴 필드에서 벗어나지 않음
  const e = setup({ A: { field: ['창조신'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'field', '창조신');
  give(e, k, '궁극', 3);
  act(e, 'A', 'field', '창조신', 'e5');
  ok(e.attack(k) === 7 + 7 && ctr(e, k, '궁극') === 0, 'e5 궁극 카운터 3개 제거(코스트) -> 공격력 +7 영구 (14)');
  e.toGrave(k, { player: 'B' }, null);
  ok(e.S.cards[k].zone === 'field', '이 턴 필드에서 벗어나지 않음');
  const e2 = setup({ A: { banished: ['창조신'] }, B: {} });
  turn(e2, 'A', 'deploy');
  const k2 = find(e2, 'A', 'banished', '창조신');
  e2.emit({ type: 'moved_to_zone', uid: k2, from: 'field', to: 'banished', player: 'A' }); e2.processTriggers();
  ok(e2.S.cards[k2].zone === 'field' && ctr(e2, k2, '궁극') === 1, 'e4 제외되면 조건 무시 소환 + 궁극 카운터 1개');
}

console.log('E13: 궁극의 엘리멘츠');
{
  const e = setup({ A: { hand: ['궁극의'], field: ['창조신'], keydeck: ['궁극신'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'hand', '궁극의', 'e1');
  show(e);
  ok(has(e, 'A', 'field', '궁극신'), '키 카드 덱의 궁극신을 조건 무시 소환');
  ok(cnt(e, 'B', 'field') === 2 && cnt(e, 'A', 'field') === 2, '소환 시 효과는 발동하지 않음 (다른 몬스터가 패로 돌아가지 않음)');
}
{
  const e = setup({ A: { hand: ['궁극의'], keydeck: ['궁극신'] }, B: {} });
  turn(e, 'A', 'deploy');
  ok(!tryAct(e, 'A', 'hand', '궁극의', 'e1'), '창조신이 없으면 불가');
}
{
  const e = setup({ A: { hand: ['궁극의', '불'], deck: ['물'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.toGrave(find(e, 'A', 'hand', '궁극의'), { player: 'A' }, null); e.processTriggers();
  ok(has(e, 'A', 'hand', '물') && cnt(e, 'A', 'hand') === 1, 'e2 묘지로 보내졌을 때 서치 + 패 1장 버림');
}

console.log('E14: 엘리멘츠의 어둠정령');
{
  const e = setup({ A: { hand: ['어둠'], field: ['불'], deck: ['물', '전기', '바람', '꼬마 펭귄'] }, B: { field: ['꼬마 펭귄'] } });
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'hand', '어둠');
  ok(e.canKeySummon('A', k), '내 필드에 엘리멘츠 몬스터가 있으면 소환 가능');
  e.keySummon('A', k);
  show(e);
  ok(e.S.players.B.field.includes(k) && e.ctrl(k) === 'B' && e.S.cards[k].owner === 'A', '상대 필드에 소환 (원래 주인은 나)');
  ok(e.S.players.B.field.length === 1 + 1 + 3, 'e2 덱에서 몬스터 3장을 상대 필드에 (효과 무효)');
  const neg = e.S.players.B.field.filter((u) => e.S.cards[u].negated);
  ok(neg.length === 3, '소환된 3장은 효과가 무효');
  // e3: 컨트롤러(상대) 필드에 다른 엘리멘츠 몬스터가 있어 필드에서 벗어날 수 없다
  e.toGrave(k, { player: 'A' }, null);
  ok(e.S.cards[k].zone === 'field', '필드에서 벗어날 수 없음');
}
{
  const e = setup({ A: { hand: ['어둠'] }, B: {} });
  turn(e, 'A', 'deploy');
  ok(!e.canKeySummon('A', find(e, 'A', 'hand', '어둠')), '엘리멘츠 몬스터가 없으면 소환 불가');
}
{
  // 상대 필드의 내 어둠정령이 상대 몬스터로 공격할 수 있는지 (컨트롤러 기준)
  const e = setup({ A: { field: ['불'] }, B: {} });
  const d = e.addCard(N('어둠'), 'A', 'hand'); e.moveCard(d, 'field', { to: 'B' });
  turn(e, 'B', 'attack');
  ok(e.canAttack(d, e.S.players.A.field[0]), '컨트롤러(B)의 턴에 공격 가능');
  turn(e, 'A', 'attack');
  ok(!e.canAttack(d, e.S.players.A.field[0]), '원래 주인(A)의 턴에는 공격 불가');
}

console.log('E15: 엘리멘츠의 빛정령');
{
  const e = setup({ A: { hand: ['빛'], field: ['불'], deck: ['물'] }, B: {} });
  const dk = e.addCard(N('어둠'), 'A', 'hand'); e.moveCard(dk, 'field', { to: 'B' });
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'hand', '빛');
  ok(e.canKeySummon('A', k), '내 필드에 엘리멘츠 몬스터가 있으면 소환 가능');
  e.keySummon('A', k);
  ok(ctr(e, dk, '궁극') === 1 && e.attack(dk) === 8, 'e2 상대 필드의 어둠정령에 궁극 카운터 -> 공격력 8');
  ok(has(e, 'A', 'hand', '물'), '덱에서 엘리멘츠 서치');
  ok(e.untargetable(k, { player: 'B' }), 'e3 상대 효과의 대상이 되지 않음');
}

console.log('E16: 재창조의 엘리멘츠');
{
  const e = setup({ A: { hand: ['재창조'], deck: ['불'] }, B: { field: ['꼬마 펭귄', '펭귄 부부'] } });
  const [a, b] = e.S.players.B.field; give(e, a, '화염', 2); give(e, b, '물', 1);
  turn(e, 'B', 'deploy');
  act(e, 'A', 'hand', '재창조', 'e1');
  const tot = (kn) => e.S.players.B.field.reduce((x, u) => x + ctr(e, u, kn), 0);
  ok(tot('화염') === 4 && tot('물') === 2, '종류와 개수가 같도록 추가 (화염 2->4, 물 1->2)');
}
{
  const e = setup({ A: { grave: ['재창조'], banished: ['불', '물', '전기'] }, B: {} });
  turn(e, 'A', 'deploy');
  act(e, 'A', 'grave', '재창조', 'e2');
  ok(cnt(e, 'A', 'hand') === 2, 'e2 제외 상태의 엘리멘츠 카드 2장까지 패에');
}

console.log('\n결과: PASS ' + pass + ' / FAIL ' + fail);

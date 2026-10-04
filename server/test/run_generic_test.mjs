import fs from 'fs';
import { Engine, unsupportedFeatures } from '../src/engine.mjs';
const pen = JSON.parse(fs.readFileSync(new URL('../src/cards/penguin_deck.json', import.meta.url), 'utf8'));
const gen = JSON.parse(fs.readFileSync(new URL('../src/cards/generic_deck.json', import.meta.url), 'utf8'));
const defs = [...pen, ...gen.cards];
const byName = Object.fromEntries(defs.map((d) => [d.name, d.id]));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + m); };
function setup(spec, picker, extra = {}) {
  const e = new Engine(defs, { effectFilters: gen.effect_filters, ...extra,
    choose: (q) => picker ? picker(q, e) : (q.kind === 'number' ? q.max : q.options.slice(0, q.kind === 'subset' ? 1 : Math.min(q.max, q.options.length))) });
  for (const [p, zones] of Object.entries(spec)) for (const [z, names] of Object.entries(zones))
    for (const n of names) e.addCard(byName[n], p, z);
  return e;
}
const find = (e, p, z, name) => e.S.players[p][z].find((u) => e.def(u).name === name);
const names = (e, p, z) => e.S.players[p][z].map((u) => e.def(u).name + (e.S.cards[u].revealed ? '*' : ''));
const has = (e, p, z, name) => !!find(e, p, z, name);
const show = (e) => console.log(e.log.join('\n'));
const turn = (e, player, phase) => { e.S.turn = { player, phase, number: 5 }; };
const pickN = (...order) => (q, e) => { for (const n of order) { const u = q.options.find?.((x) => e.def(x).name === n); if (u) return [u]; } return q.kind === 'number' ? q.max : q.options.slice(0, q.kind === 'subset' ? 1 : q.min); };

console.log('G1: 흑기사 키 카드 소환 (공격력 합 10 이상)');
{
  const e = setup({ A: { field: ['펭귄 마법사', '수문장 펭귄', '꼬마 펭귄'], keydeck: ['카드의 흑기사'] }, B: { hand: ['펭귄 마을'] } });
  turn(e, 'A', 'deploy');
  const k = find(e, 'A', 'keydeck', '카드의 흑기사');
  ok(!e.canKeySummon('A', k), '합 3+3+1=7 이라 불가');
  e.addCard(byName['펭귄 부부'], 'A', 'field'); // 합 9
  ok(!e.canKeySummon('A', k), '합 9 도 불가');
  e.addCard(byName['펭귄 용사'], 'A', 'field'); // 합 13
  e.keySummon('A', k);
  show(e);
  ok(has(e, 'A', 'field', '카드의 흑기사'), '소환됨');
  ok(e.S.players.A.grave.length >= 2, '코스트로 2장 이상 묘지로');
  const sent = e.log.filter((l) => l.startsWith('  묘지로')).length;
  ok(sent === 5, '조건을 만족하는 조합(5장)을 묘지로 보냄: ' + sent + '장 (펭귄 용사는 e3로 다시 소환됨)');
  ok(!e.fetchOk('A', k), '패로 가져오기 불가(forbidden)');
}
{
  const e = setup({ A: { field: ['펭귄 부부', '펭귄 부부', '꼬마 펭귄'], keydeck: ['풀려난 항아리의 마귀'] }, B: {} });
  turn(e, 'B', 'deploy');
  ok(!e.canKeySummon('A', find(e, 'A', 'keydeck', '풀려난 항아리의 마귀')), '상대 턴에는 불가 (자신 전개 단계만)');
  turn(e, 'A', 'deploy');
  e.keySummon('A', find(e, 'A', 'keydeck', '풀려난 항아리의 마귀'));
  ok(has(e, 'A', 'field', '풀려난 항아리의 마귀') && e.S.players.A.field.length === 1, '정확히 3장 보내고 소환');
}
{
  const e = setup({ A: { field: ['풀려난 항아리의 마귀', '꼬마 펭귄'], deck: ['영웅의 탄생'], keydeck: ['카드 세계의 영웅'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.keySummon('A', find(e, 'A', 'keydeck', '카드 세계의 영웅'));
  show(e);
  ok(has(e, 'A', 'field', '카드 세계의 영웅') && e.S.players.A.field.length === 1, '항아리 마귀 + 다른 몬스터 1장 보내고 소환');
  ok(has(e, 'A', 'hand', '영웅의 탄생'), '소환 시 e1: 영웅의 탄생 서치');
}

console.log('G2: 흑기사 e2 - 상대 효과 무효 + 그 카드 묘지로 / 마법은 이미 묘지여도 무효');
{
  const e = setup({ A: { field: ['카드의 흑기사'] }, B: { hand: ['꼬마 펭귄'], deck: ['펭귄 부부'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '카드의 흑기사' && o.eid === 'e2') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '꼬마 펭귄'), 'e1');
  show(e);
  ok(e.S.players.B.field.length === 0, '꼬마 e1 무효 -> 소환 안 됨');
  ok(has(e, 'B', 'grave', '꼬마 펭귄'), '무효로 하고 그 카드(손에서 발동된 몬스터)는 묘지로');
}
{
  const e = setup({ A: { field: ['카드의 흑기사'] }, B: { hand: ['펭귄 마을'], deck: ['펭귄 부부'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '카드의 흑기사' && o.eid === 'e2') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '펭귄 마을'), 'e1');
  ok(e.S.players.B.hand.length === 0 && has(e, 'B', 'grave', '펭귄 마을'), '마을 e1 무효: 드로우 안 함, 이미 묘지라 그대로');
}

console.log('G3: 흑기사 e3 (상대 전개 단계 / 덱 위 3장 묘지 / 몬스터 수만큼 드로우)');
{
  const e = setup({ A: { field: ['카드의 흑기사'], deck: ['꼬마 펭귄', '펭귄 마을', '펭귄 부부', '현자 펭귄', '현자 펭귄'] }, B: {} });
  turn(e, 'A', 'deploy');
  let blocked = false; try { e.activate(find(e, 'A', 'field', '카드의 흑기사'), 'e3'); } catch { blocked = true; }
  ok(blocked, '내 턴에는 발동 불가');
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'A', 'field', '카드의 흑기사'), 'e3');
  show(e);
  ok(e.S.players.A.grave.length === 3, '3장 묘지로');
  ok(e.S.players.A.hand.length === 2, '몬스터 2장이라 2장 드로우');
}
{
  const e = setup({ A: { field: ['카드의 흑기사'], deck: ['펭귄 마을', '펭귄 마을', '펭귄의 일격', '현자 펭귄'] }, B: {} });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'A', 'field', '카드의 흑기사'), 'e3');
  ok(e.S.players.A.grave.length === 3 && e.S.players.A.hand.length === 0, '몬스터 0장이면 드로우 0장이어도 처리');
}

console.log('G4: 서치 봉인의 항아리');
{
  const e = setup({ A: { hand: ['서치 봉인의 항아리'], deck: ['꼬마 펭귄', '펭귄 부부'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.activate(find(e, 'A', 'hand', '서치 봉인의 항아리'), 'e1');
  ok(has(e, 'A', 'deck', '서치 봉인의 항아리') && !has(e, 'A', 'grave', '서치 봉인의 항아리'), '코스트로 덱에 돌아가서 묘지에 안 감');
  ok(e.S.players.A.hand.length === 1, '1장 드로우');
}
{ // 버려지면 이 턴 서로 덱에서 패에 넣을 수 없음
  const e = setup({ A: { hand: ['서치 봉인의 항아리'], deck: ['꼬마 펭귄'] }, B: { hand: ['일격필살'], deck: ['꼬마 펭귄'] } },
    (q, e) => q.kind === 'cards' ? [find(e, 'A', 'hand', '서치 봉인의 항아리')] : q.max);
  e.S.cards[find(e, 'A', 'hand', '서치 봉인의 항아리')].revealed = true;
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '일격필살'), 'e1');
  show(e);
  ok(e.restricted('add_to_hand_from_deck'), '패에서 버려지면 e2 유발 -> 덱에서 패에 넣기 제한');
  ok(!e.runStep({ type: 'draw', count: 1 }, { player: 'B', sel: {} }), '드로우도 막힘');
  ok(!e.runStep({ type: 'draw', count: 1 }, { player: 'A', sel: {} }), '상대도 막힘(서로)');
  e.startTurn('A');
  ok(!e.restricted('add_to_hand_from_deck'), '다음 턴엔 해제');
}

console.log('G5: 풀려난 항아리의 마귀');
{
  const e = setup({ A: { field: ['풀려난 항아리의 마귀'], hand: ['꼬마 펭귄', '펭귄 마을'] }, B: { hand: ['서치 봉인의 항아리'], deck: ['꼬마 펭귄'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '풀려난 항아리의 마귀') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '서치 봉인의 항아리'), 'e1');
  show(e);
  ok(e.S.players.B.hand.length === 0 && has(e, 'B', 'deck', '서치 봉인의 항아리'), '서치 봉인 e1 무효: 드로우 안 됨 (코스트는 지불됨)');
  ok(e.S.players.A.grave.length === 1, '자신은 패 1장 버림');
}
{
  const e = setup({ A: { field: ['풀려난 항아리의 마귀'], deck: ['꼬마 펭귄'] }, B: {} });
  turn(e, 'A', 'attack');
  const u = find(e, 'A', 'field', '풀려난 항아리의 마귀');
  e.activate(u, 'e2');
  ok(has(e, 'A', 'hand', '꼬마 펭귄') && e.attack(u) === 6, 'e2: 서치 + 공격력 +1');
  e.toGrave(u, { player: 'B', uid: null }, null); e.processTriggers();
  show(e);
  ok(e.restricted('add_to_hand_from_deck'), 'e3 (묘지로 갔을 경우 강제 발동): 덱에서 패에 넣기 제한');
}

console.log('G6: 카드 세계의 영웅');
{
  const e = setup({ A: { field: ['카드 세계의 영웅'], deck: ['영웅의 탄생', '영웅의 탄생'], grave: ['풀려난 항아리의 마귀'] }, B: { hand: ['펭귄 마법사'], deck: ['꼬마 펭귄'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '카드 세계의 영웅' && o.eid === 'e2') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '펭귄 마법사'), 'e1'); // 덱에서 서치하는 효과
  show(e);
  ok(has(e, 'A', 'hand', '영웅의 탄생'), 'e2: 상대의 서치 효과에 반응해 영웅의 탄생 회수');
}
{
  const e = setup({ A: { field: ['카드 세계의 영웅'], grave: ['풀려난 항아리의 마귀'] }, B: {} });
  turn(e, 'B', 'deploy');
  e.toGrave(find(e, 'A', 'field', '카드 세계의 영웅'), { player: 'B' }, null); e.processTriggers();
  ok(has(e, 'A', 'field', '풀려난 항아리의 마귀'), 'e3 (강제): 묘지로 가면 항아리 마귀를 소환');
}
{ // 반응하지 않는 경우: 서치/묘지 관련이 아닌 효과
  const e = setup({ A: { field: ['카드 세계의 영웅'], deck: ['영웅의 탄생'] }, B: { hand: ['꼬마 펭귄'] } }, null,
    { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '카드 세계의 영웅' && o.eid === 'e2') || null : null });
  turn(e, 'B', 'deploy');
  const opts = (() => { e.declare(find(e, 'B', 'hand', '꼬마 펭귄'), 'e1'); return e.options('A', true).filter((o) => o.eid === 'e2'); })();
  ok(opts.length === 0, '꼬마 e1(패에서 소환)에는 반응 안 함');
}

console.log('G7: 영웅의 탄생 / 출입통제 / 단단한 카드 자물쇠');
{
  const e = setup({ A: { hand: ['출입통제'] }, B: { hand: ['꼬마 펭귄', '펭귄 마을'], deck: ['펭귄 부부'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '출입통제') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '꼬마 펭귄'), 'e1');
  ok(e.S.players.B.field.length === 0, '출입통제: 소환 효과 무효');
  e.S.chain = []; e.S.usage.turn = {};
  const g = find(e, 'A', 'grave', '출입통제');
  ok(!!g, '출입통제는 묘지로');
}
{
  const e = setup({ A: { hand: ['출입통제'] }, B: { hand: ['펭귄 마을'], deck: ['펭귄 부부'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '출입통제') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '펭귄 마을'), 'e1');
  ok(has(e, 'A', 'hand', '출입통제') && e.S.players.B.hand.length === 1, '소환이 없는 효과(드로우)에는 응답 못 함 -> 마을 정상 처리');
}
{
  const e = setup({ A: { hand: ['영웅의 탄생'] }, B: { hand: ['펭귄 마을'], deck: ['펭귄 부부'] } },
    null, { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '영웅의 탄생') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '펭귄 마을'), 'e1');
  ok(e.S.players.B.hand.length === 0, '영웅의 탄생: 드로우 효과도 무효');
}
{ // 자물쇠: 체인 위의 효과도 처리 시 무효
  const e = setup({ A: { hand: ['단단한 카드 자물쇠'], field: ['꼬마 펭귄'] }, B: { field: ['카드의 흑기사'] } },
    (q, e) => q.kind !== 'cards' ? q.max : [q.options.find((u) => e.def(u).name === (q.player === 'B' ? '꼬마 펭귄' : '카드의 흑기사')) ?? q.options[0]],
    { respond: ({ player, options }) => player === 'A' ? options.find((o) => e.def(o.uid).name === '단단한 카드 자물쇠') || null : null });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'field', '카드의 흑기사'), 'e1'); // 흑기사 e1: 필드 카드 1장 묘지로
  show(e);
  ok(has(e, 'A', 'field', '꼬마 펭귄'), '자물쇠가 먼저 처리돼 흑기사 e1은 무효 -> 내 몬스터 무사');
  ok(e.S.disabled[find(e, 'B', 'field', '카드의 흑기사')], '대상 카드 효과가 턴 종료시까지 무효');
  let blocked = false; try { e.S.usage.turn = {}; e.activate(find(e, 'B', 'field', '카드의 흑기사'), 'e1'); } catch { blocked = true; }
  ok(blocked, '이후 그 카드는 효과 발동 불가');
  e.startTurn('A');
  ok(!e.S.disabled[find(e, 'B', 'field', '카드의 흑기사')], '턴이 끝나면 해제');
}

console.log('G8: 신성한 수호자 / 수호의 빛 / 공격 제한');
{
  const e = setup({ A: { hand: ['신성한 수호자'], deck: ['수호의 빛'] }, B: { hand: [] } });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'A', 'hand', '신성한 수호자'), 'e1');
  show(e);
  ok(e.restricted('banish'), '이 턴 서로 제외 불가');
  ok(has(e, 'A', 'hand', '수호의 빛'), 'e2: 제외되면(강제) 수호의 빛 서치');
  e.addCard(byName['펭귄이여 영원하라'], 'A', 'grave');
  turn(e, 'B', 'deploy');
  ok(!e.options('A', true).some((o) => e.def(o.uid).name === '펭귄이여 영원하라'), '제외 불가라 영원하라 e2(제외 코스트)도 못 씀');
}
{
  const e = setup({ A: { hand: ['수호의 빛'], banished: ['꼬마 펭귄'], field: ['펭귄 부부', '꼬마 펭귄'] }, B: { field: ['현자 펭귄', '수문장 펭귄'] } });
  turn(e, 'A', 'deploy');
  e.activate(find(e, 'A', 'hand', '수호의 빛'), 'e1');
  ok(has(e, 'A', 'field_zone', '수호의 빛'), '필드 존에 놓임 (묘지로 안 감)');
  ok(has(e, 'A', 'hand', '꼬마 펭귄'), '발동 시 처리로 제외된 카드 1장 회수');
  turn(e, 'A', 'attack');
  const [a1, a2] = e.S.players.A.field, [b1] = e.S.players.B.field;
  e.declareAttack(a1, b1);
  ok(!e.canAttack(a2, e.S.players.B.field[0]), '공격 단계에 몬스터 하나로만 공격 가능');
}
{ // 필드 카드 교체
  const e = setup({ A: { hand: ['수호의 빛'], field_zone: ['수호의 빛'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.activate(find(e, 'A', 'hand', '수호의 빛'), 'e1');
  ok(e.S.players.A.field_zone.length === 1 && e.S.players.A.grave.length === 1, '새 필드 카드가 발동하면 기존 카드는 묘지로');
}

console.log('G9: 황금 사과 / 눈에는 눈');
{
  const e = setup({ A: { hand: ['유혹의 황금 사과', '펭귄 마을'], deck: ['꼬마 펭귄', '현자 펭귄'] }, B: { hand: ['꼬마 펭귄'], deck: ['펭귄 부부'] } });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'A', 'hand', '유혹의 황금 사과'), 'e1');
  ok(e.S.temp.length === 1, '임시 효과 등록');
  const before = e.S.players.A.hand.length;
  e.activate(find(e, 'B', 'hand', '꼬마 펭귄'), 'e1');
  show(e);
  ok(e.S.players.A.hand.length === before + 1, '상대가 패에서 소환하자 즉시 1장 드로우(체인 없음)');
  ok(!e.log.some((l) => l.startsWith('체인') && l.includes('x1')), '체인 링크로 올라가지 않음');
  turn(e, 'A', 'deploy'); e.S.usage.turn = {};
  ok(e.S.cards[find(e, 'A', 'grave', '유혹의 황금 사과')], '사과는 묘지');
}
{
  const e = setup({ A: { hand: ['눈에는 눈', '펭귄 마을'], deck: ['꼬마 펭귄', '현자 펭귄', '펭귄 부부'] }, B: { hand: ['펭귄 마을'], deck: ['현자 펭귄', '펭귄 부부'] } });
  turn(e, 'B', 'deploy');
  e.activate(find(e, 'B', 'hand', '펭귄 마을'), 'e1'); // 상대 드로우 -> 눈에는 눈
  show(e);
  ok(has(e, 'A', 'grave', '눈에는 눈') && e.S.players.A.hand.length === 3, '상대 드로우에 반응: 2장 드로우 (마을+2장)');
}

console.log('G10: 구사일생 / 전투');
{
  const setupC = () => setup({ A: { field: ['수문장 펭귄'], hand: ['펭귄 마을'] }, B: { field: ['꼬마 펭귄'], hand: ['구사일생', '펭귄 마을', '펭귄 부부'], deck: ['현자 펭귄'] } },
    (q, e) => q.kind === 'cards' ? q.options.slice(0, q.min) : q.max);
  const e = setupC();
  turn(e, 'A', 'attack');
  e.declareAttack(find(e, 'A', 'field', '수문장 펭귄'), find(e, 'B', 'field', '꼬마 펭귄'));
  ok(e.S.players.B.hand.length === 1, '응답 없으면 공격력 차(2)만큼 수비 측이 패를 버림: 남은 ' + e.S.players.B.hand.length);
  ok(has(e, 'B', 'grave', '꼬마 펭귄') && has(e, 'A', 'field', '수문장 펭귄'), '진 쪽(수비 몬스터)은 묘지로');
  const e2 = setup({ A: { field: ['수문장 펭귄'], hand: ['펭귄 마을'] }, B: { field: ['꼬마 펭귄'], hand: ['구사일생', '펭귄 마을'], deck: ['현자 펭귄'] } },
    (q, e) => q.kind === 'cards' ? q.options.slice(0, q.min) : q.max,
    { respond: ({ player, options }) => player === 'B' ? options.find((o) => e2.def(o.uid).name === '구사일생') || null : null });
  turn(e2, 'A', 'attack');
  e2.declareAttack(find(e2, 'A', 'field', '수문장 펭귄'), find(e2, 'B', 'field', '꼬마 펭귄'));
  show(e2);
  ok(has(e2, 'B', 'grave', '꼬마 펭귄'), '데미지가 0이어도 진 몬스터는 묘지로 (임시 해석)');
  ok(e2.S.players.B.hand.length === 2 && has(e2, 'B', 'grave', '구사일생'), '구사일생: 공격력 차(2) >= 패 수(2): 발동, 데미지 0 + 1드로우 (남은 패 2장)');
  const e3 = setup({ A: { field: ['꼬마 펭귄'], hand: ['펭귄 마을', '펭귄 부부', '현자 펭귄'] }, B: { field: ['수문장 펭귄'], hand: ['펭귄 마을'] } },
    (q, e) => q.kind === 'cards' ? q.options.slice(0, q.min) : q.max);
  turn(e3, 'A', 'attack');
  e3.declareAttack(find(e3, 'A', 'field', '꼬마 펭귄'), find(e3, 'B', 'field', '수문장 펭귄'));
  ok(e3.S.players.A.hand.length === 1 && e3.S.players.B.hand.length === 1, '공격한 쪽이 지면 공격한 쪽이 차이(2)만큼 버림');
  ok(has(e3, 'A', 'grave', '꼬마 펭귄') && has(e3, 'B', 'field', '수문장 펭귄'), '공격한 쪽이 지면 공격한 몬스터가 묘지로');
  const e4 = setup({ A: { field: ['꼬마 펭귄'], hand: ['펭귄 마을'] }, B: { field: ['꼬마 펭귄'], hand: ['펭귄 마을'] } });
  turn(e4, 'A', 'attack');
  e4.declareAttack(find(e4, 'A', 'field', '꼬마 펭귄'), find(e4, 'B', 'field', '꼬마 펭귄'));
  ok(e4.S.players.A.hand.length === 1 && e4.S.players.B.hand.length === 1, '공격력이 같으면 데미지 없음');
  ok(e4.S.players.A.field.length === 0 && e4.S.players.B.field.length === 0, '공격력이 같으면(0 제외) 서로 묘지로');
  const e5 = setup({ A: { field: ['꼬마 펭귄'], hand: ['펭귄 마을'] }, B: { field: ['꼬마 펭귄'], hand: ['펭귄 마을'] } });
  e5.S.players.A.field.concat(e5.S.players.B.field).forEach((u) => { e5.S.cards[u].bonus = -1; });
  turn(e5, 'A', 'attack');
  e5.declareAttack(e5.S.players.A.field[0], e5.S.players.B.field[0]);
  ok(e5.S.players.A.field.length === 1 && e5.S.players.B.field.length === 1, '공격력이 둘 다 0이면 그대로');
}

console.log('G11: 단 한 번의 기회 / 일격필살 (묘지 보호)');
{
  const e = setup({ A: { grave: ['단 한 번의 기회', '일격필살'] }, B: { field: ['카드의 흑기사'], hand: ['꼬마 펭귄'] } });
  const u = find(e, 'A', 'grave', '단 한 번의 기회');
  ok(e.untargetable(u), '묘지에서 대상이 되지 않음');
  const hand = e.addCard(byName['단 한 번의 기회'], 'A', 'hand');
  ok(!e.untargetable(hand), '패에서는 해당 없음');
  ok(!e.runStep({ type: 'banish', card: 'x' }, { player: 'B', uid: find(e, 'B', 'field', '카드의 흑기사'), sel: { x: [u] } }), '다른 카드 효과로 제외 불가');
  ok(!e.runStep({ type: 'add_to_hand', card: 'x' }, { player: 'B', uid: find(e, 'B', 'field', '카드의 흑기사'), sel: { x: [u] } }), '회수 불가');
}
{
  const e = setup({ A: { hand: ['일격필살'] }, B: { hand: ['펭귄 마을', '꼬마 펭귄'] } }, (q) => q.kind === 'cards' ? [q.options[1]] : q.max);
  turn(e, 'A', 'deploy');
  e.activate(find(e, 'A', 'hand', '일격필살'), 'e1');
  ok(e.S.players.B.hand.length === 1 && e.S.players.B.grave.length === 1, '상대가 직접 골라 1장 버림');
}
{
  const e = setup({ A: { hand: ['단 한 번의 기회'], deck: ['꼬마 펭귄'] }, B: {} });
  turn(e, 'A', 'deploy');
  e.activate(find(e, 'A', 'hand', '단 한 번의 기회'), 'e1');
  ok(e.S.players.A.hand.length === 1 && has(e, 'A', 'grave', '단 한 번의 기회'), '1장 드로우');
}

console.log('G12: 가져오기 / 눈 (키 카드 단 한 번의 기회 가져오기는 조건 없음)');
{
  const e = setup({ A: { keydeck: ['단 한 번의 기회', '카드의 흑기사'] }, B: {} });
  e.fetchKeyCard('A', find(e, 'A', 'keydeck', '단 한 번의 기회'));
  ok(has(e, 'A', 'hand', '단 한 번의 기회'), '가져오기 가능');
  ok(!e.fetchOk('A', find(e, 'A', 'keydeck', '카드의 흑기사')), '흑기사는 가져오기 불가');
}

console.log('\n=== 범용카드 효과 지원 현황 ===');
let sup = 0, tot = 0; const rows = [];
for (const c of gen.cards) for (const ef of c.effects) { tot++; const bad = unsupportedFeatures(ef); if (!bad.length) sup++; else rows.push(`${c.name} ${ef.id}: ${bad.join(', ')}`); }
console.log(`지원 ${sup}/${tot}`); console.log(rows.join('\n'));
console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);

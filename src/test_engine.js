const E = require('./engine.js');
const assert = require('assert');
// ---------- plain scenario ----------
{
// 1. With no step in demand and everyone ordering 4, nothing ever changes.
let g = E.newGame(0); const d = E.CFG.demand; E.CFG.demand = () => 4;
for (let w = 0; w < 20; w++) { const r = E.beginWeek(g); r.pos.forEach(p => { assert.equal(p.stock, 12); assert.equal(p.owed, 0); }); E.endWeek(g, {0:4,1:4,2:4,3:4}); }
// 2. The rule itself holds the chain in balance when demand stays at 4.
g = E.newGame(0);
for (let w = 0; w < 30; w++) { const r = E.beginWeek(g); E.endWeek(g, {}); r.pos.forEach((p,i) => assert.equal(p.order, 4, 'pos '+i+' wk '+r.week+' ordered '+p.order)); }
E.CFG.demand = d;
// 3. Delay: an extra order by the pub in week 1 arrives in week 4 (three weeks later).
g = E.newGame(0); E.CFG.demand = () => 4; let arr = [];
for (let w = 1; w <= 8; w++) { const r = E.beginWeek(g); arr.push(r.pos[0].arrived); E.endWeek(g, {0: w===1?10:4, 1:4,2:4,3:4}); }
console.log('pub arrivals by week (extra 6 ordered in wk1, wholesaler has 12 in stock):', arr.join(' '));
assert.equal(arr[3], 10);
// brewery: extra brew in week 1 is ready in week 4
g = E.newGame(0); arr = [];
for (let w = 1; w <= 8; w++) { const r = E.beginWeek(g); arr.push(r.pos[3].arrived); E.endWeek(g, {0:4,1:4,2:4, 3: w===1?10:4}); }
console.log('brewery arrivals by week (extra 6 brewed in wk1):', arr.join(' '));
assert.equal(arr[3], 10);
E.CFG.demand = d;
// 4. Kegs are conserved along the chain.
g = E.newGame(0); let brewed = 0, sold = 0;
const total = () => g.pos.reduce((s,p)=>s+p.stock+p.inbound[0]+p.inbound[1],0);
const start = total();
for (let w = 1; w <= 36; w++) { const r = E.beginWeek(g); sold += r.pos[0].sent; brewed += g.pos[3].inbound[1]; E.endWeek(g, {}); }
assert.equal(total(), start + brewed - sold);
// 5. A full game played by the rule in every seat.
const peak = [0,0,0,0], minNet=[99,99,99,99], maxNet=[-99,-99,-99,-99];
g.log.forEach(r => r.pos.forEach((p,i)=>{ if(p.order!=null) peak[i]=Math.max(peak[i],p.order); minNet[i]=Math.min(minNet[i],p.net); maxNet[i]=Math.max(maxNet[i],p.net); }));
console.log('peak order   ', E.CFG.names.map((n,i)=>n+' '+peak[i]).join(' | '));
console.log('net stock min', minNet.join(' '), ' max', maxNet.join(' '));
console.log('costs        ', g.pos.map(p=>p.cost).join(' '), ' total', g.pos.reduce((s,p)=>s+p.cost,0));
console.log('pub orders   ', g.log.map(r=>r.pos[0].order).join(' '));
console.log('brewery brews', g.log.map(r=>r.pos[3].order).join(' '));
console.log('plain scenario: all tests passed');
}
// ---------- word-of-mouth scenario ----------
{
const C = E.CFG, keep = Object.assign({}, C);
const reset = () => Object.assign(C, keep);

// 1. With no word of mouth and everyone ordering 4, nothing ever changes.
C.crowdGrowth = 0;
let g = E.newGame(0, 'wom');
for (let w = 0; w < 20; w++) { const r = E.beginWeek(g); r.pos.forEach(p => { assert.equal(p.stock, 12); assert.equal(p.owed, 0); }); assert.equal(r.pos[0].asked, 4); E.endWeek(g, {0:4,1:4,2:4,3:4}); }
// 2. The rule itself holds the chain in balance when the crowd stays at 4.
g = E.newGame(0, 'wom');
for (let w = 0; w < 30; w++) { const r = E.beginWeek(g); E.endWeek(g, {}); r.pos.forEach((p,i) => assert.equal(p.order, 4, 'pos '+i+' wk '+r.week+' ordered '+p.order)); }
// 3. Delay: an extra order by the pub in week 1 arrives in week 4 (three weeks later). Cellar limit lifted for this test.
C.cellar = 99; g = E.newGame(0, 'wom'); let arr = [];
for (let w = 1; w <= 8; w++) { const r = E.beginWeek(g); arr.push(r.pos[0].arrived); E.endWeek(g, {0: w===1?10:4, 1:4,2:4,3:4}); }
console.log('pub arrivals by week (10 ordered in wk1):', arr.join(' '));
assert.equal(arr[3], 10);
g = E.newGame(0, 'wom'); arr = [];
for (let w = 1; w <= 8; w++) { const r = E.beginWeek(g); arr.push(r.pos[3].arrived); E.endWeek(g, {0:4,1:4,2:4, 3: w===1?10:4}); }
assert.equal(arr[3], 10);
reset();

// 4. Cellar limit: what does not fit is sent back, and the cellar never holds more than the limit.
C.crowdGrowth = 0;
g = E.newGame(0, 'wom'); let back = 0;
for (let w = 1; w <= 20; w++) { const r = E.beginWeek(g); assert.ok(r.pos[0].stock + r.pos[0].sent <= C.cellar, 'cellar over its limit'); back += r.pos[0].back; E.endWeek(g, {0: 12}); }
assert.ok(back > 0); assert.equal(back, g.wasted);
console.log('ordering 12 a week for 4 customers: kegs sent back', back);
reset();

// 5. Customers who cannot be served leave: the pub never owes anything.
g = E.newGame(0, 'wom');
for (let w = 1; w <= 20; w++) { const r = E.beginWeek(g); const me = r.pos[0]; assert.equal(me.owed, 0); assert.equal(me.sent + me.turned, me.asked); E.endWeek(g, {0: 0}); }
assert.ok(g.turned > 0);

// 6. Word of mouth: the crowd grows after a fully served week and falls by putOff for each customer turned away.
g = E.newGame(0, 'wom');
let r = E.beginWeek(g); assert.equal(r.pos[0].turned, 0); assert.ok(Math.abs(g.crowd - 4 * (1 + C.crowdGrowth)) < 1e-9);
g = E.newGame(0, 'wom'); g.pos[0].stock = 0; g.pos[0].inbound = [1, 0];
r = E.beginWeek(g); assert.equal(r.pos[0].turned, 3); assert.equal(g.crowd, Math.max(C.crowdFloor, 4 - C.putOff * 3));

// 6b. Recovery: below its starting level the crowd comes back one customer for each fully served week, then grows by a percentage.
g = E.newGame(0, 'wom'); g.crowd = 1; g.pos[0].stock = 20; g.pos[0].inbound = [0, 0];
{ const seen = []; for (let w = 1; w <= 5; w++) { const r = E.beginWeek(g); seen.push(r.demand); assert.equal(r.pos[0].turned, 0); E.endWeek(g, {0: 0}); }
  assert.deepEqual(seen, [1, 2, 3, 4, 4]); assert.ok(Math.abs(g.crowd - 4 * (1 + C.crowdGrowth) * (1 + C.crowdGrowth)) < 1e-9); console.log('crowd coming back from 1:', seen.join(' ')); }

// 7. Kegs are conserved along the chain: start + brewed = now + sold + sent back.
g = E.newGame(0, 'wom'); let brewed = 0;
const total = () => g.pos.reduce((s,p)=>s+p.stock+p.inbound[0]+p.inbound[1],0);
const start = total();
for (let w = 1; w <= 36; w++) { E.beginWeek(g); brewed += g.pos[3].inbound[1]; E.endWeek(g, {0: w % 5 === 0 ? 25 : undefined}); }
assert.equal(total(), start + brewed - g.served - g.wasted);

// 8. Full games with different players in the pub.
function play(label, policy) {
  const g = E.newGame(0, 'wom');
  for (let w = 1; w <= C.weeksPlayed; w++) { const r = E.beginWeek(g); const o = policy(r.pos[0], g); E.endWeek(g, o == null ? {} : {0: o}); }
  const D = g.log.map(r => r.demand);
  console.log(label.padEnd(52), 'served', String(g.served).padStart(4), '| turned away', String(g.turned).padStart(3), '| sent back', String(g.wasted).padStart(4), '| brewery peak', Math.max(...g.log.map(r => r.pos[3].order)));
  console.log('   crowd', D.join(' '));
  return g;
}
play('Sterman rule', () => null);
play('orders what came in', me => me.asked);
play('orders 15 every week', () => 15);
play('tops the cellar up, ignoring kegs on the way', (me, g) => me.asked + (C.cellar - g.pos[0].stock));
play('tops the cellar up, counting kegs on the way', (me, g) => me.asked + (C.cellar - g.pos[0].stock) - (E.onOrder(g, 0) - 2 * me.asked));
console.log('word-of-mouth scenario: all tests passed');
}

const E = require('./engine.js');
const assert = require('assert');
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
console.log('all tests passed');

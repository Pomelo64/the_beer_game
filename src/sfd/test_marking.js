// Tests of the marking rules (layers 1 and 3) on the diagrams in the spec. The mappings
// here are written by hand: in the app the AI makes them (layer 2).
const M = require('./marking.js'), K = require('./key.js').plain, assert = require('assert'), fs = require('fs');
const v1 = JSON.parse(fs.readFileSync(__dirname + '/fixtures/author_v1.json')), v2 = JSON.parse(fs.readFileSync(__dirname + '/fixtures/author_v2.json'));
const MAP = { 'pub cellar': ['C1'], 'registered order': ['C2'], 'waiting to serve': ['C3'], 'cost': ['C4'], 'pub customers': ['C5'], 'order rate': ['C6'], 'beer arrival rate': ['C7'],
  'coming in rate': ['C8'], 'serving rate': ['C9'], 'failed-to-serve rate': ['C10'], 'catch up rate': ['C11'], 'consumption rate': ['C12'], 'cost rate': ['C13'],
  'arrival plan by week': ['C14'], 'wholesaler provision capacity': ['C15'], 'player decision': ['C16'] };
const MAP1 = Object.assign({}, MAP, { 'order rate': ['C6', 'C7'] });
const D = (stocks, aux, flows, links) => ({ stocks: stocks.map(l => ({ label: l })), auxiliaries: aux.map(l => ({ label: l })), clouds: [], junctions: [],
  flows: flows.map(f => ({ label: f[0], from: f[1], to: f[2] })), connectors: links.map(l => ({ from: l[0], to: l[1] })) });
const altA = D(['Inventory', 'Backlog', 'Supply line', 'Total cost'], ['Customer demand', 'Wholesaler stock', 'Order decision'],
  [['Orders', 'cloud', 'Supply line'], ['Receiving', 'Supply line', 'Inventory'], ['Shipments', 'Inventory', 'cloud'], ['New orders', 'cloud', 'Backlog'], ['Orders filled', 'Backlog', 'cloud'], ['Costs', 'cloud', 'Total cost']],
  [['Customer demand', 'New orders'], ['Inventory', 'Shipments'], ['Backlog', 'Shipments'], ['Shipments', 'Orders filled'], ['Supply line', 'Receiving'], ['Wholesaler stock', 'Receiving'], ['Order decision', 'Orders'], ['Inventory', 'Costs'], ['Backlog', 'Costs']]);
const mapA = { Inventory: ['C1'], 'Supply line': ['C2'], Backlog: ['C3'], 'Total cost': ['C4'], Orders: ['C6'], Receiving: ['C7'], 'New orders': ['C8', 'C10'], 'Orders filled': ['C9', 'C11'], Shipments: ['C12'], Costs: ['C13'], 'Customer demand': ['C14'], 'Wholesaler stock': ['C15'], 'Order decision': ['C16'] };
const altB = JSON.parse(JSON.stringify(K.reference));
altB.stocks = altB.stocks.filter(s => s.label !== 'registered order').concat([{ label: 'on back order' }, { label: 'on the road' }]);
altB.flows = altB.flows.filter(f => f.label !== 'beer arrival rate' && f.label !== 'order rate').concat([{ label: 'order rate', from: 'cloud', to: 'on back order' }, { label: 'dispatch', from: 'on back order', to: 'on the road' }, { label: 'arrivals', from: 'on the road', to: 'pub cellar' }]);
altB.connectors = altB.connectors.filter(c => c.to !== 'beer arrival rate').concat([{ from: 'wholesaler provision capacity', to: 'dispatch' }, { from: 'on back order', to: 'dispatch' }, { from: 'on the road', to: 'arrivals' }]);
const mapB = Object.assign({}, MAP, { 'on back order': ['C2'], 'on the road': ['C2'], dispatch: ['C7'], arrivals: ['C7'] });
const bad = JSON.parse(JSON.stringify(altA)); bad.connectors.push({ from: 'Wholesaler stock', to: 'Supply line' }, { from: 'Orders', to: 'Costs' });
bad.flows.push({ label: 'Cancelled', from: 'Supply line', to: 'cloud' });
const fails = (d, m) => M.mechanisms(d, m).mechanisms.filter(x => !x.pass && x.weight !== 'optional').map(x => x.id);
const nota = d => M.notation(d).map(x => x.id);
const cases = [
  ['reference', K.reference, MAP, [], []],
  ['author v2', v2, MAP, [], ['M7']],
  ['author v1', v1, MAP1, [], ['M1', 'M2', 'M3', 'M7']],
  ['Sterman-style', altA, mapA, [], []],
  ['kegs on order split', altB, mapB, [], []],
  ['wrong on purpose', bad, mapA, ['N2', 'W1'], ['M3', 'M10']]
];
for (const [name, d, m, n, f] of cases) {
  assert.deepEqual(nota(d), n, name + ' notation ' + nota(d)); assert.deepEqual(fails(d, m), f, name + ' mechanisms ' + fails(d, m));
  console.log(('  ' + name).padEnd(24), 'notation', JSON.stringify(nota(d)).padEnd(14), 'fails', JSON.stringify(fails(d, m)));
}
// what the failures point at
const m7 = M.mechanisms(v2, MAP).mechanisms.find(x => x.id === 'M7');
assert.deepEqual(m7.evidence.ghost, [{ from: 'waiting to serve', to: 'catch up rate' }]);
assert.deepEqual(m7.evidence.bad, [{ from: 'pub customers', to: 'catch up rate' }]);
assert.deepEqual(m7.evidence.good, [{ from: 'pub cellar', to: 'catch up rate' }]);
assert.ok(/reads "pub customers" instead/.test(m7.hint));
const m10 = M.mechanisms(bad, mapA).mechanisms.find(x => x.id === 'M10'); assert.deepEqual(m10.evidence.bad, [{ from: 'Orders', to: 'Costs' }]);
const m3 = M.mechanisms(bad, mapA).mechanisms.find(x => x.id === 'M3'); assert.deepEqual(m3.evidence.badFlows, ['Cancelled']);
const m1 = M.mechanisms(v1, MAP1).mechanisms.find(x => x.id === 'M1'); assert.deepEqual(m1.evidence.badFlows, ['order rate']);
// an unrelated diagram: little of the game found, problems shown on the whole diagram
const junk = D(['Happiness'], ['Music'], [['fun', 'cloud', 'Happiness']], [['Music', 'fun']]);
const r = M.mechanisms(junk, {}); assert.equal(M.coreFound({}), 0); assert.ok(r.mechanisms.filter(x => !x.pass && x.weight === 'required').every(x => x.evidence.whole));
// kinds: a stock concept drawn as an auxiliary is noted
assert.equal(M.kindNotes({ stocks: [], auxiliaries: [{ label: 'cost' }], flows: [], connectors: [] }, { cost: ['C4'] }).length, 1);
// decision observation
assert.ok(/input from outside/.test(M.mechanisms(K.reference, MAP).decisionNote));
const dm = JSON.parse(JSON.stringify(altA)); dm.connectors.push({ from: 'Inventory', to: 'Order decision' }); assert.ok(/does not take the kegs already on order/.test(M.mechanisms(dm, mapA).decisionNote));
dm.connectors.push({ from: 'Supply line', to: 'Order decision' }); assert.ok(/takes the kegs already on order/.test(M.mechanisms(dm, mapA).decisionNote));
// no order flow at all: nothing is said about the decision
assert.strictEqual(M.mechanisms({ stocks: [{ label: 'rabbits', x: 0, y: 0 }], auxiliaries: [], clouds: [], flows: [], connectors: [], junctions: [] }, {}).decisionNote, null);
// two elements with the same name, and an L-shaped flow (a learner's test diagram, rebuilt from screenshots)
{
  const L = require('./fixtures/learner_lshape.json'), U = M.unique(L), Z = '​';
  assert.deepEqual(U.flows.map(f => M.shown(f.label)).filter(l => /arrival/.test(l)), ['arrival rate', 'arrival rate (2)']);
  assert.equal(U.flows.find(f => f.label === 'arrival rate' + Z).from, 'ordered kegs');               // the copies keep their own ends
  // a link to the shared name goes to the copy nearest its source: all three here are the kegs' arrival rate
  assert.deepEqual(U.connectors.filter(c => M.base(c.to) === 'arrival rate').map(c => c.from + ' -> ' + M.shown(c.to)),
    ['ordered kegs -> arrival rate (2)', 'delay factor -> arrival rate (2)', 'serving rate -> arrival rate (2)']);
  assert.equal(U.connectors.length, L.connectors.length);
  assert.equal(M.unique(K.reference).flows.length, K.reference.flows.length);                         // nothing changes without duplicates
  assert.deepEqual(M.notation(U).map(n => n.id), ['N1', 'W1']);   // W1: nothing informs the customers' arrival rate
  assert.deepEqual(M.notation(U)[0].evidence.focus, ['arrival rate', 'arrival rate' + Z]);
  const mapL = { 'customers arrived': ['C5'], 'customers waiting': ['C3'], 'ordered kegs': ['C2'], 'kegs at the pub': ['C1'], 'exogenous table': ['C14'],
    "player's decision": ['C16'], 'wholesaler provision capability': ['C15'], 'delay factor': ['C17'], 'arrival rate': ['C8'], 'serving rate': ['C9'],
    'fail to serve rate': ['C10'], 'catch up rate': ['C11'], 'order rate': ['C6'], ['arrival rate' + Z]: ['C7'], 'consumption rate': ['C12'] };
  const fl = fails(U, mapL);
  assert.deepEqual(fl, ['M3', 'M8', 'M9', 'M10']);           // the limit informs orders, arrivals not linked, no cost
  console.log('  same names, L-shaped'.padEnd(24), 'notation', JSON.stringify(M.notation(U).map(n => n.id)).padEnd(14), 'fails', JSON.stringify(fl));
}
console.log('marking: all tests passed');

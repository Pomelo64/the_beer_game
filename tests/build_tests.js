/* Builds the 59 test diagrams for Beer Game Lab's performance assessment, and the expected
   result for each. Every diagram starts from the author's reference (the author's second draft
   with its one link corrected) and changes only what its description says.
   Run: node build_tests.js   (writes diagrams/*.json, key.json, key.csv; checks each against the rules)
   CHECK_DIR=<folder> node build_tests.js checks diagrams saved from the app after import instead.
   There is no test of N5 (a flow attached at one end): the canvas cannot hold such a flow. */
const fs = require('fs'), path = require('path');
const M = require('../src/sfd/marking.js');
const FX = path.join(__dirname, '../src/sfd/fixtures/');
const load = f => JSON.parse(fs.readFileSync(FX + f));
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- the reference (A1) and its expected reading ----------
const REF = load('author_v2.json');
REF.connectors = REF.connectors.filter(c => !(c.from === 'pub customers' && c.to === 'catch up rate'));
REF.connectors.push({ from: 'waiting to serve', to: 'catch up rate' });
const MAP0 = { 'pub customers': ['C5'], 'waiting to serve': ['C3'], 'pub cellar': ['C1'], 'cost': ['C4'], 'registered order': ['C2'],
  'arrival plan by week': ['C14'], 'wholesaler provision capacity': ['C15'], 'player decision': ['C16'],
  'coming in rate': ['C8'], 'serving rate': ['C9'], 'failed-to-serve rate': ['C10'], 'cost rate': ['C13'],
  'consumption rate': ['C12'], 'catch up rate': ['C11'], 'beer arrival rate': ['C7'], 'order rate': ['C6'] };

// ---------- editing helpers ----------
const pos = (d, l) => { const e = d.stocks.concat(d.auxiliaries).find(x => x.label === l); return e ? [e.x, e.y] : null; };
const addStock = (d, l, x, y) => d.stocks.push({ label: l, x, y });
const addAux = (d, l, x, y) => d.auxiliaries.push({ label: l, x, y });
const addCloud = (d, x, y) => d.clouds.push({ label: 'cloud', x, y });
function addFlow(d, l, from, to, fromXY, toXY) {
  const a = fromXY || pos(d, from), b = toXY || pos(d, to);
  if (from === 'cloud') addCloud(d, a[0], a[1]);
  if (to === 'cloud') addCloud(d, b[0], b[1]);
  d.flows.push({ label: l, from, to, from_xy: a, to_xy: b, valve_xy: [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)] });
}
const delFlow = (d, l) => { const f = d.flows.find(x => x.label === l); d.flows = d.flows.filter(x => x !== f);
  ['from', 'to'].forEach(k => { if (f[k] === 'cloud') { const xy = f[k + '_xy']; d.clouds = d.clouds.filter(c => !(c.x === xy[0] && c.y === xy[1])); } });
  d.connectors = d.connectors.filter(c => c.from !== l && c.to !== l); };
const delNode = (d, l) => { d.stocks = d.stocks.filter(x => x.label !== l); d.auxiliaries = d.auxiliaries.filter(x => x.label !== l); d.connectors = d.connectors.filter(c => c.from !== l && c.to !== l); };
const link = (d, a, b) => d.connectors.push({ from: a, to: b });
const unlink = (d, a, b) => { d.connectors = d.connectors.filter(c => !(c.from === a && c.to === b)); };
function rename(d, map, a, b) {   // renames element a to b everywhere, and in the expected reading
  [].concat(d.stocks, d.auxiliaries, d.flows).forEach(e => { if (e.label === a) e.label = b; });
  d.flows.forEach(f => { if (f.from === a) f.from = b; if (f.to === a) f.to = b; });
  d.connectors.forEach(c => { if (c.from === a) c.from = b; if (c.to === a) c.to = b; });
  if (map[a]) { map[b] = map[a]; delete map[a]; }
}
const setFlowEnd = (d, l, end, to, xy) => { const f = d.flows.find(x => x.label === l); f[end] = to; f[end + '_xy'] = xy || pos(d, to); };

// ---------- the tests ----------
// each: id, group, title (what the diagram is), errors (how many), build(d, map), notation / fail = what should be found
const T = [];
const t = (id, title, errors, build, notation, fail, base) => T.push({ id, title, errors, build, notation, fail, base });

t('A1', 'The reference, as the author drew it', 0, () => {}, [], []);
t('A2', 'A1 with every name replaced by a synonym', 0, (d, m) => {
  [['pub customers', 'guests this week'], ['waiting to serve', 'backlog'], ['pub cellar', 'kegs at the pub'], ['cost', 'running cost'], ['registered order', 'kegs in transit'],
   ['arrival plan by week', 'demand pattern'], ['wholesaler provision capacity', 'supplier capacity'], ['player decision', 'my order'], ['coming in rate', 'guests arriving'],
   ['serving rate', 'served on the spot'], ['failed-to-serve rate', 'added to backlog'], ['cost rate', 'cost per week'], ['consumption rate', 'kegs poured'],
   ['catch up rate', 'backlog served'], ['beer arrival rate', 'deliveries'], ['order rate', 'ordering']].forEach(p => rename(d, m, p[0], p[1])); }, [], []);
t('A3', 'A1 with a different layout, same structure', 0, d => {
  const tx = p => [1100 - p[0], Math.round(p[1] * 1.15) + 40];
  [].concat(d.stocks, d.auxiliaries, d.clouds).forEach(e => { const p = tx([e.x, e.y]); e.x = p[0]; e.y = p[1]; });
  d.flows.forEach(f => { f.from_xy = tx(f.from_xy); f.to_xy = tx(f.to_xy); f.valve_xy = tx(f.valve_xy); }); }, [], []);
t('A4', 'Kegs on order split into "on back order" and "on the road"', 0, (d, m) => {
  rename(d, m, 'registered order', 'on back order');
  const s = d.stocks.find(x => x.label === 'on back order'); s.x = 300;
  addStock(d, 'on the road', 470, 344); m['on the road'] = ['C2'];
  setFlowEnd(d, 'order rate', 'to', 'on back order');
  setFlowEnd(d, 'beer arrival rate', 'from', 'on the road');
  addFlow(d, 'shipping rate', 'on back order', 'on the road'); m['shipping rate'] = ['C7'];
  unlink(d, 'on back order', 'beer arrival rate'); link(d, 'on back order', 'shipping rate'); link(d, 'on the road', 'beer arrival rate');
  unlink(d, 'wholesaler provision capacity', 'beer arrival rate'); link(d, 'wholesaler provision capacity', 'shipping rate'); }, [], []);
t('A5', 'No customers-this-week stock: arrivals flow straight into the waiting customers', 0, (d, m) => {
  delFlow(d, 'serving rate'); delFlow(d, 'failed-to-serve rate'); delNode(d, 'pub customers'); delete m['pub customers']; delete m['serving rate']; delete m['failed-to-serve rate'];
  setFlowEnd(d, 'coming in rate', 'to', 'waiting to serve'); }, [], []);
t('A6', 'Cellar drained by two flows, one per kind of serving', 0, (d, m) => {
  delFlow(d, 'consumption rate'); delete m['consumption rate'];
  addFlow(d, 'kegs served on arrival', 'pub cellar', 'cloud', null, [990, 300]); addFlow(d, 'kegs served late', 'pub cellar', 'cloud', null, [990, 400]);
  link(d, 'serving rate', 'kegs served on arrival'); link(d, 'catch up rate', 'kegs served late'); m['kegs served on arrival'] = ['C12']; m['kegs served late'] = ['C12']; }, [], []);
t('A7', 'Order decision modelled, informed by the cellar and the waiting customers', 0, d => { link(d, 'pub cellar', 'player decision'); link(d, 'waiting to serve', 'player decision'); }, [], []);
t('A8', 'A1 plus a delivery time and the two cost rates', 0, (d, m) => {
  addAux(d, 'delivery time', 506, 470); link(d, 'delivery time', 'beer arrival rate'); m['delivery time'] = ['C17'];
  addAux(d, 'holding cost per keg', 720, 600); addAux(d, 'cost per keg owed', 860, 600); link(d, 'holding cost per keg', 'cost rate'); link(d, 'cost per keg owed', 'cost rate');
  m['holding cost per keg'] = ['C18']; m['cost per keg owed'] = ['C18']; }, [], []);

t('B1', 'Deliveries never reach the cellar: they fill a separate stock "kegs at the door"', 1, d => {
  addStock(d, 'kegs at the door', 506, 470); setFlowEnd(d, 'beer arrival rate', 'to', 'kegs at the door'); }, [], ['M1']);
t('B2', 'Orders flow into the cellar; the kegs on order have no inflow', 1, d => { setFlowEnd(d, 'order rate', 'to', 'pub cellar'); }, [], ['M2']);
t('B3', 'The wholesaler\'s limit informs the orders, not the deliveries', 1, d => { unlink(d, 'wholesaler provision capacity', 'beer arrival rate'); link(d, 'wholesaler provision capacity', 'order rate'); }, [], ['M3']);
t('B4', 'The link from the cellar to serving removed', 1, d => unlink(d, 'pub cellar', 'serving rate'), [], ['M4']);
t('B5', 'Kegs leaving the cellar not tied to serving on arrival', 1, d => unlink(d, 'serving rate', 'consumption rate'), [], ['M5']);
t('B6', 'Waiting customers can leave to a cloud ("giving up rate")', 1, (d, m) => { addFlow(d, 'giving up rate', 'waiting to serve', 'cloud', null, [700, 150]); link(d, 'waiting to serve', 'giving up rate'); }, [], ['M6']);
t('B7', 'Catching up informed by the customers of the week, not the waiting ones (the author\'s second draft)', 1, null, [], ['M7'], 'author_v2.json');
t('B8', 'The customer arrivals input not linked', 1, d => unlink(d, 'arrival plan by week', 'coming in rate'), ['W1', 'W2'], ['M8']);
t('B9', 'Cost per week not informed by the waiting customers', 1, d => unlink(d, 'waiting to serve', 'cost rate'), [], ['M9']);
t('B10', 'The orders inform the cost', 1, d => link(d, 'order rate', 'cost rate'), [], ['M10']);

t('C1', 'Two flows called "coming in rate" (the deliveries renamed)', 1, (d, m) => { rename(d, m, 'beer arrival rate', 'coming in rate'); m['coming in rate'] = ['C8']; m['coming in rate​'] = ['C7']; }, ['N1'], []);
t('C2', 'A link from serving into the cellar', 1, d => link(d, 'serving rate', 'pub cellar'), ['N2'], []);
t('C3', 'A link from a cloud to the customers arriving', 1, d => link(d, 'cloud', 'coming in rate'), ['N3'], []);
t('C4', 'The cost per week flows from an auxiliary into the cost', 1, (d, m) => { addAux(d, 'weekly costs', 770, 600); setFlowEnd(d, 'cost rate', 'from', 'weekly costs');
  d.clouds = d.clouds.filter(c => !(c.x === 602 && c.y === 484)); link(d, 'weekly costs', 'cost rate'); m['weekly costs'] = ['C18']; }, ['N4'], []);
t('C6', 'A flow between two clouds ("spillage")', 1, d => { addFlow(d, 'spillage', 'cloud', 'cloud', [760, 640], [960, 640]); link(d, 'pub cellar', 'spillage'); }, ['N6'], []);
t('C7', 'A flow from the cellar back into the cellar ("restocking")', 1, d => { d.flows.push({ label: 'restocking', from: 'pub cellar', to: 'pub cellar', from_xy: [647, 344], to_xy: [647, 344], valve_xy: [647, 430] }); link(d, 'pub cellar', 'restocking'); }, ['N7'], []);
t('C8', 'An extra stock "reputation" with no flows', 1, d => addStock(d, 'reputation', 150, 150), ['N8'], []);
t('C9', 'The order decision left out: nothing informs the orders', 1, (d, m) => { delNode(d, 'player decision'); delete m['player decision']; }, ['W1'], []);
t('C10', 'An auxiliary "weather" that affects nothing', 1, d => addAux(d, 'weather', 150, 150), ['W2'], []);

t('D1', 'B7 plus two flows of the same name', 2, (d, m) => { rename(d, m, 'beer arrival rate', 'coming in rate'); m['coming in rate'] = ['C8']; m['coming in rate​'] = ['C7']; }, ['N1'], ['M7'], 'author_v2.json');
t('D2', 'The author\'s first draft', 4, null, [], ['M1', 'M2', 'M3', 'M7'], 'author_v1.json');
t('D3', 'A learner\'s diagram with no cost part (rebuilt from screenshots)', 6, null, ['N1', 'W1'], ['M3', 'M8', 'M9', 'M10'], 'learner_lshape.json');
t('D4', 'Notation slips throughout, game structure right', 5, d => {
  link(d, 'serving rate', 'pub cellar'); link(d, 'cloud', 'coming in rate');
  addFlow(d, 'spillage', 'cloud', 'cloud', [760, 640], [960, 640]); link(d, 'pub cellar', 'spillage');
  d.flows.push({ label: 'restocking', from: 'pub cellar', to: 'pub cellar', from_xy: [647, 344], to_xy: [647, 344], valve_xy: [647, 430] }); link(d, 'pub cellar', 'restocking');
  addStock(d, 'reputation', 150, 150); }, ['N2', 'N3', 'N6', 'N7', 'N8'], []);
t('D5', 'No cost, no waiting customers, orders straight to the cellar, a link into a stock', 8, (d, m) => {
  ['cost rate', 'catch up rate', 'failed-to-serve rate', 'beer arrival rate'].forEach(f => { delFlow(d, f); delete m[f]; });
  ['cost', 'waiting to serve', 'registered order'].forEach(s => { delNode(d, s); delete m[s]; });
  setFlowEnd(d, 'order rate', 'to', 'pub cellar'); link(d, 'wholesaler provision capacity', 'order rate'); link(d, 'serving rate', 'pub cellar'); }, ['N2'], ['M1', 'M2', 'M3', 'M6', 'M7', 'M9', 'M10']);

t('E1', 'An unrelated diagram: happiness, fun and music', 'unrelated', null, [], ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']);
t('E2', 'One stock "beer" with one inflow and one outflow', 'unrelated', null, [], null);
t('E3', 'The reference with the names of the cellar and the waiting customers swapped', 'misleading names', (d, m) => {
  rename(d, m, 'pub cellar', 'TMP'); rename(d, m, 'waiting to serve', 'pub cellar'); rename(d, m, 'TMP', 'waiting to serve'); }, [], []);
t('E4', 'A flow named "catch up rate" that drains the cellar to a cloud', 'misleading names', (d, m) => {
  rename(d, m, 'catch up rate', 'orders filled late'); rename(d, m, 'consumption rate', 'catch up rate'); }, [], []);

// ---------- G. From the literature: errors language models are reported to make in building models,
// planted in a learner's diagram, to see whether the AI reader catches them. Each names its source.
// Some are errors the rules are not built to catch (they check that what the game needs is there,
// not that wrong links are absent): there the key gives the author's verdict, and the rules disagree (Q3).
t('G1', 'Double count: the kegs for customers served on arrival leave the cellar twice, by "kegs served" and by "consumption rate" [Akhavan & Jalali 2024, net exports counted twice]', 1, (d, m) => {
  addFlow(d, 'kegs served', 'pub cellar', 'cloud', null, [993, 440]); link(d, 'serving rate', 'kegs served'); link(d, 'pub cellar', 'kegs served'); m['kegs served'] = ['C12']; }, [], ['M5']);
t('G2', 'Double count: every arriving customer also joins the waiting customers, by a second inflow "customers joining the queue" [Akhavan & Jalali 2024]', 1, (d, m) => {
  addFlow(d, 'customers joining the queue', 'cloud', 'waiting to serve', [569, 120], null); link(d, 'arrival plan by week', 'customers joining the queue'); m['customers joining the queue'] = ['C8']; }, [], ['M6']);
t('G3', 'Invented link: the cellar informs the customers coming in, as if a full cellar drew customers (true only of the word-of-mouth version) [Schoenberg et al. 2025, fake relationships; Leitch 2026, extra links]', 1, d => link(d, 'pub cellar', 'coming in rate'), [], ['M8']);
t('G4', 'Invented link: the order rate informs the beer arrival rate, as if ordering sped up deliveries [Schoenberg et al. 2025; Leitch 2026]', 1, d => link(d, 'order rate', 'beer arrival rate'), [], ['M1']);
t('G5', 'Reversed flow: the deliveries run from the cellar back to the kegs on order [Schoenberg et al. 2025, link ends reversed]', 1, d => {
  const f = d.flows.find(x => x.label === 'beer arrival rate'); f.from = 'pub cellar'; f.to = 'registered order'; const a = f.from_xy; f.from_xy = f.to_xy; f.to_xy = a; }, [], ['M1']);
t('G6', 'Reversed link: the order rate informs the player decision, not the other way round [Schoenberg et al. 2025]', 1, d => { unlink(d, 'player decision', 'order rate'); link(d, 'order rate', 'player decision'); }, ['W1', 'W2'], []);
t('G7', 'Larger and correct: the learner also models the wholesaler\'s cellar, its kegs on order and the brewery (8 stocks) [Campuzano-Bolarin et al. 2026, larger models need major fixes; Park et al. 2026, performance falls with complexity]', 0, (d, m) => {
  addStock(d, 'wholesaler kegs on order', 364, 800); addStock(d, 'wholesaler cellar', 647, 800); addStock(d, 'brewery kegs brewing', 364, 980);
  addFlow(d, 'wholesaler order rate', 'cloud', 'wholesaler kegs on order', [107, 800], null);
  addFlow(d, 'wholesaler arrival rate', 'wholesaler kegs on order', 'wholesaler cellar');
  addFlow(d, 'wholesaler shipping rate', 'wholesaler cellar', 'cloud', null, [993, 800]);
  addFlow(d, 'brewing start rate', 'cloud', 'brewery kegs brewing', [107, 980], null);
  addFlow(d, 'brewing finish rate', 'brewery kegs brewing', 'cloud', null, [647, 980]);
  link(d, 'wholesaler cellar', 'wholesaler provision capacity'); link(d, 'wholesaler cellar', 'wholesaler shipping rate'); link(d, 'beer arrival rate', 'wholesaler shipping rate');
  link(d, 'order rate', 'wholesaler order rate'); link(d, 'wholesaler kegs on order', 'wholesaler arrival rate'); link(d, 'wholesaler order rate', 'brewing start rate');
  link(d, 'brewery kegs brewing', 'brewing finish rate'); link(d, 'brewing finish rate', 'wholesaler arrival rate'); }, [], []);
t('G8', 'Element type confused: the total cost drawn as an auxiliary, so it does not add up [Bravo et al. 2009, learners mix up element types]', 1, (d, m) => {
  delFlow(d, 'cost rate'); delete m['cost rate']; delNode(d, 'cost'); delete m['cost'];
  addAux(d, 'total cost', 900, 489); link(d, 'pub cellar', 'total cost'); link(d, 'waiting to serve', 'total cost'); m['total cost'] = ['C4']; }, ['W2'], ['M9', 'M10']);
t('G9', 'Element type confused: the waiting customers drawn as an auxiliary; the unserved go to a cloud and catching up comes from a cloud [Bravo et al. 2009]', 1, (d, m) => {
  const ws = pos(d, 'waiting to serve'); delNode(d, 'waiting to serve');
  setFlowEnd(d, 'failed-to-serve rate', 'to', 'cloud', ws); addCloud(d, ws[0], ws[1]);
  setFlowEnd(d, 'catch up rate', 'from', 'cloud', [569, 160]); addCloud(d, 569, 160);
  addAux(d, 'waiting to serve', 720, 100); link(d, 'pub customers', 'waiting to serve'); link(d, 'serving rate', 'waiting to serve');
  link(d, 'waiting to serve', 'catch up rate'); link(d, 'waiting to serve', 'cost rate'); }, ['N6'], ['M6', 'M7', 'M9']);
t('G10', 'The reference, with a confident but wrong explanation from the learner: tests the wording only [Akhavan & Jalali 2024, the model agreed readily with the user]', 0, () => {}, [], []);
// what the learner says after the game, given to the wording call in place of the usual one (G10 only)
const SAID = { G10: 'My diagram shows that the three-week delivery does not matter. My costs were all the wholesaler\'s fault, and ordering more every week would have fixed them.' };

// ---------- F. Drawn by hand: the author's own diagrams, kept as drawn (tests/hand/F*.json, typos included).
// F1 is the author's own model of the game; F2-F12 change one thing in it; F13 is unrelated.
// The expected reading is ours (the author's elements mapped to the concepts); the verdicts are the rules',
// for the author to confirm.
const MAP_F1 = { 'arrived customers': ['C5'], 'waiting customers': ['C3'], 'orders': ['C2'], 'deliverables': ['C2'], 'pub cellar': ['C1'], 'total cost': ['C4'],
  'player decision': ['C16'], 'exogenous game setup': ['C14'], 'wholesaler capacity of provsion': ['C15'], 'delay factor': ['C17'],
  'serving rate': ['C9'], 'failurre rate': ['C10'], 'catchup rate': ['C11'], 'customer arrival rrate': ['C8'], 'keg orrder rate': ['C6'],
  'orderr fulfill rate': ['C7'], 'delivery rate': ['C7'], 'consumption rate': ['C12'], 'cost rate': ['C13'] };
const fmap = extra => Object.assign({}, MAP_F1, extra);
const HAND = {
  F1: ['The author\'s own model of the game, drawn by hand (with typos in the names, and a stock of served customers)', 0, fmap({}), [], []],
  F2: ['F1 with an auxiliary "pub hours" that is linked to nothing', 1, fmap({}), null, null],
  F3: ['F1 with a cloud attached to nothing', 1, fmap({}), null, null],
  F4: ['F1 with a stock "a" attached to nothing', 1, fmap({}), null, null],
  F5: ['F1 with the order flow named "keg order stock"', 1, fmap({ 'keg orrder rate': undefined, 'keg order stock': ['C6'] }), null, null],
  F6: ['F1 with the link between serving and failing to serve reversed (failing to serve informs serving)', 1, fmap({ 'keg orrder rate': undefined, 'keg order rate': ['C6'] }), null, null],
  F7: ['F1 with the player decision linked to the orders stock instead of the order flow', 1, fmap({ 'keg orrder rate': undefined, 'keg order rate': ['C6'] }), null, null],
  F8: ['F1 with the player decision drawn as a stock', 1, fmap({ 'keg orrder rate': undefined, 'keg order rate': ['C6'] }), null, null],
  F9: ['F1 with a stock "wholesaler", filled from a cloud, that the orders flow out of', 1, fmap({ 'keg orrder rate': undefined, 'keg order rate': ['C6'], 'wholesaler': ['C15'] }), null, null],
  F10: ['F1 without the player decision and the order flow: nothing fills the orders', 2, fmap({ 'keg orrder rate': undefined }), null, null],
  F11: ['F1 with the order flow drawn as a stock "keg order rate", which a flow "kegs" empties into the orders', 1, fmap({ 'keg orrder rate': undefined, 'kegs': ['C6'] }), null, null],
  F12: ['F1 without the link from the player decision to the order flow', 1, fmap({}), null, null],
  F13: ['An unrelated diagram: rabbits, with births and deaths', 1, {}, null, null]
};
Object.keys(HAND).forEach(id => { const h = HAND[id]; T.push({ id, title: h[0], errors: h[1], build: null, notation: h[3], fail: h[4], hand: h[2] }); });

// ---------- the two diagrams not built from the reference ----------
const E1 = { stocks: [{ label: 'Happiness', x: 400, y: 200 }], auxiliaries: [{ label: 'Music', x: 300, y: 350 }], clouds: [{ label: 'cloud', x: 120, y: 200 }],
  flows: [{ label: 'fun', from: 'cloud', to: 'Happiness', from_xy: [120, 200], to_xy: [400, 200], valve_xy: [260, 200] }], connectors: [{ from: 'Music', to: 'fun' }], junctions: [] };
const E2 = { stocks: [{ label: 'beer', x: 450, y: 250 }], auxiliaries: [{ label: 'supply', x: 260, y: 400 }, { label: 'thirst', x: 640, y: 400 }],
  clouds: [{ label: 'cloud', x: 120, y: 250 }, { label: 'cloud', x: 800, y: 250 }],
  flows: [{ label: 'brewing', from: 'cloud', to: 'beer', from_xy: [120, 250], to_xy: [450, 250], valve_xy: [285, 250] },
    { label: 'drinking', from: 'beer', to: 'cloud', from_xy: [450, 250], to_xy: [800, 250], valve_xy: [625, 250] }],
  connectors: [{ from: 'supply', to: 'brewing' }, { from: 'thirst', to: 'drinking' }, { from: 'beer', to: 'drinking' }], junctions: [] };
const MAPS = {
  'author_v1.json': Object.assign({}, MAP0, { 'registered order': undefined, 'beer arrival rate': undefined }),
  'learner_lshape.json': { 'customers arrived': ['C5'], 'customers waiting': ['C3'], 'ordered kegs': ['C2'], 'kegs at the pub': ['C1'], 'exogenous table': ['C14'],
    "player's decision": ['C16'], 'wholesaler provision capability': ['C15'], 'delay factor': ['C17'], 'arrival rate': ['C8'], 'serving rate': ['C9'],
    'fail to serve rate': ['C10'], 'catch up rate': ['C11'], 'order rate': ['C6'], 'arrival rate​': ['C7'], 'consumption rate': ['C12'] } };
const SPECIAL = { E1: [E1, {}], E2: [E2, { beer: ['C1'], drinking: ['C12'], brewing: ['C7'], supply: ['C15'], thirst: ['C14'] }] };

// ---------- build, check, write ----------
fs.mkdirSync(path.join(__dirname, 'diagrams'), { recursive: true });
const key = [], rows = [['id', 'file', 'diagram', 'errors', 'expected notation', 'expected failing mechanisms', 'the rules agree']];
let bad = 0;
T.forEach(x => {
  let d, m;
  if (SPECIAL[x.id]) { d = clone(SPECIAL[x.id][0]); m = clone(SPECIAL[x.id][1]); }
  else if (x.hand) { d = JSON.parse(fs.readFileSync(path.join(__dirname, 'hand', x.id + '.json'))); m = clone(x.hand); Object.keys(m).forEach(k => m[k] === undefined && delete m[k]); }
  else if (x.base) { d = load(x.base); delete d.note; m = clone(MAPS[x.base] || MAP0); Object.keys(m).forEach(k => m[k] === undefined && delete m[k]); }
  else { d = clone(REF); m = clone(MAP0); }
  if (x.build) x.build(d, m);
  if (process.env.CHECK_DIR) d = JSON.parse(fs.readFileSync(path.join(process.env.CHECK_DIR, x.id + '.json')));   // the canvas's own version after import
  const u = M.unique(d);
  const notation = M.notation(u).map(n => n.id).sort();
  const res = M.mechanisms(u, m), fails = res.mechanisms.filter(r => !r.pass && /^M/.test(r.id)).map(r => r.id);
  if (x.notation === null) x.notation = notation;   // F2-F13: whatever the rules give is recorded, for the author to confirm
  if (x.fail === null) x.fail = fails;   // E2: whatever the rules give is recorded, for the author to confirm
  const ok = JSON.stringify(notation) === JSON.stringify(x.notation.slice().sort()) && JSON.stringify(fails) === JSON.stringify(x.fail);
  if (!ok) { bad++; console.log('MISMATCH', x.id, 'notation', notation, 'want', x.notation, '| fails', fails, 'want', x.fail); }
  const file = x.id + '.json';
  if (!process.env.CHECK_DIR) fs.writeFileSync(path.join(__dirname, 'diagrams', file), JSON.stringify(d, null, 1));
  // the expected reading, by element as the learner sees it (a second element of the same name gets "(2)")
  const reading = {};
  [].concat(u.stocks, u.flows, u.auxiliaries).forEach(e => {
    const f = u.flows.find(q => q === e);
    reading[M.shown(e.label) + (f ? ' [flow ' + M.shown(f.from) + ' -> ' + M.shown(f.to) + ']' : '')] = m[e.label] || 'extra';
  });
  key.push(Object.assign({ id: x.id, file: 'diagrams/' + file, diagram: x.title, errors: x.errors, expected: { notation: x.notation, failing: x.fail, observation_on_decision: res.decisionNote }, expected_reading: reading },
    SAID[x.id] ? { said: SAID[x.id] } : {}, ok ? {} : { rules_give: { notation: notation, failing: fails } }));
  rows.push([x.id, 'diagrams/' + file, x.title, x.errors, x.notation.join(' '), x.fail.join(' '), ok ? 'yes' : 'NO']);
});
if (!process.env.CHECK_DIR) fs.writeFileSync(path.join(__dirname, 'key.json'), JSON.stringify(key, null, 1));
if (!process.env.CHECK_DIR) fs.writeFileSync(path.join(__dirname, 'key.csv'), rows.map(r => r.map(v => /[",]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n') + '\n');
console.log(T.length + ' diagrams written; ' + (bad ? bad + ' do not match their expected result' : 'every one gives its expected result under the rules'));

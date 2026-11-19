/* Game engine. No drawing here: the same engine runs the player's pub,
   the three simulated positions and the replay.

   The supply chain is that of the Beer Game as described in Sterman (1989),
   "Modeling managerial behavior", Management Science 35(3), and the three
   simulated positions use the ordering rule estimated in that paper.

   Two scenarios share this engine.

   'plain' (the default) follows that game, with two changes:
   (1) units renamed: case -> keg, factory -> brewery, retailer -> pub;
   (2) the order delay is removed. An order reaches the supplier at once and is
       acted on in the following week, so delivery takes three weeks from
       ordering (it took four). The brewing delay is unchanged.
   Customer demand steps once, from 4 to 8 a week, and the score is cost.

   'wom' (word of mouth) adds four more changes:
   (3) the pub's customers do not wait. One who cannot be served leaves;
   (4) the number of customers depends on how the pub served them. It grows
       after a week in which everyone was served, and falls with each customer
       turned away;
   (5) the pub's cellar has a limit. Kegs that do not fit are sent back;
   (6) there is no money. The score is the number of customers served.
   The numbers behind (4) and (5) are design choices of this game, not
   estimates from any source. They are all in CFG below. */
const Engine = (function () {
  const CFG = {
    weeksPlayed: 36,          // the game is stopped here
    weeksAnnounced: 50,       // what the player is told
    startStock: 12,
    startFlow: 4,             // kegs in each delay slot and on each order slip
    // --- plain scenario ---
    holdCost: 0.5,            // per keg in stock, per week
    backlogCost: 1.0,         // per keg owed, per week
    demand: function (week) { return week < 5 ? 4 : 8; },   // one step, in week 5
    // --- word-of-mouth scenario: design choices of this game ---
    cellar: 20,               // most kegs the pub's cellar can hold
    crowdStart: 4,            // customers a week at the start
    crowdGrowth: 0.08,        // growth of the crowd after a week in which everyone was served
    putOff: 2,                // customers who stay away for each customer turned away
    crowdFloor: 1,            // the crowd never falls below this
    // ------------------------------------
    names: ['Pub', 'Wholesaler', 'Distributor', 'Brewery'],
    // Ordering rule of the simulated positions: mean estimates over 44 players
    // (Sterman 1989, Table 4). S' is set per position so that the chain starts
    // in balance; the paper's mean is 17.
    rule: { theta: 0.36, alphaS: 0.26, beta: 0.34 }
  };

  function newGame(seat, mode) {
    const pos = [];
    for (let i = 0; i < 4; i++) {
      pos.push({
        stock: CFG.startStock, owed: 0,
        inbound: [CFG.startFlow, CFG.startFlow],  // [arrives next week, the week after]
        placed: CFG.startFlow,                    // last order, read by the supplier next week
        expected: CFG.startFlow,                  // expected demand (adaptive)
        cost: 0
      });
    }
    const g = { week: 0, seat: seat || 0, mode: mode === 'wom' ? 'wom' : 'plain', pos: pos, log: [],
                crowd: CFG.crowdStart,            // the crowd, kept as a fraction; whole customers come in
                served: 0, turned: 0, wasted: 0 };
    // Desired stock that keeps the starting position in balance.
    for (let i = 0; i < 4; i++) {
      const sl0 = 2 * CFG.startFlow;
      pos[i].desired = CFG.startStock + CFG.rule.beta * sl0;
    }
    return g;
  }

  /* A week up to the ordering decision: deliveries arrive, each position
     reads the order its customer placed last week and sends what it can,
     the crowd reacts to how it was served, and the brewery starts brewing. */
  function beginWeek(g) {
    g.week += 1;
    const P = g.pos, wom = g.mode === 'wom';
    const came = wom ? Math.max(CFG.crowdFloor, Math.round(g.crowd)) : CFG.demand(g.week);
    const rec = { week: g.week, demand: came, pos: [] };
    const arrived = [], back = [];
    for (let i = 0; i < 4; i++) {
      const p = P[i];
      let a = p.inbound[0]; back[i] = 0;
      if (wom && i === 0) {                       // the pub's cellar takes only what fits
        const room = Math.max(0, CFG.cellar - p.stock);
        if (a > room) { back[i] = a - room; a = room; }
      }
      arrived[i] = a;
      p.stock += a;
      p.inbound[0] = p.inbound[1];
      p.inbound[1] = 0;
    }
    g.wasted += back[0];
    for (let i = 0; i < 4; i++) {
      const p = P[i];
      const asked = i === 0 ? came : P[i - 1].placed;
      const leave = wom && i === 0;               // in 'wom' the pub's customers do not wait
      const want = p.owed + asked;
      const sent = Math.min(p.stock, want);
      const turned = leave ? want - sent : 0;     // customers who leave without a keg
      p.stock -= sent;
      p.owed = leave ? 0 : want - sent;
      if (i > 0) P[i - 1].inbound[1] += sent;
      p.expected = CFG.rule.theta * asked + (1 - CFG.rule.theta) * p.expected;
      const weekCost = wom ? 0 : CFG.holdCost * p.stock + CFG.backlogCost * p.owed;
      p.cost += weekCost;
      rec.pos.push({
        asked: asked, sent: sent, turned: turned, arrived: arrived[i], back: back[i],
        stock: p.stock, owed: p.owed, net: p.stock - p.owed,
        weekCost: weekCost, cost: p.cost, order: null
      });
    }
    const me = rec.pos[0];
    g.served += me.sent; g.turned += me.turned;
    if (wom) {   // word of mouth
      if (me.turned > 0) g.crowd = Math.max(CFG.crowdFloor, g.crowd - CFG.putOff * me.turned);
      else g.crowd = g.crowd * (1 + CFG.crowdGrowth);
    }
    me.served = g.served; me.turnedAll = g.turned; me.wasted = g.wasted;

    P[3].inbound[1] = P[3].placed;   // the brewery starts brewing what it decided last week
    for (let i = 0; i < 4; i++) rec.pos[i].way = [P[i].inbound[0], P[i].inbound[1]];
    g.log.push(rec);
    return rec;
  }

  /* Everything a position has asked for and not yet received. */
  function onOrder(g, i) {
    const P = g.pos, p = P[i];
    const inTransit = p.inbound[0] + p.inbound[1];
    if (i === 3) return inTransit;
    return P[i + 1].owed + inTransit;
  }

  /* Ordering rule of a simulated position (anchoring and adjustment). */
  function decide(g, i) {
    const p = g.pos[i], r = CFG.rule;
    const net = p.stock - p.owed;
    const order = p.expected + r.alphaS * (p.desired - net - r.beta * onOrder(g, i));
    return Math.max(0, Math.round(order));
  }

  /* Every position writes its order. `orders` maps seat -> amount
     for human players; the rest follow the rule. */
  function endWeek(g, orders) {
    const rec = g.log[g.log.length - 1];
    for (let i = 0; i < 4; i++) {
      const o = orders && orders[i] != null ? Math.max(0, Math.round(orders[i])) : decide(g, i);
      g.pos[i].placed = o;
      rec.pos[i].order = o;
    }
    return rec;
  }

  function finished(g) { return g.week >= CFG.weeksPlayed; }

  return { CFG: CFG, newGame: newGame, beginWeek: beginWeek, endWeek: endWeek,
           decide: decide, onOrder: onOrder, finished: finished };
})();
if (typeof module !== 'undefined') module.exports = Engine;

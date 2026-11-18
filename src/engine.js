/* Game engine. No drawing here: the same engine runs the player's pub,
   the three simulated positions, the replay, and any later variants.
   Adapted from the Beer Game as described in Sterman (1989), "Modeling
   managerial behavior", Management Science 35(3).
   Changes from the original: (1) units renamed, case -> keg, factory -> brewery,
   retailer -> pub; (2) the order delay is removed. An order reaches the
   supplier at once and is acted on in the following week, so delivery takes
   three weeks from ordering (it took four). The brewing delay is unchanged. */
const Engine = (function () {
  const CFG = {
    weeksPlayed: 36,          // the game is stopped here
    weeksAnnounced: 50,       // what the player is told
    startStock: 12,
    startFlow: 4,             // kegs in each delay slot and on each order slip
    holdCost: 0.5,            // per keg in stock, per week
    backlogCost: 1.0,         // per keg owed, per week
    demand: function (week) { return week < 5 ? 4 : 8; },   // one step, in week 5
    names: ['Pub', 'Wholesaler', 'Distributor', 'Brewery'],
    // Ordering rule of the simulated positions: mean estimates over 44 players
    // (Sterman 1989, Table 4). S' is set per position so that the chain starts
    // in balance; the paper's mean is 17.
    rule: { theta: 0.36, alphaS: 0.26, beta: 0.34 }
  };

  function newGame(seat) {
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
    const g = { week: 0, seat: seat || 0, pos: pos, log: [] };
    // Desired stock that keeps the starting position in balance.
    for (let i = 0; i < 4; i++) {
      const sl0 = 2 * CFG.startFlow;
      pos[i].desired = CFG.startStock + CFG.rule.beta * sl0;
    }
    return g;
  }

  /* A week up to the ordering decision: deliveries arrive, each position
     reads the order its customer placed last week and sends what it can,
     costs are counted, and the brewery starts brewing. */
  function beginWeek(g) {
    g.week += 1;
    const P = g.pos, rec = { week: g.week, demand: CFG.demand(g.week), pos: [] };
    const arrived = [];
    for (let i = 0; i < 4; i++) {
      const p = P[i];
      arrived[i] = p.inbound[0];
      p.stock += p.inbound[0];
      p.inbound[0] = p.inbound[1];
      p.inbound[1] = 0;
    }
    for (let i = 0; i < 4; i++) {
      const p = P[i];
      const asked = i === 0 ? rec.demand : P[i - 1].placed;
      const want = p.owed + asked;
      const sent = Math.min(p.stock, want);
      p.stock -= sent;
      p.owed = want - sent;
      if (i > 0) P[i - 1].inbound[1] += sent;
      p.expected = CFG.rule.theta * asked + (1 - CFG.rule.theta) * p.expected;
      p.cost += CFG.holdCost * p.stock + CFG.backlogCost * p.owed;
      rec.pos.push({
        asked: asked, sent: sent, arrived: arrived[i],
        stock: p.stock, owed: p.owed, net: p.stock - p.owed,
        weekCost: CFG.holdCost * p.stock + CFG.backlogCost * p.owed,
        cost: p.cost, order: null
      });
    }
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

  /* Step 5: every position writes its order. `orders` maps seat -> amount
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

/* Marking a learner's stock-and-flow diagram of the supply game, in three layers
   (see the spec "Marking the supply-game diagram: rules, concepts and mechanisms"):

   1. notation(d)          rules of the notation, checked by code
   2. (the AI)             maps each of the learner's elements to concepts
   3. mechanisms(d, map)   the game's mechanisms as patterns, checked by code

   Every failure carries `evidence` for the slide's picture: which elements to
   show (focus), which links or flows are wrong (bad, badFlows), which already
   work (good), the fix to draw on request (ghost), short questions beside the
   spot (notes), and `whole` when the problem has no single place.

   d   = a diagram in the canvas's JSON ({stocks, auxiliaries, clouds, flows, connectors, junctions})
   map = { "<learner element label>": ["C1", ...], ... } */
const Marking = (function () {
  const CONCEPTS = [
    { id: 'C1', name: 'the cellar', kind: 'stock', what: 'kegs on hand in the pub\'s cellar', names: ['inventory', 'stock', 'kegs in stock'] },
    { id: 'C2', name: 'kegs on order', kind: 'stock', what: 'kegs ordered but not yet arrived, including any the wholesaler holds on back order; may be drawn as several stocks in a row', names: ['supply line', 'on order', 'in transit', 'back order', 'registered order'] },
    { id: 'C3', name: 'waiting customers', kind: 'stock', what: 'customers (kegs) owed: customers who could not be served and are waiting', names: ['backlog', 'customers waiting', 'kegs owed', 'waiting to serve'] },
    { id: 'C4', name: 'total cost', kind: 'stock', what: 'the cost added up so far', names: ['cost', 'cost so far', 'cumulative cost'] },
    { id: 'C5', name: 'customers this week', kind: 'stock', what: 'the customers in the pub this week, before they are served or left waiting (may be left out)', names: ['pub customers', 'customers in the pub'] },
    { id: 'C6', name: 'orders', kind: 'flow', what: 'the pub\'s orders: the flow that fills the kegs on order', names: ['order rate', 'ordering', 'orders placed'] },
    { id: 'C7', name: 'deliveries', kind: 'flow', what: 'kegs arriving: the flow from the kegs on order into the cellar (or between stocks of a chain of kegs on order)', names: ['arrivals', 'receiving', 'beer arrival rate', 'dispatch'] },
    { id: 'C8', name: 'customers arriving', kind: 'flow', what: 'customers coming in each week', names: ['coming in rate', 'new customers', 'demand'] },
    { id: 'C9', name: 'serving on arrival', kind: 'flow', what: 'customers served in the week they arrive', names: ['serving rate', 'sales', 'customers served'] },
    { id: 'C10', name: 'failing to serve', kind: 'flow', what: 'customers not served, moving into the waiting customers', names: ['failed-to-serve rate', 'shortfall', 'unserved'] },
    { id: 'C11', name: 'catching up', kind: 'flow', what: 'waiting customers served later: the flow that empties the waiting customers', names: ['catch up rate', 'backlog served', 'orders filled'] },
    { id: 'C12', name: 'kegs leaving the cellar', kind: 'flow', what: 'kegs going out of the cellar to customers', names: ['consumption rate', 'shipments', 'kegs out'] },
    { id: 'C13', name: 'cost per week', kind: 'flow', what: 'the cost added each week: the flow that fills the total cost', names: ['cost rate', 'weekly cost'] },
    { id: 'C14', name: 'customer arrivals', kind: 'input', what: 'how many customers come each week (an outside input)', names: ['arrival plan by week', 'customer demand'] },
    { id: 'C15', name: 'the wholesaler\'s limit', kind: 'input', what: 'what the wholesaler is able to send (an outside input)', names: ['wholesaler provision capacity', 'wholesaler stock'] },
    { id: 'C16', name: 'the order decision', kind: 'input', what: 'how many kegs the player orders (an outside input, or modelled)', names: ['player decision', 'my order', 'order decision'] },
    { id: 'C17', name: 'delivery time', kind: 'constant', what: 'the three weeks a delivery takes (optional)', names: ['lead time', 'delay'] },
    { id: 'C18', name: 'cost rates', kind: 'constant', what: 'the £0.50 and £1 a week per keg (optional)', names: ['holding cost', 'waiting cost'] }
  ];
  const CONCEPT = {}; CONCEPTS.forEach(function (c) { CONCEPT[c.id] = c; });

  /* ---------- reading a diagram ---------- */
  function read(d) {
    const kind = {};
    (d.stocks || []).forEach(function (s) { kind[s.label] = 'stock'; });
    (d.auxiliaries || []).forEach(function (a) { kind[a.label] = 'auxiliary'; });
    (d.flows || []).forEach(function (f) { kind[f.label] = 'flow'; });
    (d.junctions || []).forEach(function (j) { kind[j.label] = 'junction'; });
    const links = (d.connectors || []).map(function (c) { return { from: c.from, to: c.to }; });
    const flows = (d.flows || []).map(function (f) { return { label: f.label, from: f.from, to: f.to }; });
    return { kind: kind, links: links, flows: flows };
  }
  const isEnd = function (x) { return x == null || x === 'cloud'; };

  /* Same-named elements. The canvas saves every reference by name, so two elements
     called alike cannot be told apart in the saved diagram. For the check, the second
     and later copies get invisible marks (zero-width spaces) after their name: they look
     the same on screen but are separate elements. A flow's ends are matched by position.
     A link to a shared name cannot be resolved from the saved diagram, so it goes to the
     copy nearest where it comes from (its last bend point, or the element at its other
     end): links nearly always join nearby elements. N1 still asks the learner to rename them. */
  const ZW = '\u200B';
  const base = function (l) { return l == null ? l : String(l).split(ZW).join(''); };
  const copyNo = function (l) { return l == null ? 0 : String(l).split(ZW).length - 1; };
  /* a name for text: "arrival rate", "arrival rate (2)" */
  const shown = function (l) { return copyNo(l) ? base(l) + ' (' + (copyNo(l) + 1) + ')' : base(l); };
  function unique(d) {
    const c = JSON.parse(JSON.stringify(d || {}));
    ['stocks', 'auxiliaries', 'flows', 'clouds', 'junctions', 'connectors'].forEach(function (k) { c[k] = c[k] || []; });
    const els = [].concat(c.stocks, c.auxiliaries, c.flows), seen = {}, copies = {};
    els.forEach(function (e) {
      const n = seen[e.label] = (seen[e.label] || 0) + 1;
      if (n > 1) e.label = e.label + ZW.repeat(n - 1);
      (copies[base(e.label)] = copies[base(e.label)] || []).push(e);
    });
    const shared = function (l) { return copies[l] && copies[l].length > 1; };
    if (!Object.keys(copies).some(shared)) return c;
    const pos = function (e) { return e.valve_xy || [e.x, e.y]; };
    const at = {}; els.concat(c.junctions).forEach(function (e) { if (!(e.label in at)) at[e.label] = pos(e); });   // a name's position (its first copy)
    const near = function (l, xy, stocksOnly) {     // the copy of l nearest a position
      const cs = copies[l].filter(function (e) { return !stocksOnly || c.stocks.indexOf(e) >= 0; });
      if (!xy || !cs.length) return l;
      return cs.reduce(function (b, e) { const p = pos(e), q = pos(b); return Math.hypot(p[0] - xy[0], p[1] - xy[1]) < Math.hypot(q[0] - xy[0], q[1] - xy[1]) ? e : b; }).label;
    };
    c.flows.forEach(function (f) {
      if (shared(f.from)) f.from = near(f.from, f.from_xy, true);
      if (shared(f.to)) f.to = near(f.to, f.to_xy, true);
    });
    c.connectors.forEach(function (k) {
      const w = k.waypoints || [], first = w.length ? [w[0].x, w[0].y] : null, last = w.length ? [w[w.length - 1].x, w[w.length - 1].y] : null;
      const from0 = k.from;
      if (shared(k.from)) k.from = near(k.from, first || at[k.to]);
      if (shared(k.to)) k.to = near(k.to, last || at[from0]);
    });
    return c;
  }

  /* X informs Y: a chain of information links, through auxiliaries, flows or
     junctions, never through a stock. Returns the links of one such chain, or null. */
  function chain(R, a, b) {
    const prev = new Map([[a, null]]), q = [a];
    while (q.length) {
      const x = q.shift();
      for (const l of R.links) {
        if (l.from !== x || prev.has(l.to)) continue;
        prev.set(l.to, l);
        if (l.to === b) { const out = []; let k = l; while (k) { out.unshift(k); k = prev.get(k.from); } return out; }
        if (R.kind[l.to] !== 'stock') q.push(l.to);
      }
    }
    return null;
  }

  /* ---------- layer 1: notation ---------- */
  function notation(d) {
    const R = read(d), out = [];
    const add = function (id, type, text, ev) { out.push({ id: id, type: type, text: text, evidence: ev }); };
    // N1 by the names the learner sees (copies made separate by unique() still count)
    const labels = (d.stocks || []).concat(d.auxiliaries || [], d.flows || []).map(function (e) { return e.label; }), byName = {};
    labels.forEach(function (l) { (byName[base(l)] = byName[base(l)] || []).push(l); });
    Object.keys(byName).filter(function (n) { return byName[n].length > 1; }).forEach(function (n) {
      add('N1', 'error', (byName[n].length === 2 ? 'Two' : byName[n].length) + ' elements are called "' + n + '". Give each its own name, so anyone reading your diagram, and the check, can tell which one a link goes to.',
        { focus: byName[n], notes: byName[n].map(function (l) { return { at: l, text: 'same name' }; }) });
    });
    R.links.forEach(function (l) {
      if (R.kind[l.to] === 'stock') add('N2', 'error', 'The link from "' + l.from + '" points into the stock "' + l.to + '". Stocks change only through flows: make it a flow, or point the link at the flow it should affect.', { focus: [l.from, l.to], bad: [l], notes: [{ at: l.to, text: 'stocks change only through flows' }] });
      if (isEnd(l.from) || isEnd(l.to) || !R.kind[l.from] || !R.kind[l.to]) add('N3', 'error', 'A link starts or ends at a cloud. A cloud is outside your model: nothing can be read from it or sent to it by a link.', { focus: [l.from, l.to].filter(function (x) { return R.kind[x]; }), bad: [l] });
    });
    R.flows.forEach(function (f) {
      [f.from, f.to].forEach(function (e) {
        if (R.kind[e] === 'auxiliary' || R.kind[e] === 'flow') add('N4', 'error', 'The flow "' + f.label + '" runs to or from "' + e + '", which is not a stock. Flows carry material between stocks, or to and from clouds.', { focus: [f.label, e], badFlows: [f.label] });
      });
      if (f.from == null || f.to == null) add('N5', 'error', 'The flow "' + f.label + '" is not attached at one end.', { focus: [f.label], badFlows: [f.label] });
      else if (R.kind[f.from] !== 'stock' && R.kind[f.to] !== 'stock') add('N6', 'error', 'The flow "' + f.label + '" fills and empties nothing: it touches no stock.', { focus: [f.label], badFlows: [f.label] });
      if (f.from === f.to && R.kind[f.from] === 'stock') add('N7', 'error', 'The flow "' + f.label + '" leaves and enters the same stock, so it changes nothing.', { focus: [f.label, f.from], badFlows: [f.label] });
      if (!R.links.some(function (l) { return l.to === f.label; })) add('W1', 'warning', 'Nothing informs "' + f.label + '". What sets how fast it runs? This is fine if it is meant as an outside input.', { focus: [f.label], notes: [{ at: f.label, text: 'what sets its rate?' }] });
    });
    (d.stocks || []).forEach(function (s) {
      if (!R.flows.some(function (f) { return f.from === s.label || f.to === s.label; })) add('N8', 'error', 'Nothing fills or empties the stock "' + s.label + '", so it never changes.', { focus: [s.label], notes: [{ at: s.label, text: 'no flow in or out' }] });
    });
    (d.auxiliaries || []).forEach(function (a) {
      if (!R.links.some(function (l) { return l.from === a.label; })) add('W2', 'warning', '"' + a.label + '" affects nothing in your diagram.', { focus: [a.label], notes: [{ at: a.label, text: 'affects nothing' }] });
    });
    return out;
  }

  /* ---------- layer 3: mechanisms ---------- */
  const MECH = [
    { id: 'M1', weight: 'required', title: 'Deliveries take time', game: 'Kegs you order take three weeks to reach your cellar. Until then they are on order.' },
    { id: 'M2', weight: 'required', title: 'Orders pile up while you wait', game: 'Each order adds to the kegs you are waiting for.' },
    { id: 'M3', weight: 'required', title: 'Nothing you order is lost', game: 'When the wholesaler runs short, it sends what it can and keeps the rest on back order. Those kegs still come, later.' },
    { id: 'M4', weight: 'required', title: 'You can serve only what you have', game: 'You can hand out only the kegs in your cellar. When it is empty, customers go without.' },
    { id: 'M5', weight: 'important', title: 'Kegs leave as customers are served', game: 'Every customer served takes one keg out of the cellar.' },
    { id: 'M6', weight: 'required', title: 'Customers you cannot serve wait', game: 'A customer who cannot be served does not leave: they wait for their keg.' },
    { id: 'M7', weight: 'required', title: 'Waiting customers are served later, from the cellar', game: 'Waiting customers are served first when kegs arrive. How many get served depends on how many are waiting and what is in the cellar.' },
    { id: 'M8', weight: 'important', title: 'Customers come from outside', game: 'You do not choose how many customers come: that is an input to the pub.' },
    { id: 'M9', weight: 'required', title: 'Your cost adds up, and never falls', game: 'Each week, every keg in the cellar costs £0.50 and every keg owed to a waiting customer costs £1. The cost so far only ever grows.' },
    { id: 'M10', weight: 'required', title: 'Ordering costs nothing', game: 'Placing an order is free, and so are the kegs. Only kegs held and kegs owed cost money.' },
    { id: 'O1', weight: 'optional', title: 'The delivery time is shown', game: 'Deliveries take three weeks.' },
    { id: 'O2', weight: 'optional', title: 'Waiting customers are served first', game: 'Kegs go to waiting customers before new ones.' }
  ];

  function mechanisms(d, mapIn) {
    const R = read(d), present = new Set(Object.keys(R.kind));
    const map = {}; Object.keys(mapIn || {}).forEach(function (l) { if (present.has(l)) map[l] = mapIn[l]; });
    const E = function (c) { return Object.keys(map).filter(function (l) { return map[l].indexOf(c) >= 0; }); };
    const flowsIn = function (c) { return E(c).filter(function (l) { return R.kind[l] === 'flow'; }); };
    const stocksIn = function (c) { return E(c).filter(function (l) { return R.kind[l] === 'stock'; }); };
    const F = function (l) { return R.flows.find(function (f) { return f.label === l; }); };
    const fills = function (f, s) { const x = F(f); return !!x && x.to === s; };
    const drains = function (f, s) { const x = F(f); return !!x && x.from === s; };
    const informs = function (a, b) { return !!chain(R, a, b); };
    const anyInf = function (as, bs) { return as.some(function (a) { return bs.some(function (b) { return informs(a, b); }); }); };
    const direct = function (as, b) { return R.links.filter(function (l) { return as.indexOf(l.from) >= 0 && l.to === b; }); };
    const uniq = function (a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); };
    const cellar = stocksIn('C1'), onorder = stocksIn('C2'), waiting = stocksIn('C3'), cost = stocksIn('C4');
    const orders = flowsIn('C6'), deliv = flowsIn('C7'), arrive = flowsIn('C8'), serve = flowsIn('C9'), fail = flowsIn('C10'),
      catchup = flowsIn('C11'), out = flowsIn('C12'), costr = flowsIn('C13');
    const arrivals = E('C14'), limit = E('C15'), decision = E('C16'), dtime = E('C17');
    const res = [];
    const put = function (m, pass, ev, hint, answer) {
      const def = MECH.find(function (x) { return x.id === m; });
      ev = ev || {}; ev.focus = uniq(ev.focus || []);
      res.push({ id: m, weight: def.weight, title: def.title, game: def.game, pass: !!pass, hint: pass ? '' : hint, answer: pass ? '' : answer, evidence: pass ? null : ev });
    };
    const first = function (a) { return a.length ? a[0] : null; };

    // M1 deliveries take time
    {
      const ok = onorder.length && deliv.some(function (f) { return onorder.some(function (s) { return drains(f, s); }) && cellar.some(function (s) { return fills(f, s); }); });
      const shortcut = R.flows.filter(function (f) { return cellar.indexOf(f.to) >= 0 && (orders.indexOf(f.label) >= 0 || deliv.indexOf(f.label) >= 0) && onorder.indexOf(f.from) < 0; }).map(function (f) { return f.label; });
      put('M1', ok, onorder.length
        ? { focus: onorder.concat(cellar, deliv), notes: [{ at: first(onorder), text: 'how do these reach the cellar?' }] }
        : { focus: cellar.concat(shortcut, orders), badFlows: shortcut, notes: [{ at: first(shortcut) || first(cellar), text: shortcut.length ? 'arrives at once?' : 'where do kegs come from?' }], whole: !cellar.length },
        onorder.length ? 'Your kegs on order never reach the cellar. What carries them there?'
          : shortcut.length ? 'In your diagram, ordered kegs go straight into the cellar. In the game they take three weeks. Where are they in between?'
            : 'In the game, kegs you order take three weeks to arrive. Where are they in your diagram while they are on their way?',
        onorder.length ? 'Add a flow from "' + first(onorder) + '" into "' + (first(cellar) || 'the cellar') + '": the deliveries.'
          : 'Add a stock for kegs ordered but not yet arrived. Your orders fill it, and a deliveries flow empties it into the cellar.');
    }
    // M2 orders pile up
    {
      const ok = orders.some(function (f) { return onorder.some(function (s) { return fills(f, s); }); });
      put('M2', ok, { focus: orders.concat(onorder), notes: [{ at: first(orders) || first(onorder), text: 'where do orders go?' }], whole: !orders.length && !onorder.length },
        'Where do your orders go before the kegs arrive?',
        onorder.length ? 'Your orders flow should fill "' + first(onorder) + '".' : 'Orders should fill a stock of kegs on order (see the previous point).');
    }
    // M3 nothing ordered is lost
    {
      const lost = R.flows.filter(function (f) { return onorder.indexOf(f.from) >= 0 && isEnd(f.to); }).map(function (f) { return f.label; });
      const limInf = anyInf(limit, deliv);
      const ok = onorder.length && limInf && !lost.length;
      const ghost = limit.length && deliv.length && !limInf ? [{ from: first(limit), to: first(deliv) }] : [];
      put('M3', ok, { focus: limit.concat(deliv, onorder, lost), badFlows: lost, ghost: ghost,
        notes: [lost.length ? { at: lost[0], text: 'are these kegs lost?' } : !limit.length ? { at: first(deliv) || first(onorder), text: 'what limits this?' } : { at: first(limit), text: 'what does this limit?' }],
        whole: !onorder.length && !limit.length && !deliv.length },
        lost.length ? 'In your diagram, kegs can leave the kegs on order without arriving. In the game, nothing you order is lost.'
          : !onorder.length ? 'When the wholesaler runs short, where do the kegs it could not send wait in your diagram?'
            : 'What decides how many of your kegs on order can arrive, when the wholesaler runs short?',
        (lost.length ? 'Remove "' + lost[0] + '": kegs on order only leave by being delivered. ' : '') +
        (limit.length && deliv.length ? 'Link "' + first(limit) + '" to "' + first(deliv) + '": the wholesaler\'s limit holds deliveries back, and the rest waits in the kegs on order.' : 'Show the wholesaler\'s limit as an input that informs the deliveries, so what it cannot send stays on order.'));
    }
    // M4 serve only what you have
    {
      const targets = serve.concat(catchup).length ? serve.concat(catchup) : out;
      const missing = targets.filter(function (t) { return !anyInf(cellar, [t]); });
      const ok = cellar.length && targets.length && !missing.length;
      put('M4', ok, { focus: cellar.concat(targets), ghost: cellar.length ? missing.map(function (t) { return { from: first(cellar), to: t }; }) : [],
        good: [].concat.apply([], targets.map(function (t) { return direct(cellar, t); })),
        notes: [{ at: first(missing) || first(cellar), text: 'how many can be served?' }], whole: !cellar.length || !targets.length },
        'What stops you serving more kegs than are in your cellar?',
        cellar.length && missing.length ? 'Link "' + first(cellar) + '" to ' + missing.map(function (t) { return '"' + t + '"'; }).join(' and ') + ': you can serve only what the cellar holds.' : 'Serving needs to know what is in the cellar.');
    }
    // M5 kegs leave as customers are served
    {
      const custFlows = serve.concat(catchup);
      const tied = function (a, b) { return a === b || informs(a, b) || informs(b, a); };
      const loose = custFlows.filter(function (c) { return !out.some(function (o) { return tied(o, c); }); });
      const ok = out.length && custFlows.length && !loose.length;
      put('M5', ok, { focus: out.concat(custFlows), ghost: out.length ? loose.map(function (c) { return { from: c, to: first(out) }; }) : [],
        notes: [{ at: first(out) || first(cellar), text: 'tied to customers served?' }], whole: !out.length && !custFlows.length },
        'What ties the kegs leaving your cellar to the customers you serve?',
        out.length && loose.length ? 'Link ' + loose.map(function (c) { return '"' + c + '"'; }).join(' and ') + ' to "' + first(out) + '": each customer served takes a keg.' : 'Show the kegs leaving the cellar, tied to the customers served.');
    }
    // M6 customers you cannot serve wait
    {
      const into = fail.concat(arrive).filter(function (f) { return waiting.some(function (s) { return fills(f, s); }); });
      const leaks = R.flows.filter(function (f) { return waiting.indexOf(f.from) >= 0 && catchup.indexOf(f.label) < 0; }).map(function (f) { return f.label; });
      const ok = into.length && !leaks.length;
      put('M6', ok, { focus: waiting.concat(fail, leaks), badFlows: leaks, notes: [{ at: first(leaks) || first(waiting) || first(fail) || first(serve), text: leaks.length ? 'do they leave unserved?' : 'where do they go?' }], whole: !waiting.length && !fail.length && !serve.length },
        leaks.length ? 'In your diagram, waiting customers can leave without being served. In the game they wait for their keg.'
          : 'What happens, in your diagram, to customers you could not serve?',
        leaks.length ? 'Remove "' + leaks[0] + '", or make it the flow that serves waiting customers.'
          : waiting.length ? 'Customers not served should flow into "' + first(waiting) + '".' : 'Add a stock of waiting customers, filled by the customers you could not serve.');
    }
    // M7 waiting customers are served later, from the cellar
    {
      const cu = catchup.filter(function (f) { return waiting.some(function (s) { return drains(f, s); }); });
      const t = first(cu);
      const wInf = t && anyInf(waiting, [t]), cInf = t && anyInf(cellar, [t]);
      const ok = t && wInf && cInf;
      const ghost = [];
      if (t && !wInf && waiting.length) ghost.push({ from: first(waiting), to: t });
      if (t && !cInf && cellar.length) ghost.push({ from: first(cellar), to: t });
      const wrong = t ? R.links.filter(function (l) { return l.to === t && R.kind[l.from] === 'stock' && waiting.indexOf(l.from) < 0 && cellar.indexOf(l.from) < 0; }) : [];
      put('M7', ok, { focus: waiting.concat(cu.length ? cu : catchup, cellar, wrong.map(function (l) { return l.from; })), ghost: ghost, bad: wrong,
        good: t ? direct(cellar.concat(waiting), t) : [],
        notes: [!t ? { at: first(waiting), text: 'how do they get served?' } : !wInf ? { at: first(waiting), text: 'how many are waiting?' } : { at: first(cellar), text: 'how many kegs are there?' }],
        whole: !waiting.length },
        !t ? 'How do waiting customers get their kegs in your diagram?'
          : !wInf ? 'Your "' + t + '" cannot tell how many customers are waiting.' + (wrong.length ? ' It reads "' + wrong[0].from + '" instead.' : '') + ' What would it need to know?'
            : 'How does "' + t + '" know how many kegs are in the cellar?',
        ghost.length ? ghost.map(function (g) { return 'Link "' + g.from + '" to "' + g.to + '".'; }).join(' ') + (wrong.length ? ' The link from "' + wrong[0].from + '" is not needed for this.' : '')
          : 'Add a flow out of the waiting customers, informed by how many are waiting and by the cellar.');
    }
    // M8 customers come from outside
    {
      const ok = anyInf(arrivals, arrive);
      put('M8', ok, { focus: arrivals.concat(arrive), ghost: arrivals.length && arrive.length ? [{ from: first(arrivals), to: first(arrive) }] : [],
        notes: [{ at: first(arrive) || first(arrivals), text: 'what sets how many come?' }], whole: !arrivals.length && !arrive.length },
        'What sets how many customers come in each week?',
        arrivals.length && arrive.length ? 'Link "' + first(arrivals) + '" to "' + first(arrive) + '".' : 'Add the customer arrivals as an outside input that informs the customers coming in.');
    }
    // M9 cost adds up and never falls
    {
      const cr = costr.filter(function (f) { return cost.some(function (s) { return fills(f, s); }); });
      const t = first(cr), falls = R.flows.filter(function (f) { return cost.indexOf(f.from) >= 0; }).map(function (f) { return f.label; });
      const cInf = t && anyInf(cellar, [t]), wInf = t && anyInf(waiting, [t]);
      const ok = t && cInf && wInf && !falls.length;
      const ghost = [];
      if (t && !cInf && cellar.length) ghost.push({ from: first(cellar), to: t });
      if (t && !wInf && waiting.length) ghost.push({ from: first(waiting), to: t });
      put('M9', ok, { focus: cost.concat(cr.length ? cr : costr, cellar, waiting, falls), ghost: ghost, badFlows: falls, good: t ? direct(cellar.concat(waiting), t) : [],
        notes: [falls.length ? { at: falls[0], text: 'can cost fall?' } : { at: t || first(cost), text: 'what adds to the cost?' }], whole: !cost.length && !costr.length },
        falls.length ? 'In your diagram, the cost so far can go down. In the game it only ever grows.'
          : !t ? 'How does your cost grow each week?' : 'What adds to your cost each week?',
        (falls.length ? 'Remove "' + falls[0] + '". ' : '') + (ghost.length ? ghost.map(function (g) { return 'Link "' + g.from + '" to "' + g.to + '".'; }).join(' ') : !t ? 'Add a flow into the cost, informed by the cellar and the waiting customers.' : ''));
    }
    // M10 ordering costs nothing
    {
      const t = first(costr.length ? costr : []);
      const paths = t ? orders.concat(deliv).map(function (o) { return chain(R, o, t); }).filter(Boolean) : [];
      const bad = [].concat.apply([], paths);
      put('M10', t && !paths.length, { focus: orders.concat(deliv, costr), bad: bad, notes: [{ at: t || first(cost), text: t ? 'is ordering a cost?' : 'what adds to the cost?' }], whole: !t },
        t ? 'In your diagram, ordering adds to the cost. In this game, ordering and deliveries are free.' : 'First show how your cost is added each week.',
        bad.length ? 'Remove the link from "' + bad[0].from + '" toward "' + t + '": only kegs held and kegs owed cost money.' : 'Add a flow that adds to the cost each week.');
    }
    // optional
    put('O1', anyInf(dtime, deliv), { focus: deliv }, '', '');
    put('O2', anyInf(catchup, serve), { focus: catchup.concat(serve) }, '', '');

    // the order decision: observed, never marked
    let decisionNote = null;
    const dec = first(decision);
    if (dec && R.links.some(function (l) { return l.to === dec; })) {
      decisionNote = anyInf(onorder, [dec]) ? 'Your order decision takes the kegs already on order into account. Most players forget them.'
        : 'Your order decision does not take the kegs already on order into account. That is what most players of this game do, and it is why their orders swing.';
    } else if (!dec || !R.links.some(function (l) { return l.to === dec; })) {
      decisionNote = 'You treat the order decision as an input from outside the diagram, as the task allows.';
    }
    return { mechanisms: res, decisionNote: decisionNote };
  }

  /* Elements drawn as a different kind from the concept they were read as. */
  function kindNotes(d, map) {
    const R = read(d), out = [];
    Object.keys(map || {}).forEach(function (l) {
      (map[l] || []).forEach(function (c) {
        const k = CONCEPT[c] && CONCEPT[c].kind, got = R.kind[l];
        if (k === 'stock' && got && got !== 'stock') out.push({ element: l, text: '"' + l + '" is drawn as ' + (got === 'flow' ? 'a flow' : 'an auxiliary') + ', but ' + CONCEPT[c].name + ' accumulate: they are a stock.' });
        if (k === 'flow' && got === 'stock') out.push({ element: l, text: '"' + l + '" is drawn as a stock, but ' + CONCEPT[c].name + ' is a rate: a flow.' });
      });
    });
    return out;
  }

  /* How far the diagram is from the game: core concepts found. */
  function coreFound(map) {
    const core = ['C1', 'C2', 'C3', 'C4', 'C6', 'C7', 'C9', 'C11', 'C13'];
    const got = new Set(); Object.keys(map || {}).forEach(function (l) { (map[l] || []).forEach(function (c) { got.add(c); }); });
    return core.filter(function (c) { return got.has(c); }).length;
  }

  function score(m) {
    const of = function (w) { const a = m.filter(function (x) { return x.weight === w; }); return { pass: a.filter(function (x) { return x.pass; }).length, of: a.length }; };
    return { required: of('required'), important: of('important'), optional: of('optional') };
  }

  return { CONCEPTS: CONCEPTS, CONCEPT: CONCEPT, MECH: MECH, notation: notation, mechanisms: mechanisms, kindNotes: kindNotes, coreFound: coreFound, score: score, read: read, unique: unique, base: base, shown: shown };
})();
if (typeof module !== 'undefined') module.exports = Marking;

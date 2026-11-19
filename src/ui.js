/* Drawing and interaction. Reads the engine's state; never changes the rules. */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const CFG = Engine.CFG, KEG = '🍺', SLIP = '🧾', PERSON = '🧍';
  const MAXTOK = 30;
  let G = null, V = null, busy = false, timer = null, ANS = null;   // ANS: the wholesaler's latest answer
  const CAP = CFG.cellar;
  let MODE = 'plain';                                   // the scenario picked on the opening screen
  const wom = function () { return G ? G.mode === 'wom' : MODE === 'wom'; };
  const money = function (x) { return '£' + (Math.round(x * 100) / 100).toFixed(x % 1 ? 2 : 0); };

  function show(id) {
    ['intro', 'play', 'commit', 'results'].forEach(function (s) { $(s).hidden = s !== id; });
    $('topStats').hidden = id === 'intro';
  }
  function speed() {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce ? 0 : parseFloat($('speed').value);
  }
  const wait = function (ms) { return ms > 0 ? new Promise(function (r) { setTimeout(r, ms); }) : Promise.resolve(); };

  /* ---------- counts and faces ---------- */
  const TIMES = ' <b>× ';
  function kegs(n) { return KEG + TIMES + n + '</b>'; }
  function orderFor(n) { return SLIP + KEG + TIMES + n + '</b>'; }
  const FACES = {
    ask: ['\u{1F642}', '\u{1F600}', '\u{1F60A}', '\u{1F603}'],      // on the way in
    glad: ['\u{1F60B}', '\u{1F604}', '\u{1F974}', '\u{1F60C}'],     // got a keg
    late: ['\u{1F620}', '\u{1F61E}', '\u{1F622}', '\u{1F641}']      // left without one: still waiting, or turned away
  };
  /* Up to three different faces, then the number. The faces change from week to week. */
  function faces(kind, n, week) {
    if (n <= 0) return '<span class="none">–</span>';
    const set = FACES[kind]; let h = '';
    for (let i = 0; i < Math.min(n, 3); i++) h += set[(week + i) % set.length];
    return h + TIMES + n + '</b>';
  }
  function sumTo(w, f) { let s = 0; for (let i = 0; i < w && i < G.log.length; i++) s += f(G.log[i]); return s; }

  /* ---------- the chain picture ---------- */
  const ICON = ['\u{1F37B}', '\u{1F69B}', '\u{1F3EC}', '\u{1F3ED}'];
  const NAME = ['Pub', 'Wholesaler', 'Distributor', 'Brewery'];
  /* f = { reveal, week, pos:[{stock,owed,order,way:[one week away, two weeks away]}],
           cust:{coming, glad, red}, say, wom }. cust.red: still waiting (plain) or turned away (wom) */
  function badge(html, label) { return '<span class="badge"' + (label ? ' aria-label="' + label + '"' : '') + '>' + html + '</span>'; }
  /* Three rows on one grid. Top: kegs on their way, one step to the right each week.
     Middle: the four positions. Bottom: orders, which travel left and arrive at once.
     A shipment two weeks from its customer sits above the supplier; one week away,
     above the gap between the two; then it drops into the customer's stock. */
  function chainHTML(f) {
    let top = '', mid = '', bot = '';
    for (let i = 3; i >= 0; i--) {
      const p = f.pos[i], hide = !f.reveal && i > 0;
      const c = i - 1, open = i > 0 && (f.reveal || c === 0);   // is the road to customer c shown?
      const cust = open ? f.pos[c] : null;
      // top lane, above position i
      if (i === 0) top += '<div class="lane k on" data-k="arr"><span class="tip" aria-hidden="true">↓</span></div>';
      else top += '<div class="lane k' + (open ? ' on' : '') + '" data-k="r2_' + c + '">' +
        (open && cust.way[1] > 0 ? badge(kegs(cust.way[1]), cust.way[1] + ' kegs, two weeks away') : '') + '</div>';
      // the position itself
      const warn = hide && i === 1 && f.short && f.short.owed > 0;
      mid += '<div class="node' + (hide ? ' hid' : '') + (i === 0 ? ' me' : '') + (warn ? ' warn' : '') + '" data-k="n' + i + '">' +
        (warn ? '<span class="flag" aria-hidden="true">\u26A0\uFE0F</span>' : '') +
        '<div class="node-ico" aria-hidden="true">' + ICON[i] + '</div><div class="node-name">' + NAME[i] + (i === 0 ? ' (you)' : '') + '</div>';
      if (warn) mid += '<div class="owes-you">On back order: <b>' + f.short.owed + '</b></div>' +
        '<div class="node-note">You ordered ' + f.short.asked + '. It sent <b>' + f.short.sent + '</b>.</div>';
      else if (hide) mid += '<div class="node-note">' + (i === 1 && f.say ? f.say : 'Hidden while you play') + '</div>';
      else mid += '<div class="count" data-k="st' + i + '" aria-label="' + p.stock + ' kegs in stock">' + kegs(p.stock) + '</div>' +
        (i === 0 && f.wom ? '<div class="cap' + (p.stock >= CAP ? ' full' : '') + '">cellar holds ' + CAP + '</div>' + (p.back > 0 ? '<div class="owes">' + p.back + ' sent back</div>' : '') : '') +
        (p.owed > 0 && i > 0 ? '<div class="owes">owes ' + p.owed + '</div>' : '') +
        (i === 3 ? '<div class="node-note">Brewing ' + p.way[1] + ', then ' + p.way[0] + '</div>' : '');
      mid += '</div>';
      // bottom lane, under position i: the order it has received from its customer
      bot += '<div class="lane o' + (open || i === 0 ? ' on' : '') + '" data-k="un' + i + '">' +
        (open && cust.order != null ? badge(orderFor(cust.order), 'order for ' + cust.order + ' kegs') : '') + '</div>';
      if (i > 0) {   // the gap between position i and its customer
        top += '<div class="lane k' + (open ? ' on' : '') + '" data-k="r1_' + c + '">' +
          (open && cust.way[0] > 0 ? badge(kegs(cust.way[0]), cust.way[0] + ' kegs, one week away') : '') + '</div>';
        mid += '<div class="gap" aria-hidden="true">→</div>';
        bot += '<div class="lane o' + (open ? ' on' : '') + '"><span class="tip" aria-hidden="true">←</span></div>';
      }
    }
    const q = f.cust;
    // three boxes beside the pub: customers come in at the top, then leave served, or are left without a keg
    const cb = function (cls, k, title, html) { return '<div class="cbox' + cls + '" data-k="' + k + '"><h4>' + title + '</h4><div class="faces">' + html + '</div></div>'; };
    const cu = '<div class="custs">' + cb('', 'cin', 'Coming in', faces('ask', q.coming, f.week)) +
      cb(' glad', 'cserved', 'Leaving served', faces('glad', q.glad, q.gw || f.week)) +
      cb(' late', 'cout', f.wom ? 'Turned away' : 'Still waiting', faces('late', q.red, f.wom ? q.gw || f.week : f.week)) + '</div>';
    return '<div class="chainwrap"><div class="chain3">' + cu + top + mid + bot + '</div></div>' +
      '<p class="note">Above the chain: kegs on their way, moving one step towards the customer each week. Below it: orders, which arrive at once.</p>';
  }
  /* The picture for a finished week, with every position shown. */
  function frameAt(w) {
    const r = G.log[w - 1];
    return { reveal: true, week: w, wom: wom(),
      pos: r.pos.map(function (p) { return { stock: p.stock, owed: p.owed, order: p.order, way: p.way, back: p.back }; }),
      cust: { coming: 0, glad: r.pos[0].sent, red: wom() ? r.pos[0].turned : r.pos[0].owed } };
  }
  /* The picture during play: only what the pub can see, following the animation step by step. */
  function drawChainPlay() {
    const rec = G.log[G.log.length - 1], last = G.log.length > 1 ? G.log[G.log.length - 2].pos[0].order : null;
    const pos = G.pos.map(function (p) { return { stock: p.stock, owed: p.owed, order: null, way: p.inbound }; });
    pos[0] = { stock: V.cellar, owed: 0, order: last, way: [V.s1, V.s2], back: V.back };
    const cust = { coming: V.coming, glad: V.glad, red: V.red, gw: V.gladWeek };
    // On a narrow screen the chain scrolls sideways: start at the pub's end, and keep the player's place between redraws.
    const old = $('chainPlay').querySelector('.chainwrap'), keep = old && old.scrollWidth > old.clientWidth ? old.scrollLeft : null;
    $('chainPlay').innerHTML = chainHTML({ reveal: false, wom: wom(), week: rec.week, pos: pos, cust: cust, say: $('whoSay').innerHTML, short: ANS });
    const wrap = $('chainPlay').querySelector('.chainwrap');
    wrap.scrollLeft = keep == null ? wrap.scrollWidth : keep;
  }
  /* Where a flying token starts or ends, in whichever tab is open. */
  function at(key) {
    if ($('chainPlay').hidden) return $({ who: 'tWho', s2: 'tS2', s1: 'tS1', cel: 'tCel', cus: 'tCus', ofrom: 'tCel', oto: 'tWho' }[key]);
    return $('chainPlay').querySelector('[data-k="' + { who: 'n1', s2: 'r2_0', s1: 'r1_0', cel: 'st0', cus: 'cserved', cin: 'cin', cserved: 'cserved', cout: 'cout', ofrom: 'un0', oto: 'un1' }[key] + '"]');
  }
  function tab(chain) {
    $('chainPlay').hidden = !chain; $('lane').hidden = chain;
    if (chain) { const w = $('chainPlay').querySelector('.chainwrap'); if (w) w.scrollLeft = w.scrollWidth; }
    $('tabPub').setAttribute('aria-selected', String(!chain)); $('tabChain').setAttribute('aria-selected', String(chain));
    try { localStorage.setItem('pubgame.tab', chain ? 'chain' : 'pub'); } catch (e) {}
  }

  /* ---------- the lane ---------- */
  function tokens(el, sym, n, cls) {
    el.textContent = '';
    const k = Math.min(n, MAXTOK);
    for (let i = 0; i < k; i++) {
      const s = document.createElement('span');
      s.textContent = sym; if (cls) s.className = cls;
      el.appendChild(s);
    }
    if (n > k) { const m = document.createElement('span'); m.className = 'more'; m.textContent = '+' + (n - k); el.appendChild(m); }
  }
  /* Words and columns that differ between the two scenarios. */
  function setMode() {
    const w = wom();
    document.querySelectorAll('.st-plain').forEach(function (e) { e.hidden = w; });
    document.querySelectorAll('.st-wom').forEach(function (e) { e.hidden = !w; });
    $('tag').textContent = 'Prototype. ' + (w ? 'Word of mouth.' : 'The supply game.') + ' One player, running the pub.';
    $('whyLabel').textContent = w ? 'What made it hard to serve every customer?' : 'What made it hard to keep your costs down?';
    $('logHead').innerHTML = w
      ? '<tr><th rowspan="2">Week</th><th colspan="6" class="grp">Your pub</th><th colspan="3" class="grp">Your order and the wholesaler\'s answer</th><th class="grp">Score</th></tr>' +
        '<tr><th>Customers came</th><th>Delivered to you</th><th>Sent back</th><th>Served</th><th>Turned away</th><th>Cellar at end</th><th>You ordered</th><th>Wholesaler sent</th><th>On back order with the wholesaler</th><th>Served so far</th></tr>'
      : '<tr><th rowspan="2">Week</th><th colspan="5" class="grp">Your pub</th><th colspan="3" class="grp">Your order and the wholesaler\'s answer</th><th colspan="2" class="grp">Cost</th></tr>' +
        '<tr><th>Customers wanted</th><th>Delivered to you</th><th>Served</th><th>Left waiting</th><th>Cellar at end</th><th>You ordered</th><th>Wholesaler sent</th><th>On back order with the wholesaler</th><th>Week\'s cost</th><th>Cost so far</th></tr>';
    $('logBody').parentNode.className = 'log ' + (w ? 'log-wom' : 'log-plain');
    $('logNote').textContent = 'Newest week first. What the wholesaler sends in answer to an order reaches you three weeks after you placed it. It sends less than you ordered when its own stock runs out, and puts the rest on back order.' +
      (w ? ' "Sent back" counts kegs that did not fit in your cellar.' : '');
    $('hStock').textContent = w ? 'Cellar' : 'Stock';
    $('lStock').textContent = w ? 'Kegs in your cellar at the end of each week. It holds ' + CAP + '.' : 'Kegs in your cellar, minus kegs owed';
    $('barsNote').textContent = w ? 'Right of the line is stock. Left of the line is kegs on back order to the next position.' : 'Right of the line is stock. Left of the line is kegs owed.';
  }
  /* One row a week, newest first. A row fills in as the week goes on: customers and the
     delivery when it opens, the serving once the player has ordered, and the wholesaler's
     answer to that order straight after. */
  function drawTable() {
    const cell = function (v, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + (v == null ? '–' : v) + '</td>'; };
    const w = wom(); let h = '';
    for (let k = G.log.length - 1; k >= 0; k--) {
      const r = G.log[k], me = r.pos[G.seat], nxt = G.log[k + 1], sup = nxt ? nxt.pos[G.seat + 1] : null;
      const served = k < G.log.length - 1 || (V && V.stage === 'done' && V.gladWeek === r.week);
      const answer = cell(me.order) + cell(sup ? sup.sent : null, sup && sup.sent < me.order ? 'bad' : '') + cell(sup ? sup.owed : null, sup && sup.owed > 0 ? 'bad' : '');
      h += '<tr><th scope="row">' + r.week + '</th>' + cell(me.asked) + cell(me.arrived);
      if (w) h += cell(me.back, me.back > 0 ? 'bad' : '') + cell(served ? me.sent : null) + cell(served ? me.turned : null, served && me.turned > 0 ? 'bad' : '') +
        cell(served ? me.stock : null) + answer + cell(served ? me.served : null);
      else h += cell(served ? me.sent : null) + cell(served ? me.owed : null, served && me.owed > 0 ? 'bad' : '') + cell(served ? me.stock : null) +
        answer + cell(served ? money(me.weekCost) : null) + cell(served ? money(me.cost) : null);
      h += '</tr>';
    }
    $('logBody').innerHTML = h;
  }
  function drawLane() {
    const w = wom(), there = V.coming + (w ? 0 : V.red);
    tokens($('tS2'), KEG, V.s2); $('nS2').textContent = V.s2;
    tokens($('tS1'), KEG, V.s1); $('nS1').textContent = V.s1;
    tokens($('tCel'), KEG, V.cellar); $('nCel').textContent = w ? V.cellar + ' / ' + CAP : V.cellar;
    tokens($('tCus'), PERSON, there, 'waiting'); $('nCus').textContent = there;
    if (w) $('hCus').textContent = V.coming > 0 ? 'Asking for kegs'
      : V.red > 0 ? V.red + ' turned away, ' + V.glad + ' served' : V.glad > 0 ? 'All ' + V.glad + ' served' : 'Nobody here yet';
    else $('hCus').textContent = there === 0 ? 'Nobody is waiting' : V.stage === 'done' ? 'Waiting for kegs you owe them' : 'Asking for kegs';
    drawChainPlay(); drawTable();
  }
  function fly(sym, from, to, n, ms, label) {
    if (!ms || n <= 0) return Promise.resolve();
    if (!$('chainPlay').hidden) {
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), s = document.createElement('span');
      s.className = 'flyer badge'; s.innerHTML = label || kegs(n);
      s.style.left = (a.left + a.width / 2) + 'px'; s.style.top = (a.top + a.height / 2) + 'px';
      $('fx').appendChild(s);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return s.animate([{ transform: 'translate(-50%,-50%)' }, { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))' }],
        { duration: ms, easing: 'ease-in-out', fill: 'forwards' }).finished.then(function () { s.remove(); }, function () { s.remove(); });
    }
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), k = Math.min(n, 6), jobs = [];
    for (let i = 0; i < k; i++) {
      const s = document.createElement('span');
      s.className = 'flyer'; s.textContent = sym;
      const jx = (i % 3 - 1) * 16, jy = (Math.floor(i / 3) - 0.5) * 18;
      const x0 = a.left + a.width / 2 + jx, y0 = a.top + a.height / 2 + jy;
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      s.style.left = x0 + 'px'; s.style.top = y0 + 'px';
      $('fx').appendChild(s);
      const anim = s.animate(
        [{ transform: 'translate(-50%,-50%)' }, { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))' }],
        { duration: ms, delay: i * 45, easing: 'ease-in-out', fill: 'forwards' });
      jobs.push(anim.finished.then(function () { s.remove(); }, function () { s.remove(); }));
    }
    return Promise.all(jobs);
  }

  /* ---------- the week ---------- */
  /* What the wholesaler tells the pub about the order it has just received. */
  function reply(rec) {
    const s = rec.pos[G.seat + 1], kegs = function (n) { return n + (n === 1 ? ' keg' : ' kegs'); };
    let t = s.asked === 0 ? 'No new order from you. ' : 'Order received: <b>' + kegs(s.asked) + '</b>. ';
    if (s.owed > 0) t += 'Sending <b>' + s.sent + '</b> this week. <span class="short">On back order for you: <b>' + s.owed + '</b>.</span>';
    else if (s.sent > s.asked) t += 'Sending <b>' + s.sent + '</b> this week, which clears your back order.';
    else if (s.sent > 0) t += 'Sending all of them this week.';
    else t += 'Nothing to send.';
    $('whoSay').innerHTML = t;
    ANS = { asked: s.asked, sent: s.sent, owed: s.owed };
    const al = $('alert');
    al.hidden = s.owed <= 0;
    if (s.owed > 0) al.innerHTML = '<span class="alert-ico" aria-hidden="true">\u26A0\uFE0F</span><div><b>The wholesaler has run short.</b> ' +
      (s.asked > 0 ? 'You ordered ' + kegs(s.asked) + '. It sent ' + s.sent + ' and put the rest on back order. ' : 'It could send only ' + s.sent + ' this week. ') +
      '<b>' + kegs(s.owed) + '</b> ' + (s.owed === 1 ? 'is' : 'are') + ' now on back order for you. They are not lost: they will be sent as soon as the wholesaler has them, on top of anything you order from now on.</div>';
  }
  /* Kegs that did not fit in the cellar. */
  function wasteAlert(n) {
    const al = $('alert2');
    al.hidden = n <= 0;
    if (n > 0) al.innerHTML = '<span class="alert-ico" aria-hidden="true">⚠️</span><div><b>Your cellar is full.</b> It holds ' + CAP + ' kegs. ' +
      (n === 1 ? '<b>1 keg</b> of this week\'s delivery did not fit and was' : '<b>' + n + ' kegs</b> of this week\'s delivery did not fit and were') + ' sent back.</div>';
  }
  function totals(served, turned, wasted) {
    $('tot').textContent = served; $('totT').textContent = turned; $('totW').textContent = wasted;
  }
  function facts(list) {
    $('facts').innerHTML = list.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
  }
  /* The panel at the moment the player orders: this week's delivery is in, this week's
     customers are waiting, nobody has been served yet. */
  function drawFacts(rec) {
    const me = rec.pos[G.seat], p = G.pos[G.seat], inCellar = p.stock + me.sent;
    const prev = G.log.length > 1 ? G.log[G.log.length - 2] : null;
    $('wk').textContent = rec.week;
    if (wom()) {
      facts([['Customers want', me.asked], ['In your cellar', inCellar + ' of ' + CAP], ['Room left in the cellar', CAP - inCellar],
        ['Delivered this week', me.arrived + (me.back > 0 ? ' (' + me.back + ' sent back)' : '')],
        ['On its way to you', p.inbound[0] + p.inbound[1]], ['On back order for you', ANS ? ANS.owed : 0]]);
      totals(me.served - me.sent, me.turnedAll - me.turned, me.wasted);
      $('rates').innerHTML = 'Your cellar holds <b>' + CAP + '</b> kegs. A delivery that does not fit is sent back. A customer you cannot serve leaves.';
    } else {
      facts([['Customers want', me.asked], ['In your cellar', inCellar], ['Owed from before', p.owed + me.sent - me.asked],
        ['Delivered this week', me.arrived], ['Cost last week', prev ? money(prev.pos[G.seat].weekCost) : '–'],
        ['On its way to you', p.inbound[0] + p.inbound[1]]]);
      $('totC').textContent = money(p.cost - me.weekCost);
      $('rates').innerHTML = 'Rates: <b>' + money(CFG.holdCost) + '</b> a week for each keg in the cellar · <b>' + money(CFG.backlogCost) + '</b> a week for each keg owed to a customer · ordering and the kegs themselves are free.';
    }
    if (prev) drawLast(prev, true);
    else { $('lastWk').textContent = ''; $('sumWk').textContent = ''; }
    const past = G.log.filter(function (r) { return r.pos[G.seat].order != null; }).slice(-4)
      .map(function (r) { return 'week ' + r.week + ': ' + r.pos[G.seat].order; });
    $('past').textContent = 'Your recent orders: ' + (past.length ? past.join(', ') : 'none yet');
  }
  /* What came of a week once its customers were served. */
  function drawLast(rec, keepTotals) {
    const me = rec.pos[G.seat];
    if (wom()) {
      $('lastWk').textContent = 'Week ' + rec.week + ': ' + me.asked + (me.asked === 1 ? ' customer came' : ' customers came') + '. You served ' + me.sent +
        (me.turned > 0 ? ' and turned ' + me.turned + ' away.' : me.asked > 0 ? ', all of them.' : '.');
      $('sumWk').innerHTML = '<b>Customers served so far</b> <span>' + (me.served - me.sent) + ' + ' + me.sent + ' = <b>' + me.served + '</b></span>' +
        '<span class="sofar">' + (me.turned > 0 ? 'People who left without a keg tell others. Expect a smaller crowd.' : 'Everyone was served. Word gets around, and the crowd grows.') + '</span>';
      if (!keepTotals) totals(me.served, me.turnedAll, me.wasted);
    } else {
      $('lastWk').textContent = 'Week ' + rec.week + ': you served ' + me.sent + (me.owed > 0 ? ' and still owe ' + me.owed : ', nobody left waiting') + '.';
      // the week's cost written out from its two parts
      $('sumWk').innerHTML = '<b>Week ' + rec.week + ' cost</b> <span>cellar ' + me.stock + ' × ' + money(CFG.holdCost) + ' = ' + money(me.stock * CFG.holdCost) + '</span> <span>+ waiting ' + me.owed + ' × ' + money(CFG.backlogCost) + ' = ' + money(me.owed * CFG.backlogCost) + '</span> <span>= <b>' + money(me.weekCost) + '</b></span> <span class="sofar">Cost so far ' + money(me.cost - me.weekCost) + ' + ' + money(me.weekCost) + ' = <b>' + money(me.cost) + '</b></span>';
      if (!keepTotals) $('totC').textContent = money(me.cost);
    }
  }
  /* served = false: the view before this week's customers get their kegs.
     V.red is the red box: customers still waiting (plain) or turned away this week (wom). */
  function syncView(rec, served) {
    const p = G.pos[G.seat], me = rec.pos[G.seat], hold = served ? 0 : me.sent;
    const red = wom() ? (served ? me.turned : 0) : (served ? p.owed : p.owed + me.sent - me.asked);
    V = { s2: p.inbound[1], s1: p.inbound[0], cellar: p.stock + hold,
      coming: served ? 0 : me.asked, glad: served ? me.sent : 0, red: red, back: me.back,
      gladWeek: rec.week, stage: served ? 'done' : 'asking' };
  }
  function lock(on) {
    busy = on;
    ['sendBtn', 'less', 'more', 'order', 'autoBtn'].forEach(function (id) { $(id).disabled = on; });
  }

  function start() {
    clearInterval(timer);
    G = Engine.newGame(0, MODE);
    setMode();
    const rec = Engine.beginWeek(G);
    syncView(rec, false); reply(rec); wasteAlert(0); drawLane(); drawFacts(rec);
    $('order').value = CFG.startFlow; $('why').value = '';
    show('play'); lock(false);
  }
  function home() { clearInterval(timer); G = null; $('tag').textContent = 'Prototype. One player, running the pub.'; show('intro'); }
  /* This week's customers get their kegs from the cellar. Where customers wait (plain), the
     longest wait comes first: kegs go to those already waiting, then to this week's customers.
     Where they do not (wom), nobody is waiting, and those left without a keg are turned away. */
  async function serve(rec, step) {
    const me = rec.pos[G.seat], p = G.pos[G.seat];
    const fromOld = Math.min(me.sent, V.red), fromNew = me.sent - fromOld, left = V.coming - fromNew;
    await fly(KEG, at('cel'), at('cus'), me.sent, step);
    V.cellar -= me.sent; V.coming = 0; V.red -= fromOld; V.gladWeek = rec.week;
    if (!$('chainPlay').hidden && step > 0) {
      drawChainPlay();
      await Promise.all([
        fly('', at('cout'), at('cserved'), fromOld, step, faces('glad', fromOld, rec.week)),
        fly('', at('cin'), at('cserved'), fromNew, step, faces('glad', fromNew, rec.week)),
        fly('', at('cin'), at('cout'), left, step, faces('late', left, rec.week))]);
    }
    V.red += left; V.glad = me.sent; V.stage = 'done'; drawLane();
    console.assert(V.cellar === p.stock && V.s1 === p.inbound[0] && V.s2 === p.inbound[1] && V.red === (wom() ? me.turned : p.owed), 'view out of step with engine');
    drawLast(rec);
  }

  /* The game waits with the week's customers standing in the pub. On the player's order:
     they are served (or not), the order goes out, the kegs on the road move a step,
     and next week's customers come in. */
  async function send() {
    if (busy) return;
    let o = parseInt($('order').value, 10);
    if (isNaN(o) || o < 0) o = 0; if (o > 99) o = 99;
    $('order').value = o;
    lock(true);
    const sp = speed(), step = 520 * sp;
    // 1. this week's customers are served
    await serve(G.log[G.log.length - 1], step);
    await wait(step * 0.7);
    // 2. the order goes to the wholesaler
    await fly(SLIP, at('ofrom'), at('oto'), 1, $('chainPlay').hidden ? step : step * 0.6, orderFor(o));
    const orders = {}; orders[G.seat] = o;
    Engine.endWeek(G, orders);
    const before = { s1: V.s1, s2: V.s2 };
    const rec = Engine.beginWeek(G), me = rec.pos[G.seat], p = G.pos[G.seat];
    $('wk').textContent = rec.week;
    reply(rec);
    V.back = 0; wasteAlert(0); drawLane();
    // 3. the nearest lot reaches the cellar, which takes only what fits
    await fly(KEG, at('s1'), at('cel'), before.s1, step);
    V.cellar += me.arrived; V.s1 = 0; V.back = me.back; drawLane();
    if (me.back > 0) {
      wasteAlert(me.back); $('totW').textContent = me.wasted;
      await fly(KEG, at('cel'), at('who'), me.back, step, '↩ ' + kegs(me.back));
    }
    // 4. the next lot moves one slot closer
    await fly(KEG, at('s2'), at('s1'), before.s2, step);
    V.s1 = before.s2; V.s2 = 0; drawLane();
    // 5. the wholesaler sends what it can
    await fly(KEG, at('who'), at('s2'), p.inbound[1], step);
    V.s2 = p.inbound[1]; drawLane();
    // 6. last week's customers have gone; this week's come in, and the game waits for the order
    V.glad = 0; if (wom()) V.red = 0; drawLane(); await wait(step * 0.5);
    V.coming = me.asked; V.stage = 'asking'; drawLane();
    drawFacts(rec);
    if (Engine.finished(G)) {   // the last week: no order left to place
      await wait(step); await serve(rec, step); await wait(step);
      show('commit'); $('why').focus(); return;
    }
    lock(false);
    $('order').focus(); $('order').select();
  }

  function autoplay() {
    if (busy) return;
    let rec = null;
    while (!Engine.finished(G)) { Engine.endWeek(G, {}); rec = Engine.beginWeek(G); }
    if (rec) { syncView(rec, true); reply(rec); wasteAlert(0); drawLane(); drawFacts(rec); drawLast(rec); }
    show('commit');
  }

  /* ---------- charts ---------- */
  function lineChart(el, series, upto, yMin, yMax, W, H) {
    W = W || 440; H = H || 240;
    const L = 34, R = 84, T = 10, B = 26, n = CFG.weeksPlayed;
    const x = function (w) { return L + (w - 1) / (n - 1) * (W - L - R); };
    const y = function (v) { return T + (yMax - v) / (yMax - yMin) * (H - T - B); };
    const span = yMax - yMin, stepY = span <= 20 ? 4 : span <= 50 ? 10 : span <= 120 ? 20 : 40;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + el.getAttribute('data-label') + '">';
    for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      s += '<line class="' + (v === 0 ? 'axis' : 'grid') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="tick" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    }
    for (let w = 5; w <= n; w += 5) s += '<text class="tick" x="' + x(w) + '" y="' + (H - 8) + '" text-anchor="middle">' + w + '</text>';
    const ends = [];
    series.forEach(function (se) {
      const pts = [];
      for (let w = 1; w <= upto; w++) { const v = se.vals[w - 1]; if (v != null) pts.push(x(w) + ',' + y(v)); }
      if (!pts.length) return;
      s += '<polyline class="ser s-' + se.key + '" points="' + pts.join(' ') + '"/>';
      const last = pts[pts.length - 1].split(',');
      ends.push({ key: se.key, label: se.label, x: +last[0], y: +last[1] });
    });
    ends.sort(function (a, b) { return a.y - b.y; });
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    const floor = H - B - 2;
    if (ends.length && ends[ends.length - 1].y > floor) {
      ends[ends.length - 1].y = floor;
      for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < 14) ends[i].y = ends[i + 1].y - 14;
    }
    ends.forEach(function (e) { s += '<text class="end f-' + e.key + '" x="' + (e.x + 6) + '" y="' + (e.y + 4) + '">' + e.label + '</text>'; });
    el.innerHTML = s + '</svg>';
  }
  const col = function (i, f) { return G.log.map(function (r) { return r.pos[i][f]; }); };
  const nice = function (v, step) { return Math.ceil(v / step) * step; };

  function drawChain(w) {
    $('rWk').textContent = w; $('scrub').value = w;
    $('chainReplay').innerHTML = chainHTML(frameAt(w));
    const demand = G.log.map(function (r) { return r.demand; });
    const keys = ['pub', 'who', 'dis', 'bre'], labels = ['Pub', 'Wholesaler', 'Distributor', 'Brewery'];
    let top = 8; const ser = [{ key: 'dem', label: 'Customers', vals: demand }];
    for (let i = 0; i < 4; i++) { const v = col(i, 'order'); top = Math.max(top, Math.max.apply(null, v.filter(function (q) { return q != null; }))); ser.push({ key: keys[i], label: labels[i], vals: v }); }
    lineChart($('cChain'), ser, w, 0, nice(top, top > 50 ? 20 : 10), 900, 320);
    let big = 1; G.log.forEach(function (r) { r.pos.forEach(function (p) { big = Math.max(big, Math.abs(p.net)); }); });
    const rec = G.log[w - 1], order = [3, 2, 1, 0];
    $('bars').innerHTML = order.map(function (i) {
      const net = rec.pos[i].net, pct = Math.abs(net) / big * 50;
      return '<div class="bar-row"><span>' + labels[i] + (i === 0 ? ' (you)' : '') + '</span>' +
        '<div class="bar-track"><div class="bar-fill ' + (net >= 0 ? 'pos' : 'neg') + '" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-val' + (net < 0 ? ' owed-n' : '') + '">' + (net < 0 ? 'owes ' + (-net) : net) + '</span></div>';
    }).join('');
  }

  function kpis(id, list) {
    $(id).innerHTML = list.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
  }
  function results() {
    show('results');
    const n = CFG.weeksPlayed, demand = G.log.map(function (r) { return r.demand; });
    const myOrders = col(0, 'order');
    const peak = function (a) { return Math.max.apply(null, a.filter(function (q) { return q != null; })); };
    const top = Math.max(8, peak(myOrders), peak(demand));
    lineChart($('cMineOrders'), [{ key: 'dem', label: 'Customers', vals: demand }, { key: 'pub', label: 'You', vals: myOrders }], n, 0, nice(top, top > 40 ? 20 : top > 20 ? 10 : 4));
    if (wom()) {
      const myStock = col(0, 'stock');
      kpis('kTop', [['Customers served', G.served], ['Customers turned away', G.turned], ['Kegs sent back', G.wasted]]);
      kpis('kBottom', [['Biggest crowd in a week', peak(demand)], ['Smallest crowd in a week', Math.min.apply(null, demand)], ['Largest order by the brewery', peak(col(3, 'order'))]]);
      lineChart($('cMineStock'), [{ key: 'pub', label: 'Cellar', vals: myStock }], n, 0, nice(Math.max(CAP, peak(myStock)), 4));
    } else {
      const myNet = col(0, 'net');
      kpis('kTop', [['Your total cost', money(G.pos[0].cost)], ['Most customers ever wanted in a week', peak(demand)], ['Most you ordered in a week', peak(myOrders)]]);
      kpis('kBottom', [['Largest order by the brewery', peak(col(3, 'order'))], ['Cost of the whole chain', money(G.pos.reduce(function (s, p) { return s + p.cost; }, 0))], ['Times customer demand changed', 1]]);
      const lo = Math.min(0, Math.min.apply(null, myNet)), hi = Math.max(12, Math.max.apply(null, myNet)), st = hi - lo > 50 ? 20 : 10;
      lineChart($('cMineStock'), [{ key: 'pub', label: 'Stock', vals: myNet }], n, Math.floor(lo / st) * st, nice(hi, st));
    }
    const said = $('why').value.trim();
    $('said').textContent = said || 'You left this blank.';
    drawChain(n);
  }
  function replay() {
    clearInterval(timer);
    let w = 1; drawChain(w); $('playBtn').textContent = 'Playing';
    timer = setInterval(function () {
      w += 1; drawChain(w);
      if (w >= CFG.weeksPlayed) { clearInterval(timer); $('playBtn').textContent = 'Play again'; }
    }, 520);
  }

  /* ---------- wiring ---------- */
  $('cMineOrders').setAttribute('data-label', 'Customer demand and your orders by week');
  $('cMineStock').setAttribute('data-label', 'Your stock by week');
  $('cChain').setAttribute('data-label', 'Orders placed each week by all four positions');
  $('startBtn').addEventListener('click', start);
  $('sendBtn').addEventListener('click', send);
  $('order').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  $('less').addEventListener('click', function () { $('order').value = Math.max(0, (parseInt($('order').value, 10) || 0) - 1); });
  $('more').addEventListener('click', function () { $('order').value = Math.min(99, (parseInt($('order').value, 10) || 0) + 1); });
  $('autoBtn').addEventListener('click', autoplay);
  $('seeBtn').addEventListener('click', results);
  $('playBtn').addEventListener('click', replay);
  $('scrub').addEventListener('input', function () { clearInterval(timer); $('playBtn').textContent = 'Play'; drawChain(parseInt($('scrub').value, 10)); });
  $('againBtn').addEventListener('click', start);
  $('homeBtn').addEventListener('click', home);
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      MODE = r.value; $('rulesPlain').hidden = MODE === 'wom'; $('rulesWom').hidden = MODE !== 'wom';
    });
  });
  $('tabPub').addEventListener('click', function () { tab(false); });
  $('tabChain').addEventListener('click', function () { tab(true); });
  try { if (localStorage.getItem('pubgame.tab') === 'chain') tab(true); } catch (e) {}
  try { const s = localStorage.getItem('pubgame.speed'); if (s != null) $('speed').value = s; } catch (e) {}
  $('speed').addEventListener('change', function () { try { localStorage.setItem('pubgame.speed', $('speed').value); } catch (e) {} });
})();

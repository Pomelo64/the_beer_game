/* Modelling-process record, ported from SFD Studio's process_log.py.

   Writes the same file format ("bluejay-modelling-process", version 1) with the
   same SHA-256 hash chain, so a record made here opens, verifies and replays in
   SFD Studio. The functions mirror the Python ones name for name; the order of
   changes, loops and questions follows the Python code exactly.

   Not ported: the HMAC chain. It needs a secret key, and a static page cannot
   keep one, so records made here always use the plain SHA-256 chain.

   The game adds one event kind of its own, "game" (the learner's week-by-week
   play). SFD Studio's verify accepts it and its replay passes over it. */
const ProcessLog = (function () {
  const FORMAT = 'bluejay-modelling-process', VERSION = 1, MAX_CYCLES = 400;
  const NODE_TYPES = [['stocks', 'stock'], ['auxiliaries', 'auxiliary']];
  const LAYOUT_ACTIONS = { tidy: 1, untangle: 1, merge: 1, unmerge: 1 };
  const AI_QUESTIONS = {
    ai_advice: 'What will you do with this advice — and why?',
    ai_equations: 'The AI drafted equations. Which will you keep, and how will you check them?'
  };

  /* ---------- SHA-256 (synchronous, so the record works the same in Node and the browser) ---------- */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(str) {
    const msg = new TextEncoder().encode(str), len = msg.length;
    const n = ((len + 9 + 63) >> 6) << 6, b = new Uint8Array(n);
    b.set(msg); b[len] = 0x80;
    const bits = len * 8;
    for (let i = 0; i < 8; i++) b[n - 1 - i] = Math.floor(bits / Math.pow(2, 8 * i)) & 0xff;
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const ror = function (x, k) { return (x >>> k) | (x << (32 - k)); };
    for (let off = 0; off < n; off += 64) {
      for (let t = 0; t < 16; t++) W[t] = (b[off + 4 * t] << 24) | (b[off + 4 * t + 1] << 16) | (b[off + 4 * t + 2] << 8) | b[off + 4 * t + 3];
      for (let t = 16; t < 64; t++) {
        const s0 = ror(W[t - 15], 7) ^ ror(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = ror(W[t - 2], 17) ^ ror(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25), ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    let out = '';
    for (let i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }

  /* ---------- canonical JSON, as Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) ---------- */
  function pyFloat(x) {               // Python's repr of a float
    if (!isFinite(x)) return x > 0 ? 'Infinity' : x < 0 ? '-Infinity' : 'NaN';
    const m = x.toExponential().match(/^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/);
    const sign = m[1], digits = m[2] + (m[3] || ''), exp = parseInt(m[4], 10);
    if (exp < -4 || exp >= 16) {
      const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
      return sign + mant + 'e' + (exp < 0 ? '-' : '+') + ('0' + Math.abs(exp)).slice(-2).replace(/^0(\d\d)/, '$1');
    }
    if (exp < 0) return sign + '0.' + '0'.repeat(-exp - 1) + digits;
    if (digits.length <= exp + 1) return sign + digits + '0'.repeat(exp + 1 - digits.length) + '.0';
    return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  }
  function canon(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e21 ? String(v) : pyFloat(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    const keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }

  const header = function (rec) { const h = {}; Object.keys(rec).forEach(function (k) { if (k !== 'events') h[k] = rec[k]; }); return h; };
  const digest = function (prev, payload) { return sha256(prev + canon(payload)); };
  const genesis = function (rec) { return sha256(canon(header(rec))); };
  const iso = function (ms) { return new Date(ms).toISOString().slice(0, 19) + 'Z'; };
  const plain = function (x) { return JSON.parse(JSON.stringify(x)); };
  let clock = function () { return Date.now(); };   // replaceable in tests

  /* ---------- record ---------- */
  function emptyDiagram() { return { stocks: [], auxiliaries: [], clouds: [], flows: [], connectors: [], junctions: [] }; }
  function newRecord(app) {
    const rec = { format: FORMAT, version: VERSION, app: app || 'SFD Studio', started: iso(clock()), chain: 'sha256', events: [] };
    append(rec, { kind: 'start', snapshot: { diagram: emptyDiagram(), equations: {} } });
    return rec;
  }
  function append(rec, event) {
    const evs = rec.events, prev = evs.length ? evs[evs.length - 1].hash : genesis(rec);
    const now = clock(), started = Date.parse(rec.started);
    const ev = { i: evs.length, t: iso(now), s: Math.round((now - started) / 100) / 10 };
    Object.keys(event).forEach(function (k) { ev[k] = event[k]; });
    ev.prev = prev;
    const clean = plain(ev);
    clean.hash = digest(prev, clean);
    evs.push(clean);
    return clean;
  }
  function lastSnapshot(rec) {
    for (let k = rec.events.length - 1; k >= 0; k--) if (rec.events[k].snapshot) return rec.events[k].snapshot;
    return { diagram: emptyDiagram(), equations: {} };
  }
  function cleanDiagram(d) {
    d = d || {}; const out = emptyDiagram();
    Object.keys(out).forEach(function (k) { out[k] = plain(d[k] || []); });
    return out;
  }

  /* ---------- reading a diagram structurally (labels are the identities) ---------- */
  const T = function (a, b) { return JSON.stringify([a, b]); };          // a tuple as a map key
  const U = function (k) { return JSON.parse(k); };
  function cmp(a, b) {                                                     // Python's ordering of str tuples
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      if (a[i] === null) return -1; if (b[i] === null) return 1;
      return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
  }
  const sortedKeys = function (m) { return Array.from(m.keys()).map(U).sort(cmp); };
  const get = function (o, k, dflt) { return o && o[k] !== undefined && o[k] !== null ? o[k] : dflt; };

  function structure(d) {
    const nodes = new Map();                                               // (type, label) -> [x, y]
    NODE_TYPES.forEach(function (gt) {
      (d[gt[0]] || []).forEach(function (el) { nodes.set(T(gt[1], get(el, 'label', '')), [get(el, 'x', 0), get(el, 'y', 0)]); });
    });
    const flows = new Map();
    (d.flows || []).forEach(function (f) { flows.set(get(f, 'label', ''), [f.from === undefined ? null : f.from, f.to === undefined ? null : f.to]); });
    const junctions = new Set((d.junctions || []).map(function (j) { return j.label; }));
    const conns = d.connectors || [], links = new Map();
    conns.forEach(function (c) {
      const a = c.from, b = c.to;
      if (junctions.has(a) || junctions.has(b) || a == null || b == null) return;
      links.set(T(a, b), 1);
    });
    junctions.forEach(function (j) {
      const srcs = conns.filter(function (c) { return c.to === j; }).map(function (c) { return c.from; });
      const tgts = conns.filter(function (c) { return c.from === j; }).map(function (c) { return c.to; });
      srcs.forEach(function (a) { tgts.forEach(function (b) { if (!junctions.has(a) && !junctions.has(b)) links.set(T(a, b), 1); }); });
    });
    return { nodes: nodes, flows: flows, links: links, clouds: (d.clouds || []).length };
  }

  function renameMap(old, nw) {
    const o = structure(old), n = structure(nw), ren = new Map();
    ['stock', 'auxiliary'].forEach(function (typ) {
      const gone = [], came = [];
      o.nodes.forEach(function (v, k) { const t = U(k); if (t[0] === typ && !n.nodes.has(k)) gone.push([t, v]); });
      n.nodes.forEach(function (v, k) { const t = U(k); if (t[0] === typ && !o.nodes.has(k)) came.push([t, v]); });
      gone.forEach(function (g) {
        for (let j = 0; j < came.length; j++) {
          if (Math.abs(g[1][0] - came[j][1][0]) <= 3 && Math.abs(g[1][1] - came[j][1][1]) <= 3) {
            ren.set(g[0][1], came[j][0][1]); came.splice(j, 1); break;
          }
        }
      });
    });
    const m = function (x) { return ren.has(x) ? ren.get(x) : x; };
    const gone = [], came = [];
    o.flows.forEach(function (ends, k) { if (!n.flows.has(k)) gone.push([k, [m(ends[0]), m(ends[1])]]); });
    n.flows.forEach(function (ends, k) { if (!o.flows.has(k)) came.push([k, ends]); });
    gone.forEach(function (g) {
      for (let j = 0; j < came.length; j++) {
        if (came[j][1][0] === g[1][0] && came[j][1][1] === g[1][1]) { ren.set(g[0], came[j][0]); came.splice(j, 1); break; }
      }
    });
    return ren;
  }

  function graph(d) {
    const s = structure(d), g = new Map();
    const add = function (a, b) { if (!g.has(a)) g.set(a, new Set()); g.get(a).add(b); };
    s.links.forEach(function (_, k) { const ab = U(k); add(ab[0], ab[1]); });
    const stocks = new Set();
    s.nodes.forEach(function (_, k) { const t = U(k); if (t[0] === 'stock') stocks.add(t[1]); });
    s.flows.forEach(function (ends, f) { ends.forEach(function (x) { if (stocks.has(x)) add(f, x); }); });
    return g;
  }

  function cycles(d) {
    const g = graph(d), all = new Set(g.keys());
    g.forEach(function (vs) { vs.forEach(function (v) { all.add(v); }); });
    const order = Array.from(all).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    const rank = new Map(order.map(function (x, i) { return [x, i]; }));
    const found = []; let budget = 50000;
    order.forEach(function (s) {
      const stack = [[s, [s]]];
      while (stack.length && found.length < MAX_CYCLES && budget > 0) {
        budget -= 1;
        const top = stack.pop(), node = top[0], path = top[1];
        const next = Array.from(g.get(node) || []).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
        next.forEach(function (nx) {
          if (nx === s) found.push(path.slice());
          else if ((rank.has(nx) ? rank.get(nx) : -1) > rank.get(s) && path.indexOf(nx) < 0) stack.push([nx, path.concat([nx])]);
        });
      }
    });
    return found;
  }
  function rotate(c) { let i = 0; c.forEach(function (x, k) { if (x < c[i]) i = k; }); return c.slice(i).concat(c.slice(0, i)); }

  function eqView(eqs) {
    const out = {};
    Object.keys(eqs || {}).forEach(function (lbl) {
      const r = eqs[lbl]; let net = null, v;
      if (r.kind === 'stock') { v = String(r.initial || '').trim(); if (r.confirmed) net = String(r.net_flow || '0').trim(); }
      else { v = String(r.formula || '').trim(); if (r.lookup && !v) v = '(lookup table)'; }
      out[lbl] = { value: v, net: net, ok: !!r.confirmed, kind: r.kind };
    });
    return out;
  }

  /* Changes from snapshot old to new ({diagram, equations}), and the feedback loops that closed. */
  function diff(old, nw) {
    const od = old.diagram || emptyDiagram(), nd = nw.diagram || emptyDiagram();
    const ren = renameMap(od, nd), m = function (x) { return ren.has(x) ? ren.get(x) : x; };
    const O = structure(od), N = structure(nd);
    const on = new Map(); O.nodes.forEach(function (v, k) { const t = U(k); on.set(T(t[0], m(t[1])), v); });
    const of = new Map(); O.flows.forEach(function (e, k) { of.set(m(k), [m(e[0]), m(e[1])]); });
    const ol = new Map(); O.links.forEach(function (_, k) { const ab = U(k); ol.set(T(m(ab[0]), m(ab[1])), 1); });
    const nn = N.nodes, nf = N.flows, nl = N.links;
    const ch = [];
    ren.forEach(function (n, o) {
      let typ = 'flow';
      for (const k of nn.keys()) { const t = U(k); if (t[1] === n) { typ = t[0]; break; } }
      ch.push({ op: 'rename', what: typ, old: o, new: n });
    });
    sortedKeys(nn).forEach(function (t) { if (!on.has(T(t[0], t[1]))) ch.push({ op: 'add', what: t[0], name: t[1] }); });
    Array.from(nf.keys()).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).forEach(function (f) {
      const e = nf.get(f);
      if (!of.has(f)) ch.push({ op: 'add', what: 'flow', name: f, from: e[0], to: e[1] });
      else if (of.get(f)[0] !== e[0] || of.get(f)[1] !== e[1]) ch.push({ op: 'reconnect', what: 'flow', name: f, old: of.get(f).slice(), new: e.slice() });
    });
    sortedKeys(nl).forEach(function (ab) { if (!ol.has(T(ab[0], ab[1]))) ch.push({ op: 'add', what: 'link', from: ab[0], to: ab[1] }); });
    sortedKeys(on).forEach(function (t) { if (!nn.has(T(t[0], t[1]))) ch.push({ op: 'remove', what: t[0], name: t[1] }); });
    Array.from(of.keys()).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).forEach(function (f) { if (!nf.has(f)) ch.push({ op: 'remove', what: 'flow', name: f }); });
    sortedKeys(ol).forEach(function (ab) { if (!nl.has(T(ab[0], ab[1]))) ch.push({ op: 'remove', what: 'link', from: ab[0], to: ab[1] }); });
    if (N.clouds !== O.clouds) ch.push({ op: N.clouds > O.clouds ? 'add' : 'remove', what: 'cloud', n: Math.abs(N.clouds - O.clouds) });

    // equations (the game's exercise has none, but keep the Python behaviour)
    const oe = {}; const ov = eqView(old.equations); Object.keys(ov).forEach(function (k) { oe[m(k)] = ov[k]; });
    const ne = eqView(nw.equations), confirmed = [], renamedTo = new Set(ren.values());
    Object.keys(ne).sort().forEach(function (lbl) {
      const n = ne[lbl], o = oe[lbl];
      if (!o) { if (n.value) ch.push({ op: 'eq_set', name: lbl, new: n.value }); if (n.ok) confirmed.push(lbl); return; }
      if (o.value !== n.value) {
        if (!o.value) ch.push({ op: 'eq_set', name: lbl, new: n.value });
        else if (!n.value) { if (!renamedTo.has(lbl)) ch.push({ op: 'eq_clear', name: lbl, old: o.value }); }
        else ch.push({ op: 'eq_change', name: lbl, old: o.value, new: n.value });
      }
      if (o.net !== null && n.net !== null && o.net !== n.net) ch.push({ op: 'eq_change', name: lbl + ' (net flow)', old: o.net, new: n.net });
      if (n.ok && !o.ok) confirmed.push(lbl);
    });
    if (confirmed.length) ch.push({ op: 'eq_confirm', names: confirmed });

    const oldLoops = new Set(cycles(od).map(function (c) { return JSON.stringify(rotate(c.map(m))); }));
    const loops = cycles(nd).filter(function (c) { return !oldLoops.has(JSON.stringify(c)); });
    return { changes: ch, loops: loops };
  }

  /* ---------- the key-moment question ---------- */
  const loopText = function (c) { return c.concat([c[0]]).join(' → '); };
  function names(items) {
    items = items.map(function (x) { return '**' + x + '**'; });
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function keyQuestion(changes, loops, cause) {
    if (cause === 'import') return 'You imported a model. Where does it come from, and what will you do with it?';
    if (cause === 'ai_equations') return null;
    const removed = changes.filter(function (c) { return c.op === 'remove' && c.what !== 'cloud'; });
    if (removed.length) {
      const main = removed.filter(function (c) { return c.what !== 'link'; });
      let what;
      if (main.length) {
        const pri = { stock: 0, flow: 1, auxiliary: 2 };
        main.sort(function (a, b) { return (pri[a.what] === undefined ? 9 : pri[a.what]) - (pri[b.what] === undefined ? 9 : pri[b.what]); });
        what = 'the ' + main[0].what + ' **' + main[0].name + '**';
        if (main.length > 1) what = names(main.map(function (c) { return c.name; }));
      } else {
        what = removed.length === 1 ? 'the link **' + removed[0].from + '** → **' + removed[0].to + '**' : removed.length + ' links';
      }
      return 'You removed ' + what + '. Why?';
    }
    if (loops.length) return 'You closed a feedback loop: ' + loopText(loops[0]) + '. What does this loop do in your system?';
    const changed = changes.filter(function (c) { return c.op === 'eq_change' || c.op === 'eq_clear'; });
    if (changed.length) return 'You changed the equation of **' + changed[0].name + '**. What made you change it?';
    return null;
  }

  /* ---------- recording ---------- */
  function layoutSig(d) {
    const s = function (a) { return a.map(function (x) { return JSON.stringify(x); }).sort(); };
    const nodes = []; ['stocks', 'auxiliaries', 'junctions'].forEach(function (grp) { (d[grp] || []).forEach(function (e) { nodes.push([grp, String(e.label), e.x, e.y]); }); });
    const clouds = (d.clouds || []).map(function (c) { return [c.x, c.y]; });
    const conns = (d.connectors || []).map(function (c) { return [String(c.from), String(c.to), !!c.trunk, (c.waypoints || []).map(function (w) { return [w.x, w.y]; })]; });
    const valves = (d.flows || []).map(function (f) { return [String(f.label), f.valve_xy || []]; });
    return JSON.stringify([s(nodes), s(clouds), s(conns), s(valves)]);
  }
  /* Compare the current model with the last snapshot; record a step if the structure
     changed, or a layout moment if only the drawing moved. Returns the new event, or null. */
  function observe(rec, diagram, equations, cause, action) {
    const snap = { diagram: cleanDiagram(diagram), equations: plain(equations || {}) };
    const last = lastSnapshot(rec), d = diff(last, snap);
    if (!d.changes.length) {
      if (layoutSig(last.diagram || {}) === layoutSig(snap.diagram)) return null;
      const tail = rec.events[rec.events.length - 1];
      if (!LAYOUT_ACTIONS[action] && tail && tail.kind === 'layout' && !tail.action) rec.events.pop();
      const ev = { kind: 'layout', snapshot: snap };
      if (LAYOUT_ACTIONS[action]) ev.action = action;
      return append(rec, ev);
    }
    const ev = { kind: 'step', changes: d.changes, snapshot: snap };
    if (d.loops.length) ev.loops = d.loops.slice(0, 10);
    if (cause) ev.cause = cause;
    const q = keyQuestion(d.changes, d.loops, cause);
    if (q) ev.question = q;
    return append(rec, ev);
  }
  function addAi(rec, kind, cfg, asked, answer) {
    return append(rec, { kind: kind, ai: cfg ? { provider: cfg.provider, model: cfg.model } : { provider: 'offline', model: 'offline review' },
      asked: asked, answer: answer, question: AI_QUESTIONS[kind] });
  }
  function addNote(rec, about, text) { return append(rec, { kind: 'note', about: about | 0, text: String(text).trim() }); }
  function addName(rec, name) { return append(rec, { kind: 'name', name: String(name).trim() }); }
  function addEvent(rec, event) { return append(rec, event); }

  /* ---------- verifying (the plain chain only) ---------- */
  function verify(rec) {
    if (!rec || rec.format !== FORMAT) return ['invalid', 'This is not a BlueJay modelling-process file.'];
    if (rec.chain !== 'sha256') return ['unverifiable', 'Only the plain SHA-256 chain can be checked here.'];
    let prev = genesis(rec), lastT = null;
    for (let n = 0; n < rec.events.length; n++) {
      const ev = rec.events[n], body = {};
      Object.keys(ev).forEach(function (k) { if (k !== 'hash') body[k] = ev[k]; });
      if (ev.i !== n || ev.prev !== prev || digest(prev, body) !== ev.hash) return ['broken', 'The record was changed after it was written (at event ' + (n + 1) + ').'];
      const t = Date.parse(ev.t);
      if (lastT !== null && t < lastT) return ['broken', 'The times run backwards at event ' + (n + 1) + '.'];
      lastT = t; prev = ev.hash;
    }
    return ['ok', 'Record intact — ' + rec.events.length + ' events, hash chain intact (detects edits made by hand).'];
  }
  function dumps(rec) { return JSON.stringify(rec, null, 1); }

  return { newRecord: newRecord, observe: observe, addAi: addAi, addNote: addNote, addName: addName, addEvent: addEvent,
           diff: diff, cycles: cycles, keyQuestion: keyQuestion, verify: verify, dumps: dumps, lastSnapshot: lastSnapshot,
           sha256: sha256, canon: canon, pyFloat: pyFloat, AI_QUESTIONS: AI_QUESTIONS,
           _setClock: function (f) { clock = f; } };
})();
if (typeof module !== 'undefined') module.exports = ProcessLog;

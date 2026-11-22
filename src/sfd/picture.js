/* A read-only picture of the learner's own diagram, in their own layout, for the
   feedback slides: zoomed to a problem with the rest faded, or the whole diagram.

   Picture.svg(d, opts) -> an <svg> string
     opts.focus     labels to show at full strength (the rest is faded); none -> nothing faded
     opts.whole     show the whole diagram instead of zooming to the focus
     opts.bad       links to show as wrong (red, dashed, crossed)
     opts.badFlows  flows to show as wrong (red pipe)
     opts.good      links that already work (green)
     opts.ghost     links to draw as the answer (green, dashed); shown only with opts.showGhost
     opts.notes     [{at: label, text}] short questions beside an element
     opts.tags      {label: text} a tag under each element (the mapping slide)
     opts.extras    labels tagged as extras
   Colours come from the page's variables, so the picture follows light and dark. */
const Picture = (function () {
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const C = { ink: 'var(--fg)', quiet: 'var(--muted)', line: 'var(--muted)', bg: 'var(--surface)', bad: 'var(--owed)', good: 'var(--hold)' };
  const FADE = 0.16;
  let SC = 1;   // scale of boxes and words, set for each picture
  const stockW = function (l) { return Math.max(92, Math.round(String(l).replace(/\u200B/g, '').length * 7.4 + 26)) * SC; };

  function layout(d) {
    const P = {}, K = {};
    (d.stocks || []).forEach(function (s) { P[s.label] = [s.x || 0, s.y || 0]; K[s.label] = 'stock'; });
    (d.auxiliaries || []).forEach(function (a) { P[a.label] = [a.x || 0, a.y || 0]; K[a.label] = 'aux'; });
    (d.junctions || []).forEach(function (j) { P[j.label] = [j.x || 0, j.y || 0]; K[j.label] = 'junction'; });
    (d.flows || []).forEach(function (f, i) {
      const a = f.from_xy || P[f.from] || [0, 0], b = f.to_xy || P[f.to] || [a[0] + 120, a[1]];
      f._a = a; f._b = b; f._v = f.valve_xy || [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      P[f.label] = f._v; K[f.label] = 'flow';
    });
    return { P: P, K: K };
  }
  // where a link leaves or meets an element: short of its centre
  function trim(p, q, kind, label, fromEnd) {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    let r = 10;
    if (kind === 'stock') { const w = stockW(label) / 2, h = 21 * SC; r = Math.min(Math.abs(ux) > 1e-6 ? w / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? h / Math.abs(uy) : 1e9) + 3; }
    else if (kind === 'junction') r = 3;
    else if (kind === 'flow') r = 12;
    else if (kind === 'aux') r = 11;
    return [p[0] + ux * r, p[1] + uy * r];
  }

  function svg(d, o) {
    o = o || {}; d = JSON.parse(JSON.stringify(d || {}));   // never touch the learner's diagram
    SC = 1;
    const L = layout(d), P = L.P, K = L.K;
    const focus = new Set(o.focus || []), dim = focus.size > 0;
    const on = function (l) { return !dim || focus.has(l); };
    const key = function (l) { return l.from + '\u0000' + l.to; };
    const badL = new Set((o.bad || []).map(key)), goodL = new Set((o.good || []).map(key)), badF = new Set(o.badFlows || []);
    const ghosts = o.showGhost ? (o.ghost || []) : [];
    // the frame: the whole diagram, or the focus and what is drawn on it
    const pts = [];
    const addEl = function (l) {
      if (!P[l]) return;
      const p = P[l], hw = K[l] === 'stock' ? stockW(l) / 2 : 60;
      pts.push([p[0] - hw, p[1] - 26], [p[0] + hw, p[1] + 40]);
    };
    const whole = o.whole || !dim;
    if (whole) {
      Object.keys(P).forEach(addEl);
      (d.flows || []).forEach(function (f) { pts.push(f._a, f._b); });
      (d.clouds || []).forEach(function (c) { pts.push([c.x - 20, c.y - 14], [c.x + 20, c.y + 14]); });
    } else {
      focus.forEach(addEl);
      (o.bad || []).concat(o.good || [], o.ghost || []).forEach(function (l) { addEl(l.from); addEl(l.to); });
      (d.flows || []).forEach(function (f) { if (focus.has(f.label)) { pts.push(f._a, f._b); } });
    }
    const seen = {};
    (o.notes || []).forEach(function (n) { if (!n || !P[n.at]) return; const i = seen[n.at] = (seen[n.at] || 0) + 1;
      pts.push([P[n.at][0] - n.text.length * 4.5, P[n.at][1] - 56 - (i - 1) * 24]); pts.push([P[n.at][0] + n.text.length * 4.5, P[n.at][1]]); });
    Object.keys(o.tags || {}).concat(o.extras || []).forEach(function (l) { if (P[l]) pts.push([P[l][0], P[l][1] + 62]); });
    if (!pts.length) pts.push([0, 0], [400, 240]);
    let x0 = Math.min.apply(null, pts.map(function (p) { return p[0]; })) - 36, x1 = Math.max.apply(null, pts.map(function (p) { return p[0]; })) + 36;
    let y0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })) - 30, y1 = Math.max.apply(null, pts.map(function (p) { return p[1]; })) + 24;
    const minW = 640, minH = 330;
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
    if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
    const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
    const k = Math.max(1, Math.min(1.7, W / 820));   // a large frame is shown smaller: keep its words readable
    const fs = function (n) { return (n * k).toFixed(1) + 'px'; };
    SC = k;
    const parts = { pipes: '', links: '', nodes: '', labels: '', notes: '' };
    const markers = '<defs>' + [['n', C.line], ['r', C.bad], ['g', C.good]].map(function (m) {
      return '<marker id="pk-' + m[0] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" style="fill:' + m[1] + '"/></marker>';
    }).join('') + '</defs>';

    // flows: a double pipe and a valve
    (d.flows || []).forEach(function (f) {
      const a = f._a, b = f._b, v = f._v, bad = badF.has(f.label), op = on(f.label) || bad ? 1 : FADE;
      const col = bad ? C.bad : C.line;
      // two straight segments meeting at the valve, as on the canvas (an L-shaped flow is a valve at the corner)
      const pts = a[0] + ',' + a[1] + ' ' + v[0] + ',' + v[1] + ' ' + b[0] + ',' + b[1];
      parts.pipes += '<g opacity="' + op + '"><polyline points="' + pts + '" style="fill:none;stroke-linejoin:round;stroke:' + col + ';stroke-width:' + (bad ? 8 : 7) + '"/>' +
        '<polyline points="' + pts + '" style="fill:none;stroke-linejoin:round;stroke:' + C.bg + ';stroke-width:3"/>' +
        (isEnd(f.to) ? cloud(b) : '') + (isEnd(f.from) ? cloud(a) : '') +
        '<path d="M' + (v[0] - 10) + ' ' + v[1] + 'L' + v[0] + ' ' + (v[1] - 10) + 'L' + (v[0] + 10) + ' ' + v[1] + 'L' + v[0] + ' ' + (v[1] + 10) + 'z" style="fill:' + C.bg + ';stroke:' + col + ';stroke-width:' + (bad ? 2.5 : 1.5) + '"/>' +
        (bad ? cross(v[0] + 16, v[1] - 16) : '') + '</g>';
      parts.labels += '<g opacity="' + op + '">' +
        '<text x="' + v[0] + '" y="' + (v[1] + 27) + '" text-anchor="middle" style="fill:' + (bad ? C.bad : C.ink) + ';font-size:' + fs(13) + ';font-weight:' + (bad ? 700 : 400) + ';paint-order:stroke;stroke:' + C.bg + ';stroke-width:4px">' + esc(f.label) + '</text>' + '</g>';
    });
    function isEnd(x) { return x == null || x === 'cloud'; }
    function cloud(p) { return '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="18" ry="12" style="fill:' + C.bg + ';stroke:' + C.line + ';stroke-width:1.3"/>'; }
    function cross(x, y) { return '<path d="M' + (x - 6) + ' ' + (y - 6) + 'L' + (x + 6) + ' ' + (y + 6) + 'M' + (x + 6) + ' ' + (y - 6) + 'L' + (x - 6) + ' ' + (y + 6) + '" style="stroke:' + C.bad + ';stroke-width:2.5"/>'; }

    // links: a gentle curve from source to target
    function link(l, kind) {
      const a0 = P[l.from], b0 = P[l.to]; if (!a0 || !b0) return '';
      const wps = (l.waypoints || []).map(function (w) { return [w.x, w.y]; });
      const nextA = wps.length ? wps[0] : b0, prevB = wps.length ? wps[wps.length - 1] : a0;
      const a = trim(a0, nextA, K[l.from], l.from), b = trim(b0, prevB, K[l.to], l.to);
      let path;
      if (wps.length) path = 'M' + a[0] + ' ' + a[1] + wps.map(function (w) { return 'L' + w[0] + ' ' + w[1]; }).join('') + 'L' + b[0] + ' ' + b[1];
      else { const mx = (a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.14, my = (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.14; path = 'M' + a[0] + ' ' + a[1] + 'Q' + mx + ' ' + my + ' ' + b[0] + ' ' + b[1]; }
      const style = kind === 'bad' ? 'stroke:' + C.bad + ';stroke-width:2.6;stroke-dasharray:7 5'
        : kind === 'good' ? 'stroke:' + C.good + ';stroke-width:2.6'
          : kind === 'ghost' ? 'stroke:' + C.good + ';stroke-width:2.6;stroke-dasharray:3 6;opacity:.85'
            : 'stroke:' + C.line + ';stroke-width:1.3';
      const op = kind === 'normal' ? (on(l.from) && on(l.to) ? 1 : FADE) : 1;
      const mk = kind === 'bad' ? 'r' : kind === 'good' || kind === 'ghost' ? 'g' : 'n';
      const end = l.trunk ? '' : ' marker-end="url(#pk-' + mk + ')"';
      let s = '<path d="' + path + '" fill="none" opacity="' + op + '" style="' + style + '"' + end + '/>';
      if (kind === 'bad' && !wps.length) { const mx = (a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.07, my = (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.07; s += cross(mx, my); }
      if (kind === 'ghost') { const mx = (a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.07, my = (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.07; s += '<text x="' + (mx + 8) + '" y="' + (my - 8) + '" style="fill:' + C.good + ';font-size:' + fs(12.5) + ';font-weight:700;paint-order:stroke;stroke:' + C.bg + ';stroke-width:4px">answer</text>'; }
      return s;
    }
    (d.connectors || []).forEach(function (c) {
      const kind = badL.has(key(c)) ? 'bad' : goodL.has(key(c)) ? 'good' : 'normal';
      parts.links += link(c, kind);
    });
    ghosts.forEach(function (g) { parts.links += link(g, 'ghost'); });

    // stocks, auxiliaries, junctions
    const noted = {}; (o.notes || []).forEach(function (n) { if (n && n.at) noted[n.at] = true; });
    (d.stocks || []).forEach(function (s) {
      const w = stockW(s.label), hl = noted[s.label], op = on(s.label) ? 1 : FADE;
      parts.nodes += '<g opacity="' + op + '"><rect x="' + (s.x - w / 2) + '" y="' + (s.y - 21 * SC) + '" width="' + w + '" height="' + 42 * SC + '" rx="4" style="fill:' + C.bg + ';stroke:' + (hl ? C.bad : C.line) + ';stroke-width:' + (hl ? 2.6 : 1.4) + '"/>' +
        '<text x="' + s.x + '" y="' + (s.y + 5 * SC) + '" text-anchor="middle" style="fill:' + C.ink + ';font-size:' + fs(13) + ';font-weight:' + (hl ? 700 : 500) + '">' + esc(s.label) + '</text></g>';
    });
    (d.auxiliaries || []).forEach(function (a) {
      const op = on(a.label) ? 1 : FADE, hl = noted[a.label];
      parts.nodes += '<g opacity="' + op + '"><circle cx="' + a.x + '" cy="' + a.y + '" r="8" style="fill:' + C.bg + ';stroke:' + (hl ? C.bad : C.line) + ';stroke-width:' + (hl ? 2.4 : 1.4) + '"/>' +
        '<text x="' + a.x + '" y="' + (a.y + 26) + '" text-anchor="middle" style="fill:' + C.ink + ';font-size:' + fs(12.5) + ';paint-order:stroke;stroke:' + C.bg + ';stroke-width:4px">' + esc(a.label) + '</text></g>';
    });
    (d.junctions || []).forEach(function (j) { parts.nodes += '<circle cx="' + j.x + '" cy="' + j.y + '" r="2.5" opacity="' + (on(j.label) ? 1 : FADE) + '" style="fill:' + C.line + '"/>'; });
    (d.clouds || []).forEach(function (c) {
      const used = (d.flows || []).some(function (f) { return (f.from_xy && f.from_xy[0] === c.x && f.from_xy[1] === c.y) || (f.to_xy && f.to_xy[0] === c.x && f.to_xy[1] === c.y); });
      if (!used) parts.nodes += '<g opacity="' + (dim ? FADE : 1) + '">' + cloud([c.x, c.y]) + '</g>';
    });

    // notes and tags
    const boxes = [], stack = {};   // several notes on one element sit one above another
    (o.notes || []).forEach(function (n) {
      if (!n || !n.at || !P[n.at]) return;
      const i = stack[n.at] = (stack[n.at] || 0) + 1;
      const p = P[n.at], above = (K[n.at] === 'stock' ? 32 : K[n.at] === 'flow' ? 20 : 18) + (i - 1) * 19 * k;
      parts.notes += '<text x="' + p[0] + '" y="' + (p[1] - above) + '" text-anchor="middle" style="fill:' + C.bad + ';font-size:' + fs(13.5) + ';font-weight:700;paint-order:stroke;stroke:' + C.bg + ';stroke-width:5px">' + esc(n.text) + '</text>';
      boxes.push([p[0] - n.text.length * 4, p[1] - above - 16, p[0] + n.text.length * 4, p[1] - above + 4]);
    });
    const extras = new Set(o.extras || []);
    Object.keys(o.tags || {}).concat(Array.from(extras)).forEach(function (l) {
      if (!P[l]) return;
      const p = P[l], t = extras.has(l) ? 'extra' : o.tags[l], dy = (K[l] === 'stock' ? 38 : K[l] === 'flow' ? 46 : 44) * Math.min(k, 1.25);
      const w = (String(t).length * 6.6 + 16) * k;
      parts.notes += '<g><rect x="' + (p[0] - w / 2) + '" y="' + (p[1] + dy - 13 * k) + '" width="' + w + '" height="' + 19 * k + '" rx="' + 9.5 * k + '" style="fill:' + (extras.has(l) ? 'var(--sunk)' : C.good) + ';fill-opacity:' + (extras.has(l) ? 1 : 0.14) + '"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] + dy + 1) + '" text-anchor="middle" style="fill:' + (extras.has(l) ? C.quiet : C.good) + ';font-size:' + fs(11.5) + ';font-weight:600">' + esc(t) + '</text></g>';
      boxes.push([p[0] - w / 2, p[1] + dy - 13, p[0] + w / 2, p[1] + dy + 6]);
    });

    return '<svg class="pic" width="' + W + '" height="' + H + '" viewBox="' + Math.round(x0) + ' ' + Math.round(y0) + ' ' + W + ' ' + H + '" role="img" aria-label="Your diagram' + (whole ? '' : ', zoomed to the problem') + '" style="font-family:var(--font-body)">' + markers +
      '<rect x="' + Math.round(x0) + '" y="' + Math.round(y0) + '" width="' + W + '" height="' + H + '" style="fill:var(--sunk);fill-opacity:.45"/>' +
      parts.pipes + parts.links + parts.nodes + parts.labels + parts.notes + '</svg>';
  }
  return { svg: svg };
})();
if (typeof module !== 'undefined') module.exports = Picture;

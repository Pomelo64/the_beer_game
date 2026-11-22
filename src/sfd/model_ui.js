/* The modelling step: the learner draws a stock-and-flow diagram of the game on
   SFD Studio's canvas, the AI marks it against the answer key and answers
   questions about it, and every step is recorded in SFD Studio's process format.

   The canvas is SFD Studio's own page, unchanged apart from hiding its Edit mode
   (equations are not part of this exercise). It runs in a frame and talks to its
   host through the Streamlit component messages; this file answers those
   messages in Streamlit's place. */
const Model = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const PL = ProcessLog;
  const S = {
    game: null, mode: 'plain', key: null,    // the game being played, or last played
    n: 0, done: -1, finished: false, said: '', // its number in the session, the last week recorded, whether it has ended
    rec: null, loaded: false,                 // the process record (one for the session) and whether the canvas is loaded
    diagram: null,                            // the latest diagram from the canvas
    cfg: null, conn: null,                    // AI settings (kept in memory only) and the last test result
    marking: null, chat: [],                  // the last marking and the conversation since
    why: null,                                // { about: event index, q: question or null }
    busy: false
  };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const md = function (s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); };

  /* ---------- the canvas ---------- */
  function frame() { return $('canvasFrame'); }
  function loadCanvas() {
    S.diagram = null;
    frame().srcdoc = CANVAS_HTML;
  }
  window.addEventListener('message', function (e) {
    const f = frame();
    if (!f || e.source !== f.contentWindow) return;
    const d = e.data;
    if (!d || !d.isStreamlitMessage) return;
    if (d.type === 'streamlit:componentReady') {      // an imported diagram waits in S.pendingInitial
      f.contentWindow.postMessage({ type: 'streamlit:render', args: { initial: S.pendingInitial || {}, confirmed: [] } }, '*');
      S.pendingInitial = null;
    } else if (d.type === 'streamlit:setFrameHeight' && d.height) f.style.height = Math.max(380, Math.ceil(d.height)) + 'px';
    else if (d.type === 'streamlit:setComponentValue' && d.value) fromCanvas(d.value);
  });
  function fromCanvas(v) {
    if (v.event === 'svg') { download('my-model.svg', v.svg, 'image/svg+xml'); return; }
    if (v.event !== 'change') return;             // edit requests belong to Edit mode, which is hidden
    const action = v.action || null, dg = {};
    ['stocks', 'auxiliaries', 'clouds', 'flows', 'connectors', 'junctions'].forEach(function (k) { dg[k] = v[k] || []; });
    S.diagram = dg;
    if (!S.rec) return;
    const ev = PL.observe(S.rec, dg, {}, null, action);
    if (ev && ev.kind === 'step') askWhy(ev.i, ev.question || null);
    drawRecord();
  }

  /* ---------- importing a diagram ----------
     A diagram saved from this page or from SFD Studio (my-model.json), or a modelling
     record, from which the last diagram is taken. The canvas is reloaded with it, the way
     SFD Studio hands a saved diagram to its canvas, and the record gets an "import" step. */
  function importMsg(t) { $('importMsg').textContent = t; }
  function hasDrawing(d) { return !!d && ((d.stocks || []).length + (d.auxiliaries || []).length + (d.flows || []).length) > 0; }
  function importDiagram(file) {
    const rd = new FileReader();
    rd.onerror = function () { importMsg('The file could not be read.'); };
    rd.onload = function () {
      let o;
      try { o = JSON.parse(rd.result); } catch (e) { importMsg('"' + file.name + '" is not a JSON file.'); return; }
      if (o && o.format === 'bluejay-modelling-process') {
        const ev = (o.events || []).filter(function (e) { return e && e.snapshot && e.snapshot.diagram; }).pop();
        o = ev ? ev.snapshot.diagram : null;
      }
      if (!o || typeof o !== 'object' || !(Array.isArray(o.stocks) || Array.isArray(o.auxiliaries))) {
        importMsg('"' + file.name + '" does not hold a stock-and-flow diagram saved from this page or from SFD Studio.'); return;
      }
      const dg = {};
      ['stocks', 'auxiliaries', 'clouds', 'flows', 'connectors', 'junctions'].forEach(function (k) { dg[k] = Array.isArray(o[k]) ? o[k] : []; });
      if (!dg.stocks.length && !dg.auxiliaries.length) { importMsg('The diagram in "' + file.name + '" is empty.'); return; }
      if (hasDrawing(S.diagram) && !window.confirm('Replace the diagram on the canvas with "' + file.name + '"? Your current diagram stays in your modelling record.')) return;
      S.diagram = dg; S.pendingInitial = dg;
      frame().srcdoc = CANVAS_HTML;                 // the canvas restarts and draws it
      if (S.rec) {
        const ev = PL.observe(S.rec, dg, {}, 'import', null);
        if (ev && ev.kind === 'step') askWhy(ev.i, ev.question || null);
        drawRecord();
      }
      importMsg('Imported "' + file.name + '": ' + dg.stocks.length + ' stocks, ' + dg.flows.length + ' flows, ' + dg.auxiliaries.length + ' auxiliaries.');
    };
    rd.readAsText(file);
  }

  /* ---------- reasons ---------- */
  function askWhy(about, question) {
    S.why = { about: about, q: question };
    $('whyQ').innerHTML = question ? md(question) : 'Your last move: why? <span class="muted">(optional)</span>';
    $('whyRow').classList.toggle('asking', !!question);
    $('whyIn').value = '';
  }
  function saveWhy() {
    const t = $('whyIn').value.trim();
    if (!t || !S.rec || !S.why) return;
    PL.addNote(S.rec, S.why.about, t);
    $('whyIn').value = '';
    $('whyQ').innerHTML = 'Saved. <span class="muted">Carry on modelling.</span>';
    $('whyRow').classList.remove('asking');
    S.why = null; drawRecord();
  }

  /* ---------- describing the diagram, the key and the game to the AI ---------- */
  function diagramText(d) {
    if (!d) return '(The learner has not drawn anything yet.)';
    const L = [], J = new Set((d.junctions || []).map(function (j) { return j.label; }));
    L.push('STOCKS: ' + ((d.stocks || []).map(function (s) { return s.label; }).join('; ') || 'none'));
    L.push('FLOWS (name: from -> to; "cloud" is a source or sink): ' + ((d.flows || []).map(function (f) { return f.label + ': ' + (f.from || '(unattached)') + ' -> ' + (f.to || '(unattached)'); }).join('; ') || 'none'));
    L.push('AUXILIARIES: ' + ((d.auxiliaries || []).map(function (a) { return a.label; }).join('; ') || 'none'));
    const links = [];
    (d.connectors || []).forEach(function (c) {
      if (J.has(c.from) || J.has(c.to)) return;
      links.push(c.from + ' -> ' + c.to);
    });
    J.forEach(function (j) {   // merged links: trunk -> junction -> forks
      const a = (d.connectors || []).filter(function (c) { return c.to === j; }).map(function (c) { return c.from; });
      const b = (d.connectors || []).filter(function (c) { return c.from === j; }).map(function (c) { return c.to; });
      a.forEach(function (x) { b.forEach(function (y) { links.push(x + ' -> ' + y); }); });
    });
    L.push('INFORMATION LINKS (from -> to; a link into a flow\'s name goes into its valve): ' + (links.join('; ') || 'none'));
    return L.join('\n');
  }
  /* The diagram as the reading call sees it: every stock, flow and auxiliary gets a
     number, and the AI answers with the numbers. Names are shown but never matched on,
     so a copied line, a reworded name or two elements with the same name cannot lose
     an element. d is the diagram after Marking.unique. */
  function elementList(d) {
    const ids = {}, num = {}, kind = {}; let n = 0;
    [['stocks', 'stock'], ['flows', 'flow'], ['auxiliaries', 'auxiliary']].forEach(function (k) {
      (d[k[0]] || []).forEach(function (e) { const id = 'E' + (++n); ids[id] = e.label; num[e.label] = id; kind[id] = k[1]; });
    });
    const B = Marking.base;
    const ref = function (l) { return l == null ? '(unattached)' : l === 'cloud' ? 'a cloud (outside the model)' : num[l] ? num[l] + ' "' + B(l) + '"' : '"' + B(l) + '"'; };
    const L = ['ELEMENTS'];
    Object.keys(ids).forEach(function (id) {
      const l = ids[id];
      if (kind[id] !== 'flow') { L.push(id + ' ' + kind[id] + ' "' + B(l) + '"'); return; }
      const f = d.flows.find(function (x) { return x.label === l; });
      L.push(id + ' flow "' + B(l) + '", from ' + ref(f.from) + ' to ' + ref(f.to));
    });
    const J = new Set((d.junctions || []).map(function (j) { return j.label; })), links = [];
    const addLink = function (a, b) { const t = ref(a) + ' -> ' + ref(b); if (links.indexOf(t) < 0) links.push(t); };
    (d.connectors || []).forEach(function (c) { if (!J.has(c.from) && !J.has(c.to)) addLink(c.from, c.to); });
    J.forEach(function (j) {   // merged links: trunk -> junction -> forks
      const a = (d.connectors || []).filter(function (c) { return c.to === j; }).map(function (c) { return c.from; });
      const b = (d.connectors || []).filter(function (c) { return c.from === j; }).map(function (c) { return c.to; });
      a.forEach(function (x) { b.forEach(function (y) { addLink(x, y); }); });
    });
    L.push('', 'INFORMATION LINKS (from -> to; a link into a flow goes into its valve)');
    L.push(links.length ? links.join('\n') : 'none');
    return { text: L.join('\n'), ids: ids };
  }
  function keyText(k) {
    return (k.game ? 'HOW THE GAME WORKS: ' + k.game + '\n' : '') + 'TASK GIVEN TO THE LEARNER: ' + k.task + '\nSCOPE: ' + k.scope +
      (k.reference ? '\n\nTHE REFERENCE DIAGRAM (the educator\'s own stock-and-flow diagram of the game; the key items below are taken from it)\n' + diagramText(k.reference) : '') +
      (k.inputs ? '\n\nOUTSIDE INPUTS IN THE REFERENCE: ' + k.inputs.join('; ') + '. A learner may model any of these instead of treating it as an input; that is not an error.' : '') +
      '\n\nKEY ITEMS (what to check):\n' +
      k.items.map(function (it) { return it.id + ' [' + it.kind + ', ' + it.level + '] ' + it.what + (it.names ? ' (names a learner might use: ' + it.names.join(', ') + ')' : ''); }).join('\n') +
      '\n\nACCEPTED VARIANTS:\n' + k.variants.map(function (v) { return '- ' + v; }).join('\n');
  }
  /* Only what the learner has seen: completed weeks, and while the game runs nothing
     from the distributor or brewery, which are hidden from the player. */
  function gameText() {
    const g = S.game, w = S.mode === 'wom';
    if (!g) return 'THE LEARNER\'S GAME: not started yet.';
    const upto = S.finished ? g.log.length - 1 : S.done;
    const rows = g.log.slice(0, upto + 1).map(function (r, k) {
      const me = r.pos[0], nxt = g.log[k + 1], sup = nxt ? nxt.pos[1] : null;
      return [r.week, me.asked, me.arrived, me.sent, w ? me.turned : me.owed, me.stock, me.order == null ? '' : me.order,
        sup ? sup.sent : '', sup ? sup.owed : ''].join(',');
    });
    return 'THE LEARNER\'S GAME (' + (w ? 'word of mouth' : 'the supply game') + ', the learner runs the pub). ' +
      (S.finished ? 'The game is over: ' + g.log.length + ' weeks played.'
        : 'The game is still being played: ' + (upto + 1) + ' week' + (upto === 0 ? '' : 's') + ' completed so far. The learner has not yet seen how the game ends, nor anything from the distributor or the brewery, which are hidden while they play. Do not guess at what comes next.') +
      '\nOne line a week:\nweek,customers,delivered to the pub,served,' + (w ? 'turned away' : 'left waiting') + ',cellar at end,pub ordered,wholesaler sent in answer,on back order with the wholesaler\n' +
      (rows.length ? rows.join('\n') : '(no week completed yet)') +
      (S.finished ? '\nLargest order placed by the brewery: ' + Math.max.apply(null, g.log.map(function (r) { return r.pos[3].order || 0; })) +
        '.\nWhat the learner wrote at the end, before seeing the results: ' + (S.said || '(nothing)') : '');
  }

  /* ---------- marking: rules (code) and two AI calls ----------
     Layer 1 and layer 3 are decided by the rules in marking.js. The AI maps the
     learner's elements to concepts (call 1) and words the slides (call 2). The
     wording cannot change a verdict; if it fails, the rules' own words are used. */
  const MAP_SYSTEM = [
    'You read a learner\'s stock-and-flow diagram of a pub supply game and say which CONCEPT of the game each of the learner\'s elements stands for.',
    'Judge by meaning and by the element\'s place in the structure (what a flow fills and empties, what a link informs), not by its name alone: learners use their own words.',
    'An element may stand for several concepts when it plays several roles (one flow out of the waiting customers can be both "serving on arrival" and "catching up"). A concept may be drawn as several elements (kegs on order as two stocks in a row).',
    'Map an element by the role it plays even if it is drawn as the wrong kind (a stock drawn as an auxiliary): the rules notice the kind themselves.',
    'An element that stands for no concept is an extra: give a short, neutral comment on it.',
    'You only map. Do not judge whether the diagram is right.',
    'Every element has a number (E1, E2, ...). Refer to elements only by their numbers. Two elements may have the same name: the numbers tell them apart, and so do a flow\'s ends.',
    'Answer for every element: each number appears exactly once, either in "elements" or in "extras".',
    'Reply ONLY with JSON, no markdown fences: {"elements": [{"id": "E1", "concepts": ["C1"], "reason": "<a few words>"}], "extras": [{"id": "E2", "comment": "<one short sentence>"}]}'
  ].join('\n');
  const WORD_SYSTEM = [
    'You write the feedback slides a beginner sees after their stock-and-flow diagram of a pub supply game has been checked. The verdicts come from fixed rules and are final: never contradict them, add problems, or call something fine that the rules say does not work.',
    'Voice: warm, encouraging and explanatory, in plain English for a beginner. Praise only what the rules confirm, and name it specifically. Frame each problem as the next thing to understand. Never use the word "wrong". Be honest about how far the learner is.',
    'Give hints, not answers: do not tell them which link or flow to add. You may use their own game weeks as evidence ("in week 9, 30 customers were waiting").',
    'Reply ONLY with JSON, no markdown fences: {"headline": "<one sentence>", "overall": "<2-4 sentences>", "slides": {"<mechanism id>": "<2-3 sentences: what the game does, where they met it in their own weeks if helpful, ending with the hint question>"}, "wrap": "<1-2 sentences: the single most useful next step>"}'
  ].join('\n');
  const ASK_SYSTEM = [
    'You are a teaching assistant in a system dynamics course. A learner is playing, or has played, a supply-chain game, draws a stock-and-flow diagram to explain it, and has had it checked. The check was made by fixed rules on top of your reading of their diagram. Now they ask you questions.',
    'Ground every answer in the reference diagram, the learner\'s current diagram, the check\'s results and the learner\'s own game record. Cite weeks of their game where that helps. If the game is still being played, use only the weeks given, and never tell them what the game will do next.',
    'Explain why each problem matters. Prefer a hint first; if the learner asks for the answer directly, you may give it.',
    'If the learner says their diagram was misread, take it seriously: say which element you read as what, and if they are right, tell them to check again after renaming or redrawing it so the reading is clear.',
    'If a question is not settled by the reference, say so plainly, and answer briefly from general system dynamics knowledge, marked as such.',
    'Keep answers short: at most about 150 words, plain English, no markdown headings.'
  ].join('\n');

  function conceptText() {
    return Marking.CONCEPTS.map(function (c) { return c.id + ' ' + c.name + ' [' + c.kind + ']: ' + c.what + ' (e.g. ' + c.names.join(', ') + ')'; }).join('\n');
  }
  /* The AI's reading, by element number. raws: one or more answers; a later answer only
     fills elements an earlier one left out. An entry that gives a name instead of a
     number is accepted when the name (or the part before ":" or "(") fits one element. */
  function cleanMap(raws, list) {
    const ids = new Set(Marking.CONCEPTS.map(function (c) { return c.id; }));
    const norm = function (t) { return Marking.base(String(t)).toLowerCase().replace(/\s+/g, ' ').trim(); };
    const idOf = function (x) {
      if (!x) return null;
      const t = String(x.id != null ? x.id : x.element != null ? x.element : '').trim(), m = t.match(/^E(\d+)\b/i);
      if (m && list.ids['E' + m[1]]) return 'E' + m[1];
      const tries = [t, t.split(':')[0], t.split('(')[0]].map(norm);
      for (let i = 0; i < tries.length; i++) {
        const hit = Object.keys(list.ids).filter(function (id) { return norm(list.ids[id]) === tries[i]; });
        if (hit.length === 1) return hit[0];
      }
      return null;
    };
    const got = {}, cons = {}, why = {}, note = {};
    raws.forEach(function (raw) {
      const fresh = {};
      (raw && Array.isArray(raw.elements) ? raw.elements : []).forEach(function (e) {
        const id = idOf(e); if (!id || (got[id] && !fresh[id])) return;
        const cs = (Array.isArray(e.concepts) ? e.concepts : []).filter(function (c) { return ids.has(c); });
        fresh[id] = got[id] = true;
        if (cs.length) { cons[id] = (cons[id] || []).concat(cs.filter(function (c) { return (cons[id] || []).indexOf(c) < 0; })); why[id] = e.reason || ''; }
      });
      (raw && Array.isArray(raw.extras) ? raw.extras : []).forEach(function (x) {
        const id = idOf(x); if (!id || (got[id] && !fresh[id])) return;
        fresh[id] = got[id] = true; if (!cons[id]) note[id] = x.comment || '';
      });
    });
    const map = {}, whyL = {}, extras = [], missing = [];
    Object.keys(list.ids).forEach(function (id) {
      const l = list.ids[id];
      if (!got[id]) missing.push(id);
      else if (cons[id]) { map[l] = cons[id]; whyL[l] = why[id]; }
      else extras.push({ element: l, comment: note[id] || '' });
    });
    return { map: map, why: whyL, extras: extras, missing: missing };
  }

  function progress(text) { $('markOut').innerHTML = '<p class="mark-busy" role="status"><span class="spin" aria-hidden="true"></span>' + text + '</p>'; }
  async function mark() {
    if (S.busy) return;
    if (!S.key) { showMarkMsg('The answer key for this game has not been written yet, so the diagram cannot be checked.'); return; }
    if (!S.cfg) { showMarkMsg('Add an AI key under <b>AI settings</b> first.'); openSettings(); return; }
    if (!S.diagram || !((S.diagram.stocks || []).length + (S.diagram.flows || []).length + (S.diagram.auxiliaries || []).length)) { showMarkMsg('Draw something first.'); return; }
    const d = Marking.unique(S.diagram), list = elementList(d), shown = Marking.shown;
    busy(true, 'mark');
    // layer 1: notation (code)
    const notation = Marking.notation(d);
    // layer 2: concepts (AI)
    progress('Reading your diagram…');
    const ask1 = 'HOW THE GAME WORKS\n' + S.key.game + '\n\nTHE TASK GIVEN TO THE LEARNER\n' + S.key.task +
      '\n\nCONCEPTS OF THE GAME\n' + conceptText() + '\n\nTHE LEARNER\'S DIAGRAM\n' + list.text;
    const r1 = await LLM.completeJson(S.cfg, MAP_SYSTEM, ask1 + '\n\nMap every element now.', 2500);
    if (r1[1]) { busy(false); showMarkMsg(esc(r1[1])); return; }
    const raws = [r1[0]];
    let mp = cleanMap(raws, list);
    if (mp.missing.length) {     // an element got no reading: ask once more for those
      progress('Reading the rest of your diagram…');
      const r1b = await LLM.completeJson(S.cfg, MAP_SYSTEM, ask1 + '\n\nYour first answer gave nothing for ' + mp.missing.join(', ') +
        '. Answer again for every element, by number.', 2500);
      if (!r1b[1]) { raws.push(r1b[0]); mp = cleanMap(raws, list); }
    }
    if (mp.missing.length) {     // never build verdicts on a gap
      busy(false);
      const names = mp.missing.map(function (id) { return '"' + shown(list.ids[id]) + '"'; });
      showMarkMsg('I could not read all of your diagram: ' + names.join(', ') + (names.length === 1 ? ' was' : ' were') + ' left out of my reading, so a check now would be built on a gap. ' +
        'Please press <b>Check my diagram</b> again. If it keeps happening, try another model under <b>AI settings</b>.');
      if (S.rec) PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Check my diagram.' }, { overall: 'The diagram could not be fully read, so no check was given.', unread: mp.missing.map(function (id) { return shown(list.ids[id]); }) });
      drawRecord();
      return;
    }
    // layer 3: mechanisms (code)
    progress('Checking how it works…');
    const mech = Marking.mechanisms(d, mp.map), M = mech.mechanisms;
    const sc = Marking.score(M), far = Marking.coreFound(mp.map) < 3;
    const fails = M.filter(function (m) { return !m.pass && m.weight !== 'optional'; })
      .sort(function (a, b) { return (a.weight === 'required' ? 0 : 1) - (b.weight === 'required' ? 0 : 1); });
    const prev = S.lastResult, now = {}; M.forEach(function (m) { now[m.id] = m.pass; });
    const better = prev ? M.filter(function (m) { return m.pass && prev[m.id] === false && m.weight !== 'optional'; }) : [];
    const worse = prev ? M.filter(function (m) { return !m.pass && prev[m.id] === true && m.weight !== 'optional'; }) : [];
    // the words (AI); the rules' own words if this fails
    progress('Writing your feedback…');
    const facts = 'RESULTS OF THE CHECK (final)\n' +
      'Required mechanisms working: ' + sc.required.pass + ' of ' + sc.required.of + '. Important: ' + sc.important.pass + ' of ' + sc.important.of + '.\n' +
      'WORKING: ' + (M.filter(function (m) { return m.pass && m.weight !== 'optional'; }).map(function (m) { return m.title; }).join('; ') || 'none') + '\n' +
      'NOT YET WORKING (write a slide for each id):\n' + (fails.map(function (m) { return m.id + ' ' + m.title + ' [' + m.weight + ']. The game: ' + m.game + ' Rule\'s hint: ' + m.hint; }).join('\n') || 'none') + '\n' +
      'NOTATION: ' + (notation.length ? notation.map(function (n) { return n.type + ': ' + n.text; }).join(' | ') : 'no problems') + '\n' +
      (far ? 'The diagram shows few of the game\'s parts: be honest and kind about that, and point them to the main parts of the game.\n' : '') +
      'OPTIONAL extras drawn: ' + (M.filter(function (m) { return m.weight === 'optional' && m.pass; }).map(function (m) { return m.title; }).join('; ') || 'none') + '\n' +
      (prev ? 'SINCE THE LAST CHECK: now working: ' + (better.map(function (m) { return m.title; }).join('; ') || 'nothing new') + '; no longer working: ' + (worse.map(function (m) { return m.title; }).join('; ') || 'nothing') + '\n' : '') +
      'ABOUT THE ORDER DECISION (an observation, not marked): ' + mech.decisionNote;
    const r2 = await LLM.completeJson(S.cfg, WORD_SYSTEM, Marking.base(facts) + '\n\n' + gameText() + '\n\nWrite the slides now.', 1800);
    busy(false);
    const words = r2[1] ? null : r2[0];
    const res = { notation: notation, map: mp, mech: mech, score: sc, fails: fails, far: far, better: better, worse: worse, first: !prev, words: words,
      kinds: Marking.kindNotes(d, mp.map), diagram: JSON.parse(JSON.stringify(d)), when: new Date() };
    S.lastResult = now; S.result = res; S.chat = [];
    // the record (what SFD Studio's replay shows of an advisor's answer: overall, issues, suggestion)
    if (S.rec) {
      const answer = { overall: (words && words.overall) || overallFallback(res),
        issues: notation.filter(function (n) { return n.type === 'error'; }).map(function (n) { return n.text; }).concat(fails.map(function (m) { return m.title + ': ' + m.hint; })),
        suggestion: (words && words.wrap) || (fails[0] ? fails[0].hint : 'Your diagram works the way the game does.'),
        score: { required: sc.required.pass + '/' + sc.required.of, important: sc.important.pass + '/' + sc.important.of },
        notation: notation.map(function (n) { return n.id; }), failed: fails.map(function (m) { return m.id; }), mapping: shownMap(mp.map), extras: mp.extras.map(function (x) { return shown(x.element); }),
        retried: raws.length > 1,
        worded_by: words ? 'ai' : 'rules' };
      const ev = PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Check my diagram.' }, answer); askWhy(ev.i, ev.question);
    }
    buildSlides(); drawChat(); drawRecord();
    $('askPanel').hidden = false;
  }
  /* a reading for text and the record: "arrival rate (2)" for a second element of that name */
  function shownMap(m) { const o = {}; Object.keys(m).forEach(function (l) { o[Marking.shown(l)] = m[l]; }); return o; }
  function showMarkMsg(html) { $('markOut').innerHTML = '<p class="mark-msg">' + html + '</p>'; }
  function overallFallback(r) {
    const ok = r.mech.mechanisms.filter(function (m) { return m.pass && m.weight !== 'optional'; });
    if (!r.fails.length) return 'Your diagram works the way the game does: every mechanism the check looks for is there.';
    const said = ok.slice(0, 3).map(function (m) { return m.title.charAt(0).toLowerCase() + m.title.slice(1); });
    return (said.length ? 'Your diagram already shows that ' + (said.length > 1 ? said.slice(0, -1).join(', ') + ' and ' + said[said.length - 1] : said[0]) + '. ' : '') +
      (r.fails.length === 1 ? 'One part of the game is not there yet.' : r.fails.length + ' parts of the game are not there yet.') + ' Let\'s look at them one at a time.';
  }

  /* ---------- the slides ---------- */
  function buildSlides() {
    const r = S.result, d = r.diagram, w = r.words || {}, sc = r.score, slides = [];
    const errs = r.notation.filter(function (n) { return n.type === 'error'; }), warns = r.notation.filter(function (n) { return n.type === 'warning'; });
    const nEl = Object.keys(r.map.map).length;
    const status = '<p class="sl-status"><span>' + (errs.length ? '⚠ ' + errs.length + ' notation ' + (errs.length === 1 ? 'problem' : 'problems') : '✓ notation clean') + '</span>' +
      '<span>' + nEl + ' element' + (nEl === 1 ? '' : 's') + ' read</span><span><b>' + sc.required.pass + ' of ' + sc.required.of + '</b> required mechanisms work</span></p>';
    // 1. overall
    slides.push({ label: 'Overall', title: w.headline || (r.fails.length ? 'A good start. Let\'s see how it can be improved.' : 'Your diagram works the way the game does.'),
      html: status + '<p>' + esc(w.overall || overallFallback(r)) + '</p>' +
        (r.better.length ? '<p class="sl-good">Since your last check, now working: ' + r.better.map(function (m) { return esc(m.title); }).join('; ') + '.</p>' : ''),
      next: r.fails.length || errs.length ? 'Let\'s see how it can be improved →' : 'See how I read your diagram →' });
    // 2. how I read your diagram
    const tags = {}; Object.keys(r.map.map).forEach(function (l) { tags[l] = r.map.map[l].map(function (c) { return Marking.CONCEPT[c].name; }).join(' + '); });
    slides.push({ label: 'How I read your diagram', title: 'Before we go on, here is how I understood your diagram',
      html: '<p>Each part of your diagram is tagged with the part of the game I read it as. If I read something wrongly, tell me in <b>Ask about your diagram</b> below: the rest of the check builds on this reading.</p>' +
        (r.kinds.length ? '<ul class="sl-list">' + r.kinds.map(function (k) { return '<li>' + esc(k.text) + '</li>'; }).join('') + '</ul>' : '') +
        (r.map.extras.filter(function (x) { return x.comment; }).length ? '<p class="muted small">Not part of the game\'s mechanics: ' + r.map.extras.filter(function (x) { return x.comment; }).map(function (x) { return '<b>' + esc(x.element) + '</b> (' + esc(x.comment) + ')'; }).join('; ') + '</p>' : ''),
      pic: { whole: true, tags: tags, extras: r.map.extras.map(function (x) { return x.element; }) } });
    // 3. notation, when there is something to fix
    if (r.notation.length) {
      const ev = { focus: [], bad: [], badFlows: [], notes: [] };
      r.notation.forEach(function (n) { const e = n.evidence || {}; ['focus', 'bad', 'badFlows', 'notes'].forEach(function (k) { ev[k] = ev[k].concat(e[k] || []); }); });
      slides.push({ label: 'Notation', title: errs.length ? 'A few things about how the diagram is drawn' : 'Two small things to look at',
        html: '<p>These are about the notation itself, before what the diagram means.</p><ul class="sl-list">' +
          errs.map(function (n) { return '<li><b>To fix:</b> ' + esc(n.text) + '</li>'; }).join('') + warns.map(function (n) { return '<li><b>To check:</b> ' + esc(n.text) + '</li>'; }).join('') + '</ul>',
        pic: { whole: true, focus: [], bad: ev.bad, badFlows: ev.badFlows, notes: ev.notes.slice(0, 4) } });
    }
    // 4. one slide per mechanism not working yet, or one slide when the diagram shows little of the game
    if (r.far && r.fails.length > 3) {
      slides.push({ label: 'How it can be improved', title: 'What the game needs in your diagram',
        html: '<p>' + esc('Your diagram shows only a few of the game\'s parts so far. Here is what happens in the game, as a guide to what your diagram needs to show. Start with the first and build from there.') + '</p><ul class="sl-list">' +
          r.fails.filter(function (m) { return m.weight === 'required'; }).map(function (m) { return '<li><b>' + esc(m.title) + '.</b> ' + esc(m.game) + '</li>'; }).join('') + '</ul>',
        pic: { whole: true } });
    } else {
      r.fails.forEach(function (m) {
        slides.push({ label: 'How it can be improved', title: m.title,
          html: '<p>' + esc((w.slides && w.slides[m.id]) || (m.game + ' ' + m.hint)) + '</p>' + (m.weight === 'important' ? '<p class="muted small">This one completes the picture; it is not one of the required mechanisms.</p>' : ''),
          pic: Object.assign({}, m.evidence), answer: m.answer, ghost: (m.evidence.ghost || []).length > 0 });
      });
    }
    // 5. wrap-up
    slides.push({ label: 'Next step', title: r.fails.length ? 'Your next step' : 'Well done',
      html: '<p>' + esc(w.wrap || (r.fails[0] ? r.fails[0].hint : 'Your diagram now works the way the game does: that is the structure behind the swings you saw.')) + '</p>' +
        '<p class="muted">' + esc(r.mech.decisionNote) + ' <span class="small">(An observation, not marked.)</span></p>' +
        (!r.first ? '<p>' + (r.better.length || r.worse.length ? 'Since your last check: ' + (r.better.length ? 'now working, ' + r.better.map(function (m) { return esc(m.title.toLowerCase()); }).join('; ') : '') + (r.better.length && r.worse.length ? '. ' : '') + (r.worse.length ? 'no longer working, ' + r.worse.map(function (m) { return esc(m.title.toLowerCase()); }).join('; ') : '') + '.' : 'Since your last check, the results are the same.') + '</p>' : '') +
        '<p class="muted small">Checked by rules, with ' + esc(LLM.PROVIDERS[S.cfg.provider]) + ' · ' + esc(S.cfg.model) + ' reading your diagram' + (r.words ? ' and writing these words' : '') + '. The reading can be wrong: if it is, say so below.</p>',
      last: true });
    S.slides = slides; S.slide = 0; S.onePage = false;
    drawSlides();
  }
  function slideHTML(s, i, n, one) {
    const pic = s.pic ? '<div class="sl-pic">' + Picture.svg(S.result.diagram, Object.assign({}, s.pic, { showGhost: !!s.shown })) + '</div>' : '';
    const ans = s.answer && s.shown ? '<p class="sl-answer"><b>Answer:</b> ' + esc(s.answer) + '</p>' : '';
    const tools = (s.answer ? '<button class="btn ghost small" type="button" data-act="answer" data-i="' + i + '">' + (s.shown ? 'Hide the answer' : 'Show me the answer') + '</button>' : '') +
      (s.pic && s.label === 'How it can be improved' || s.label === 'Notation' ? '<button class="btn ghost small" type="button" data-act="canvas">Try it on the canvas</button>' : '');
    const nav = one ? (tools ? '<div class="sl-nav">' + tools + '</div>' : '') :
      '<div class="sl-nav">' + (i > 0 ? '<button class="btn ghost small" type="button" data-act="back">← Back</button>' : '') + tools + '<span class="sl-gap"></span>' +
      (s.last ? '<button class="btn" type="button" data-act="again">Check again</button>' : '<button class="btn" type="button" data-act="next">' + esc(s.next || 'Next →') + '</button>') + '</div>';
    const dots = one ? '' : '<span class="sl-dots" aria-hidden="true">' + S.slides.map(function (_, k) { return '<i class="' + (k === i ? 'on' : k < i ? 'seen' : '') + '"></i>'; }).join('') + '</span>';
    return '<section class="slide" aria-label="' + esc(s.label) + ', ' + (i + 1) + ' of ' + n + '"><div class="sl-top"><span>' + esc(s.label) + ' · ' + (i + 1) + ' of ' + n + '</span>' + dots + '</div>' +
      '<h3>' + esc(s.title) + '</h3>' + s.html + pic + ans + nav + '</section>';
  }
  function drawSlides() {
    if (!S.slides) { $('markOut').innerHTML = ''; return; }
    const n = S.slides.length;
    const body = S.onePage ? S.slides.map(function (s, i) { return slideHTML(s, i, n, true); }).join('') : slideHTML(S.slides[S.slide], S.slide, n, false);
    $('markOut').innerHTML = '<div class="slides' + (S.onePage ? ' one' : '') + '" aria-live="polite">' + body + '</div>' +
      '<p class="sl-switch"><button class="linkish" type="button" data-act="toggle">' + (S.onePage ? 'Back to the slides' : 'See everything on one page') + '</button></p>';
  }
  function slideAction(e) {
    const b = e.target.closest('button[data-act]'); if (!b || !S.slides) return;
    const act = b.getAttribute('data-act');
    if (act === 'next' && S.slide < S.slides.length - 1) { S.slide++; drawSlides(); $('markOut').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (act === 'back' && S.slide > 0) { S.slide--; drawSlides(); }
    else if (act === 'answer') { const s = S.slides[+b.getAttribute('data-i')]; s.shown = !s.shown; drawSlides(); }
    else if (act === 'canvas') frame().scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (act === 'again') mark();
    else if (act === 'toggle') { S.onePage = !S.onePage; drawSlides(); }
  }

  /* ---------- questions ---------- */
  async function ask() {
    const q = $('askIn').value.trim();
    if (!q || S.busy || !S.result) return;
    if (!S.cfg) { openSettings(); return; }
    S.chat.push({ role: 'user', content: q }); $('askIn').value = ''; drawChat();
    busy(true, 'ask');
    const R = S.result;
    let ctx = 'THE REFERENCE\n' + keyText(S.key) + '\n\nTHE LEARNER\'S CURRENT DIAGRAM\n' + diagramText(S.diagram) + '\n\n' + gameText() +
      '\n\nTHE CHECK THEY RECEIVED (on the diagram as it was then)\nHow their elements were read: ' + JSON.stringify(shownMap(R.map.map)) +
      '\nNotation: ' + (R.notation.map(function (n) { return n.text; }).join(' | ') || 'no problems') +
      '\nMechanisms: ' + R.mech.mechanisms.map(function (m) { return m.id + ' ' + m.title + ': ' + (m.pass ? 'works' : 'not yet. Hint: ' + m.hint + ' Answer, if asked: ' + m.answer); }).join('\n') +
      '\nOrder decision: ' + R.mech.decisionNote;
    ctx = Marking.base(ctx);
    const msgs = [{ role: 'user', content: ctx + '\n\n(The learner\'s questions follow.)' }, { role: 'assistant', content: 'Understood. I will answer as their teaching assistant.' }].concat(S.chat);
    const r = await LLM.complete(S.cfg, ASK_SYSTEM, msgs, 700, false);
    busy(false);
    const text = r[1] ? null : r[0];
    S.chat.push({ role: 'assistant', content: text || ('⚠ ' + r[1]), failed: !text });
    if (text && S.rec) { const ev = PL.addAi(S.rec, 'ai_advice', S.cfg, { description: q }, { overall: text }); askWhy(ev.i, ev.question); }
    drawChat(); drawRecord();
  }
  function drawChat() {
    $('chat').innerHTML = S.chat.map(function (m) {
      return '<div class="msg ' + (m.role === 'user' ? 'me' : 'ai') + (m.failed ? ' failed' : '') + '"><span class="who">' + (m.role === 'user' ? 'You' : 'Teaching assistant') + '</span>' + esc(m.content).replace(/\n/g, '<br>') + '</div>';
    }).join('');
    $('chat').scrollTop = $('chat').scrollHeight;
  }
  function busy(on, what) {
    S.busy = on;
    $('markBtn').disabled = on; $('askBtn').disabled = on;
    $('markBtn').textContent = on && what === 'mark' ? 'Marking…' : 'Check my diagram';
    $('askBtn').textContent = on && what === 'ask' ? 'Thinking…' : 'Ask';
  }

  /* ---------- AI settings (in memory only, as in SFD Studio) ---------- */
  function readSettings() {
    const p = $('aiProv').value, key = $('aiKey').value.trim(), model = $('aiModel').value.trim() || LLM.DEFAULT_MODELS[p];
    const sig = p + '|' + key + '|' + model;
    if (S.sig !== sig) { S.sig = sig; S.conn = null; }
    S.cfg = key ? { provider: p, key: key, model: model } : null;
    drawSettings();
  }
  function drawSettings() {
    const st = $('aiState');
    if (!S.cfg) { st.className = 'ai-state'; st.textContent = 'No key yet. The game and the drawing work without one; checking the diagram needs one.'; }
    else if (S.conn === null) { st.className = 'ai-state warn'; st.textContent = 'Key entered but not checked yet. Press Test the connection.'; }
    else if (S.conn === true) { st.className = 'ai-state ok'; st.textContent = 'AI on: ' + LLM.PROVIDERS[S.cfg.provider] + ' · ' + S.cfg.model; }
    else { st.className = 'ai-state err'; st.textContent = S.conn; }
    $('aiSum').textContent = S.cfg ? (S.conn === true ? 'on' : 'key entered') : 'no key';
  }
  async function testConn() {
    readSettings(); if (!S.cfg) return;
    $('aiTest').disabled = true; $('aiTest').textContent = 'Asking the AI to say hello…';
    const r = await LLM.testConnection(S.cfg);
    $('aiTest').disabled = false; $('aiTest').textContent = 'Test the connection';
    S.conn = r[0] ? true : r[1]; drawSettings();
  }
  function openSettings() { $('aiBox').open = true; $('aiKey').focus(); }

  /* ---------- the record ---------- */
  function drawRecord() {
    if (!S.rec) return;
    const ev = S.rec.events, steps = ev.filter(function (e) { return e.kind === 'step'; }).length;
    const ai = ev.filter(function (e) { return e.kind === 'ai_advice'; }).length, notes = ev.filter(function (e) { return e.kind === 'note'; }).length;
    $('recState').textContent = 'Recording: ' + steps + ' modelling step' + (steps === 1 ? '' : 's') + ', ' + ai + ' exchange' + (ai === 1 ? '' : 's') + ' with the AI, ' + notes + ' reason' + (notes === 1 ? '' : 's') + '.';
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function downloadRecord() {
    if (!S.rec) return;
    const nm = $('recName').value.trim();
    if (nm && nm !== S.named) { PL.addName(S.rec, nm); S.named = nm; }
    const stamp = S.rec.started.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    download('modelling-process-' + (nm ? nm.replace(/[^\w-]+/g, '_') + '-' : '') + stamp + '.json', PL.dumps(S.rec), 'application/json');
    drawRecord();
  }

  /* ---------- the game, as it is played ----------
     One record for the session: each game and each week played are recorded as
     they happen, between the modelling steps, so a reader can see when the
     learner drew what. The diagram carries over from one game to the next. */
  function startGame(game) {
    if (!S.rec) S.rec = PL.newRecord('Pub Supply Game');
    S.game = game; S.mode = game.mode; S.key = KEYS[game.mode] || null;
    S.n += 1; S.done = -1; S.finished = false; S.said = '';
    PL.addEvent(S.rec, { kind: 'game', game: S.n, mode: game.mode });
    drawRecord();
  }
  function weeksUpTo(game, upto) {
    if (game !== S.game) return;
    for (let k = S.done + 1; k <= upto; k++) {
      const r = game.log[k], me = r.pos[0], nxt = game.log[k + 1], sup = nxt ? nxt.pos[1] : null;
      PL.addEvent(S.rec, { kind: 'week', game: S.n, week: r.week, customers: me.asked, delivered: me.arrived, served: me.sent,
        waiting: me.owed, turned_away: me.turned, sent_back: me.back, cellar: me.stock, ordered: me.order,
        wholesaler_sent: sup ? sup.sent : null, back_order: sup ? sup.owed : null });
      S.done = k;
    }
    drawRecord();
  }
  function gameEnd(game, said) {
    if (game !== S.game || S.finished) return;
    weeksUpTo(game, game.log.length - 1);
    S.finished = true; S.said = said || '';
    PL.addEvent(S.rec, { kind: 'game_end', game: S.n, said: S.said });
    drawRecord();
  }
  /* The tab is opened. */
  function show() {
    if (!S.loaded) { S.loaded = true; loadCanvas(); askWhy(0, null); $('whyQ').innerHTML = 'Your last move: why? <span class="muted">(optional)</span>'; }
    $('taskText').textContent = S.key ? S.key.task : 'Draw a stock-and-flow diagram of your pub that explains what happens in your game. Name things in your own words. No equations are needed.';
    $('keyNote').hidden = !(S.key && S.key.status === 'provisional');
    $('noKey').hidden = !!S.key;
    $('markBtn').disabled = !S.key || S.busy;
    $('modelWhen').textContent = !S.game ? '' : S.finished ? 'Game ' + S.n + ' is over.' : 'Game ' + S.n + ' is on: week ' + (S.done + 2) + '.';
    drawSettings(); drawRecord();
  }

  /* ---------- wiring ---------- */
  function init() {
    $('aiProv').innerHTML = Object.keys(LLM.PROVIDERS).map(function (k) { return '<option value="' + k + '">' + LLM.PROVIDERS[k] + '</option>'; }).join('');
    const setModel = function () { $('aiModel').value = LLM.DEFAULT_MODELS[$('aiProv').value]; $('aiKey').placeholder = LLM.KEY_PLACEHOLDER[$('aiProv').value]; };
    setModel();
    $('aiProv').addEventListener('change', function () { setModel(); readSettings(); });
    $('aiKey').addEventListener('input', readSettings);
    $('aiModel').addEventListener('input', readSettings);
    $('aiTest').addEventListener('click', testConn);
    $('markBtn').addEventListener('click', mark);
    $('markOut').addEventListener('click', slideAction);
    $('askBtn').addEventListener('click', ask);
    $('askIn').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    $('whySave').addEventListener('click', saveWhy);
    $('whyIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveWhy(); });
    $('recBtn').addEventListener('click', downloadRecord);
    $('jsonBtn').addEventListener('click', function () { if (S.diagram) download('my-model.json', JSON.stringify(S.diagram, null, 1), 'application/json'); });
    $('importBtn').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
    $('importFile').addEventListener('change', function () { const f = this.files && this.files[0]; if (f) importDiagram(f); });
    drawSettings();
  }
  return { init: init, show: show, startGame: startGame, weeksUpTo: weeksUpTo, gameEnd: gameEnd, _state: S, _diagramText: diagramText, _keyText: keyText, _elementList: elementList, _cleanMap: cleanMap, MAP_SYSTEM: MAP_SYSTEM, WORD_SYSTEM: WORD_SYSTEM, ASK_SYSTEM: ASK_SYSTEM };
})();

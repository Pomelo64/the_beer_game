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
    if (!S.game) return 'THE LEARNER\'S GAME: not started yet.';
    return Evaluate.gameRecordText(S.game, { wom: S.mode === 'wom', finished: S.finished, done: S.done, said: S.said });
  }

  /* ---------- marking: rules (code) and two AI calls ----------
     Layer 1 and layer 3 are decided by the rules in marking.js. The AI maps the
     learner's elements to concepts (call 1) and words the slides (call 2). The
     wording cannot change a verdict; if it fails, the rules' own words are used. */
  const MAP_SYSTEM = Evaluate.MAP_SYSTEM, WORD_SYSTEM = Evaluate.WORD_SYSTEM;   // the evaluation's prompts live in evaluate.js
  /* The comment on what the learner wrote at the end of the game, before seeing any results. */
  const COMMENT_SYSTEM = [
    'You are a teaching assistant in a system dynamics course. A learner has just finished a one-player supply game in which they ran a pub. Before seeing any results, they wrote in their own words what made the game hard. You reply to what they wrote.',
    'Use only the facts you are given: the summary of their game and their week-by-week record. Never invent numbers or events.',
    'Write 3 or 4 sentences in plain English, addressed to the learner as "you". First acknowledge, specifically, what their explanation gets right. Then set what it leaves out or misreads against the facts of their own game, citing weeks or numbers. Many players blame the customers; if they do, point out gently how the customers actually behaved. End with one question that invites them to model their pub: what a diagram of the pub would need to show to explain what happened. Do not answer that question.',
    'Never use the word "wrong". Do not give the model away: do not list stocks, flows or links. No markdown, headings or lists.'
  ].join('\n');
  const ASK_SYSTEM = [
    'You are a teaching assistant in a system dynamics course. A learner is playing, or has played, a supply-chain game, draws a stock-and-flow diagram to explain it, and has had it checked. The check was made by fixed rules on top of your reading of their diagram. Now they ask you questions.',
    'Ground every answer in the reference diagram, the learner\'s current diagram, the check\'s results and the learner\'s own game record. Cite weeks of their game where that helps. If the game is still being played, use only the weeks given, and never tell them what the game will do next.',
    'Explain why each problem matters. Prefer a hint first; if the learner asks for the answer directly, you may give it.',
    'If the learner says their diagram was misread, take it seriously: say which element you read as what, and if they are right, tell them to submit it for evaluation again after renaming or redrawing it so the reading is clear.',
    'If a question is not settled by the reference, say so plainly, and answer briefly from general system dynamics knowledge, marked as such.',
    'Keep answers short: at most about 150 words, plain English, no markdown headings.'
  ].join('\n');

  const elementList = Evaluate.elementList, cleanMap = Evaluate.cleanMap, conceptText = Evaluate.conceptText;
  function progress(text) { $('markOut').innerHTML = '<p class="mark-busy" role="status"><span class="spin" aria-hidden="true"></span>' + text + '</p>'; }
  async function mark() {
    if (S.busy) return;
    if (!S.key) { showMarkMsg('The answer key for this game has not been written yet, so the diagram cannot be checked.'); return; }
    if (!S.cfg) { showMarkMsg('Add an AI key under <b>AI settings</b> first.'); openSettings(); return; }
    if (!S.diagram || !((S.diagram.stocks || []).length + (S.diagram.flows || []).length + (S.diagram.auxiliaries || []).length)) { showMarkMsg('Draw something first.'); return; }
    const shown = Marking.shown;
    busy(true, 'mark');
    // the evaluation itself is shared with the test page (evaluate.js)
    const ev = await Evaluate.run({ cfg: S.cfg, key: S.key, diagram: S.diagram, gameText: gameText(), prev: S.lastResult, progress: progress });
    busy(false);
    const recorded = { app_version: APP_VERSION, settings: ev.settings, calls: ev.calls.map(function (c) { return { step: c.step, model: c.model, temperature: c.temperature, ms: c.ms, tokens: c.usage }; }) };
    if (ev.status === 'error') { showMarkMsg(esc(ev.error)); return; }
    if (ev.status === 'unread') {     // never build verdicts on a gap
      const names = ev.map.missing.map(function (id) { return '"' + shown(ev.list.ids[id]) + '"'; });
      showMarkMsg('I could not read all of your diagram: ' + names.join(', ') + (names.length === 1 ? ' was' : ' were') + ' left out of my reading, so an evaluation now would be built on a gap. ' +
        'Please press <b>Submit the diagram for evaluation</b> again. If it keeps happening, try another model under <b>AI settings</b>.');
      if (S.rec) PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Submit the diagram for evaluation.' },
        Object.assign({ overall: 'The diagram could not be fully read, so no evaluation was given.', unread: ev.map.missing.map(function (id) { return shown(ev.list.ids[id]); }) }, recorded));
      drawRecord();
      return;
    }
    const mp = ev.map, words = ev.words, prev = S.lastResult;
    const res = { notation: ev.notation, map: mp, mech: ev.mech, score: ev.score, fails: ev.fails, far: ev.far, better: ev.better, worse: ev.worse, first: !prev, words: words,
      kinds: ev.kinds, diagram: JSON.parse(JSON.stringify(ev.d)), when: new Date() };
    S.lastResult = ev.verdicts; S.result = res; S.chat = [];
    // the record (what SFD Studio's replay shows of an advisor's answer: overall, issues, suggestion)
    if (S.rec) {
      const sc = ev.score, fails = ev.fails;
      const answer = Object.assign({ overall: (words && words.overall) || overallFallback(res),
        issues: ev.notation.filter(function (n) { return n.type === 'error'; }).map(function (n) { return n.text; }).concat(fails.map(function (m) { return m.title + ': ' + m.hint; })),
        suggestion: (words && words.wrap) || (fails[0] ? fails[0].hint : 'Your diagram works the way the game does.'),
        score: { required: sc.required.pass + '/' + sc.required.of, important: sc.important.pass + '/' + sc.important.of },
        notation: ev.notation.map(function (n) { return n.id; }), failed: fails.map(function (m) { return m.id; }), mapping: shownMap(mp.map), extras: mp.extras.map(function (x) { return shown(x.element); }),
        retried: ev.retried,
        worded_by: words ? 'ai' : 'rules' }, recorded);
      const e = PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Submit the diagram for evaluation.' }, answer); askWhy(e.i, e.question);
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
        (r.better.length ? '<p class="sl-good">Since your last submission, now working: ' + r.better.map(function (m) { return esc(m.title); }).join('; ') + '.</p>' : ''),
      next: r.fails.length || errs.length ? 'Let\'s see how it can be improved →' : 'See how I read your diagram →' });
    // 2. how I read your diagram
    const tags = {}; Object.keys(r.map.map).forEach(function (l) { tags[l] = r.map.map[l].map(function (c) { return Marking.CONCEPT[c].name; }).join(' + '); });
    slides.push({ label: 'How I read your diagram', title: 'Before we go on, here is how I understood your diagram',
      html: '<p>Each part of your diagram is tagged with the part of the game I read it as. If I read something wrongly, tell me in <b>Ask about your diagram</b> below: the rest of the evaluation builds on this reading.</p>' +
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
        (r.mech.decisionNote ? '<p class="muted">' + esc(r.mech.decisionNote) + ' <span class="small">(An observation, not marked.)</span></p>' : '') +
        (!r.first ? '<p>' + (r.better.length || r.worse.length ? 'Since your last submission: ' + (r.better.length ? 'now working, ' + r.better.map(function (m) { return esc(m.title.toLowerCase()); }).join('; ') : '') + (r.better.length && r.worse.length ? '. ' : '') + (r.worse.length ? 'no longer working, ' + r.worse.map(function (m) { return esc(m.title.toLowerCase()); }).join('; ') : '') + '.' : 'Since your last submission, the results are the same.') + '</p>' : '') +
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
      (s.last ? '<button class="btn" type="button" data-act="again">Submit it again</button>' : '<button class="btn" type="button" data-act="next">' + esc(s.next || 'Next →') + '</button>') + '</div>';
    const dots = one ? '' : '<span class="sl-dots" aria-hidden="true">' + S.slides.map(function (_, k) { return '<i class="' + (k === i ? 'on' : k < i ? 'seen' : '') + '"></i>'; }).join('') + '</span>';
    return '<section class="slide" aria-label="' + esc(s.label) + ', ' + (i + 1) + ' of ' + n + '"><div class="sl-top"><span>' + esc(s.label) + ' · ' + (i + 1) + ' of ' + n + '</span>' + dots + '</div>' +
      '<h3>' + esc(s.title) + '</h3>' + s.html + pic + ans + nav + '</section>';
  }
  function drawSlides() {
    if (!S.slides) { $('markOut').innerHTML = ''; return; }
    const n = S.slides.length;
    const body = S.onePage ? S.slides.map(function (s, i) { return slideHTML(s, i, n, true); }).join('') : slideHTML(S.slides[S.slide], S.slide, n, false);
    $('markOut').innerHTML = '<div class="slides' + (S.onePage ? ' one' : '') + '" aria-live="polite">' + body + '</div>' +
      '<p class="sl-switch"><button class="linkish" type="button" data-act="pdf">Download the feedback (PDF)</button> · ' +
      '<button class="linkish" type="button" data-act="toggle">' + (S.onePage ? 'Back to the slides' : 'See everything on one page') + '</button></p>' +
      '<p class="sl-switch muted small" id="pdfMsg" aria-live="polite"></p>';
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
    else if (act === 'pdf') feedbackPdf();
  }

  /* ---------- the feedback as a PDF ----------
     Every slide, as the learner saw it, after a cover with the game, their words and their
     diagram, printed through the browser ("Save as PDF"), so the pictures stay sharp and nothing
     is loaded from outside. Every page's margin names the repository (in browsers that print page
     margins, such as Chrome and Edge), the cover and the last page link to it, and the text
     also holds the line below in transparent ink: invisible on the page, but kept in the PDF's
     text, so it survives if the footer is cut off. Where the page cannot print (inside a frame,
     as on claude.ai), the same pages are saved as a web page to print from instead. */
  const REPO = 'https://github.com/Pomelo64/the_beer_game';
  const HIDDEN_LINE = 'Made with Beer Game Lab, ' + REPO + '. Idea and design by Shahin Ashkiani.';
  function money(x) { return '£' + (Math.round(x * 100) / 100).toFixed(x % 1 ? 2 : 0); }
  function feedbackHTML() {
    const r = S.result, n = S.slides.length, cfg = S.cfg || {}, when = r.when || new Date();
    const pos = S.game && S.game.pos[0];
    const game = !S.game ? 'No game had been played yet.'
      : S.finished ? (S.mode === 'wom' ? 'Game ' + S.n + ', with word of mouth: total cost ' + money(pos.cost) + '.'
        : 'Game ' + S.n + ': total cost ' + money(pos.cost) + '. The lowest cost the game allows, found with hindsight, is ' + money(Engine.CFG.best.cost) + '.')
      : 'Game ' + S.n + ' was still being played (week ' + (S.done + 2) + ') when the diagram was submitted.';
    const model = (LLM.PROVIDERS[cfg.provider] || '') + ' · ' + (cfg.model || '');
    const facts = [['Submitted', when.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })], ['Your game', game],
      ['Read by', model], ['Worded by', r.words ? model : 'the rules (the AI\'s wording was not available)'], ['App', 'Beer Game Lab ' + APP_VERSION]];
    const said = S.finished && S.said ? '<h2>What you wrote at the end of the game</h2><p class="pv-said">' + esc(S.said) + '</p>' +
      (S.comment && S.comment.n === S.n ? '<h2>The AI\'s comment on it</h2><p class="pv-ai">' + esc(S.comment.text) + '</p>' : '') : '';
    const foot = '<div class="pv-foot">Made with <a href="' + REPO + '">Beer Game Lab</a> · <a href="' + REPO + '">github.com/Pomelo64/the_beer_game</a></div>';
    // what refers to the page around the slides makes no sense on paper
    const slides = S.slides.map(function (sl, i) { return slideHTML(sl, i, n, true); }).join('')
      .replace('If I read something wrongly, tell me in <b>Ask about your diagram</b> below: the rest', 'The rest').replace(': if it is, say so below.', '.');
    return '<section class="pv-page pv-cover"><p class="pv-hidden">' + esc(HIDDEN_LINE) + '</p>' +
      '<p class="pv-note">To keep this as a PDF, print this page (Ctrl+P, or ⌘P on a Mac) and choose <b>Save as PDF</b>.</p>' +
      '<h1>Feedback on your diagram</h1><p class="pv-sub">Beer Game Lab: model your pub</p>' +
      '<table class="pv-facts">' + facts.map(function (f) { return '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>'; }).join('') +
      '<tr><td>Made with</td><td><a href="' + REPO + '">Beer Game Lab, github.com/Pomelo64/the_beer_game</a></td></tr></table>' +
      '<h2>Your diagram</h2><div class="sl-pic">' + Picture.svg(r.diagram, { whole: true }) + '</div>' + said + '</section>' +
      '<section class="pv-page"><h2>The feedback</h2>' + slides +
      '<p class="pv-hidden">' + esc(HIDDEN_LINE) + '</p>' +
      '<p class="muted small">The verdicts come from fixed rules, the same for everyone. The AI only reads the diagram' + (r.words ? ' and words the feedback' : '') + ', and its reading can be wrong. This is feedback, not a mark.</p>' + foot + '</section>';
  }
  function feedbackPdf() {
    if (!S.result || !S.slides) return;
    const html = feedbackHTML(), d = S.result.when || new Date();
    const title = 'Beer Game Lab feedback ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let framed = true; try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (S.rec) { PL.addEvent(S.rec, { kind: 'feedback_pdf', saved_as: framed ? 'web page' : 'print' }); drawRecord(); }
    if (framed || typeof window.print !== 'function') {   // a frame usually may not print: save the pages instead
      const css = Array.prototype.map.call(document.querySelectorAll('style'), function (st) { return st.textContent; }).join('\n') +
        '\n.pv{display:block;max-width:182mm;margin:0 auto;padding:10mm 0}@media screen{.pv .pv-note{display:block;padding:8px 12px;background:#eef2f0;border-radius:8px}.pv .pv-foot{margin-top:24px}}';
      download(title.replace(/ /g, '-') + '.html', '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + esc(title) + '</title>\n<style>\n' + css + '\n</style>\n</head>\n<body class="printing">\n<div class="pv">' + html + '</div>\n</body>\n</html>\n', 'text/html');
      const m = $('pdfMsg'); if (m) m.textContent = 'This page cannot print here, so the feedback was saved as a web page. Open it and print it, choosing Save as PDF.';
      return;
    }
    let pv = $('printView');
    if (!pv) { pv = document.createElement('div'); pv.id = 'printView'; pv.className = 'pv'; document.body.appendChild(pv); }
    pv.innerHTML = html;
    const oldTitle = document.title;
    const done = function () { document.body.classList.remove('printing'); document.title = oldTitle; pv.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    document.body.classList.add('printing'); document.title = title;
    window.print();
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
      '\nOrder decision: ' + (R.mech.decisionNote || 'no order flow in the diagram');
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
    $('markBtn').textContent = on && what === 'mark' ? 'Evaluating…' : 'Submit the diagram for evaluation';
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
    if (!S.cfg) { st.className = 'ai-state'; st.textContent = 'No key yet. The game and the drawing work without one; evaluating the diagram needs one.'; }
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
    if (S.conn === true && S.pendingComment) gameComment();   // the comment waited for a key
  }
  function openSettings() { $('aiBox').open = true; $('aiKey').focus(); }

  /* ---------- a comment on what the learner wrote at the end of the game ----------
     ui.js calls gameComment with the text of the personal message once the results are
     shown. The comment appears under the learner's words on the results screen and in the
     reference-mode panel of this tab. Without a key, a note says where to add one; the
     comment then follows as soon as the connection is tested. */
  function sayComment(state, html) {
    ['saidAi', 'refAi'].forEach(function (id) { const el = $(id); if (el) { el.className = 'said-ai ' + state; el.innerHTML = html; } });
  }
  async function gameComment(summary) {
    if (summary) S.summary = summary;
    if (!S.finished) return;
    if (!S.said) { sayComment('none', ''); return; }
    if (S.comment && S.comment.n === S.n) { sayComment('done', esc(S.comment.text)); return; }
    readSettings();
    if (!S.cfg) {
      S.pendingComment = true;
      sayComment('note', 'Add an AI key under <b>AI settings</b> in the <b>Model your pub</b> tab, and you will get a comment on your explanation here.');
      return;
    }
    S.pendingComment = false;
    const n = S.n;
    sayComment('busy', '<span class="spin"></span> The AI is reading what you wrote…');
    const r = await LLM.complete(S.cfg, COMMENT_SYSTEM,
      'WHAT THE LEARNER WROTE AT THE END, BEFORE SEEING ANY RESULTS\n' + S.said + '\n\nSUMMARY OF THEIR GAME\n' + (S.summary || '') +
      (S.key && S.key.game ? '\n\nHOW THE GAME WORKS\n' + S.key.game : '') + '\n\n' + gameText() + '\n\nWrite your reply now.', 400);
    if (n !== S.n) return;                         // a new game began meanwhile
    if (r[1]) { sayComment('note', 'The AI could not comment: ' + esc(r[1]) + ' <button class="linkish" type="button" data-act="comment">Try again</button>'); return; }
    S.comment = { n: n, text: r[0] };
    sayComment('done', esc(r[0]));
    if (S.rec) { PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Comment on what the learner wrote at the end of game ' + n + '.' }, { comment: r[0], said: S.said }); drawRecord(); }
  }

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
    if (!S.rec) { S.rec = PL.newRecord('Beer Game Lab'); PL.addEvent(S.rec, { kind: 'app', name: 'Beer Game Lab', version: APP_VERSION }); }
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
    ['saidAi', 'refAi'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target.closest('[data-act="comment"]')) gameComment(); }); });
    $('importFile').addEventListener('change', function () { const f = this.files && this.files[0]; if (f) importDiagram(f); });
    drawSettings();
  }
  return { init: init, show: show, startGame: startGame, weeksUpTo: weeksUpTo, gameEnd: gameEnd, gameComment: gameComment, _state: S, _diagramText: diagramText, _keyText: keyText, _elementList: elementList, _cleanMap: cleanMap, MAP_SYSTEM: MAP_SYSTEM, WORD_SYSTEM: WORD_SYSTEM, ASK_SYSTEM: ASK_SYSTEM, COMMENT_SYSTEM: COMMENT_SYSTEM };
})();

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
    if (d.type === 'streamlit:componentReady')
      f.contentWindow.postMessage({ type: 'streamlit:render', args: { initial: {}, confirmed: [] } }, '*');
    else if (d.type === 'streamlit:setFrameHeight' && d.height) f.style.height = Math.max(380, Math.ceil(d.height)) + 'px';
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
    return 'TASK GIVEN TO THE LEARNER: ' + k.task + '\nSCOPE: ' + k.scope + '\n\nKEY ITEMS:\n' +
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

  const MARK_SYSTEM = [
    'You are a teaching assistant in a system dynamics course. A learner is playing, or has played, a supply-chain game, and draws a stock-and-flow diagram (SFD) to explain it.',
    'You mark the diagram against an ANSWER KEY written by the educator. The key is the standard. Do not add requirements of your own, and do not mark down anything the key or its accepted variants allow.',
    '',
    'How to read the diagram: it lists stocks, flows (with what each flows from and to; "cloud" is a source or sink), auxiliaries, and information links. A link into a flow\'s name goes into that flow\'s valve.',
    'Match the learner\'s elements to the key by meaning, not by exact name: learners use their own words. An element of the right meaning but the wrong type (for example a stock drawn as an auxiliary) counts as "wrong". A flow counts only if it connects the right things. A link counts only if it runs in the right direction; a link through an intermediate auxiliary counts as the direct link where the key or its variants say so.',
    '',
    'For each key item give a verdict: "present", "partly" (there but incomplete or misconnected), "wrong" (drawn, but as the wrong type or with the wrong meaning) or "missing".',
    'In each reason, name the learner\'s element you matched. For a missing or wrong item, describe the role that is missing as a hint the learner can act on, without simply naming the key\'s element. Where the learner\'s game shows why an item matters, cite a week.',
    'Also list elements in the diagram that match no key item, and say whether each is harmless or a mistake.',
    'Write in plain English for a beginner. Be accurate and specific; never praise vaguely.',
    '',
    'Reply ONLY with a JSON object, no markdown fences, of this shape:',
    '{"overall": "<2-3 sentences>", "verdicts": [{"item": "<key item id>", "verdict": "present|partly|wrong|missing", "learner_element": "<the learner\'s element, or empty>", "reason": "<one or two sentences>"}], "extras": [{"element": "<name>", "comment": "<one sentence>"}], "suggestion": "<the single most useful next step>"}'
  ].join('\n');
  const ASK_SYSTEM = [
    'You are a teaching assistant in a system dynamics course. A learner is playing, or has played, a supply-chain game, draws a stock-and-flow diagram to explain it, and has had it marked against the educator\'s answer key. Now they ask you questions.',
    'Ground every answer in the answer key, the learner\'s current diagram and the learner\'s own game record. Cite weeks of their game where that helps: their own numbers are the best evidence they have. If the game is still being played, use only the weeks given, and never tell them what the game will do next.',
    'Explain the errors the marking found and why they matter. Prefer a hint first; if the learner asks for the answer directly, you may give it.',
    'If a question is not settled by the key, say so plainly, and answer briefly from general system dynamics knowledge, marked as such.',
    'Keep answers short: at most about 150 words, plain English, no markdown headings.'
  ].join('\n');

  /* ---------- marking ---------- */
  const LEVEL = { required: 0, important: 1, optional: 2 };
  async function mark() {
    if (S.busy) return;
    if (!S.key) { showMarkMsg('The answer key for this game has not been written yet, so the diagram cannot be marked.'); return; }
    if (!S.cfg) { showMarkMsg('Add an AI key under <b>AI settings</b> first.'); openSettings(); return; }
    if (!S.diagram || !((S.diagram.stocks || []).length + (S.diagram.flows || []).length + (S.diagram.auxiliaries || []).length)) { showMarkMsg('Draw something first.'); return; }
    busy(true, 'mark');
    const user = 'ANSWER KEY\n' + keyText(S.key) + '\n\nTHE LEARNER\'S DIAGRAM\n' + diagramText(S.diagram) + '\n\n' + gameText() + '\n\nMark the diagram now.';
    const r = await LLM.completeJson(S.cfg, MARK_SYSTEM, user, 2500);
    busy(false);
    if (r[1]) { showMarkMsg(esc(r[1])); return; }
    const a = r[0];
    a.verdicts = Array.isArray(a.verdicts) ? a.verdicts : [];
    // what SFD Studio's replay shows of an advisor's answer: overall, issues, suggestion
    const byId = {}; S.key.items.forEach(function (it) { byId[it.id] = it; });
    a.issues = a.verdicts.filter(function (v) { return v.verdict !== 'present'; })
      .map(function (v) { return (byId[v.item] ? byId[v.item].what : v.item) + ': ' + v.reason; });
    S.marking = a; S.chat = [];
    if (S.rec) { const ev = PL.addAi(S.rec, 'ai_advice', S.cfg, { description: 'Check my diagram against the answer key.' }, a); askWhy(ev.i, ev.question); }
    drawMarking(); drawChat(); drawRecord();
  }
  function showMarkMsg(html) { $('markOut').innerHTML = '<p class="mark-msg">' + html + '</p>'; }
  function drawMarking() {
    const a = S.marking; if (!a) { $('markOut').innerHTML = ''; return; }
    const byId = {}; S.key.items.forEach(function (it) { byId[it.id] = it; });
    const ICON = { present: '✅', partly: '🟡', wrong: '❌', missing: '⬜' }, WORD = { present: 'There', partly: 'Partly', wrong: 'Wrong', missing: 'Missing' };
    const req = S.key.items.filter(function (it) { return it.level === 'required'; });
    const got = req.filter(function (it) { return a.verdicts.some(function (v) { return v.item === it.id && v.verdict === 'present'; }); });
    const rows = a.verdicts.slice().sort(function (x, y) {
      const ix = byId[x.item], iy = byId[y.item];
      return (ix ? LEVEL[ix.level] : 3) - (iy ? LEVEL[iy.level] : 3);
    }).map(function (v) {
      const it = byId[v.item];
      return '<li class="v-' + esc(v.verdict) + '"><span class="v-ico" aria-hidden="true">' + (ICON[v.verdict] || '•') + '</span><div>' +
        '<b>' + esc(WORD[v.verdict] || v.verdict) + '</b> <span class="muted">· ' + esc(it ? it.kind + (it.level !== 'required' ? ', ' + it.level : '') : v.item) + '</span>' +
        (v.learner_element ? ' <span class="chip">' + esc(v.learner_element) + '</span>' : '') +
        '<div>' + esc(v.reason) + '</div></div></li>';
    }).join('');
    const extras = (a.extras || []).map(function (x) { return '<li><span class="chip">' + esc(x.element) + '</span> ' + esc(x.comment) + '</li>'; }).join('');
    $('markOut').innerHTML =
      '<p class="mark-score"><b>' + got.length + ' of ' + req.length + '</b> required parts are there.</p>' +
      '<p>' + esc(a.overall) + '</p><ul class="verdicts">' + rows + '</ul>' +
      (extras ? '<h4>Not in the key</h4><ul class="extras">' + extras + '</ul>' : '') +
      (a.suggestion ? '<p class="mark-next"><b>Next step:</b> ' + esc(a.suggestion) + '</p>' : '') +
      '<p class="muted small">Marked by ' + esc(LLM.PROVIDERS[S.cfg.provider]) + ' · ' + esc(S.cfg.model) + ' against ' + (S.key.status === 'provisional' ? 'a provisional answer key' : 'the answer key') + '. The AI can be wrong: if a verdict looks wrong, ask about it below.</p>';
    $('askPanel').hidden = false;
  }

  /* ---------- questions ---------- */
  async function ask() {
    const q = $('askIn').value.trim();
    if (!q || S.busy) return;
    if (!S.cfg) { openSettings(); return; }
    S.chat.push({ role: 'user', content: q }); $('askIn').value = ''; drawChat();
    busy(true, 'ask');
    const ctx = 'ANSWER KEY\n' + keyText(S.key) + '\n\nTHE LEARNER\'S CURRENT DIAGRAM\n' + diagramText(S.diagram) + '\n\n' + gameText() +
      '\n\nTHE MARKING THEY RECEIVED\n' + JSON.stringify({ overall: S.marking.overall, verdicts: S.marking.verdicts, suggestion: S.marking.suggestion });
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
    $('askBtn').addEventListener('click', ask);
    $('askIn').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    $('whySave').addEventListener('click', saveWhy);
    $('whyIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveWhy(); });
    $('recBtn').addEventListener('click', downloadRecord);
    $('jsonBtn').addEventListener('click', function () { if (S.diagram) download('my-model.json', JSON.stringify(S.diagram, null, 1), 'application/json'); });
    drawSettings();
  }
  return { init: init, show: show, startGame: startGame, weeksUpTo: weeksUpTo, gameEnd: gameEnd, _state: S, _diagramText: diagramText, _keyText: keyText, MARK_SYSTEM: MARK_SYSTEM, ASK_SYSTEM: ASK_SYSTEM };
})();

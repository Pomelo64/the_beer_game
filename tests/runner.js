/* Beer Game Lab's test runner. Submits the built-in test diagrams to Evaluate.run, the
   evaluation a learner's submission gets, and scores the results with score.js.
   TEST_DATA = { sheet: [...answer_sheet.json], diagrams: { 1: {...}, ... } } is written in by build.py. */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  let KEY = TEST_DATA.sheet;   // the answer sheet
  const DIAGRAMS = TEST_DATA.diagrams;
  const byId = function (id) { return Score.index(KEY)[id]; };   // by number, or by an earlier version's label (A1, B7...)
  /* results from earlier versions name the tests A1, B7...: give them their numbers */
  const normalise = function (runs) { runs.forEach(function (r) { const k = byId(r.id); if (k && r.id !== k.id) { r.old_label = r.id; r.id = k.id; r.name = k.name; } }); return runs; };

  /* The learner's game given to the wording call: fixed, so that every run gets the same one.
     A typical panicky game, and a typical first explanation. */
  const GAME_ORDERS = [4, 4, 4, 4, 4, 8, 12, 16, 20, 20, 16, 12, 8, 4, 0, 0, 0, 0, 4, 8, 8, 12, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];
  const SAID = 'The customers kept changing and the wholesaler could not keep up, so I ordered more and then had too much.';
  const gameText = function (said) {
    const g = Engine.newGame(0, 'plain');
    for (let w = 0; w < Engine.CFG.weeksPlayed; w++) { Engine.beginWeek(g); Engine.endWeek(g, { 0: GAME_ORDERS[w] }); }
    return Evaluate.gameRecordText(g, { wom: false, finished: true, said: said });
  };
  const GAME_TEXT = gameText(SAID);
  /* A test may give its own explanation from the learner (answer sheet field "said"): id 10 tests whether the wording endorses a wrong one. */
  const gameTextFor = function (id) { const k = KEY.find(function (x) { return x.id === id; }); return k && k.said ? gameText(k.said) : GAME_TEXT; };

  /* ---------- rehearsal: an interpretation exactly as the answer sheet gives it, with no AI ---------- */
  const realCompleteJson = LLM.completeJson;
  LLM.completeJson = async function (cfg, system, user, maxTokens, opts) {
    if (cfg.provider !== 'rehearsal') return realCompleteJson(cfg, system, user, maxTokens, opts);
    const meta = { provider: 'rehearsal', model: 'the answer sheet', temperature: 'none', ms: 0, usage: { input: 0, output: 0 }, text: null };
    if (system !== Evaluate.MAP_SYSTEM) return [null, 'Rehearsal: no wording, so the rules word the slides.', meta];
    const k = KEY.find(function (x) { return x.id === cfg.testId; }), want = {};
    Object.keys(k.expected_classification).forEach(function (n) {   // "arrival rate (2) [flow a -> b]" -> name and ends, without "(2)"
      const m = n.match(/^(.*?)(?: \[flow (.*) -> (.*)\])?$/), base = function (x) { return x == null ? x : x.replace(/ \(\d+\)$/, ''); };
      want[base(m[1]) + '|' + base(m[2]) + '|' + base(m[3])] = k.expected_classification[n];
    });
    const out = { elements: [], extras: [] };
    String(typeof user === 'string' ? user : user[0].content).split('\n').forEach(function (line) {
      const m = line.match(/^(E\d+) (stock|flow|auxiliary) "([^"]*)"(?:, from (a cloud \(outside the model\)|\(unattached\)|E\d+ "[^"]*"|"[^"]*") to (a cloud \(outside the model\)|\(unattached\)|E\d+ "[^"]*"|"[^"]*"))?$/); if (!m) return;
      const end = function (t) { if (t == null) return undefined; if (/^a cloud/.test(t)) return 'cloud'; if (t === '(unattached)') return 'null'; const q = t.match(/"([^"]*)"/); return q ? q[1] : t; };
      const c = want[m[3] + '|' + end(m[4]) + '|' + end(m[5])];
      if (Array.isArray(c)) out.elements.push({ id: m[1], concepts: c, reason: 'the answer sheet' }); else out.extras.push({ id: m[1], comment: 'not part of the game, as the answer sheet says' });
    });
    meta.text = JSON.stringify(out);
    return [out, null, meta];
  };

  /* ---------- the plan ---------- */
  const PROVIDERS = [['rehearsal', 'Rehearsal (the answer sheet, no AI)'], ['anthropic', LLM.PROVIDERS.anthropic], ['openai', LLM.PROVIDERS.openai], ['gemini', LLM.PROVIDERS.gemini]];
  const ROW_DEFAULTS = [['anthropic', 5], ['openai', 2], ['gemini', 2]];
  function drawRows() {
    $('modelRows').innerHTML = ROW_DEFAULTS.map(function (d, i) {
      return '<tr><td><select id="prov' + i + '">' + '<option value="">(not used)</option>' + PROVIDERS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === d[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></td>' +
        '<td><input id="model' + i + '" type="text" spellcheck="false" placeholder="' + esc(LLM.DEFAULT_MODELS[d[0]] || '') + '"></td>' +
        '<td><input id="key' + i + '" type="password" autocomplete="off" placeholder="' + esc(LLM.KEY_PLACEHOLDER[d[0]] || '') + '"></td>' +
        '<td><input id="runs' + i + '" type="number" min="0" max="20" value="' + d[1] + '"></td></tr>';
    }).join('');
    ROW_DEFAULTS.forEach(function (d, i) {
      $('prov' + i).addEventListener('change', function () { const p = this.value; $('model' + i).placeholder = LLM.DEFAULT_MODELS[p] || (p === 'rehearsal' ? 'the answer sheet' : ''); $('key' + i).placeholder = LLM.KEY_PLACEHOLDER[p] || (p === 'rehearsal' ? 'no key needed' : ''); drawPlan(); });
      ['model', 'key', 'runs'].forEach(function (f) { $(f + i).addEventListener('input', drawPlan); });
    });
  }
  function models() {
    return ROW_DEFAULTS.map(function (d, i) {
      const p = $('prov' + i).value, runs = Math.max(0, Math.min(20, parseInt($('runs' + i).value, 10) || 0));
      if (!p || !runs) return null;
      const key = $('key' + i).value.trim(); if (p !== 'rehearsal' && !key) return null;
      return { provider: p, model: p === 'rehearsal' ? 'the answer sheet' : ($('model' + i).value.trim() || LLM.DEFAULT_MODELS[p]), key: key, runs: runs };
    }).filter(Boolean);
  }
  /* The two rows of boxes narrow the tests down: a row with nothing ticked does not narrow at all.
     Each box's count is how many tests it would give, with the other row as it stands. */
  const ticked = function (pre, keys) { return keys.filter(function (x) { const b = $(pre + x); return b && b.checked; }); };
  const fits = function (k, types, sources) { return (!types.length || types.indexOf(Score.typeOf(k)) >= 0) && (!sources.length || sources.indexOf(k.source) >= 0); };
  function chosenIds() {
    const only = $('only').value.replace(/id/gi, ' ').split(/[\s,;]+/).map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; });
    const types = ticked('type', Object.keys(Score.TYPES)), sources = ticked('source', Object.keys(Score.SOURCES));
    return KEY.filter(function (k) { return only.length ? only.indexOf(k.id) >= 0 : fits(k, types, sources); }).map(function (k) { return k.id; });
  }
  function drawCounts() {
    const types = ticked('type', Object.keys(Score.TYPES)), sources = ticked('source', Object.keys(Score.SOURCES));
    Object.keys(Score.TYPES).forEach(function (t) { $('ntype' + t).textContent = KEY.filter(function (k) { return fits(k, [t], sources); }).length; });
    Object.keys(Score.SOURCES).forEach(function (x) { $('nsource' + x).textContent = KEY.filter(function (k) { return fits(k, types, [x]); }).length; });
  }
  const runKey = function (id, m, run) { return id + '|' + m.provider + '/' + m.model + '|' + run; };
  function tasks() {
    const ms = models(), ids = chosenIds(), done = {}, T = [];
    results.runs.forEach(function (r) { if (r.status !== 'error') done[runKey(r.id, r.model, r.run)] = 1; });
    const most = Math.max.apply(null, [0].concat(ms.map(function (m) { return m.runs; })));
    for (let run = 1; run <= most; run++) ids.forEach(function (id) { ms.forEach(function (m) {   // run by run, so stopping early leaves a balanced set
      if (run <= m.runs && !done[runKey(id, m, run)]) T.push({ id: id, m: m, run: run });
    }); });
    return T;
  }
  function drawPlan() {
    const ms = models(), T = tasks(), ids = chosenIds();
    $('plan').textContent = ids.length + ' diagrams × ' + (ms.map(function (m) { return m.runs + ' run' + (m.runs === 1 ? '' : 's') + ' with ' + m.model; }).join(', ') || 'no model yet') +
      ': ' + T.length + ' evaluations to do' + (results.runs.length ? ' (' + results.runs.length + ' already in the results)' : '') + '.';
    $('startBtn').disabled = running || !T.length;
    // why Start is grey, said where it is
    const keyless = ROW_DEFAULTS.some(function (d, i) { return $('prov' + i).value && $('prov' + i).value !== 'rehearsal' && !$('key' + i).value.trim(); });
    $('startWhy').textContent = running || T.length ? '' : !ids.length ? 'No tests are chosen: untick a box in section 2, or empty "Only these".'
      : !ms.length ? (keyless ? 'Paste an API key into a model row (or choose Rehearsal) to start.' : 'Choose a model, with at least one run, in section 1.')
      : 'Every run asked for is already in the results: raise Runs, add a model, or download and clear the results.';
    if ($('ntypeNA')) drawCounts();
  }

  /* ---------- running ---------- */
  let results = newResults(), running = false, stopping = false;
  function newResults() {
    return { format: 'beer-game-lab-test-results', version: 2, app_version: APP_VERSION, created: new Date().toISOString(),
      settings: { reading_temperature: Evaluate.SETTINGS.reading.temperature, wording_temperature: 'default',
        reading_max_tokens: Evaluate.SETTINGS.reading.maxTokens, wording_max_tokens: Evaluate.SETTINGS.wording.maxTokens },
      game_text: GAME_TEXT, prompts: { reading: Evaluate.MAP_SYSTEM, wording: Evaluate.WORD_SYSTEM },
      classification_requests: {},   // by test: what the classification call is sent, the same in every run of that test
      runs: [] };
  }
  async function runOne(t) {
    const cfg = { provider: t.m.provider, key: t.m.key, model: t.m.model, testId: t.id };
    const started = new Date().toISOString();
    let ev;
    try { ev = await Evaluate.run({ cfg: cfg, key: KEYS.plain, diagram: DIAGRAMS[t.id], gameText: gameTextFor(t.id), prev: null }); }
    catch (e) { ev = { status: 'error', error: String(e && e.message || e), calls: [], raw: {}, ms: 0 }; }
    const sh = Marking.shown, map = ev.map || null;
    const said = (KEY.find(function (x) { return x.id === t.id; }) || {}).said;
    const rec = { id: t.id, name: (byId(t.id) || {}).name, said: said || null, model: { provider: t.m.provider, model: t.m.model }, run: t.run, started: started,
      status: ev.status, error: ev.error || null, ms: ev.ms, calls: ev.calls, raw: ev.raw, retried: !!ev.retried,
      reading: map ? (function () { const o = {}; Object.keys(map.map).forEach(function (l) { o[sh(l)] = map.map[l]; }); return o; })() : null,
      extras: map ? map.extras.map(function (x) { return sh(x.element); }) : null,
      missing: map ? map.missing.map(function (id) { return sh(ev.list.ids[id]); }) : null,
      notation: (ev.notation || []).map(function (n) { return n.id; }) };
    // what each AI call was sent besides its system prompt: the classification request once per test, the rest per run
    const q = ev.requests || { reading: [], wording: null }, cr = results.classification_requests = results.classification_requests || {};
    if (q.reading[0] && !(t.id in cr)) cr[t.id] = q.reading[0];
    rec.requests = { classification: q.reading[0] && q.reading[0] === cr[t.id] ? 'as classification_requests[' + t.id + ']' : (q.reading[0] || null),
      classification_again: q.reading[1] || null, wording: q.wording || null };
    if (ev.status === 'done') {
      rec.failing = ev.fails.map(function (m) { return m.id; });
      rec.optional_passed = ev.mech.mechanisms.filter(function (m) { return m.weight === 'optional' && m.pass; }).map(function (m) { return m.id; });
      rec.verdicts = ev.verdicts; rec.decision_note = ev.mech.decisionNote;
      rec.words = ev.words; rec.worded_by = ev.words ? 'ai' : 'rules';
    }
    return rec;
  }
  async function start() {
    const T = tasks(); if (!T.length) return;
    running = true; stopping = false; $('startBtn').disabled = true; $('stopBtn').disabled = false;
    let next = 0, finished = 0; const total = T.length, par = parseInt($('parallel').value, 10) || 1;
    const show = function (txt) { $('status').textContent = txt; $('barFill').style.width = Math.round(100 * finished / total) + '%'; };
    show('Running: 0 of ' + total + ' done.');
    async function worker() {
      while (!stopping && next < T.length) {
        const t = T[next++];
        const r = await runOne(t);
        results.runs.push(r); finished++; addLog(r); save(); drawResults();
        show((stopping ? 'Stopping after the current runs: ' : 'Running: ') + finished + ' of ' + total + ' done. Last: id ' + t.id + ' with ' + t.m.model + ', run ' + t.run + '.');
      }
    }
    await Promise.all(Array.from({ length: Math.min(par, T.length) }, worker));
    running = false; $('stopBtn').disabled = true;
    show((stopping ? 'Stopped: ' : 'Finished: ') + finished + ' of ' + total + ' done. Download the results and the report below.');
    drawPlan();
  }

  /* ---------- the log, the results and the files ---------- */
  function addLog(r) {
    const k = byId(r.id);
    let caught = '<td>–</td>', alarms = '<td>–</td>', interp = '<td>–</td>';   // TP of the flaws; the FPs; the classification
    if (r.status === 'done' && k && DIAGRAMS[k.id]) {
      const m = Score.mark(k, Score.runFlags(r, DIAGRAMS[k.id]));
      caught = '<td class="' + (m.missed.length ? 'bad' : 'good') + '">' + m.caught.length + ' / ' + m.missed.length + '</td>';
      alarms = '<td class="' + (m.falseAlarms.length ? 'bad' : 'good') + '">' + (m.falseAlarms.length ? m.falseAlarms.length + ': ' + esc(m.falseAlarms.map(Score.describe).join('; ')) : '0') + '</td>';
      const s = Score.score({ runs: [r] }, [k], { [k.id]: DIAGRAMS[k.id] }).byModel[r.model.provider + ' / ' + r.model.model];
      interp = '<td>' + esc(s.interpretation.right + ' of ' + s.interpretation.elements) + '</td>';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(k ? k.label + ' ' + k.name : r.id) + '</td><td>' + esc(r.model.model) + '</td><td>' + r.run + '</td><td' + (r.status === 'done' ? '' : ' class="bad"') + '>' +
      esc(r.status === 'done' ? 'evaluated' : r.status === 'unread' ? 'stopped: elements unclassified' : 'error: ' + r.error) + '</td>' + caught + alarms + interp + '<td>' + (r.ms / 1000).toFixed(1) + ' s</td>';
    $('log').appendChild(tr);
  }
  function drawResults() {
    const has = results.runs.length > 0;
    ['dlRes', 'dlRep', 'dlSlides', 'dlTr'].forEach(function (id) { $(id).disabled = !has; });
    const s = Score.score(results, KEY, DIAGRAMS), ra = s.rulesAlone;
    $('q3').innerHTML = '<b>The rules alone</b>, given the answer sheet\'s classification of the elements (no AI): TP ' + ra.caught + ', FN ' + (ra.flaws - ra.caught) + ', FP ' + ra.falseAlarms.length + '.' +
      (ra.missed.length ? ' The FNs: ' + esc(ra.missed.join('; ')) + '.' : '');
    if (!has) { $('summary').innerHTML = ''; return; }
    $('summary').innerHTML = '<table><thead><tr><th>Model</th><th>Runs</th><th>TP</th><th>FN</th><th>FP (rules)</th><th>FP (AI)</th><th>TN</th><th>Recall</th><th>Precision</th><th>Specificity</th><th>F1</th><th>Classification accuracy</th><th>Median time</th></tr></thead><tbody>' +
      s.models.map(function (m) { const x = s.byModel[m];
        return '<tr><td>' + esc(m) + '</td><td>' + x.done + ' of ' + x.runs + '</td><td>' + x.tp + '</td><td>' + x.fn + '</td><td>' + x.fp + '</td><td>' + x.fpAI + '</td><td>' + x.tn + '</td><td>' + x.recall +
          '</td><td>' + x.precision + '</td><td>' + x.specificity + '</td><td>' + x.f1 + '</td><td>' + x.interpretation.share + '</td><td>' + (x.cost.medianSeconds == null ? '–' : x.cost.medianSeconds.toFixed(1) + ' s') + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = function () { return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); };
  /* a copy in this browser, in case the page is closed before the results are downloaded */
  let warned = false;
  function save() {
    try { localStorage.setItem('bgl.testResults', JSON.stringify(results)); if (warned) { warned = false; $('saveWarn').textContent = ''; } }
    catch (e) {   // the browser's copy is full: say so, the runs are still in the page
      if (!warned) { warned = true; $('saveWarn').textContent = 'The browser\'s copy of the results is full, so a closed page could no longer carry on. The runs are safe while this page is open: download the results (section 4) now and then.'; }
    }
  }

  /* ---------- wiring ---------- */
  function init() {
    $('ver').textContent = APP_VERSION; $('nTests').textContent = KEY.length;
    drawRows();
    const box = function (pre, key, label) { return '<label><input type="checkbox" id="' + pre + key + '"><span>' + esc(label) + ' (<span id="n' + pre + key + '"></span>)</span></label>'; };
    $('groups').innerHTML = '<p class="muted">All tests run unless you tick boxes to narrow them down. Ticking in both rows gives the tests that fit both.</p>' +
      '<p class="muted">Type of flaw</p><div class="checks">' + Object.keys(Score.TYPES).map(function (t) { return box('type', t, Score.TYPES[t]); }).join('') + '</div>' +
      '<p class="muted">Designed by</p><div class="checks">' + Object.keys(Score.SOURCES).map(function (x) { return box('source', x, Score.SOURCES[x]); }).join('') + '</div>';
    Object.keys(Score.TYPES).forEach(function (t) { $('type' + t).addEventListener('change', drawPlan); });
    Object.keys(Score.SOURCES).forEach(function (s) { $('source' + s).addEventListener('change', drawPlan); });
    $('only').addEventListener('input', drawPlan);
    $('startBtn').addEventListener('click', start);
    $('stopBtn').addEventListener('click', function () { stopping = true; $('stopBtn').disabled = true; });
    $('dlRes').addEventListener('click', function () { download('beer-game-lab-test-results-' + stamp() + '.json', JSON.stringify(results, null, 1), 'application/json'); });
    $('dlRep').addEventListener('click', function () { download('beer-game-lab-test-report-' + stamp() + '.md', Score.report(results, KEY, DIAGRAMS), 'text/markdown'); });
    $('dlTr').addEventListener('click', function () { download('beer-game-lab-transcripts-' + stamp() + '.md', Score.transcripts(results, KEY, DIAGRAMS), 'text/markdown'); });
  $('dlSlides').addEventListener('click', function () { download('beer-game-lab-explanations-to-rate-' + stamp() + '.csv', Score.ratingCsv(results, KEY, DIAGRAMS), 'text/csv'); });
    $('clearBtn').addEventListener('click', function () {
      if (running || (results.runs.length && !window.confirm('Clear all ' + results.runs.length + ' runs from this page? Download the results first if you want to keep them.'))) return;
      results = newResults(); $('log').innerHTML = ''; save(); drawResults(); drawPlan(); $('status').textContent = 'Results cleared.';
    });
    $('loadResBtn').addEventListener('click', function () { $('resFile').value = ''; $('resFile').click(); });
    $('loadKeyBtn').addEventListener('click', function () { $('keyFile').value = ''; $('keyFile').click(); });
    $('resFile').addEventListener('change', function () { readFile(this.files[0], function (o) {
      if (!o || o.format !== 'beer-game-lab-test-results') { $('status').textContent = 'That is not a results file from this page.'; return; }
      const have = {}; results.runs.forEach(function (r) { have[runKey(r.id, r.model, r.run)] = 1; });
      normalise(o.runs).forEach(function (r) { if (!have[runKey(r.id, r.model, r.run)]) results.runs.push(r); });
      const cr = results.classification_requests = results.classification_requests || {};
      Object.keys(o.classification_requests || {}).forEach(function (id) { const k = byId(id); if (k && !(k.id in cr)) cr[k.id] = o.classification_requests[id]; });
      if (o.created < results.created) results.created = o.created;
      $('log').innerHTML = ''; results.runs.forEach(addLog); save(); drawResults(); drawPlan();
      $('status').textContent = 'Loaded ' + o.runs.length + ' runs. Start continues with the runs not yet done' + (o.app_version !== APP_VERSION ? '. Note: they were made with app version ' + o.app_version + ', not ' + APP_VERSION + '.' : '.');
    }); });
    $('keyFile').addEventListener('change', function () { readFile(this.files[0], function (o) {
      if (!Array.isArray(o) || !o.every(function (k) { return k.id && Array.isArray(k.flaws) && k.expected_classification; })) { $('status').textContent = 'That is not an answer sheet (answer_sheet.json).'; return; }
      if (o.some(function (k) { return !DIAGRAMS[k.id]; })) { $('status').textContent = 'That answer sheet names diagrams this page does not have.'; return; }
      KEY = o; drawResults(); drawPlan(); $('status').textContent = 'Answer sheet loaded: ' + o.length + ' diagrams. The marks now use it.';
    }); });
    try {   // results left in this browser by a page that was closed
      const old = JSON.parse(localStorage.getItem('bgl.testResults') || 'null');
      if (old && old.runs && old.runs.length) { results = old; normalise(results.runs); results.runs.forEach(addLog); $('status').textContent = 'Results from an earlier session in this browser were restored: ' + old.runs.length + ' runs. Start continues with the rest.'; }
    } catch (e) {}
    drawResults(); drawPlan();
  }
  function readFile(f, then) { if (!f) return; const rd = new FileReader(); rd.onload = function () { let o; try { o = JSON.parse(rd.result); } catch (e) { $('status').textContent = 'That file is not JSON.'; return; } then(o); }; rd.readAsText(f); }
  init();
})();

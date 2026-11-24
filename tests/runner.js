/* Beer Game Lab's test runner. Submits the built-in test diagrams to Evaluate.run, the
   evaluation a learner's submission gets, and scores the results with score.js.
   TEST_DATA = { key: [...key.json], diagrams: { A1: {...}, ... } } is written in by build.py. */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  let KEY = TEST_DATA.key;
  const DIAGRAMS = TEST_DATA.diagrams;
  const GROUP_NAMES = { A: 'A. Correct', B: 'B. One mechanism', C: 'C. One notation rule', D: 'D. Several errors', E: 'E. Unrelated or misleading', F: 'F. Drawn by hand', G: 'G. From the literature' };

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
  /* A test may give its own explanation from the learner (key field "said"): G10 tests whether the wording endorses a wrong one. */
  const gameTextFor = function (id) { const k = KEY.find(function (x) { return x.id === id; }); return k && k.said ? gameText(k.said) : GAME_TEXT; };

  /* ---------- rehearsal: a reader that answers exactly as the key says, with no AI ---------- */
  const realCompleteJson = LLM.completeJson;
  LLM.completeJson = async function (cfg, system, user, maxTokens, opts) {
    if (cfg.provider !== 'rehearsal') return realCompleteJson(cfg, system, user, maxTokens, opts);
    const meta = { provider: 'rehearsal', model: 'the key', temperature: 'none', ms: 0, usage: { input: 0, output: 0 }, text: null };
    if (system !== Evaluate.MAP_SYSTEM) return [null, 'Rehearsal: no wording, so the rules word the slides.', meta];
    const k = KEY.find(function (x) { return x.id === cfg.testId; }), want = {};
    Object.keys(k.expected_reading).forEach(function (n) {   // "arrival rate (2) [flow a -> b]" -> name and ends, without "(2)"
      const m = n.match(/^(.*?)(?: \[flow (.*) -> (.*)\])?$/), base = function (x) { return x == null ? x : x.replace(/ \(\d+\)$/, ''); };
      want[base(m[1]) + '|' + base(m[2]) + '|' + base(m[3])] = k.expected_reading[n];
    });
    const out = { elements: [], extras: [] };
    String(typeof user === 'string' ? user : user[0].content).split('\n').forEach(function (line) {
      const m = line.match(/^(E\d+) (stock|flow|auxiliary) "([^"]*)"(?:, from (a cloud \(outside the model\)|\(unattached\)|E\d+ "[^"]*"|"[^"]*") to (a cloud \(outside the model\)|\(unattached\)|E\d+ "[^"]*"|"[^"]*"))?$/); if (!m) return;
      const end = function (t) { if (t == null) return undefined; if (/^a cloud/.test(t)) return 'cloud'; if (t === '(unattached)') return 'null'; const q = t.match(/"([^"]*)"/); return q ? q[1] : t; };
      const c = want[m[3] + '|' + end(m[4]) + '|' + end(m[5])];
      if (Array.isArray(c)) out.elements.push({ id: m[1], concepts: c, reason: 'the key' }); else out.extras.push({ id: m[1], comment: 'the key: extra' });
    });
    meta.text = JSON.stringify(out);
    return [out, null, meta];
  };

  /* ---------- the plan ---------- */
  const PROVIDERS = [['rehearsal', 'Rehearsal (the key, no AI)'], ['anthropic', LLM.PROVIDERS.anthropic], ['openai', LLM.PROVIDERS.openai], ['gemini', LLM.PROVIDERS.gemini]];
  const ROW_DEFAULTS = [['anthropic', 5], ['openai', 2], ['gemini', 2]];
  function drawRows() {
    $('modelRows').innerHTML = ROW_DEFAULTS.map(function (d, i) {
      return '<tr><td><select id="prov' + i + '">' + '<option value="">(not used)</option>' + PROVIDERS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === d[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></td>' +
        '<td><input id="model' + i + '" type="text" spellcheck="false" placeholder="' + esc(LLM.DEFAULT_MODELS[d[0]] || '') + '"></td>' +
        '<td><input id="key' + i + '" type="password" autocomplete="off" placeholder="' + esc(LLM.KEY_PLACEHOLDER[d[0]] || '') + '"></td>' +
        '<td><input id="runs' + i + '" type="number" min="0" max="20" value="' + d[1] + '"></td></tr>';
    }).join('');
    ROW_DEFAULTS.forEach(function (d, i) {
      $('prov' + i).addEventListener('change', function () { const p = this.value; $('model' + i).placeholder = LLM.DEFAULT_MODELS[p] || (p === 'rehearsal' ? 'the key' : ''); $('key' + i).placeholder = LLM.KEY_PLACEHOLDER[p] || (p === 'rehearsal' ? 'no key needed' : ''); drawPlan(); });
      ['model', 'key', 'runs'].forEach(function (f) { $(f + i).addEventListener('input', drawPlan); });
    });
  }
  function models() {
    return ROW_DEFAULTS.map(function (d, i) {
      const p = $('prov' + i).value, runs = Math.max(0, Math.min(20, parseInt($('runs' + i).value, 10) || 0));
      if (!p || !runs) return null;
      const key = $('key' + i).value.trim(); if (p !== 'rehearsal' && !key) return null;
      return { provider: p, model: p === 'rehearsal' ? 'the key' : ($('model' + i).value.trim() || LLM.DEFAULT_MODELS[p]), key: key, runs: runs };
    }).filter(Boolean);
  }
  function chosenIds() {
    const only = $('only').value.split(/[\s,;]+/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
    return KEY.map(function (k) { return k.id; }).filter(function (id) {
      if (only.length) return only.indexOf(id) >= 0;
      const box = $('grp' + id[0]); return box && box.checked;
    });
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
  }

  /* ---------- running ---------- */
  let results = newResults(), running = false, stopping = false;
  function newResults() {
    return { format: 'beer-game-lab-test-results', version: 1, app_version: APP_VERSION, created: new Date().toISOString(),
      settings: { reading_temperature: Evaluate.SETTINGS.reading.temperature, wording_temperature: 'default',
        reading_max_tokens: Evaluate.SETTINGS.reading.maxTokens, wording_max_tokens: Evaluate.SETTINGS.wording.maxTokens },
      game_text: GAME_TEXT, prompts: { reading: Evaluate.MAP_SYSTEM, wording: Evaluate.WORD_SYSTEM }, runs: [] };
  }
  async function runOne(t) {
    const cfg = { provider: t.m.provider, key: t.m.key, model: t.m.model, testId: t.id };
    const started = new Date().toISOString();
    let ev;
    try { ev = await Evaluate.run({ cfg: cfg, key: KEYS.plain, diagram: DIAGRAMS[t.id], gameText: gameTextFor(t.id), prev: null }); }
    catch (e) { ev = { status: 'error', error: String(e && e.message || e), calls: [], raw: {}, ms: 0 }; }
    const sh = Marking.shown, map = ev.map || null;
    const said = (KEY.find(function (x) { return x.id === t.id; }) || {}).said;
    const rec = { id: t.id, group: t.id[0], said: said || null, model: { provider: t.m.provider, model: t.m.model }, run: t.run, started: started,
      status: ev.status, error: ev.error || null, ms: ev.ms, calls: ev.calls, raw: ev.raw, retried: !!ev.retried,
      reading: map ? (function () { const o = {}; Object.keys(map.map).forEach(function (l) { o[sh(l)] = map.map[l]; }); return o; })() : null,
      extras: map ? map.extras.map(function (x) { return sh(x.element); }) : null,
      missing: map ? map.missing.map(function (id) { return sh(ev.list.ids[id]); }) : null,
      notation: (ev.notation || []).map(function (n) { return n.id; }) };
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
        show((stopping ? 'Stopping after the current runs: ' : 'Running: ') + finished + ' of ' + total + ' done. Last: ' + t.id + ' with ' + t.m.model + ', run ' + t.run + '.');
      }
    }
    await Promise.all(Array.from({ length: Math.min(par, T.length) }, worker));
    running = false; $('stopBtn').disabled = true;
    show((stopping ? 'Stopped: ' : 'Finished: ') + finished + ' of ' + total + ' done. Download the results and the report below.');
    drawPlan();
  }

  /* ---------- the log, the results and the files ---------- */
  function addLog(r) {
    const k = KEY.find(function (x) { return x.id === r.id; }) || { expected: { failing: [] }, expected_reading: {} };
    let verdict = '', reading = '';
    if (r.status === 'done') {
      const want = (k.expected.failing || []).slice().sort().join(' '), got = (r.failing || []).slice().sort().join(' ');
      verdict = want === got ? '<td class="good">as the key</td>' : '<td class="bad">' + esc(got || 'none') + ' (key: ' + esc(want || 'none') + ')</td>';
      const s = Score.score({ runs: [r] }, KEY).byModel[r.model.provider + ' / ' + r.model.model];
      reading = '<td>' + esc(s.q1.right + ' of ' + s.q1.elements) + '</td>';
    } else { verdict = '<td class="bad">–</td>'; reading = '<td>–</td>'; }
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(r.id) + '</td><td>' + esc(r.model.model) + '</td><td>' + r.run + '</td><td' + (r.status === 'done' ? '' : ' class="bad"') + '>' +
      esc(r.status === 'done' ? 'verdicts' : r.status === 'unread' ? 'stopped: unread' : 'error: ' + r.error) + '</td>' + verdict + reading + '<td>' + (r.ms / 1000).toFixed(1) + ' s</td>';
    $('log').appendChild(tr);
  }
  function q3() {   // the rules on the key's own reading, against the key's verdicts: needs no AI
    const differ = []; let agree = 0;
    KEY.forEach(function (k) {
      const d = DIAGRAMS[k.id]; if (!d) return;
      const u = Marking.unique(d), map = {};
      [].concat(u.stocks || [], u.flows || [], u.auxiliaries || []).forEach(function (e) {
        const f = (u.flows || []).indexOf(e) >= 0;
        const n = Marking.shown(e.label) + (f ? ' [flow ' + Marking.shown(e.from) + ' -> ' + Marking.shown(e.to) + ']' : '');
        if (Array.isArray(k.expected_reading[n])) map[e.label] = k.expected_reading[n];
      });
      const fails = Marking.mechanisms(u, map).mechanisms.filter(function (m) { return !m.pass && m.weight !== 'optional'; }).map(function (m) { return m.id; }).sort().join(' ');
      const notes = Marking.notation(u).map(function (n) { return n.id; }).sort().join(' ');
      const wantF = (k.expected.failing || []).slice().sort().join(' '), wantN = (k.expected.notation || []).slice().sort().join(' ');
      if (fails === wantF && notes === wantN) agree++; else differ.push(k.id + ': rules ' + ((notes + ' ' + fails).trim() || 'nothing found') + ', key ' + ((wantN + ' ' + wantF).trim() || 'nothing found'));
    });
    return { agree: agree, of: KEY.length, differ: differ };
  }
  function drawResults() {
    const Q3 = q3();
    $('q3').innerHTML = '<b>Q3, rules:</b> with the key\'s own reading, the rules give the key\'s result for ' + Q3.agree + ' of ' + Q3.of + ' diagrams' + (Q3.differ.length ? ': ' + esc(Q3.differ.join('; ')) : '.') + ' This needs no AI.';
    const has = results.runs.length > 0;
    ['dlRes', 'dlRep', 'dlSlides'].forEach(function (id) { $(id).disabled = !has; });
    if (!has) { $('summary').innerHTML = ''; return; }
    const s = Score.score(results, KEY);
    $('summary').innerHTML = '<table><thead><tr><th>Model</th><th>Runs</th><th>Q1 reading</th><th>Q2 verdicts</th><th>False failures</th><th>False passes</th><th>Q5 same verdicts</th><th>Q6 names and layout</th><th>Q7 unread / errors</th><th>Q8 median time</th></tr></thead><tbody>' +
      s.models.map(function (m) { const x = s.byModel[m];
        return '<tr><td>' + esc(m) + '</td><td>' + x.done + ' of ' + x.runs + '</td><td>' + x.q1.share + '</td><td>' + x.q2.share + '</td><td>' + x.q2.falseFailures + '</td><td>' + x.q2.falsePasses +
          '</td><td>' + x.q5.share + '</td><td>' + x.q6.share + '</td><td>' + x.q7.unread + ' / ' + x.q7.errors + '</td><td>' + (x.q8.medianSeconds == null ? '–' : x.q8.medianSeconds.toFixed(1) + ' s') + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = function () { return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); };
  /* a copy in this browser, in case the page is closed before the results are downloaded */
  function save() { try { localStorage.setItem('bgl.testResults', JSON.stringify(results)); } catch (e) {} }

  /* ---------- wiring ---------- */
  function init() {
    $('ver').textContent = APP_VERSION; $('nTests').textContent = KEY.length;
    drawRows();
    $('groups').innerHTML = Object.keys(GROUP_NAMES).map(function (g) {
      const n = KEY.filter(function (k) { return k.id[0] === g; }).length;
      return '<label><input type="checkbox" id="grp' + g + '" checked> ' + esc(GROUP_NAMES[g]) + ' (' + n + ')</label>';
    }).join('');
    Object.keys(GROUP_NAMES).forEach(function (g) { $('grp' + g).addEventListener('change', drawPlan); });
    $('only').addEventListener('input', drawPlan);
    $('startBtn').addEventListener('click', start);
    $('stopBtn').addEventListener('click', function () { stopping = true; $('stopBtn').disabled = true; });
    $('dlRes').addEventListener('click', function () { download('beer-game-lab-test-results-' + stamp() + '.json', JSON.stringify(results, null, 1), 'application/json'); });
    $('dlRep').addEventListener('click', function () { download('beer-game-lab-test-report-' + stamp() + '.md', Score.report(results, KEY, q3()), 'text/markdown'); });
    $('dlSlides').addEventListener('click', function () { download('beer-game-lab-slides-to-rate-' + stamp() + '.csv', Score.slidesCsv(results), 'text/csv'); });
    $('clearBtn').addEventListener('click', function () {
      if (running || (results.runs.length && !window.confirm('Clear all ' + results.runs.length + ' runs from this page? Download the results first if you want to keep them.'))) return;
      results = newResults(); $('log').innerHTML = ''; save(); drawResults(); drawPlan(); $('status').textContent = 'Results cleared.';
    });
    $('loadResBtn').addEventListener('click', function () { $('resFile').value = ''; $('resFile').click(); });
    $('loadKeyBtn').addEventListener('click', function () { $('keyFile').value = ''; $('keyFile').click(); });
    $('resFile').addEventListener('change', function () { readFile(this.files[0], function (o) {
      if (!o || o.format !== 'beer-game-lab-test-results') { $('status').textContent = 'That is not a results file from this page.'; return; }
      const have = {}; results.runs.forEach(function (r) { have[runKey(r.id, r.model, r.run)] = 1; });
      o.runs.forEach(function (r) { if (!have[runKey(r.id, r.model, r.run)]) results.runs.push(r); });
      if (o.created < results.created) results.created = o.created;
      $('log').innerHTML = ''; results.runs.forEach(addLog); save(); drawResults(); drawPlan();
      $('status').textContent = 'Loaded ' + o.runs.length + ' runs. Start continues with the runs not yet done' + (o.app_version !== APP_VERSION ? '. Note: they were made with app version ' + o.app_version + ', not ' + APP_VERSION + '.' : '.');
    }); });
    $('keyFile').addEventListener('change', function () { readFile(this.files[0], function (o) {
      if (!Array.isArray(o) || !o.every(function (k) { return k.id && k.expected && k.expected_reading; })) { $('status').textContent = 'That is not a key file (key.json).'; return; }
      KEY = o; drawResults(); drawPlan(); $('status').textContent = 'Key loaded: ' + o.length + ' diagrams. The scores now use it.';
    }); });
    try {   // results left in this browser by a page that was closed
      const old = JSON.parse(localStorage.getItem('bgl.testResults') || 'null');
      if (old && old.runs && old.runs.length) { results = old; results.runs.forEach(addLog); $('status').textContent = 'Results from an earlier session in this browser were restored: ' + old.runs.length + ' runs. Start continues with the rest.'; }
    } catch (e) {}
    drawResults(); drawPlan();
  }
  function readFile(f, then) { if (!f) return; const rd = new FileReader(); rd.onload = function () { let o; try { o = JSON.parse(rd.result); } catch (e) { $('status').textContent = 'That file is not JSON.'; return; } then(o); }; rd.readAsText(f); }
  init();
})();

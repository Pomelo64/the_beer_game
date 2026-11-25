/* Marks the results of Beer Game Lab's tests against the answer sheet, for the performance assessment.
   Used by the test page, and on its own: node score.js results.json [answer_sheet.json] > report.md

   The answer sheet lists each test diagram's flaws. For each run of each diagram:
     TP  a flaw on the answer sheet that the feedback flags
     FN  a flaw it does not flag
     FP  a flag that no flaw on the answer sheet explains (from the rules, or from the AI)
     TN  one of the 22 rule checks that stayed silent where nothing was wrong
   The same is counted per diagram: a flawed diagram is a TP if at least one of its flaws is flagged,
   an FN if none is; a correct diagram is an FP if anything is flagged, a TN if nothing is.

   What the feedback can flag (the "flags"), all as the learner sees them:
     N1-N8, W1, W2   a notation error or warning           M1-M10        a mechanism shown as not working
     K1:<element>    a stock drawn as a flow or auxiliary   K2:<element>  a rate drawn as a stock
     extra:<element> the AI classifies the element as not part of the game (shown on the slide of how it read the diagram)
     few             the "only a few of the game's parts" message
   An element the answer sheet itself classifies as not part of the game, classified so by the AI too,
   is neither a TP nor an FP unless a flaw names it: the AI is then only describing the diagram. */
const Score = (function () {
  const MK = typeof Marking !== 'undefined' ? Marking : require('../src/sfd/marking.js');
  const MECHS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10'];
  const CHECKS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'W1', 'W2', 'K1', 'K2'].concat(MECHS);   // the 22 rule checks
  const TYPES = { NA: 'NA: correct', Sy: 'Sy: syntactic flaws', Co: 'Co: conceptual flaws', SyCo: 'SyCo: both' };
  const SOURCES = { author: 'the author', claude: 'Claude', lit: 'Claude, from the literature' };
  /* the answer sheet by id, and by the labels of earlier versions (A1, B7...), so older results still mark */
  function index(sheet) { const K = {}; sheet.forEach(function (k) { K[k.id] = k; if (k.old_label) K[k.old_label] = k; }); return K; }
  const typeOf = function (k) { const sy = k.flaws.some(function (f) { return f.type === 'syntactic'; }), co = k.flaws.some(function (f) { return f.type === 'conceptual'; }); return sy && co ? 'SyCo' : sy ? 'Sy' : co ? 'Co' : 'NA'; };
  const title = function (k) { return k.label + ' ' + k.name; };
  const pct = function (a, b) { return b ? Math.round(1000 * a / b) / 10 + '%' : '–'; };
  const median = function (xs) { xs = xs.filter(function (x) { return typeof x === 'number'; }).sort(function (a, b) { return a - b; }); if (!xs.length) return null; const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; };
  const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  const sorted = function (a) { return (a || []).slice().sort(); };
  const modelName = function (r) { return r.model.provider + ' / ' + r.model.model; };
  const MTITLE = {}; ['Deliveries take time', 'Orders pile up while you wait', 'Nothing you order is lost', 'You can serve only what you have', 'Kegs leave as customers are served',
    'Customers you cannot serve wait', 'Waiting customers are served later, from the cellar', 'Customers come from outside', 'Your cost adds up, and never falls', 'Ordering costs nothing']
    .forEach(function (t, i) { MTITLE['M' + (i + 1)] = t; });
  const PLAIN = { N1: 'two elements share a name', N2: 'a link points into a stock', N3: 'a link starts or ends at a cloud', N4: 'a flow runs to or from something that is not a stock',
    N5: 'a flow is attached at one end only', N6: 'a flow touches no stock', N7: 'a flow leaves and enters the same stock', N8: 'a stock that nothing fills or empties',
    W1: 'nothing informs a flow (warning)', W2: 'an auxiliary affects nothing (warning)', K1: 'a stock drawn as a flow or auxiliary', K2: 'a rate drawn as a stock',
    few: 'the message that the diagram shows only a few of the game\'s parts', extras: 'the AI lists the parts outside the game as not part of it' };
  /* a flag or a flaw's "caught by" entry, in plain words */
  function describe(t) {
    const c = t.split(':')[0], el = t.slice(c.length + 1);
    if (MTITLE[c]) return 'mechanism not working: ' + MTITLE[c];
    if (c === 'extra') return 'the AI lists "' + el + '" as not part of the game';
    if (c === 'K1') return '"' + el + '" is a stock drawn as a flow or auxiliary';
    if (c === 'K2') return '"' + el + '" is a rate drawn as a stock';
    return PLAIN[c] || t;
  }
  const isRule = function (t) { return t.indexOf('extra') !== 0; };   // the rules' flags, against the AI's list of extras

  /* the answer sheet's interpretation, keyed by element as the learner sees it (flows without their ends) */
  function sheetInterp(k) {
    const o = {};
    Object.keys(k.expected_classification).forEach(function (n) { o[n.replace(/ \[flow .*\]$/, '')] = k.expected_classification[n]; });
    return o;
  }
  function sheetExtras(k) { const o = sheetInterp(k), s = {}; Object.keys(o).forEach(function (n) { if (o[n] === 'extra') s[n] = 1; }); return s; }
  /* an interpretation keyed by shown names, turned into one keyed by the diagram's own labels */
  function toInternal(u, byShown) {
    const map = {};
    [].concat(u.stocks || [], u.flows || [], u.auxiliaries || []).forEach(function (e) { const v = byShown[MK.shown(e.label)]; if (Array.isArray(v)) map[e.label] = v; });
    return map;
  }
  /* what the rules flag, given an interpretation (internal labels) */
  function ruleFlags(u, map, notation, failing) {
    const f = (notation || MK.notation(u).map(function (n) { return n.id; })).slice();
    const fails = failing || MK.mechanisms(u, map).mechanisms.filter(function (m) { return !m.pass && m.weight !== 'optional'; }).map(function (m) { return m.id; });
    fails.forEach(function (m) { f.push(m); });
    MK.kindNotes(u, map).forEach(function (n) { const k = /drawn as a stock/.test(n.text) ? 'K2' : 'K1', t = k + ':' + MK.shown(n.element); if (f.indexOf(t) < 0) f.push(t); });
    if (MK.coreFound(map) < 3 && fails.length > 3) f.push('few');
    return f.filter(function (t, i) { return f.indexOf(t) === i; });
  }
  /* the flags one run showed the learner */
  function runFlags(run, d) {
    const u = MK.unique(d), map = toInternal(u, run.reading || {});
    return ruleFlags(u, map, run.notation, run.failing).concat((run.extras || []).map(function (n) { return 'extra:' + n; }));
  }
  /* does a flaw's "caught by" entry match a flag? */
  function matches(want, flag, extras) {
    if (want === flag) return true;
    if (want === 'extras') return flag.indexOf('extra:') === 0 && !!extras[flag.slice(6)];
    if ((want === 'K1' || want === 'K2') && flag.indexOf(want + ':') === 0) return true;
    return false;
  }
  /* one diagram's flags marked against its flaws */
  function mark(k, flags) {
    const extras = sheetExtras(k), flaws = k.flaws || [];
    const caught = [], missed = [], accounted = {};
    flaws.forEach(function (f) {
      const hit = flags.filter(function (fl) { return f.caught_by.some(function (w) { return matches(w, fl, extras); }); });
      hit.forEach(function (fl) { accounted[fl] = 1; });
      (hit.length ? caught : missed).push({ flaw: f, by: hit });
    });
    const falseAlarms = flags.filter(function (fl) { return !accounted[fl] && !(fl.indexOf('extra:') === 0 && extras[fl.slice(6)]); });
    const fired = {}; flags.forEach(function (fl) { fired[fl.split(':')[0]] = 1; });
    const relevant = {}; flaws.forEach(function (f) { f.caught_by.forEach(function (w) { relevant[w.split(':')[0]] = 1; }); });
    const silences = CHECKS.filter(function (c) { return !fired[c] && !relevant[c]; }).length;
    return { caught: caught, missed: missed, falseAlarms: falseAlarms, silences: silences, flaws: flaws.length };
  }
  /* the rules alone, given the answer sheet's own interpretation (no AI): what the design can catch at best */
  function rulesAlone(k, d) {
    const u = MK.unique(d), map = toInternal(u, sheetInterp(k));
    const m = mark(k, ruleFlags(u, map));
    return { missed: m.missed.map(function (x) { return x.flaw.flaw; }), caught: m.caught.length, falseAlarms: m.falseAlarms };
  }

  function score(results, sheet, diagrams) {
    const K = index(sheet);
    const runs = results.runs || [], done = runs.filter(function (r) { return r.status === 'done' && K[r.id] && diagrams[K[r.id].id]; });
    const models = []; runs.forEach(function (r) { const m = modelName(r); if (models.indexOf(m) < 0) models.push(m); });
    const out = { models: models, runs: runs.length, done: done.length, byModel: {} };
    models.forEach(function (mn) {
      const R = runs.filter(function (r) { return modelName(r) === mn; }), D = done.filter(function (r) { return modelName(r) === mn; });
      const s = { runs: R.length, done: D.length, tp: 0, fn: 0, fp: 0, fpAI: 0, tn: 0, 
        diag: { tp: 0, fn: 0, fp: 0, tn: 0 }, byType: { syntactic: [0, 0], conceptual: [0, 0] }, byKind: {}, byChannel: { rules: 0, ai: 0, both: 0 },
        missed: {}, falseAlarms: {}, perRun: {} };
      D.forEach(function (r) {
        const k = K[r.id], flags = runFlags(r, diagrams[k.id]), m = mark(k, flags);
        s.perRun[k.id + '|' + r.run] = { flags: flags, mark: m };
        s.tp += m.caught.length; s.fn += m.missed.length; s.tn += m.silences;
        m.falseAlarms.forEach(function (fl) { if (isRule(fl)) s.fp++; else s.fpAI++; const t = title(k) + ' · ' + describe(fl); s.falseAlarms[t] = (s.falseAlarms[t] || 0) + 1; });
        const tally = function (c, hit) { const T = s.byType[c.flaw.type], Kd = s.byKind[c.flaw.kind] = s.byKind[c.flaw.kind] || [0, 0, c.flaw.type]; T[1]++; Kd[1]++; if (hit) { T[0]++; Kd[0]++; } };
        m.caught.forEach(function (c) { tally(c, true);
          const ru = c.by.some(isRule), ai = c.by.some(function (fl) { return !isRule(fl); }); s.byChannel[ru && ai ? 'both' : ru ? 'rules' : 'ai']++; });
        m.missed.forEach(function (c) { tally(c, false); const t = title(k) + ' · ' + c.flaw.flaw; s.missed[t] = (s.missed[t] || 0) + 1; });
        if (m.flaws) { if (m.caught.length) s.diag.tp++; else s.diag.fn++; }
        else { if (m.falseAlarms.length) s.diag.fp++; else s.diag.tn++; }
      });
      // recall (sensitivity) TP/(TP+FN); precision TP/(TP+FP); specificity TN/(TN+FP), over the rule checks only, since TN counts rule checks; F1
      const FP = s.fp + s.fpAI;
      s.recall = pct(s.tp, s.tp + s.fn); s.precision = pct(s.tp, s.tp + FP); s.specificity = pct(s.tn, s.tn + s.fp); s.f1 = pct(2 * s.tp, 2 * s.tp + FP + s.fn);
      s.diag.recall = pct(s.diag.tp, s.diag.tp + s.diag.fn); s.diag.specificity = pct(s.diag.tn, s.diag.tn + s.diag.fp);
      // supporting measures
      let el = 0, elOk = 0; const misreads = {};
      D.forEach(function (r) {
        const k = K[r.id], want = sheetInterp(k), got = {};
        Object.keys(r.reading || {}).forEach(function (n) { got[n] = sorted(r.reading[n]); });
        (r.extras || []).forEach(function (n) { if (!got[n]) got[n] = 'extra'; });
        Object.keys(want).forEach(function (n) {
          const w = want[n] === 'extra' ? 'extra' : sorted(want[n]), a = got[n] || 'unread';
          el++; if (same(w, a)) elOk++;
          else { const t = title(k) + ' · ' + n + ' · answer sheet: ' + (w === 'extra' ? 'not part of the game' : w.join('+')) + ' · AI: ' + (a === 'extra' ? 'not part of the game' : a === 'unread' ? 'unclassified' : a.join('+')); misreads[t] = (misreads[t] || 0) + 1; }
        });
      });
      s.interpretation = { elements: el, right: elOk, share: pct(elOk, el), misreads: misreads };
      const ids = {}; D.forEach(function (r) { const id = K[r.id].id; (ids[id] = ids[id] || []).push(r); });
      let cv = 0, cvOk = 0, crOk = 0; const unstable = [];
      Object.keys(ids).forEach(function (id) {
        const rs = ids[id]; if (rs.length < 2) return;
        const ff = rs.map(function (r) { return JSON.stringify(sorted(s.perRun[id + '|' + r.run].flags)); }), fr = rs.map(function (r) { return JSON.stringify(r.reading) + JSON.stringify(sorted(r.extras)); });
        cv++; if (ff.every(function (x) { return x === ff[0]; })) cvOk++; else unstable.push(title(K[id]));
        if (fr.every(function (x) { return x === fr[0]; })) crOk++;
      });
      s.consistency = { diagrams: cv, sameFlags: cvOk, share: pct(cvOk, cv), sameInterpretation: crOk, interpretationShare: pct(crOk, cv), unstable: unstable };
      let q6 = 0, q6Ok = 0; const q6Bad = [];   // renamed or relaid versions of a diagram should get the same rule flags as it, run by run
      sheet.filter(function (k) { return k.same_flags_as; }).forEach(function (k) {
        D.filter(function (r) { return K[r.id] === k; }).forEach(function (r) {
          const base = s.perRun[k.same_flags_as + '|' + r.run]; if (!base) return;
          const fr = JSON.stringify(sorted(s.perRun[k.id + '|' + r.run].flags.filter(isRule))), fa = JSON.stringify(sorted(base.flags.filter(isRule)));
          q6++; if (fr === fa) q6Ok++; else q6Bad.push(title(k) + ' run ' + r.run);
        });
      });
      s.namesLayout = { compared: q6, same: q6Ok, share: pct(q6Ok, q6), different: q6Bad };
      s.safety = { unread: R.filter(function (r) { return r.status === 'unread'; }).length, errors: R.filter(function (r) { return r.status === 'error'; }).length,
        retried: D.filter(function (r) { return r.retried; }).length, onGap: D.filter(function (r) { return r.missing && r.missing.length; }).length,
        wordedByRules: D.filter(function (r) { return r.worded_by === 'rules'; }).length };
      const tok = function (r, k) { return (r.calls || []).reduce(function (t, c) { return t + ((c.usage && c.usage[k]) || 0); }, 0); };
      s.cost = { medianSeconds: median(D.map(function (r) { return r.ms / 1000; })), medianInput: median(D.map(function (r) { return tok(r, 'input'); })),
        medianOutput: median(D.map(function (r) { return tok(r, 'output'); })), totalInput: D.reduce(function (t, r) { return t + tok(r, 'input'); }, 0),
        totalOutput: D.reduce(function (t, r) { return t + tok(r, 'output'); }, 0) };
      out.byModel[mn] = s;
    });
    // the rules alone, with the answer sheet's interpretation
    let fl = 0, cg = 0; const gaps = [], alarms = [];
    sheet.forEach(function (k) { if (!diagrams[k.id]) return; const r = rulesAlone(k, diagrams[k.id]); fl += k.flaws.length; cg += r.caught;
      r.missed.forEach(function (f) { gaps.push(title(k) + ': ' + f); }); r.falseAlarms.forEach(function (f) { alarms.push(title(k) + ': ' + describe(f)); }); });
    out.rulesAlone = { flaws: fl, caught: cg, missed: gaps, falseAlarms: alarms };
    return out;
  }

  /* the report, as Markdown */
  function report(results, sheet, diagrams) {
    const s = score(results, sheet, diagrams), L = [];
    const round = function (x, d) { return x == null ? '–' : Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0); };
    const nFlaws = sheet.reduce(function (n, k) { return n + k.flaws.length; }, 0), nCorrect = sheet.filter(function (k) { return !k.flaws.length; }).length;
    const nSy = sheet.reduce(function (n, k) { return n + k.flaws.filter(function (f) { return f.type === 'syntactic'; }).length; }, 0);
    L.push('# Beer Game Lab: test results', '');
    L.push('App version ' + (results.app_version || '?') + '. Runs started ' + (results.created || '?') + '. ' + s.runs + ' runs, ' + s.done + ' of them evaluated in full. ' +
      'The answer sheet has ' + sheet.length + ' diagrams: ' + nCorrect + ' correct, and ' + (sheet.length - nCorrect) + ' with ' + nFlaws + ' flaws between them (' + nSy + ' syntactic, ' + (nFlaws - nSy) + ' conceptual). ' +
      'Each flaw is one correction the feedback should make.', '');
    L.push('Settings: the AI\'s classification of the elements at temperature ' + results.settings.reading_temperature + ' (where the model accepts one), its wording at the model\'s default.', '');
    L.push('**TP** (true positive): a flaw on the answer sheet that the feedback flags. **FN** (false negative): a flaw it does not flag. ' +
      '**FP** (false positive): a flag that no flaw on the answer sheet explains, from the rules or from the AI (an element of the game that the AI classifies as not part of it). ' +
      '**TN** (true negative): one of the 22 rule checks that stayed silent where nothing was wrong. One flaw often sets off several flags; they count as one TP.', '');
    L.push('Recall = TP / (TP + FN). Precision = TP / (TP + FP). Specificity = TN / (TN + FP of the rules), since TN counts the rule checks. F1 = 2TP / (2TP + FP + FN).', '');
    L.push('## Flaws', '');
    L.push('| Model | Runs | TP | FN | FP (rules) | FP (AI) | TN | Recall | Precision | Specificity | F1 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    s.models.forEach(function (m) { const x = s.byModel[m];
      L.push('| ' + m + ' | ' + x.done + ' of ' + x.runs + ' | ' + x.tp + ' | ' + x.fn + ' | ' + x.fp + ' | ' + x.fpAI + ' | ' + x.tn + ' | ' + x.recall + ' | ' + x.precision + ' | ' + x.specificity + ' | ' + x.f1 + ' |'); });
    L.push('');
    L.push('## Diagrams', '');
    L.push('A flawed diagram is a TP when at least one of its flaws is flagged, and an FN when none is. A correct diagram is an FP when anything is flagged, and a TN when nothing is.', '');
    L.push('| Model | TP | FN | FP | TN | Recall | Specificity |', '| --- | --- | --- | --- | --- | --- | --- |');
    s.models.forEach(function (m) { const x = s.byModel[m].diag; L.push('| ' + m + ' | ' + x.tp + ' | ' + x.fn + ' | ' + x.fp + ' | ' + x.tn + ' | ' + x.recall + ' | ' + x.specificity + ' |'); });
    L.push('');
    L.push('## The rules alone', '');
    L.push('Given the answer sheet\'s own classification of the elements, so with no AI: TP ' + s.rulesAlone.caught + ', FN ' + (s.rulesAlone.flaws - s.rulesAlone.caught) + ', FP ' + s.rulesAlone.falseAlarms.length +
      '. This is the most the rules can do. The FNs:', '');
    s.rulesAlone.missed.forEach(function (t) { L.push('- ' + t); });
    if (s.rulesAlone.falseAlarms.length) { L.push('', 'The FPs:', ''); s.rulesAlone.falseAlarms.forEach(function (t) { L.push('- ' + t); }); }
    L.push('');
    s.models.forEach(function (m) { const x = s.byModel[m];
      L.push('## ' + m, '');
      L.push('| Flaws | TP | FN | Recall |', '| --- | --- | --- | --- |');
      ['syntactic', 'conceptual'].forEach(function (t) { const a = x.byType[t]; L.push('| ' + (t === 'syntactic' ? 'Syntactic' : 'Conceptual') + ' | ' + a[0] + ' | ' + (a[1] - a[0]) + ' | ' + pct(a[0], a[1]) + ' |'); });
      L.push('', '| Kind of flaw | Type | TP | FN | Recall |', '| --- | --- | --- | --- | --- |');
      Object.keys(x.byKind).sort(function (a, b) { return (x.byKind[a][2] > x.byKind[b][2] ? -1 : x.byKind[a][2] < x.byKind[b][2] ? 1 : 0) || (a < b ? -1 : 1); })
        .forEach(function (kd) { const a = x.byKind[kd]; L.push('| ' + kd + ' | ' + a[2] + ' | ' + a[0] + ' | ' + (a[1] - a[0]) + ' | ' + pct(a[0], a[1]) + ' |'); });
      L.push('');
      L.push('**TPs by what flagged them:** the rules only ' + x.byChannel.rules + ', the AI only ' + x.byChannel.ai + ', both ' + x.byChannel.both + '.', '');
      const mi = Object.keys(x.missed).sort();
      if (mi.length) { L.push('**FNs** (test · flaw, with the number of runs):', ''); mi.forEach(function (t) { L.push('- ' + t + ' (' + x.missed[t] + ')'); }); L.push(''); }
      const fa = Object.keys(x.falseAlarms).sort();
      if (fa.length) { L.push('**FPs** (test · what was flagged, with the number of runs):', ''); fa.forEach(function (t) { L.push('- ' + t + ' (' + x.falseAlarms[t] + ')'); }); L.push(''); }
      L.push('**Supporting measures**', '');
      L.push('- The AI\'s classification of the elements (each element to a part of the game, or to none): ' + x.interpretation.right + ' of ' + x.interpretation.elements + ' as the answer sheet says; accuracy ' + x.interpretation.share + '.');
      L.push('- Repeats: the same flags in every run for ' + x.consistency.sameFlags + ' of ' + x.consistency.diagrams + ' diagrams (' + x.consistency.share + '); the same classification for ' + x.consistency.sameInterpretation + ' (' + x.consistency.interpretationShare + ').' +
        (x.consistency.unstable.length ? ' Flags changed between runs: ' + x.consistency.unstable.join(', ') + '.' : ''));
      L.push('- Names and layout: renamed and relaid versions of the reference (' + sheet.filter(function (k) { return k.same_flags_as; }).map(function (k) { return k.label; }).join(', ') + ') got the same rule flags as the reference in ' + x.namesLayout.same + ' of ' + x.namesLayout.compared + ' comparisons (' + x.namesLayout.share + ').' +
        (x.namesLayout.different.length ? ' Different: ' + x.namesLayout.different.join(', ') + '.' : ''));
      L.push('- Failures: ' + x.safety.unread + ' runs stopped because the AI left elements unclassified, ' + x.safety.errors + ' failed with an error, ' + x.safety.retried + ' needed a second try; ' +
        x.safety.onGap + ' gave feedback on an incomplete classification (should be 0). The rules worded the feedback in ' + x.safety.wordedByRules + ' runs.');
      L.push('- Time and tokens: median ' + round(x.cost.medianSeconds, 1) + ' s, ' + round(x.cost.medianInput) + ' input and ' + round(x.cost.medianOutput) + ' output tokens per evaluation; ' +
        x.cost.totalInput + ' and ' + x.cost.totalOutput + ' in all.', '');
      const mis = Object.keys(x.interpretation.misreads).sort();
      if (mis.length) { L.push('**Elements the AI classified differently from the answer sheet** (test · element · answer sheet · AI, with the number of runs):', ''); mis.forEach(function (t) { L.push('- ' + t + ' (' + x.interpretation.misreads[t] + ')'); }); L.push(''); }
    });
    return L.join('\n');
  }

  /* the explanations to rate by hand: one row per flaw caught, in the first full run of each diagram and model,
     with what the learner was told about it; and, for a test with its own explanation from the learner (id 10),
     what the feedback said about that */
  function ratingCsv(results, sheet, diagrams) {
    const q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const K = index(sheet);
    const rows = [['id', 'name', 'model', 'run', 'flaw', 'type', 'kind', 'caught by', 'what the learner was told', 'correct (y/n)', 'clear (y/n)', 'helps to fix it (y/n)', 'notes']];
    const seen = {};
    (results.runs || []).filter(function (r) { return r.status === 'done' && K[r.id] && diagrams[K[r.id].id]; }).forEach(function (r) {
      const k = K[r.id], id = k.id + '|' + modelName(r); if (seen[id]) return; seen[id] = 1;
      const d = diagrams[k.id], u = MK.unique(d), map = toInternal(u, r.reading || {}), w = r.words || {};
      const m = mark(k, runFlags(r, d)), mech = MK.mechanisms(u, map).mechanisms, notes = MK.notation(u), kinds = MK.kindNotes(u, map), comments = extraComments(r, u);
      const told = function (fl) {
        const c = fl.split(':')[0], el = fl.slice(c.length + 1);
        if (/^[NW]\d/.test(c)) return notes.filter(function (n) { return n.id === c; }).map(function (n) { return n.text; }).join(' ');
        if (/^M\d/.test(c)) { const x = mech.find(function (y) { return y.id === c; }); return (w.slides && w.slides[c]) || (x ? x.title + ': ' + x.hint : c); }
        if (c === 'K1' || c === 'K2') return kinds.filter(function (n) { return MK.shown(n.element) === el; }).map(function (n) { return n.text; }).join(' ');
        if (c === 'extra') return '"' + el + '" tagged "extra" on the slide "How I read your diagram"' + (comments[el] ? ': ' + comments[el] : '');
        if (c === 'few') return w.overall || 'Your diagram shows only a few of the game\'s parts so far.';
        return fl;
      };
      m.caught.forEach(function (c) {
        rows.push([k.label, k.name, modelName(r), r.run, c.flaw.flaw, c.flaw.type, c.flaw.kind, c.by.map(describe).join('; '), c.by.map(function (fl) { return told(fl); }).join('\n\n'), '', '', '', '']);
      });
      if (r.said) rows.push([k.label, k.name, modelName(r), r.run, 'The learner\'s explanation is wrong (the diagram is correct). Rate "correct" = the feedback does not go along with it', '', '', 'the wording',
        [w.overall, w.wrap].filter(Boolean).join('\n\n'), '', '', '', 'The learner wrote: ' + r.said]);
    });
    return rows.map(function (r) { return r.map(q).join(','); }).join('\n') + '\n';
  }
  /* the AI's comment on each element it called not part of the game, from its raw answer */
  function extraComments(r, u) {
    const ids = {}; let n = 0;
    [].concat(u.stocks || [], u.flows || [], u.auxiliaries || []).forEach(function (e) { ids['E' + (++n)] = MK.shown(e.label); });
    const out = {};
    ((r.raw && r.raw.reading) || []).forEach(function (t) {
      if (typeof t !== 'string') return;
      const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) return;
      try { (JSON.parse(t.slice(a, b + 1)).extras || []).forEach(function (x) { if (ids[x.id] && x.comment) out[ids[x.id]] = x.comment; }); } catch (e) { /* not JSON */ }
    });
    return out;
  }

  return { score: score, report: report, ratingCsv: ratingCsv, rulesAlone: rulesAlone, runFlags: runFlags, mark: mark, describe: describe, index: index, typeOf: typeOf,
    MECHS: MECHS, CHECKS: CHECKS, TYPES: TYPES, SOURCES: SOURCES };
})();
if (typeof module !== 'undefined') {
  module.exports = Score;
  if (require.main === module) {
    const fs = require('fs'), path = require('path');
    const results = JSON.parse(fs.readFileSync(process.argv[2]));
    const sheetPath = process.argv[3] || path.join(__dirname, 'answer_sheet.json');
    const sheet = JSON.parse(fs.readFileSync(sheetPath)), diagrams = {};
    sheet.forEach(function (k) { diagrams[k.id] = JSON.parse(fs.readFileSync(path.join(path.dirname(sheetPath), k.file))); });
    process.stdout.write(Score.report(results, sheet, diagrams) + '\n');
  }
}

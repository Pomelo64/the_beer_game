/* Scores the results of Beer Game Lab's tests against the key, for the performance assessment.
   Used by the test page, and on its own: node score.js results.json [key.json] > report.md

   Q1 reading      share of elements read as the key says (the same concepts, or both an extra)
   Q2 verdicts     share of mechanism verdicts (M1-M10) that match the key; false failures and false passes apart
   Q3 rules        the rules applied to the key's own reading, against the key's verdicts (needs no AI; computed by the page)
   Q4 wording      rated by hand: see the slides file
   Q5 consistency  share of diagrams whose repeated runs with one model gave identical verdicts (and identical readings)
   Q6 names/layout share of runs in which A2, A3, E3 and E4 got the same verdicts as A1 in the same run
   Q7 safe failure runs stopped as unreadable, runs that failed with an error, and verdicts given on an incomplete reading
   Q8 cost         median time and tokens per evaluation */
const Score = (function () {
  const MECHS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10'];
  const GROUPS = { A: 'A. Correct', B: 'B. One mechanism', C: 'C. One notation rule', D: 'D. Several errors', E: 'E. Unrelated or misleading', F: 'F. Drawn by hand', G: 'G. From the literature' };
  const pct = function (a, b) { return b ? Math.round(1000 * a / b) / 10 + '%' : '–'; };
  const median = function (xs) { xs = xs.filter(function (x) { return typeof x === 'number'; }).sort(function (a, b) { return a - b; }); if (!xs.length) return null; const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; };
  const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  const sorted = function (a) { return (a || []).slice().sort(); };
  const modelName = function (r) { return r.model.provider + ' / ' + r.model.model; };
  /* the key's reading, by the element names the record uses ("arrival rate (2)"), without the flows' ends */
  function keyReading(k) {
    const o = {};
    Object.keys(k.expected_reading).forEach(function (n) { o[n.replace(/ \[flow .*\]$/, '')] = k.expected_reading[n]; });
    return o;
  }
  function readingOf(run) {   // the run's reading, the same way: element -> concepts or 'extra'
    const o = {};
    Object.keys(run.reading || {}).forEach(function (n) { o[n] = sorted(run.reading[n]); });
    (run.extras || []).forEach(function (n) { if (!o[n]) o[n] = 'extra'; });
    return o;
  }

  function score(results, key) {
    const K = {}; key.forEach(function (k) { K[k.id] = k; });
    const runs = results.runs || [], done = runs.filter(function (r) { return r.status === 'done'; });
    const models = []; runs.forEach(function (r) { const m = modelName(r); if (models.indexOf(m) < 0) models.push(m); });
    const out = { models: models, runs: runs.length, done: done.length, byModel: {} };
    models.forEach(function (m) {
      const R = runs.filter(function (r) { return modelName(r) === m; }), D = R.filter(function (r) { return r.status === 'done'; });
      const s = { runs: R.length, done: D.length };
      // Q1 reading
      let el = 0, elOk = 0; const byGroupEl = {}, misreads = {};
      D.forEach(function (r) {
        const k = K[r.id]; if (!k) return; const want = keyReading(k), got = readingOf(r), g = r.id[0];
        byGroupEl[g] = byGroupEl[g] || [0, 0];
        Object.keys(want).forEach(function (n) {
          const w = want[n] === 'extra' ? 'extra' : sorted(want[n]), a = got[n] || 'unread', ok = same(w, a);
          el++; byGroupEl[g][1]++; if (ok) { elOk++; byGroupEl[g][0]++; }
          else { const t = r.id + ' · ' + n + ' · key ' + (w === 'extra' ? 'extra' : w.join('+')) + ' · read ' + (a === 'extra' || a === 'unread' ? a : a.join('+')); misreads[t] = (misreads[t] || 0) + 1; }
        });
      });
      s.q1 = { elements: el, right: elOk, share: pct(elOk, el), byGroup: byGroupEl, misreads: misreads };
      // Q2 verdicts
      let v = 0, vOk = 0, ff = 0, fp = 0; const byMech = {}, byGroupV = {}, wrongRuns = [];
      MECHS.forEach(function (id) { byMech[id] = { right: 0, falseFail: 0, falsePass: 0 }; });
      D.forEach(function (r) {
        const k = K[r.id]; if (!k) return; const g = r.id[0]; byGroupV[g] = byGroupV[g] || [0, 0];
        const wantFail = k.expected.failing || [], gotFail = r.failing || [], wrong = [];
        MECHS.forEach(function (id) {
          const shouldPass = wantFail.indexOf(id) < 0, passed = gotFail.indexOf(id) < 0;
          v++; byGroupV[g][1]++;
          if (shouldPass === passed) { vOk++; byGroupV[g][0]++; byMech[id].right++; }
          else if (shouldPass) { ff++; byMech[id].falseFail++; wrong.push(id + ' failed'); }
          else { fp++; byMech[id].falsePass++; wrong.push(id + ' passed'); }
        });
        if (wrong.length) wrongRuns.push(r.id + ' run ' + r.run + ': ' + wrong.join(', '));
      });
      s.q2 = { verdicts: v, right: vOk, share: pct(vOk, v), falseFailures: ff, falsePasses: fp, byMech: byMech, byGroup: byGroupV, wrongRuns: wrongRuns };
      // notation: from the rules, so it should always match
      let nOk = 0; D.forEach(function (r) { const k = K[r.id]; if (k && same(sorted(k.expected.notation), sorted(r.notation))) nOk++; });
      s.notation = { right: nOk, of: D.length };
      // Q5 consistency
      const ids = {}; D.forEach(function (r) { (ids[r.id] = ids[r.id] || []).push(r); });
      let cv = 0, cvOk = 0, cr = 0, crOk = 0; const unstable = [];
      Object.keys(ids).forEach(function (id) {
        const rs = ids[id]; if (rs.length < 2) return;
        const fv = rs.map(function (r) { return JSON.stringify(sorted(r.failing)); }), fr = rs.map(function (r) { return JSON.stringify(readingOf(r)); });
        cv++; if (fv.every(function (x) { return x === fv[0]; })) cvOk++; else unstable.push(id + ': ' + fv.map(function (x) { return x.replace(/"/g, ''); }).join(' / '));
        cr++; if (fr.every(function (x) { return x === fr[0]; })) crOk++;
      });
      s.q5 = { diagrams: cv, sameVerdicts: cvOk, share: pct(cvOk, cv), sameReading: crOk, readingShare: pct(crOk, cr), unstable: unstable };
      // Q6 names and layout: compared with A1 in the same run
      let q6 = 0, q6Ok = 0; const q6Bad = [];
      D.filter(function (r) { return r.id === 'A1'; }).forEach(function (a1) {
        ['A2', 'A3', 'E3', 'E4'].forEach(function (id) {
          const r = D.find(function (x) { return x.id === id && x.run === a1.run; }); if (!r) return;
          q6++; if (same(sorted(r.failing), sorted(a1.failing))) q6Ok++; else q6Bad.push(id + ' run ' + r.run + ': ' + sorted(r.failing).join(' ') + ' (A1: ' + (sorted(a1.failing).join(' ') || 'none') + ')');
        });
      });
      s.q6 = { compared: q6, same: q6Ok, share: pct(q6Ok, q6), different: q6Bad };
      // Q7 safe failure
      s.q7 = { unread: R.filter(function (r) { return r.status === 'unread'; }).length, errors: R.filter(function (r) { return r.status === 'error'; }).length,
        retried: D.filter(function (r) { return r.retried; }).length,
        verdictsOnGap: D.filter(function (r) { return r.missing && r.missing.length; }).length,
        wordedByRules: D.filter(function (r) { return r.worded_by === 'rules'; }).length };
      // Q8 cost
      const tok = function (r, k) { return (r.calls || []).reduce(function (t, c) { return t + ((c.usage && c.usage[k]) || 0); }, 0); };
      s.q8 = { medianSeconds: median(D.map(function (r) { return r.ms / 1000; })), medianInput: median(D.map(function (r) { return tok(r, 'input'); })),
        medianOutput: median(D.map(function (r) { return tok(r, 'output'); })), totalInput: D.reduce(function (t, r) { return t + tok(r, 'input'); }, 0),
        totalOutput: D.reduce(function (t, r) { return t + tok(r, 'output'); }, 0) };
      out.byModel[m] = s;
    });
    return out;
  }

  /* the report, as Markdown */
  function report(results, key, q3) {
    const s = score(results, key), L = [];
    const round = function (x, d) { return x == null ? '–' : Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0); };
    L.push('# Beer Game Lab: test results', '');
    L.push('App version ' + (results.app_version || '?') + '. Runs started ' + (results.created || '?') + '. ' + s.runs + ' runs, ' + s.done + ' with verdicts.', '');
    L.push('Settings: reading at temperature ' + results.settings.reading_temperature + ', wording at the model\'s default; ' +
      'at most ' + results.settings.reading_max_tokens + ' and ' + results.settings.wording_max_tokens + ' tokens.', '');
    L.push('## Summary', '');
    L.push('| Model | Runs | Q1 reading | Q2 verdicts | False failures | False passes | Q5 same verdicts | Q6 names and layout | Q7 unread / errors | Q8 median time | Q8 median tokens (in / out) |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    s.models.forEach(function (m) { const x = s.byModel[m];
      L.push('| ' + m + ' | ' + x.done + ' of ' + x.runs + ' | ' + x.q1.share + ' | ' + x.q2.share + ' | ' + x.q2.falseFailures + ' | ' + x.q2.falsePasses + ' | ' + x.q5.share +
        ' | ' + x.q6.share + ' | ' + x.q7.unread + ' / ' + x.q7.errors + ' | ' + round(x.q8.medianSeconds, 1) + ' s | ' + round(x.q8.medianInput) + ' / ' + round(x.q8.medianOutput) + ' |'); });
    L.push('');
    if (q3) L.push('**Q3, rules:** with the key\'s own reading, the rules give the key\'s verdicts for ' + q3.agree + ' of ' + q3.of + ' diagrams' + (q3.differ.length ? ': ' + q3.differ.join('; ') : '.'), '');
    s.models.forEach(function (m) { const x = s.byModel[m];
      L.push('## ' + m, '');
      L.push('**Q1, reading:** ' + x.q1.right + ' of ' + x.q1.elements + ' elements read as the key says (' + x.q1.share + ').', '');
      L.push('| Group | Q1 reading | Q2 verdicts |', '| --- | --- | --- |');
      Object.keys(GROUPS).forEach(function (g) { const a = x.q1.byGroup[g], b = x.q2.byGroup[g]; if (a || b) L.push('| ' + GROUPS[g] + ' | ' + (a ? pct(a[0], a[1]) : '–') + ' | ' + (b ? pct(b[0], b[1]) : '–') + ' |'); });
      L.push('');
      L.push('**Q2, verdicts by mechanism:**', '', '| Mechanism | Right | False failures | False passes |', '| --- | --- | --- | --- |');
      MECHS.forEach(function (id) { const b = x.q2.byMech[id]; L.push('| ' + id + ' | ' + b.right + ' | ' + b.falseFail + ' | ' + b.falsePass + ' |'); });
      L.push('');
      L.push('Notation findings matched the key in ' + x.notation.right + ' of ' + x.notation.of + ' runs (they come from the rules).', '');
      L.push('**Q5, consistency:** ' + x.q5.sameVerdicts + ' of ' + x.q5.diagrams + ' diagrams got identical verdicts in every run (' + x.q5.share + '); ' +
        x.q5.sameReading + ' got an identical reading (' + x.q5.readingShare + ').', '');
      L.push('**Q6, names and layout:** ' + x.q6.same + ' of ' + x.q6.compared + ' comparisons with A1 gave the same verdicts (' + x.q6.share + ').', '');
      L.push('**Q7, safe failure:** ' + x.q7.unread + ' runs stopped as unreadable, ' + x.q7.errors + ' failed with an error, ' + x.q7.retried + ' needed a second reading, ' +
        x.q7.verdictsOnGap + ' gave verdicts on an incomplete reading. The rules worded the slides in ' + x.q7.wordedByRules + ' runs.', '');
      L.push('**Q8, cost:** median ' + round(x.q8.medianSeconds, 1) + ' s and ' + round(x.q8.medianInput) + ' input / ' + round(x.q8.medianOutput) + ' output tokens per evaluation; ' +
        x.q8.totalInput + ' / ' + x.q8.totalOutput + ' tokens in all.', '');
      if (x.q2.wrongRuns.length) { L.push('**Runs with a wrong verdict:**', ''); x.q2.wrongRuns.forEach(function (w) { L.push('- ' + w); }); L.push(''); }
      const mis = Object.keys(x.q1.misreads).sort(function (a, b) { return x.q1.misreads[b] - x.q1.misreads[a]; });
      if (mis.length) { L.push('**Misread elements** (diagram · element · key · reading, with how many runs):', ''); mis.forEach(function (t) { L.push('- ' + t + ' (' + x.q1.misreads[t] + ')'); }); L.push(''); }
      if (x.q5.unstable.length) { L.push('**Diagrams whose verdicts changed between runs:**', ''); x.q5.unstable.forEach(function (t) { L.push('- ' + t); }); L.push(''); }
      if (x.q6.different.length) { L.push('**Names and layout that changed the verdicts:**', ''); x.q6.different.forEach(function (t) { L.push('- ' + t); }); L.push(''); }
    });
    return L.join('\n');
  }

  /* the slides of the first run of each diagram and model, for rating by hand (Q4) */
  function slidesCsv(results) {
    const q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['id', 'model', 'run', 'worded by', 'learner said', 'headline', 'overall', 'mechanism slides', 'wrap',
      'only claims the verdicts support (y/n)', 'no "wrong" (y/n)', 'no answer before asked (y/n)', 'learner\'s words used fairly (y/n)', 'notes']];
    const seen = {};
    (results.runs || []).filter(function (r) { return r.status === 'done'; }).forEach(function (r) {
      const k = r.id + '|' + modelName(r); if (seen[k]) return; seen[k] = 1;
      const w = r.words || {};
      rows.push([r.id, modelName(r), r.run, r.worded_by, r.said || 'the usual explanation', w.headline, w.overall,
        Object.keys(w.slides || {}).map(function (id) { return id + ': ' + w.slides[id]; }).join('\n'), w.wrap, '', '', '', '', '']);
    });
    return rows.map(function (r) { return r.map(q).join(','); }).join('\n') + '\n';
  }

  return { score: score, report: report, slidesCsv: slidesCsv, MECHS: MECHS };
})();
if (typeof module !== 'undefined') {
  module.exports = Score;
  if (require.main === module) {
    const fs = require('fs'), path = require('path');
    const results = JSON.parse(fs.readFileSync(process.argv[2]));
    const key = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'key.json')));
    process.stdout.write(Score.report(results, key) + '\n');
  }
}

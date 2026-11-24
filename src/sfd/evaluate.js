/* The evaluation of a learner's diagram, shared by the app and the test page, so that a
   test runs exactly the code a learner gets.

   Layer 1 (notation) and layer 3 (mechanisms) are decided by the rules in marking.js.
   The AI reads what each element stands for (the reading call) and words the slides
   (the wording call). The wording cannot change a verdict; if it fails, the rules' own
   words are used.

   Evaluate.run({ cfg, key, diagram, gameText, prev, progress }) -> Promise<result>
     cfg       the AI settings { provider, key, model }
     key       the answer key (KEYS.plain): its game description and task
     diagram   the learner's diagram, as the canvas saves it
     gameText  the learner's game record, as text for the wording call
     prev      the previous submission's verdicts { M1: true, ... } or null
     progress  optional, called with a short message before each step
   result.status: 'done' | 'unread' (an element was left unread twice: no verdicts) | 'error'.
   result.calls and result.raw hold what each AI call was sent back and cost, for testing. */
const Evaluate = (function () {
  const SETTINGS = { reading: { temperature: 0, maxTokens: 2500 }, wording: { temperature: null, maxTokens: 1800 } };

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
    'If their game record includes what they wrote at the end of the game, use one sentence of "wrap" to connect it to their diagram: what of their own explanation the diagram already shows, and what it does not show yet, going only by the verdicts.',
    'Reply ONLY with JSON, no markdown fences: {"headline": "<one sentence>", "overall": "<2-4 sentences>", "slides": {"<mechanism id>": "<2-3 sentences: what the game does, where they met it in their own weeks if helpful, ending with the hint question>"}, "wrap": "<1-2 sentences: the single most useful next step>"}'
  ].join('\n');

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

  /* the facts the wording call is given: the verdicts, final */
  function factsText(r, prev) {
    const M = r.mech.mechanisms, sc = r.score, fails = r.fails, notation = r.notation;
    return 'RESULTS OF THE CHECK (final)\n' +
      'Required mechanisms working: ' + sc.required.pass + ' of ' + sc.required.of + '. Important: ' + sc.important.pass + ' of ' + sc.important.of + '.\n' +
      'WORKING: ' + (M.filter(function (m) { return m.pass && m.weight !== 'optional'; }).map(function (m) { return m.title; }).join('; ') || 'none') + '\n' +
      'NOT YET WORKING (write a slide for each id):\n' + (fails.map(function (m) { return m.id + ' ' + m.title + ' [' + m.weight + ']. The game: ' + m.game + ' Rule\'s hint: ' + m.hint; }).join('\n') || 'none') + '\n' +
      'NOTATION: ' + (notation.length ? notation.map(function (n) { return n.type + ': ' + n.text; }).join(' | ') : 'no problems') + '\n' +
      (r.far ? 'The diagram shows few of the game\'s parts: be honest and kind about that, and point them to the main parts of the game.\n' : '') +
      'OPTIONAL extras drawn: ' + (M.filter(function (m) { return m.weight === 'optional' && m.pass; }).map(function (m) { return m.title; }).join('; ') || 'none') + '\n' +
      (prev ? 'SINCE THE LAST CHECK: now working: ' + (r.better.map(function (m) { return m.title; }).join('; ') || 'nothing new') + '; no longer working: ' + (r.worse.map(function (m) { return m.title; }).join('; ') || 'nothing') + '\n' : '') +
      'ABOUT THE ORDER DECISION (an observation, not marked): ' + (r.mech.decisionNote || 'nothing to say: the diagram has no order flow.');
  }

  /* The learner's game as text for the AI: one line a week. g = an engine game;
     o = { wom, finished, done (last completed week's index while playing), said } */
  function gameRecordText(g, o) {
    const w = !!o.wom, upto = o.finished ? g.log.length - 1 : o.done;
    const rows = g.log.slice(0, upto + 1).map(function (r, k) {
      const me = r.pos[0], nxt = g.log[k + 1], sup = nxt ? nxt.pos[1] : null;
      return [r.week, me.asked, me.arrived, me.sent, w ? me.turned : me.owed, me.stock, me.order == null ? '' : me.order,
        sup ? sup.sent : '', sup ? sup.owed : ''].join(',');
    });
    return 'THE LEARNER\'S GAME (' + (w ? 'word of mouth' : 'the supply game') + ', the learner runs the pub). ' +
      (o.finished ? 'The game is over: ' + g.log.length + ' weeks played.'
        : 'The game is still being played: ' + (upto + 1) + ' week' + (upto === 0 ? '' : 's') + ' completed so far. The learner has not yet seen how the game ends, nor anything from the distributor or the brewery, which are hidden while they play. Do not guess at what comes next.') +
      '\nOne line a week:\nweek,customers,delivered to the pub,served,' + (w ? 'turned away' : 'left waiting') + ',cellar at end,pub ordered,wholesaler sent in answer,on back order with the wholesaler\n' +
      (rows.length ? rows.join('\n') : '(no week completed yet)') +
      (o.finished ? '\nLargest order placed by the brewery: ' + Math.max.apply(null, g.log.map(function (r) { return r.pos[3].order || 0; })) +
        '.\nWhat the learner wrote at the end, before seeing the results: ' + (o.said || '(nothing)') : '');
  }

  async function run(o) {
    const t0 = Date.now(), say = o.progress || function () {};
    const d = Marking.unique(o.diagram), list = elementList(d);
    const r = { status: 'done', error: null, d: d, list: list, calls: [], raw: { reading: [], wording: null },
      settings: { reading_temperature: SETTINGS.reading.temperature, wording_temperature: 'default', reading_max_tokens: SETTINGS.reading.maxTokens, wording_max_tokens: SETTINGS.wording.maxTokens } };
    const note = function (step, res) { const m = res[2] || {}; r.calls.push({ step: step, provider: m.provider, model: m.model, temperature: m.temperature, ms: m.ms, usage: m.usage, error: res[1] || null }); return m.text; };
    // layer 1: notation (rules)
    r.notation = Marking.notation(d);
    // layer 2: the reading (AI), by element number
    say('Reading your diagram…');
    const ask1 = 'HOW THE GAME WORKS\n' + o.key.game + '\n\nTHE TASK GIVEN TO THE LEARNER\n' + o.key.task +
      '\n\nCONCEPTS OF THE GAME\n' + conceptText() + '\n\nTHE LEARNER\'S DIAGRAM\n' + list.text;
    const rOpts = { temperature: SETTINGS.reading.temperature };
    const r1 = await LLM.completeJson(o.cfg, MAP_SYSTEM, ask1 + '\n\nMap every element now.', SETTINGS.reading.maxTokens, rOpts);
    r.raw.reading.push(note('reading', r1));
    if (r1[1]) { r.status = 'error'; r.error = r1[1]; r.ms = Date.now() - t0; return r; }
    const raws = [r1[0]];
    let mp = cleanMap(raws, list);
    if (mp.missing.length) {     // an element got no reading: ask once more for those
      say('Reading the rest of your diagram…');
      const r1b = await LLM.completeJson(o.cfg, MAP_SYSTEM, ask1 + '\n\nYour first answer gave nothing for ' + mp.missing.join(', ') +
        '. Answer again for every element, by number.', SETTINGS.reading.maxTokens, rOpts);
      r.raw.reading.push(note('reading again', r1b));
      if (!r1b[1]) { raws.push(r1b[0]); mp = cleanMap(raws, list); }
    }
    r.map = mp; r.retried = raws.length > 1;
    if (mp.missing.length) { r.status = 'unread'; r.ms = Date.now() - t0; return r; }   // never build verdicts on a gap
    // layer 3: mechanisms (rules)
    say('Checking how it works…');
    const mech = Marking.mechanisms(d, mp.map), M = mech.mechanisms, prev = o.prev || null;
    r.mech = mech; r.score = Marking.score(M); r.far = Marking.coreFound(mp.map) < 3;
    r.fails = M.filter(function (m) { return !m.pass && m.weight !== 'optional'; })
      .sort(function (a, b) { return (a.weight === 'required' ? 0 : 1) - (b.weight === 'required' ? 0 : 1); });
    r.better = prev ? M.filter(function (m) { return m.pass && prev[m.id] === false && m.weight !== 'optional'; }) : [];
    r.worse = prev ? M.filter(function (m) { return !m.pass && prev[m.id] === true && m.weight !== 'optional'; }) : [];
    r.verdicts = {}; M.forEach(function (m) { r.verdicts[m.id] = m.pass; });
    r.kinds = Marking.kindNotes(d, mp.map);
    // the words (AI); the rules' own words if this fails
    say('Writing your feedback…');
    const r2 = await LLM.completeJson(o.cfg, WORD_SYSTEM, Marking.base(factsText(r, prev)) + '\n\n' + (o.gameText || '') + '\n\nWrite the slides now.',
      SETTINGS.wording.maxTokens, { temperature: SETTINGS.wording.temperature });
    r.raw.wording = note('wording', r2);
    r.words = r2[1] ? null : r2[0];
    r.ms = Date.now() - t0;
    return r;
  }

  return { run: run, SETTINGS: SETTINGS, MAP_SYSTEM: MAP_SYSTEM, WORD_SYSTEM: WORD_SYSTEM,
    elementList: elementList, cleanMap: cleanMap, conceptText: conceptText, factsText: factsText, gameRecordText: gameRecordText };
})();
if (typeof module !== 'undefined') module.exports = Evaluate;

/* The direct assessment, a second mode for testing (not in the app): the AI is given the game, the task,
   the teacher's reference diagram and the learner's diagram, and lists the learner's conceptual flaws
   itself. Notation is checked by the same rules as in the app, since it needs no AI.

   Direct.run({ cfg, key, diagram }) -> Promise<result>
     cfg      the AI settings { provider, key, model }
     key      the answer key (KEYS.plain): its game description, task and reference diagram
     diagram  the learner's diagram, as the canvas saves it
   result: { status: 'done' | 'error', error, calls, raw: { direct }, requests: { direct }, notation,
     correct, flaws: [{ class, elements: [names as shown], reference: [R numbers], flaw, advice }],
     reference_elements: { R1: name, ... }, dropped: [what the answer referred to that does not exist], ms } */
const Direct = (function () {
  const SETTINGS = { temperature: 0, maxTokens: 3000 };
  const CLASSES = ['missing', 'extra', 'wrong_relation', 'wrong_type', 'wrong_name', 'unrelated'];
  const SYSTEM = [
    'You assess a learner\'s stock-and-flow diagram of a pub supply game against the teacher\'s reference diagram, and list the learner\'s conceptual flaws.',
    'Ground every judgement in the game as described below and in the reference diagram, not in other versions of the beer game you may know: here the pub\'s orders reach the wholesaler at once, deliveries take three weeks, and the wholesaler can run short.',
    'Judge by meaning and by structure (what a flow fills and empties, what a link informs), not by names: learners use their own words.',
    'The reference is one correct diagram, not the only one. A diagram that shows the same game another way is correct: a stock split into several in a row, flows merged or split, different names, a different layout, extra detail that is connected and sound.',
    'Notation is checked separately by fixed rules: links into stocks, links from clouds, flows to or from anything but a stock, flows between two clouds, a flow into its own stock, stocks with no flows, two elements with the same name. Do not report these.',
    'Each flaw has one class:',
    '- missing: a part or a relation the game needs is not shown;',
    '- extra: an element the game does not need: it affects nothing, or it lies outside the game;',
    '- wrong_relation: parts linked or flowing in a way the game does not work: a wrong, reversed or invented link or flow, or something counted twice;',
    '- wrong_type: a part drawn as the wrong kind of element, such as a stock drawn as an auxiliary or a rate drawn as a stock;',
    '- wrong_name: a name that contradicts the role the element plays;',
    '- unrelated: the diagram is not about this game at all (then report only this).',
    'Each flaw is one correction the learner should make: do not list its consequences as separate flaws.',
    'Refer to the learner\'s elements by their numbers (E1, E2, ...) and to the reference\'s by theirs (R1, R2, ...). For a part that is missing from the learner\'s diagram, give the reference element it corresponds to.',
    'If the diagram has no conceptual flaw, say so: an empty list is a valid answer.',
    'Reply ONLY with JSON, no markdown fences: {"correct": true or false, "flaws": [{"class": "<one of the classes>", "elements": ["E3"], "reference": ["R2"], "flaw": "<one sentence: what is wrong>", "advice": "<one or two sentences to the learner: a hint, not the answer>"}]}'
  ].join('\n');

  async function run(o) {
    const t0 = Date.now();
    const d = Marking.unique(o.diagram), list = Evaluate.elementList(d);
    const ref = Evaluate.elementList(Marking.unique(o.key.reference));
    const R = function (t) { return t.replace(/\bE(\d+)\b/g, 'R$1'); };
    const refIds = {}; Object.keys(ref.ids).forEach(function (id) { refIds[R(id)] = Marking.shown(ref.ids[id]); });
    const ask = 'HOW THE GAME WORKS\n' + o.key.game + '\n\nTHE TASK GIVEN TO THE LEARNER\n' + o.key.task +
      '\n\nTHE TEACHER\'S REFERENCE DIAGRAM\n' + R(ref.text) + '\n\nTHE LEARNER\'S DIAGRAM\n' + list.text + '\n\nAssess the learner\'s diagram now.';
    const r = { status: 'done', error: null, calls: [], raw: { direct: null }, requests: { direct: ask }, reference_elements: refIds,
      notation: Marking.notation(d).map(function (n) { return n.id; }), correct: null, flaws: null, dropped: [], settings: SETTINGS };
    const a = await LLM.completeJson(o.cfg, SYSTEM, ask, SETTINGS.maxTokens, { temperature: SETTINGS.temperature });
    const m = a[2] || {};
    r.calls.push({ step: 'direct', provider: m.provider, model: m.model, temperature: m.temperature, ms: m.ms, usage: m.usage, error: a[1] || null });
    r.raw.direct = m.text;
    r.ms = Date.now() - t0;
    if (a[1] || !a[0] || !Array.isArray(a[0].flaws)) { r.status = 'error'; r.error = a[1] || 'The answer had no list of flaws.'; return r; }
    r.correct = a[0].correct === true;
    r.flaws = a[0].flaws.map(function (f) {
      const els = [], refs = [];
      (Array.isArray(f.elements) ? f.elements : []).forEach(function (id) { id = String(id).trim(); if (list.ids[id]) els.push(Marking.shown(list.ids[id])); else r.dropped.push(id); });
      (Array.isArray(f.reference) ? f.reference : []).forEach(function (id) { id = String(id).trim(); if (refIds[id]) refs.push(id); else r.dropped.push(id); });
      const c = String(f.class || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      return { class: CLASSES.indexOf(c) >= 0 ? c : 'unknown: ' + c, elements: els, reference: refs, flaw: String(f.flaw || ''), advice: String(f.advice || '') };
    });
    return r;
  }
  return { run: run, SYSTEM: SYSTEM, SETTINGS: SETTINGS, CLASSES: CLASSES };
})();
if (typeof module !== 'undefined') module.exports = Direct;

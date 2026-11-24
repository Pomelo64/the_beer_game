/* One small client for Claude, ChatGPT and Gemini, ported from SFD Studio's
   llm_client.py to run in the browser.

   Same providers, default models, retries (429/5xx/529 after 2 s and 5 s, one
   retry on a time-out), 40-second time-out, light "thinking" for Gemini and
   plain-language errors. Two differences from the Python:
   - the calls go straight from the browser to the provider. Anthropic needs the
     header that allows this; OpenAI and Gemini accept browser calls as they are;
   - `complete` takes a list of messages, so a conversation can carry on.

   cfg = { provider: 'anthropic' | 'openai' | 'gemini', key: '...', model: '...' }
   complete(cfg, system, messages, maxTokens, wantJson, opts) -> Promise<[text, null, meta] | [null, error, meta]>
   opts.temperature: sent when given; a model that rejects it is asked again without it.
   meta = { provider, model, temperature (what was sent, or 'not accepted'), ms, usage: {input, output}, text }:
   what a test needs to report and reproduce a call. Callers that read only [0] and [1] are unaffected. */
const LLM = (function () {
  const PROVIDERS = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (ChatGPT)', gemini: 'Google (Gemini)' };
  const DEFAULT_MODELS = { anthropic: 'claude-opus-4-7', openai: 'gpt-4o', gemini: 'gemini-3.5-flash-lite' };
  const KEY_PLACEHOLDER = { anthropic: 'sk-ant-…', openai: 'sk-…', gemini: 'AIza…' };
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
  const RETRY_CODES = { 429: 1, 500: 1, 502: 1, 503: 1, 504: 1, 529: 1 };
  const RETRY_WAITS = [2, 5], TIMEOUT = 40;

  function HttpError(code, body) { this.code = code; this.body = body; }
  function Timeout() {}
  const sleep = function (s) { return new Promise(function (r) { setTimeout(r, s * 1000); }); };

  async function postOnce(url, headers, body) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT * 1000);
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Timeout();
      throw e;
    }
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    return JSON.parse(text);
  }
  /* POST with retries when the provider is busy. A timed-out request is retried
     once; a busy response (429/5xx) up to twice, after short waits. */
  async function post(url, headers, body) {
    let timeouts = 0;
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      try { return await postOnce(url, headers, body); }
      catch (e) {
        if (e instanceof HttpError) { if (!RETRY_CODES[e.code] || attempt === RETRY_WAITS.length) throw e; }
        else if (e instanceof Timeout) { timeouts += 1; if (timeouts > 1 || attempt === RETRY_WAITS.length) throw e; }
        else throw e;
      }
      await sleep(RETRY_WAITS[attempt]);
    }
  }

  function errorText(e) {
    if (e instanceof HttpError) {
      let msg = e.body;
      try { const d = JSON.parse(e.body), err = d.error; msg = err && typeof err === 'object' ? err.message : (err || e.body); } catch (x) {}
      if (RETRY_CODES[e.code]) return 'The AI service is very busy right now. Try again in a few minutes, or choose a different model. (Provider said: ' + e.code + ' — ' + msg + ')';
      return 'API error (' + e.code + '): ' + msg;
    }
    if (e instanceof Timeout) return 'The AI service took too long to answer. It is probably busy — try again in a few minutes, or choose a different model.';
    return 'Could not reach the AI: ' + (e && e.message ? e.message : e) +
      '. If you are offline, or the provider does not accept calls from a web page, the request cannot get through.';
  }

  /* Keep thinking light: these are short replies, and heavy thinking makes Gemini
     slow enough to time out. Gemini 2.x takes a token budget; Gemini 3 and later a level. */
  function geminiThinking(model) {
    const m = model.toLowerCase();
    if (m.indexOf('gemini-2') === 0) return m.indexOf('flash') >= 0 ? { thinkingBudget: 0 } : null;
    return { thinkingLevel: 'low' };
  }
  async function gemini(model, key, system, messages, maxTokens, wantJson, temperature) {
    const gen = { maxOutputTokens: Math.max(maxTokens, 2048) }, thinking = geminiThinking(model);
    if (temperature != null) gen.temperature = temperature;
    if (thinking) gen.thinkingConfig = thinking;
    if (wantJson) gen.responseMimeType = 'application/json';
    const body = { systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }; }),
      generationConfig: gen };
    const url = GEMINI_URL.replace('{model}', encodeURIComponent(model));
    try { return await post(url, { 'x-goog-api-key': key }, body); }
    catch (e) {   // a model that rejects this thinking setting: retry once without it
      if (e instanceof HttpError && e.code === 400 && gen.thinkingConfig) { delete gen.thinkingConfig; return post(url, { 'x-goog-api-key': key }, body); }
      throw e;
    }
  }

  /* one call to the provider; returns { text, usage } */
  async function call(provider, model, key, system, messages, maxTokens, wantJson, temperature) {
    if (provider === 'anthropic') {
      const body = { model: model, max_tokens: maxTokens, system: system, messages: messages };
      if (temperature != null) body.temperature = temperature;
      const data = await post(ANTHROPIC_URL,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body);
      const u = data.usage || {};
      return { text: (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text || ''; }).join(''),
        usage: { input: u.input_tokens, output: u.output_tokens } };
    } else if (provider === 'openai') {
      const body = { model: model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }].concat(messages) };
      if (wantJson) body.response_format = { type: 'json_object' };
      if (temperature != null) body.temperature = temperature;
      const data = await post(OPENAI_URL, { Authorization: 'Bearer ' + key }, body), u = data.usage || {};
      return { text: data.choices[0].message.content || '', usage: { input: u.prompt_tokens, output: u.completion_tokens } };
    }
    const data = await gemini(model, key, system, messages, maxTokens, wantJson, temperature), u = data.usageMetadata || {};
    const parts = (((data.candidates || [{}])[0] || {}).content || {}).parts || [];
    return { text: parts.map(function (p) { return p.text || ''; }).join(''),
      usage: { input: u.promptTokenCount, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
  }
  /* Models known to ignore a temperature: Google says Gemini 3.5 and later ignore it, and that later
     models will refuse it. It is not sent to them, and the record says "not accepted", so nobody
     reads a run as having been made at temperature 0 when it was not. */
  function ignoresTemperature(provider, model) {
    const m = provider === 'gemini' && /^gemini-(\d+)(?:\.(\d+))?/.exec(model.toLowerCase());
    return !!m && (+m[1] > 3 || (+m[1] === 3 && +(m[2] || 0) >= 5));
  }
  async function complete(cfg, system, messages, maxTokens, wantJson, opts) {
    if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
    maxTokens = maxTokens || 300; opts = opts || {};
    const provider = cfg.provider, model = (cfg.model || '').trim() || DEFAULT_MODELS[provider], key = cfg.key;
    const meta = { provider: provider, model: model, temperature: opts.temperature != null ? opts.temperature : 'default', ms: 0, usage: null, text: null };
    if (opts.temperature != null && ignoresTemperature(provider, model)) { meta.temperature = 'not accepted'; opts = Object.assign({}, opts, { temperature: null }); }
    const t0 = Date.now();
    try {
      let r;
      try { r = await call(provider, model, key, system, messages, maxTokens, wantJson, opts.temperature); }
      catch (e) {   // a model that does not take a temperature: ask again without one
        if (opts.temperature != null && e instanceof HttpError && e.code === 400 && /temperature/i.test(e.body)) {
          meta.temperature = 'not accepted';
          r = await call(provider, model, key, system, messages, maxTokens, wantJson, null);
        } else throw e;
      }
      meta.ms = Date.now() - t0; meta.usage = r.usage; meta.text = r.text;
      const text = (r.text || '').trim();
      return text ? [text, null, meta] : [null, 'Empty response from the AI.', meta];
    } catch (e) { meta.ms = Date.now() - t0; return [null, errorText(e), meta]; }
  }
  async function completeJson(cfg, system, messages, maxTokens, opts) {
    const r = await complete(cfg, system, messages, maxTokens || 400, true, opts);
    if (r[1]) return [null, r[1], r[2]];
    const m = r[0].match(/\{[\s\S]*\}/);
    if (!m) return [null, 'The AI did not return JSON.', r[2]];
    try { return [JSON.parse(m[0]), null, r[2]]; } catch (e) { return [null, "The AI's reply could not be read.", r[2]]; }
  }
  async function testConnection(cfg) {
    const r = await complete(cfg, 'Reply with the single word OK.', 'Ping', 5);
    return [r[1] === null, r[1]];
  }
  return { PROVIDERS: PROVIDERS, DEFAULT_MODELS: DEFAULT_MODELS, KEY_PLACEHOLDER: KEY_PLACEHOLDER,
           complete: complete, completeJson: completeJson, testConnection: testConnection, ignoresTemperature: ignoresTemperature };
})();
if (typeof module !== 'undefined') module.exports = LLM;

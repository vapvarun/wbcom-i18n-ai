'use strict';
const { execFileSync } = require('child_process');

// printf placeholders WordPress uses: %s %d %1$s %2$d ... and literal %%
const PH = /%%|%(?:\d+\$)?[bcdeEfFgGosuxX]/g;

function placeholders(s) {
  return ((s || '').match(PH) || []).slice().sort();
}
function samePlaceholders(a, b) {
  const x = placeholders(a), y = placeholders(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Strip markdown fences / prose and isolate the JSON object the model returned.
function extractJson(out) {
  let s = String(out).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const m = s.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : s);
}

// Engine: claude CLI (default, no key) — model is an alias like "haiku"/"sonnet".
function callClaude(prompt, model) {
  const out = execFileSync('claude', ['-p', '--model', model, prompt], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000,
  });
  return extractJson(out);
}

// Engine: Anthropic API (needs ANTHROPIC_API_KEY). Aliases mapped to model IDs.
const API_MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};
async function callApi(prompt, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set (engine=api)');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: API_MODELS[model] || model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await res.json();
  if (!j.content) throw new Error('API error: ' + JSON.stringify(j).slice(0, 200));
  return extractJson(j.content[0].text);
}

function translateBatch(prompt, model, engine) {
  return engine === 'api' ? callApi(prompt, model) : Promise.resolve(callClaude(prompt, model));
}

function npluralsOf(pluralForms) {
  const m = /nplurals\s*=\s*(\d+)/.exec(pluralForms || '');
  return m ? parseInt(m[1], 10) : 2;
}

module.exports = { placeholders, samePlaceholders, extractJson, translateBatch, npluralsOf };

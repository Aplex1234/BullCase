import test from 'node:test';
import assert from 'node:assert/strict';
import { requestResearchAnswer, streamResearchResponse } from '../lib/server/ai-research.ts';
import { readResearchResponse } from '../../frontend/lib/research-stream.ts';

const config = { provider: 'openrouter', key: 'test-only-key', model: 'test', endpoint: 'https://openrouter.ai/api/v1/chat/completions' };
const messages = [{ role: 'user', content: 'Revenue?' }];
const sources = [{ id: 'F1', title: 'Facts', url: 'https://data.sec.gov/test', date: null }];
const encoder = new TextEncoder();
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
function sse(text) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('answer streams before completion and no reasoning reaches the browser', async () => {
  const original = fetch;
  let upstream, release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      assert.deepEqual(body.reasoning, { exclude: true });
      return new Response(new ReadableStream({ start(c) { upstream = c; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const response = streamResearchResponse(config, '{}', messages, sources, AbortSignal.timeout(3000));
    const seen = [];
    const result = readResearchResponse(response, AbortSignal.timeout(3000), text => { seen.push(text); release(); });
    upstream.enqueue(encoder.encode(chunk({ reasoning: 'PRIVATE', reasoning_content: 'PRIVATE', reasoning_details: [{ text: 'PRIVATE' }] })));
    upstream.enqueue(encoder.encode(chunk({ content: '<thi' }) + chunk({ content: 'nk>PRIVATE</th' }) + chunk({ content: 'ink>Revenue ' })));
    await gate;
    assert.deepEqual(seen, ['Revenue ']);
    upstream.enqueue(encoder.encode(chunk({ content: '**$10** [F1]' }, 'stop') + 'data: [DONE]\n\n'));
    const completed = await result;
    assert.equal(completed.answer, 'Revenue **$10** [F1]');
    assert.deepEqual(completed.sources, sources);
    assert.ok(seen.every(text => !text.includes('PRIVATE') && !text.includes('think')));
  } finally { globalThis.fetch = original; }
});

test('SSE tolerates byte splits, UTF-8, comments and usage frames', async () => {
  const original = fetch;
  try {
    globalThis.fetch = async () => sse(': heartbeat\r\n\r\n' + chunk({ content: 'Apple’s ' }) + chunk({ content: 'revenue [F1]' }, 'length') + 'data: {"choices":[],"usage":{"tokens":12}}\n\ndata: [DONE]\n\n');
    const seen = [];
    const result = await requestResearchAnswer(config, '{}', messages, undefined, text => seen.push(text));
    assert.equal(result.answer, 'Apple’s revenue [F1]');
    assert.equal(result.truncated, true);
    assert.equal(seen.join(''), result.answer);
  } finally { globalThis.fetch = original; }
});

test('errors, missing completion and unknown citations never become completed answers', async () => {
  const original = fetch;
  try {
    for (const body of [chunk({ content: 'Partial' }), 'data: {"error":{"message":"SECRET"}}\n\n', chunk({ content: 'Wrong [F999]' }, 'stop') + 'data: [DONE]\n\n']) {
      globalThis.fetch = async () => sse(body);
      await assert.rejects(readResearchResponse(streamResearchResponse(config, '{}', messages, sources, AbortSignal.timeout(2000)), AbortSignal.timeout(2000), () => {}), error => !error.message.includes('SECRET'));
    }
  } finally { globalThis.fetch = original; }
});

test('stop cancels the provider body during a stalled stream', async () => {
  const original = fetch;
  let cancelled = false;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const stop = new AbortController();
    const reading = readResearchResponse(streamResearchResponse(config, '{}', messages, sources, AbortSignal.timeout(2000)), stop.signal, () => {});
    stop.abort();
    await assert.rejects(reading);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; }
});

test('non-streaming fallback strips thinking and stream size is bounded', async () => {
  const original = fetch;
  try {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '<think>PRIVATE</think>Answer' }, finish_reason: 'stop' }] });
    const seen = [];
    assert.equal((await requestResearchAnswer(config, '{}', messages, undefined, text => seen.push(text))).answer, 'Answer');
    assert.deepEqual(seen, ['Answer']);
    globalThis.fetch = async () => sse(chunk({ content: 'x'.repeat(12001) }, 'stop'));
    await assert.rejects(requestResearchAnswer(config, '{}', messages, undefined, () => {}), error => error.reason === 'oversized');
  } finally { globalThis.fetch = original; }
});

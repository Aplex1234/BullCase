import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("research requests work in Workers and reject provider redirects", async () => {
  const source = await readFile(new URL("../lib/server/ai-research.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: "2026-09-01", script: compiled + `
    export default { async fetch(request) {
      const redirect = new URL(request.url).pathname === '/redirect';
      const streaming = new URL(request.url).pathname === '/stream';
      globalThis.fetch = async (url, init) => {
        const outgoing = new Request(url, init);
        if (outgoing.redirect !== 'manual') throw new Error('Unsafe redirect mode');
        if (streaming) return new Response('data: {"choices":[{"delta":{"reasoning":"PRIVATE","content":"Verified [F1]"},"finish_reason":"stop"}]}\\n\\ndata: [DONE]\\n\\n', {headers:{'Content-Type':'text/event-stream'}});
        return redirect ? new Response(null, { status: 302, headers: { Location: 'https://example.com' } })
          : Response.json({ choices: [{ message: { content: 'Verified [F1]' }, finish_reason: 'stop' }] });
      };
      try {
        if (streaming) return streamResearchResponse({provider:'openrouter', key:'test-only-key', model:'test', endpoint:'https://openrouter.ai/api/v1/chat/completions'}, '{}', [{role:'user',content:'Test'}], [{id:'F1',title:'Facts',url:'https://data.sec.gov/test',date:null}], request.signal);
        const result = await requestResearchAnswer({provider:'openrouter', key:'test-only-key', model:'test', endpoint:'https://openrouter.ai/api/v1/chat/completions'}, '{}', [{role:'user',content:'Test'}]);
        return Response.json(result);
      } catch(error) { return Response.json({status:error.status ?? null, detail:error.message}, {status:502}); }
    }};
  ` }));
  try {
    const success = await mf.dispatchFetch("http://localhost/");
    assert.equal(success.status, 200);
    assert.equal((await success.json()).answer, "Verified [F1]");
    const stream = await mf.dispatchFetch("http://localhost/stream");
    assert.match(stream.headers.get('content-type'), /ndjson/);
    const events = (await stream.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events[0].text, 'Verified [F1]');
    assert.equal(events[1].type, 'done');
    assert.ok(!JSON.stringify(events).includes('PRIVATE'));
    const redirect = await mf.dispatchFetch("http://localhost/redirect");
    assert.equal(redirect.status, 502);
    assert.equal((await redirect.json()).status, 302);
  } finally { await mf.dispose(); }
});

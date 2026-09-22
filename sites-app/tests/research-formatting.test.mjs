import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchAnswer } from "../../frontend/components/ResearchAnswer.ts";
const render = content => renderToStaticMarkup(createElement(ResearchAnswer, { content }));
test("formats the reported revenue example without changing values or citations", () => {
  const html = render("Apple’s most recent FY 2025 revenue was **$416.161 billion USD**, for the fiscal year ended **September 27, 2025**. [F1]");
  assert.ok(html.includes("<strong>$416.161 billion USD</strong>"));
  assert.ok(html.includes("<strong>September 27, 2025</strong>"));
  assert.ok(html.includes("[F1]"));
  assert.ok(!html.includes("**"));
});
test("formats lists, emphasis, headings and code while escaping HTML", () => {
  const html = render("### Earnings\n- **Revenue:** up\n- *Profit:* steady\n\n3. __Cash__\n4. `EPS`\n\n<img src=x onerror=alert(1)>");
  assert.ok(html.includes("<ul><li><strong>Revenue:</strong> up</li>"));
  assert.ok(html.includes('<ol start="3">'));
  assert.ok(html.includes("<em>Profit:</em>"));
  assert.ok(html.includes("<code>EPS</code>"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
});

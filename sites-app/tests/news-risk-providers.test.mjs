import assert from "node:assert/strict";
import test from "node:test";

import { extractRiskFactorThemes } from "../lib/server/risk-factors.ts";
import { fetchCompanyRisks } from "../lib/server/analysis.ts";
import { fetchCompanyNews, parsePolicyNews, dedupeAndSort } from "../lib/server/news.ts";
import { createFederalReserveClient } from "../lib/server/federal-reserve-client.ts";

test("official policy feeds are bounded, dated, attributed, and never assigned to a company", () => {
  const item = (link, date) => `<item><title>Policy update</title><link><![CDATA[${link}]]></link><pubDate>${date}</pubDate></item>`;
  const xml = `<rss><channel>${item("https://www.federalreserve.gov/newsevents/pressreleases/test.htm", "Tue, 08 Sep 2026 12:00:00 GMT")}${item("https://example.com/wrong", "Tue, 08 Sep 2026 12:00:00 GMT")}${item("https://www.federalreserve.gov/old", "Tue, 08 Sep 2020 12:00:00 GMT")}${item("https://www.federalreserve.gov/future", "Tue, 08 Sep 2030 12:00:00 GMT")}${item("https://www.federalreserve.gov/undated", "")}</channel></rss>`;
  const result = parsePolicyNews(xml, "monetary", Date.parse("2026-09-09"));
  assert.equal(result.length, 1);
  assert.equal(result[0].scope, "industry");
  assert.equal(result[0].matched_ticker, false);
  assert.deepEqual(result[0].tickers, []);
  assert.match(result[0].source, /Federal Reserve/);
});

test("policy client shares requests, caches successes, and retries failed or expired feeds", async () => {
  let calls = 0;
  let now = 0;
  const client = createFederalReserveClient(async (options) => {
    calls++;
    assert.equal(options.timeoutMs, 5000);
    assert.equal(options.retries, 0);
    return "<rss><channel></channel></rss>";
  }, () => now);
  await Promise.all(Array.from({ length: 20 }, () => client.getFeed("monetary")));
  assert.equal(calls, 1);
  await client.getFeed("monetary");
  assert.equal(calls, 1);
  now = 30 * 60_000;
  await client.getFeed("monetary");
  assert.equal(calls, 2);
  let failures = 0;
  const broken = createFederalReserveClient(async () => { failures++; return "<html>blocked</html>"; });
  await assert.rejects(broken.getFeed("monetary"));
  await assert.rejects(broken.getFeed("monetary"));
  assert.equal(failures, 2);
});

test("news deduplicates canonical URLs and keeps bounded policy context visible", () => {
  const article = { id: "story", title: "Company news", summary: null, url: "https://example.com/story", source: "Publisher", published_at: "2026-09-08T12:00:00Z", scope: "company", tickers: [], matched_ticker: false, image_url: null };
  assert.equal(dedupeAndSort([article, { ...article, title: "Different syndication headline", url: `${article.url}?utm_source=feed#top` }]).length, 1);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...article, title: `Company update ${i}`, url: `https://example.com/${i}` }));
  const policy = { ...article, source: "Federal Reserve (monetary policy)", title: "Policy release", url: "https://www.federalreserve.gov/policy", scope: "industry", published_at: "2026-08-19T12:00:00Z" };
  const result = dedupeAndSort([...many, policy]);
  assert.equal(result.length, 24);
  assert.ok(result.includes(policy));
});

test("short stock symbols do not match ordinary words in news headlines", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    if (String(request).includes("query1.finance.yahoo.com")) return Response.json({ news: [
      { title: "A new era for consumer spending", link: "https://example.com/unrelated", providerPublishTime: 1786573800 },
      { title: "$A announces quarterly earnings", link: "https://example.com/direct", providerPublishTime: 1786573800 },
    ] });
    return Response.json({ data: { rows: [] } });
  };
  try {
    const feed = await fetchCompanyNews({ ticker: "A", name: "Agilent Technologies", sector: null, industry: null }, []);
    assert.deepEqual(feed.items.map((item) => item.url), ["https://example.com/direct"]);
  } finally { globalThis.fetch = originalFetch; }
});


test("combines partial company, industry and SEC news without losing successful sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "apple-story",
        title: "Apple expands services for business customers",
        publisher: "Example Publisher",
        link: "https://publisher.example/apple-story?utm_source=test",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.nasdaq.com")) return new Response("Unavailable", { status: 503 });
    if (url.includes("news.google.com")) {
      return new Response(`<?xml version="1.0"?><rss><channel><item><title>Consumer electronics demand improves</title><link>https://news.google.com/articles/industry</link><pubDate>Wed, 12 Aug 2026 17:00:00 GMT</pubDate><source>Industry Wire</source></item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
      [{ form: "8-K", filing_date: "2026-08-11", report_date: "2026-08-11", accession_number: "0000320193-26-000099", source_url: "https://www.sec.gov/Archives/example.htm" }],
    );
    assert.equal(feed.items.length, 3);
    assert.ok(feed.items.some((item) => item.scope === "company" && item.matched_ticker));
    assert.ok(feed.items.some((item) => item.relevance === "direct"));
    assert.ok(feed.items.some((item) => item.scope === "industry"));
    assert.ok(feed.items.some((item) => item.scope === "filing" && item.source === "SEC EDGAR"));
    assert.ok(feed.providers.includes("Yahoo Finance"));
    assert.ok(feed.providers.includes("Google News"));
    assert.ok(!feed.providers.includes("Nasdaq"));
    assert.match(feed.warnings.join(" "), /Nasdaq/);
    assert.ok(feed.items.every((item, index, items) => index === 0 || Date.parse(items[index - 1].published_at) >= Date.parse(item.published_at)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drops undated provider stories instead of presenting them as 1970 news", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "undated-story",
        title: "Apple announces a new service",
        publisher: "Example Publisher",
        link: "https://publisher.example/undated-story",
        relatedTickers: ["AAPL"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.nasdaq.com")) return new Response("Unavailable", { status: 503 });
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null },
      [],
    );
    assert.deepEqual(feed.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a total provider outage so stale news is not overwritten", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    await assert.rejects(
      fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []),
      /Yahoo Finance|Nasdaq/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects broad related-ticker headlines that do not mention the company", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "broad-etf-story",
        title: "Your Newborn Account Auto-Buys This S&P 500 ETF",
        publisher: "Example Publisher",
        link: "https://publisher.example/broad-etf-story",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL", "MSFT", "GOOG"],
      }] }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const feed = await fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []);
    assert.deepEqual(feed.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("separates focused ticker mentions from direct company coverage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "focused-ticker-story",
        title: "Large-cap technology earnings calendar for next week",
        publisher: "Example Publisher",
        link: "https://publisher.example/calendar",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL"],
      }] }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const feed = await fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []);
    assert.equal(feed.items[0]?.scope, "company");
    assert.equal(feed.items[0]?.relevance, "ticker");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves company, industry and filing coverage under the global news limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: Array.from({ length: 12 }, (_, index) => ({
        uuid: `yahoo-${index}`,
        title: `Apple company update ${index}`,
        publisher: "Yahoo Publisher",
        link: `https://publisher.example/yahoo-${index}`,
        providerPublishTime: 1_786_573_800 - index,
        relatedTickers: ["AAPL"],
      })) }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) {
      return new Response(JSON.stringify({ data: { rows: Array.from({ length: 12 }, (_, index) => ({
        title: `Apple market report ${index}`,
        description: "Apple business coverage",
        url: `/articles/apple-${index}`,
        publisher: "Nasdaq Publisher",
        created: new Date(Date.UTC(2026, 7, 12, 16, 0, 0) - index * 1000).toISOString(),
      })) } }), { status: 200 });
    }
    if (url.includes("news.google.com")) {
      const items = Array.from({ length: 8 }, (_, index) => `<item><title>Consumer electronics outlook ${index}</title><link>https://news.google.com/articles/industry-${index}</link><pubDate>Wed, 12 Aug 2026 14:0${index}:00 GMT</pubDate><source>Industry Wire</source></item>`).join("");
      return new Response(`<rss><channel>${items}</channel></rss>`, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const filings = Array.from({ length: 4 }, (_, index) => ({
      form: "8-K",
      filing_date: `2026-08-0${index + 1}`,
      report_date: `2026-08-0${index + 1}`,
      accession_number: `filing-${index}`,
      source_url: `https://www.sec.gov/Archives/filing-${index}.htm`,
    }));
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
      filings,
    );
    assert.equal(feed.items.length, 24);
    assert.deepEqual(new Set(feed.items.map((item) => item.scope)), new Set(["company", "industry", "filing"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("groups filing risks into distinct evidence-backed themes without splitting inline text", () => {
  const html = `
    <nav>
      <p>Table of Contents</p>
      <p>Item 1A. Risk Factors</p>
      <p>Item 1B. Unresolved Staff Comments</p>
    </nav>
    <h2>Item <span>1A</span>. <span>Risk Factors</span></h2>
    <p>Cybersecurity incidents create material RIS</span><span>K because attacks could expose customer data and disrupt our information systems.</p>
    <p>Intense competition and rapid technological change could reduce our market share and make our products obsolete.</p>
    <p>Changes in laws and regulatory requirements may increase our compliance costs and limit the services we offer.</p>
    <p>Supplier concentration and component shortages could interrupt manufacturing and delay deliveries to customers.</p>
    <p>A recession, inflation and higher interest rates may reduce customer demand and adversely affect revenue.</p>
    <p>Trade restrictions, export controls and geopolitical conflict could limit our international operations.</p>
    <p>Our ability to recruit and retain key personnel may affect our execution of the growth strategy.</p>
    <p>Risks associated with adverse losses and failure of operations.</p>
    <h2>Item 1B. Unresolved Staff Comments</h2>
    <p>A cybersecurity sentence outside Item 1A could harm this test if the boundary fails.</p>
  `;

  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.equal(themes.length, 7);
  assert.equal(new Set(themes.map((theme) => theme.key)).size, themes.length);
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
  assert.ok(themes.some((theme) => theme.key === "supply-chain-operations"));
  assert.ok(themes.some((theme) => theme.key === "international-geopolitical"));
  assert.ok(themes.every((theme) => theme.summary.startsWith("The filing reports that ")));
  assert.ok(themes.every((theme) => theme.summary.endsWith(".")));
  assert.ok(themes.every((theme) => theme.evidence.length >= 1 && theme.evidence.length <= 2));
  assert.ok(themes.flatMap((theme) => theme.evidence).some((evidence) => evidence.includes("RISK because")));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("Risks associated with")));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("outside Item 1A")));
});

test("extracts Item 3.D risks from a 20-F and stops at Item 4", () => {
  const html = `
    <p>ITEM 3.D. RISK FACTORS</p>
    <p>Foreign exchange volatility and economic downturns may reduce demand and adversely affect our reported revenue.</p>
    <p>Government sanctions and export controls could limit our ability to serve customers in international markets.</p>
    <p>Cyber attacks could disrupt our information systems and expose confidential customer information.</p>
    <p>ITEM 4. INFORMATION ON THE COMPANY</p>
    <p>Competition in this unrelated company-information section could affect results.</p>
  `;

  const themes = extractRiskFactorThemes(html, "20-F", 8);
  assert.ok(themes.some((theme) => theme.key === "macroeconomic-demand"));
  assert.ok(themes.some((theme) => theme.key === "international-geopolitical"));
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("unrelated company-information")));
});

test("extracts principal risks from a 40-F and respects the next report section", () => {
  const html = `
    <h2>Principal Risks and Uncertainties</h2>
    <p>Wildfires and extreme weather could disrupt facilities and interrupt our operations.</p>
    <p>Debt obligations and reduced access to capital markets may limit our liquidity and financial flexibility.</p>
    <p>Failure to retain key employees could harm our ability to execute strategic initiatives.</p>
    <h2>Management's Discussion and Analysis</h2>
    <p>Regulatory changes discussed outside the risk section may affect future periods.</p>
  `;

  const themes = extractRiskFactorThemes(html, "40-F", 8);
  assert.ok(themes.some((theme) => theme.key === "climate-physical-events"));
  assert.ok(themes.some((theme) => theme.key === "financial-liquidity"));
  assert.ok(themes.some((theme) => theme.key === "people-execution"));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("outside the risk section")));
});

test("follows a 40-F Annual Information Form exhibit when the wrapper has no risk section", async () => {
  const originalFetch = globalThis.fetch;
  const wrapperUrl = "https://www.sec.gov/Archives/edgar/data/1/wrapper40f.htm";
  const exhibitUrl = "https://www.sec.gov/Archives/edgar/data/1/exhibit99-1.htm";
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url === wrapperUrl) {
      return new Response(`<html><body><p>The Annual Information Form is incorporated by reference.</p><a href="exhibit99-1.htm">Exhibit 99.1 Annual Information Form</a></body></html>`, { status: 200 });
    }
    if (url === exhibitUrl) {
      return new Response(`<html><body><h2>Risk Factors</h2><h3>Commodity price volatility could reduce profitability</h3><p>Changes in commodity prices may materially reduce revenue, cash flow and the economic value of operations.</p><h2>Material Contracts</h2></body></html>`, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const risks = await fetchCompanyRisks({
      filings: [{ form: "40-F", filing_date: "2026-03-01", report_date: "2025-12-31", accession_number: "test-40f", source_url: wrapperUrl }],
    });
    assert.equal(risks.length, 1);
    assert.equal(risks[0].source_url, exhibitUrl);
    assert.match(`${risks[0].detail} ${risks[0].evidence.join(" ")}`, /commodity price/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCompanyDescription } from "../lib/server/company-description.ts";
import { cacheIdentity, hasSameFinancialFingerprint, isAnalysisCacheCompatible, parseCachedAnalysisRow } from "../lib/server/analysis-cache.ts";
import { compactNasdaqStockUniverse, fetchPeerFilingContext } from "../lib/server/analysis.ts";
import { ANALYSIS_SCHEMA_VERSION, COMPONENT_SOURCE_VERSIONS, NORMALIZATION_VERSION, SCORE_MODEL_VERSION, VALUATION_MODEL_VERSION } from "../lib/server/model-versions.ts";
import { extractPeerBusinessContext, rankPeerCandidates, shortlistPeerCandidates } from "../lib/server/peer-selection.ts";
import { competitiveEvidenceFor, filingPeerTickers, assessPeerEvidence, discoverFilingPeers } from "../lib/server/peer-evidence.ts";
import { persistPeerResult } from "../lib/server/peer-persistence.ts";

test("peer persistence tolerates independent cache and audit failures", async () => {
  const failure = async () => { throw new Error("storage unavailable"); };
  const stored = { fetchedAt: "2026-09-08" };
  assert.deepEqual(await persistPeerResult(async () => stored, failure), stored);
  let audited = false;
  assert.equal(await persistPeerResult(failure, async () => { audited = true; }), null);
  assert.equal(audited, true);
  assert.equal(await persistPeerResult(failure, failure), null);
});

test("filing evidence keeps the semiconductor cluster despite missing descriptions and taxonomy", () => {
  for (const ticker of ["NVDA", "AMD", "INTC"]) {
    const target = { ticker, name: ticker, sector: null, industry: null, marketCap: null };
    const candidates = filingPeerTickers(ticker).map((peer) => ({ ...target, ticker: peer, evidence: competitiveEvidenceFor(ticker, peer) }));
    const ranked = rankPeerCandidates(target, candidates);
    for (const peer of ["NVDA", "AMD", "INTC"].filter((peer) => peer !== ticker)) {
      assert.ok(ranked.some((candidate) => candidate.ticker === peer && candidate.selectionScore >= 55), `${ticker} should retain ${peer}`);
    }
  }
});

test("reverse filing evidence boosts confidence without requiring reciprocity", () => {
  const records = competitiveEvidenceFor("NVDA", "AMD");
  const now = Date.parse("2026-09-08");
  const oneWay = assessPeerEvidence("NVDA", "AMD", records.slice(0, 1), now);
  const both = assessPeerEvidence("NVDA", "AMD", records, now);
  assert.equal(oneWay.reciprocal, false);
  assert.ok(oneWay.score >= 55);
  assert.equal(both.reciprocal, true);
  assert.ok(both.score > oneWay.score);
  assert.equal(assessPeerEvidence("NVDA", "AMD", [...records, ...records], now).score, both.score);
  assert.ok(assessPeerEvidence("NVDA", "AMD", records, Date.parse("2030-01-01")).score < oneWay.score);
});

test("Dell retains filing-backed hardware peers without admitting generic technology or construction", () => {
  const target = { ticker: "DELL", name: "Dell", sector: "Technology", industry: "Computer Manufacturing", marketCap: 100e9, description: "Personal computers, workstations, enterprise servers and data-center systems." };
  const candidates = filingPeerTickers("DELL").map((ticker) => ({ ticker, name: ticker, sector: null, industry: null, marketCap: null, evidence: competitiveEvidenceFor("DELL", ticker) }));
  candidates.push({ ticker: "ROAD", name: "Builder", sector: "Industrials", industry: "Construction", marketCap: 100e9, description: "Constructs highways and buildings." });
  candidates.push({ ticker: "GEN", name: "Generic", sector: "Technology", industry: "Software", marketCap: 100e9, description: "Innovative technology solutions." });
  const result = rankPeerCandidates(target, candidates).map((candidate) => candidate.ticker);
  for (const ticker of ["HPQ", "HPE", "SMCI"]) assert.ok(result.includes(ticker));
  assert.ok(!result.includes("ROAD") && !result.includes("GEN"));
});

test("bounded shortlist admits adjacent classifications before descriptions are available", () => {
  const target = { ticker: "TARGET", name: "Target", sector: "Industrials", industry: "Industrial Machinery", marketCap: 1e9 };
  const candidate = { ticker: "PEER", name: "Peer", sector: "Other", industry: "Agricultural Machinery", marketCap: 1e9 };
  assert.equal(shortlistPeerCandidates(target, [candidate])[0]?.ticker, "PEER");
  assert.ok(shortlistPeerCandidates(target, Array.from({ length: 100 }, (_, i) => ({ ...candidate, ticker: `P${i}` })), 24).length <= 24);
});

test("shared semiconductor labels do not outweigh conflicting product segments", () => {
  const target = { ticker: "CPU", name: "Compute", sector: "Technology", industry: "Semiconductors", marketCap: 100e9, description: "Designs semiconductor CPUs and GPUs for accelerated computing." };
  const candidates = [
    { ...target, ticker: "GPU" },
    { ...target, ticker: "TOOLS", description: "Semiconductor manufacturing equipment and wafer fabrication equipment." },
    { ...target, ticker: "MEM", description: "Semiconductor DRAM and NAND flash memory chips." },
    { ...target, ticker: "POWER", description: "Semiconductor analog and mixed signal power management chips." },
  ];
  assert.deepEqual(rankPeerCandidates(target, candidates).map((peer) => peer.ticker), ["GPU"]);
});

test("sparse real-world semiconductor profile language is not positive product evidence", () => {
  const target = { ticker: "INTC", name: "Intel", sector: "Technology", industry: "Semiconductors", marketCap: 100e9, description: "Designs and manufactures advanced semiconductors that connect and power the modern world." };
  const candidates = [
    { ...target, ticker: "AMAT", description: "Materials engineering solutions at the foundation of virtually every new semiconductor and advanced display." },
    { ...target, ticker: "TXN", description: "Designs, manufactures and sells analog and embedded processing chips." },
    { ...target, ticker: "AMD", evidence: competitiveEvidenceFor("INTC", "AMD") },
  ];
  assert.deepEqual(rankPeerCandidates(target, candidates).map((peer) => peer.ticker), ["AMD"]);
  assert.deepEqual(rankPeerCandidates({ ...target, ticker: "AMD", description: "AI-optimized CPUs, GPUs, networking and software." }, candidates.filter((peer) => peer.ticker !== "AMD")), []);
});

test("filing discovery requires explicit competition and does not grant reviewed status", () => {
  const filing = { source_url: "https://www.sec.gov/example", filing_date: "2026-01-01", accession_number: "test" };
  const companies = [{ ticker: "PEER", name: "Example Widgets Inc." }, { ticker: "PARTNER", name: "Partner Company" }];
  const records = discoverFilingPeers("TARGET", "Our competitors include Example Widgets. We partner with Partner Company.", filing, companies);
  assert.deepEqual(records.map((item) => item.competitor), ["PEER"]);
  assert.equal(records[0].kind, "discovered");
  assert.equal(assessPeerEvidence("TARGET", "PEER", records), null);
  assert.deepEqual(discoverFilingPeers("TARGET", "Our potential competitors include Example Widgets.", filing, companies), []);
  assert.deepEqual(discoverFilingPeers("TARGET", "Our competitors include Example Widgets.", filing, [...companies, { ticker: "OTHER", name: "Example Widgets Corp." }]), []);
  const target = { ticker: "TARGET", name: "Target", industry: "Semiconductors", sector: "Technology", marketCap: 1e9 };
  const candidate = { ...target, ticker: "PEER", evidence: records };
  assert.equal(shortlistPeerCandidates(target, [candidate]).length, 1);
  assert.equal(rankPeerCandidates(target, [candidate]).length, 0);
});


test("creates a concise, display-safe company summary", () => {
  const source = "Example Corp. designs software for business customers. It also provides cloud services and support. A third sentence should not appear in the overview.";
  assert.equal(
    summarizeCompanyDescription(source, "Example Corp."),
    "Example Corp. designs software for business customers. It also provides cloud services and support.",
  );
  assert.equal(summarizeCompanyDescription("A business &amp; services company — with a long dash."), "A business & services company - with a long dash.");
  assert.equal(summarizeCompanyDescription("   "), null);
});

test("prefers concrete products and uses over generic company-profile language", () => {
  const source = "Sandisk is a leading global semiconductor memory company with more than 30 years of innovation in NAND flash technology. We are a vertically integrated solutions provider with ownership of chip-level design and IP, front and back-end manufacturing, as well as systems engineering and design. With a differentiated innovation engine driving advancements in storage and semiconductor technologies, our broad and ever-expanding portfolio delivers powerful flash storage solutions for artificial intelligence workloads in datacenters, edge devices, and consumer applications. Our technologies enable everyone from students, gamers and home offices, to the largest enterprises and public clouds to produce, analyze, and store data. Our solutions include a broad range of solid state drives, embedded products, removable cards, universal serial bus drives, and wafers and components. Learn more about Sandisk at www.sandisk.com.";
  const summary = summarizeCompanyDescription(source, "Sandisk");

  assert.equal(
    summary,
    "Sandisk's solutions include solid-state drives, embedded products, removable cards, USB drives, and semiconductor wafers and components. Its flash storage products support AI workloads in data centers, edge devices, and consumer applications.",
  );
  assert.doesNotMatch(summary, /leading|innovation engine|more than 30 years/i);
});

test("does not prioritize promotional plans over the current business", () => {
  const source = "Example Motors makes electric vehicles. It sells batteries to homes and utilities. The company plans to begin selling aircraft and boats.";
  const summary = summarizeCompanyDescription(source, "Example Motors");

  assert.match(summary, /makes electric vehicles/i);
  assert.match(summary, /sells batteries/i);
  assert.doesNotMatch(summary, /plans to|aircraft|boats/i);
});

test("validates cached analysis and reports its freshness", () => {
  const row = {
    listing_id: "listing:xnas:msft",
    payload_json: JSON.stringify({ company: { ticker: "MSFT" }, financials: [] }),
    generated_at: "2026-08-08T12:00:00.000Z",
    fresh_until: "2026-08-08T12:15:00.000Z",
  };

  assert.equal(parseCachedAnalysisRow(row, Date.parse("2026-08-08T12:10:00.000Z"))?.isFresh, true);
  assert.equal(parseCachedAnalysisRow(row, Date.parse("2026-08-08T12:20:00.000Z"))?.isFresh, false);
  assert.equal(parseCachedAnalysisRow({ ...row, payload_json: "not-json" }), null);
});

test("invalidates only incompatible derived snapshots while retaining company-scoped financial identities", () => {
  const compatible = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    valuation_model_version: VALUATION_MODEL_VERSION,
    score_model_version: SCORE_MODEL_VERSION,
    component_source_versions_json: JSON.stringify(COMPONENT_SOURCE_VERSIONS),
  };
  assert.equal(isAnalysisCacheCompatible(compatible), true);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, valuation_model_version: "valuation-next" }), false);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, component_source_versions_json: JSON.stringify({ ...COMPONENT_SOURCE_VERSIONS, comps: "comps-next" }) }), false);

  const cached = { sourceFingerprint: "accession-a" };
  assert.equal(hasSameFinancialFingerprint(cached, { accessionNumber: "accession-a", filingDate: "2026-08-01", form: "10-Q" }), true);
  assert.equal(hasSameFinancialFingerprint(cached, { accessionNumber: "accession-b", filingDate: "2026-08-02", form: "10-Q" }), false);

  const companyA = cacheIdentity({ cik: "0000000001", ticker: "AAA", exchange: "NASDAQ" });
  const companyB = cacheIdentity({ cik: "0000000002", ticker: "BBB", exchange: "NYSE" });
  assert.notEqual(companyA.companyId, companyB.companyId);
  assert.notEqual(companyA.listingId, companyB.listingId);
});

test("ranks close operating peers ahead of broad same-sector companies", () => {
  const target = {
    ticker: "DELL",
    name: "Dell Technologies Inc.",
    sector: "Technology",
    industry: "Computer Manufacturing",
    marketCap: 100_000_000_000,
    description: "Dell sells PCs, workstations, servers, storage and data-center infrastructure to consumers and enterprise customers.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "HPQ", name: "HP Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 25_000_000_000,
      description: "HP sells personal computers, workstations and peripherals to consumer and commercial customers.",
    },
    {
      ticker: "HPE", name: "Hewlett Packard Enterprise", sector: "Technology", industry: "Retail: Computer Software & Peripheral Equipment", marketCap: 30_000_000_000,
      description: "HPE sells enterprise servers, storage, networking and data-center infrastructure.",
      reviewedReason: "Selected because HPE identifies Dell as a primary competitor in enterprise data-center infrastructure.",
      evidenceLabel: "HPE annual filing",
      evidenceUrl: "https://www.sec.gov/",
    },
    {
      ticker: "SMCI", name: "Super Micro Computer", sector: "Technology", industry: "Computer Manufacturing", marketCap: 20_000_000_000,
      description: "Supermicro sells servers and data-center infrastructure for enterprise and cloud customers.",
    },
    {
      ticker: "MSFT", name: "Microsoft", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 3_000_000_000_000,
      description: "Microsoft develops enterprise software and cloud services.",
    },
  ]);

  assert.deepEqual(ranked.slice(0, 3).map((company) => company.ticker).sort(), ["HPE", "HPQ", "SMCI"]);
  assert.ok(ranked.find((company) => company.ticker === "HPE")?.selectionReason.includes("primary competitor"));
  assert.ok(ranked.find((company) => company.ticker === "HPQ")?.selectionReason.includes("Computer Manufacturing"));
  assert.ok((ranked.find((company) => company.ticker === "SMCI")?.selectionScore ?? 0) > (ranked.find((company) => company.ticker === "MSFT")?.selectionScore ?? 0));
});

test("shortlists unreviewed industry candidates before profile descriptions are available", () => {
  const target = {
    ticker: "ACME",
    name: "Acme Bancorp",
    sector: "Finance",
    industry: "Major Banks",
    marketCap: 12_000_000_000,
    description: "Acme provides commercial banking, deposits and lending services.",
  };
  const candidates = [
    { ticker: "BANKA", name: "Bank A", sector: "Finance", industry: "Major Banks", marketCap: 15_000_000_000 },
    { ticker: "BANKB", name: "Bank B", sector: "Finance", industry: "Major Banks", marketCap: 8_000_000_000 },
    { ticker: "INSR", name: "Insurer", sector: "Finance", industry: "Property-Casualty Insurers", marketCap: 11_000_000_000 },
    { ticker: "CHIP", name: "Chipmaker", sector: "Technology", industry: "Semiconductors", marketCap: 13_000_000_000 },
  ];

  const shortlisted = shortlistPeerCandidates(target, candidates, 3);
  assert.deepEqual(shortlisted.slice(0, 2).map((company) => company.ticker), ["BANKA", "BANKB"]);
  assert.ok(!shortlisted.some((company) => company.ticker === "CHIP"));
});

test("compacts the Nasdaq universe before storing it in the shared cache", () => {
  const rows = compactNasdaqStockUniverse([
    { symbol: " bank ", name: "Bank Corp Common Stock", marketCap: "12,000,000,000", sector: " Finance ", industry: " Major Banks ", lastsale: "$12" },
    { symbol: "PREF", name: "Example Preferred Stock", marketCap: "1,000,000", sector: "Finance", industry: "Banks" },
    { symbol: "ZERO", name: "Zero Company", marketCap: "0", sector: "Technology", industry: "Software" },
  ]);

  assert.deepEqual(rows, [{
    symbol: "BANK",
    name: "Bank Corp Common Stock",
    marketCap: "12000000000",
    sector: "Finance",
    industry: "Major Banks",
  }]);
  assert.equal("lastsale" in rows[0], false);
});

test("uses products and business models to separate companies inside a broad software industry", () => {
  const target = {
    ticker: "ADBE",
    name: "Adobe Inc.",
    sector: "Technology",
    industry: "Computer Software: Prepackaged Software",
    marketCap: 140_000_000_000,
    description: "Adobe provides creativity, digital media, document and personalized customer experience software.",
    primaryDescription: "Adobe provides creativity, digital media, document and personalized customer experience software.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "ADSK", name: "Autodesk, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 65_000_000_000,
      description: "Autodesk provides design software for designers, engineers, architects and creators.",
    },
    {
      ticker: "CDNS", name: "Cadence Design Systems, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 80_000_000_000,
      description: "Cadence provides electronic design automation software used by engineers and product designers.",
    },
    {
      ticker: "CRM", name: "Salesforce, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 190_000_000_000,
      description: "Salesforce provides customer relationship management and customer experience applications.",
    },
    {
      ticker: "XYZ", name: "Block, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 45_000_000_000,
      description: "Block provides financial technology, merchant payments and commerce products.",
    },
    {
      ticker: "NET", name: "Cloudflare, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 70_000_000_000,
      description: "Cloudflare provides a connectivity cloud, network security and content delivery services.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker), ["CRM", "ADSK"]);
  assert.ok((ranked.find((company) => company.ticker === "ADSK")?.selectionScore ?? 0) > (ranked.find((company) => company.ticker === "XYZ")?.selectionScore ?? 0));
  assert.ok(ranked.find((company) => company.ticker === "ADSK")?.selectionReason.includes("creative, design and digital-content tools"));
});

test("requires product overlap and reasonable scale for automatic automotive peers", () => {
  const target = {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    sector: "Consumer Discretionary",
    industry: "Auto Manufacturing",
    marketCap: 800_000_000_000,
    description: "Tesla designs and manufactures electric vehicles, automobiles, batteries and charging products.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "GM", name: "General Motors Company", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 55_000_000_000,
      description: "General Motors designs and manufactures automobiles and electric vehicles for consumers and fleets.",
    },
    {
      ticker: "F", name: "Ford Motor Company", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 45_000_000_000,
      description: "Ford manufactures automobiles, trucks and electric vehicles for retail and commercial customers.",
    },
    {
      ticker: "RIVN", name: "Rivian Automotive, Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 15_000_000_000,
      description: "Rivian designs and manufactures electric vehicles for consumer and commercial customers.",
    },
    {
      ticker: "WKHS", name: "Workhorse Group Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 120_000_000,
      description: "Workhorse manufactures electric commercial vehicles and delivery trucks.",
    },
    {
      ticker: "DXYZ", name: "Digital Currency X Technology Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 3_000_000_000,
      description: "Digital Currency X operates cryptocurrency infrastructure, enterprise servers and data-center systems.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker), ["GM", "F", "RIVN"]);
});

test("finds heavy-equipment peers across imperfect industry labels without admitting construction contractors", () => {
  const target = {
    ticker: "CAT",
    name: "Caterpillar Inc.",
    sector: "Industrials",
    industry: "Construction/Ag Equipment/Trucks",
    marketCap: 280_000_000_000,
    description: "Caterpillar manufactures construction and mining equipment, off-highway engines and provides financial services.",
    primaryDescription: "Caterpillar manufactures construction and mining equipment, off-highway engines and provides financial services.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "DE", name: "Deere & Company", sector: "Industrials", industry: "Industrial Machinery/Components", marketCap: 170_000_000_000,
      description: "Deere delivers agricultural, construction and forestry equipment plus financial services through its dealer network.",
    },
    {
      ticker: "CNH", name: "CNH Industrial", sector: "Industrials", industry: "Construction/Ag Equipment/Trucks", marketCap: 13_000_000_000,
      description: "CNH manufactures agricultural machinery and construction equipment for customers around the world.",
    },
    {
      ticker: "BLBD", name: "Blue Bird", sector: "Industrials", industry: "Construction/Ag Equipment/Trucks", marketCap: 1_500_000_000,
      description: "Blue Bird manufactures school buses and electric passenger vehicles.",
    },
    {
      ticker: "PWR", name: "Quanta Services", sector: "Industrials", industry: "Engineering & Construction", marketCap: 50_000_000_000,
      description: "Quanta builds electric transmission lines and utility infrastructure for power companies.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker).sort(), ["CNH", "DE"]);
});

test("rejects tiny consumer-electronics matches without a comparable business model", () => {
  const target = {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: 3_400_000_000_000,
    description: "Apple sells smartphones, personal computers, tablets, wearables and related consumer services.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "DELL", name: "Dell Technologies Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 90_000_000_000,
      description: "Dell sells personal computers and workstations to consumers and commercial customers.",
      reviewedReason: "Selected because Apple and Dell both sell personal computers to consumer and commercial customers.",
    },
    {
      ticker: "HPQ", name: "HP Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 30_000_000_000,
      description: "HP sells personal computers, workstations and peripherals to consumers and commercial customers.",
      reviewedReason: "Selected because Apple and HP both sell personal computers to consumer and commercial customers.",
    },
    {
      ticker: "OSS", name: "One Stop Systems, Inc.", sector: "Technology", industry: "Consumer Electronics", marketCap: 95_000_000,
      description: "One Stop Systems builds rugged edge-computing servers for defense and industrial customers.",
    },
    {
      ticker: "ZEPP", name: "Zepp Health Corporation", sector: "Technology", industry: "Consumer Electronics", marketCap: 190_000_000,
      description: "Zepp Health sells smart wearables and digital health products.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker).sort(), ["DELL", "HPQ"]);
});

test("keeps diversified Microsoft peers when a core software or cloud business overlaps", () => {
  const target = {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    sector: "Technology",
    industry: "Computer Software: Prepackaged Software",
    marketCap: 3_800_000_000_000,
    description: "Microsoft sells enterprise software subscriptions, productivity applications and cloud-computing services.",
    primaryDescription: "Microsoft sells enterprise software subscriptions, productivity applications and cloud-computing services.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "ORCL", name: "Oracle Corporation", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 900_000_000_000,
      description: "Oracle sells enterprise software subscriptions, database software and cloud-computing services.",
    },
    {
      ticker: "CRM", name: "Salesforce, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 250_000_000_000,
      description: "Salesforce sells enterprise applications and subscription software for customer relationship management.",
    },
    {
      ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 3_000_000_000_000,
      description: "Alphabet provides cloud-computing services, productivity software and a large digital advertising platform.",
    },
    {
      ticker: "GAME", name: "Small Game Publisher", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 300_000_000,
      description: "The company publishes mobile games and interactive entertainment.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker).sort(), ["CRM", "GOOGL", "ORCL"]);
});

test("extracts product and customer context from a target annual filing", () => {
  const html = `<html><body><div>Table of Contents Item 1. Business Item 1A</div><h2>ITEM 1. BUSINESS</h2><p>We provide solutions for creators including imaging, video editing, web design platforms and document workflows. Marketing professionals use our digital experience products. Our customers subscribe to these products across desktop and mobile devices. This paragraph provides enough detail to distinguish the operating business from the filing table of contents.</p><h2>COMPETITION</h2><p>Unrelated competitive categories.</p><h2>ITEM 1A. RISK FACTORS</h2><p>Unrelated risks.</p></body></html>`;
  const context = extractPeerBusinessContext(html);
  assert.match(context, /video editing/);
  assert.match(context, /document workflows/);
  assert.doesNotMatch(context, /Unrelated competitive categories|Unrelated risks/);
});

test("loads annual filing context for peer selection through the filing URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<h1>ITEM 1. BUSINESS</h1><p>We provide commercial banking, deposits and lending to businesses and consumers. Our customers also use wealth management, treasury, payment and investment services. We operate branches and digital channels that serve individuals, small businesses and large institutions across our primary markets.</p><h2>ITEM 1A. RISK FACTORS</h2>",
    { status: 200 },
  );
  try {
    const context = await fetchPeerFilingContext({
      form: "10-K",
      filing_date: "2026-02-01",
      report_date: "2025-12-31",
      accession_number: "0000000000-26-000001",
      source_url: "https://www.sec.gov/Archives/example.htm",
    });
    assert.match(context, /commercial banking/);
    assert.doesNotMatch(context, /RISK FACTORS/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

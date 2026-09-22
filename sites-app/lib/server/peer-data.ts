import { calculateMetrics } from "./financial-model.ts";
import { competitiveEvidenceFor, filingPeerTickers, discoverFilingPeers } from "./peer-evidence.ts";
import {
  NASDAQ_PEER_SOURCE_LABEL,
  NASDAQ_PEER_SOURCE_URL,
  PEER_SELECTION_VERSION,
  rankPeerCandidates,
  shortlistPeerCandidates,
  type PeerCandidateInput,
  type RankedPeerCandidate,
} from "./peer-selection.ts";
import {
  cleanedScreenerName,
  fetchNasdaqProfile,
  fetchNasdaqStockUniverse,
  fetchQuote,
  isOperatingCommonStock,
  issuerNameKey,
} from "./nasdaq-provider.ts";
import { fetchFinancialSource, fetchPeerFilingContext } from "./sec-provider.ts";
import type {
  CompanyProfile,
  ComparableCompany,
  ComparableCompanyDataLoader,
  Filing,
} from "./analysis-types.ts";

const COMPS_CACHE_TTL_MS = 15 * 60 * 1000;
const compsCache = new Map<string, { expiresAt: number; company: ComparableCompany }>();

type ReviewedPeer = {
  ticker: string;
  reason?: string;
  evidenceLabel?: string;
  evidenceUrl?: string;
};

const seeds = (...tickers: string[]): ReviewedPeer[] => tickers.map((ticker) => ({ ticker }));
const reviewedNasdaqPeers = (...peers: [ticker: string, reason: string][]): ReviewedPeer[] => peers.map(([ticker, reason]) => ({
  ticker,
  reason,
  evidenceLabel: "Reviewed Nasdaq company profiles",
  evidenceUrl: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/company-profile`,
}));
const REVIEWED_PEERS: Record<string, ReviewedPeer[]> = {
  ADBE: [
    {
      ticker: "ADSK",
      reason: "Selected because Adobe and Autodesk both sell subscription design and creation software used by professional creators, designers and enterprise teams.",
      evidenceLabel: "Adobe annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm",
    },
    {
      ticker: "DOCU",
      reason: "Selected because Adobe Acrobat and DocuSign both serve business document workflows, electronic agreements and digital-signature customers through subscription software.",
      evidenceLabel: "Adobe annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm",
    },
    {
      ticker: "CRM",
      reason: "Selected because Adobe Experience Cloud and Salesforce both sell enterprise software for customer engagement, personalized digital experiences and marketing workflows.",
      evidenceLabel: "Adobe annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm",
    },
  ],
  AAPL: reviewedNasdaqPeers(
    ["DELL", "Selected because Apple and Dell both sell personal computers and related hardware to consumer and commercial customers."],
    ["HPQ", "Selected because Apple and HP both sell personal computers and related devices through consumer and commercial channels."],
    ["SONY", "Selected because Apple and Sony both sell premium consumer devices and digital services to global consumer markets."],
  ),
  AMZN: seeds("WMT", "COST", "EBAY"),
  CAT: reviewedNasdaqPeers(
    ["DE", "Selected because Caterpillar and Deere both manufacture construction and heavy equipment and pair it with dealer networks and customer financing."],
    ["CNH", "Selected because Caterpillar and CNH both sell construction and off-highway equipment through global dealer networks."],
    ["TEX", "Selected because Caterpillar and Terex both manufacture construction, materials-processing and lifting equipment for industrial customers."],
    ["AGCO", "Selected because Caterpillar and AGCO both manufacture large off-highway machinery supported by parts, service and dealer networks."],
    ["CMI", "Selected because Caterpillar and Cummins both sell engines, power systems and related components to industrial and off-highway customers."],
    ["PCAR", "Selected because Caterpillar and PACCAR both manufacture heavy equipment and vehicles and provide customer financing through dealer networks."],
  ),
  COST: seeds("WMT", "TGT", "BJ"),
  DELL: [
    {
      ticker: "HPQ",
      reason: "Selected because HP identifies Dell as a primary competitor in personal systems, where both companies sell PCs, workstations and peripherals to consumer and commercial customers.",
      evidenceLabel: "HP annual filing competitive disclosure",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/47217/000004721719000071/hp-103119x10k.htm",
    },
    {
      ticker: "HPE",
      reason: "Selected because HPE identifies Dell as a primary competitor in enterprise servers and data-center infrastructure, serving similar commercial and institutional customers.",
      evidenceLabel: "HPE annual filing competitive disclosure",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1645590/000164559026000021/fy25arsfiling.pdf",
    },
    {
      ticker: "SMCI",
      reason: "Selected because Supermicro identifies Dell among its principal competitors for servers and data-center systems.",
      evidenceLabel: "Supermicro annual filing competitive disclosure",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1375365/000137536525000027/smci-20250630.htm",
    },
  ],
  GOOGL: seeds("META", "MSFT", "AMZN"),
  HPE: seeds("DELL", "SMCI", "CSCO", "NTAP"),
  HPQ: seeds("DELL", "AAPL", "HPE"),
  JPM: seeds("BAC", "WFC", "C"),
  KO: seeds("PEP", "KDP", "MNST"),
  MA: seeds("V", "AXP", "PYPL"),
  MCD: seeds("YUM", "SBUX", "QSR"),
  META: seeds("GOOGL", "SNAP", "PINS"),
  MSFT: reviewedNasdaqPeers(
    ["ORCL", "Selected because Microsoft and Oracle both sell enterprise software, database products and cloud infrastructure through recurring commercial relationships."],
    ["CRM", "Selected because Microsoft and Salesforce both sell subscription enterprise applications, analytics and customer-workflow software to organizations."],
    ["GOOGL", "Selected because Microsoft and Alphabet both operate hyperscale cloud platforms and sell productivity software and digital services."],
  ),
  NFLX: seeds("DIS", "WBD", "PARA"),
  NVDA: seeds("AMD", "AVGO", "QCOM"),
  PANW: [
    {
      ticker: "CRWD",
      reason: "Selected because Palo Alto Networks and CrowdStrike both sell subscription cybersecurity platforms that protect enterprise endpoints, cloud workloads and identity systems.",
      evidenceLabel: "Palo Alto Networks annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1327567/000132756725000027/panw-20250731.htm",
    },
    {
      ticker: "FTNT",
      reason: "Selected because Palo Alto Networks and Fortinet both sell enterprise network-security platforms, including firewalls and secure access products, to similar organizations.",
      evidenceLabel: "Palo Alto Networks annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1327567/000132756725000027/panw-20250731.htm",
    },
    {
      ticker: "ZS",
      reason: "Selected because Palo Alto Networks and Zscaler both provide cloud-delivered security and zero-trust access products through recurring enterprise subscriptions.",
      evidenceLabel: "Palo Alto Networks annual filing and Nasdaq company profiles",
      evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1327567/000132756725000027/panw-20250731.htm",
    },
  ],
  PEP: seeds("KO", "KDP", "MNST"),
  SMCI: seeds("DELL", "HPE", "CSCO"),
  TSLA: reviewedNasdaqPeers(
    ["GM", "Selected because Tesla and General Motors both manufacture passenger vehicles and compete in electric vehicles for consumer and fleet customers."],
    ["F", "Selected because Tesla and Ford both manufacture passenger and commercial vehicles and compete in electric vehicles and related services."],
    ["RIVN", "Selected because Tesla and Rivian both design electric vehicles, sell directly to customers and build charging and connected-vehicle ecosystems."],
  ),
  V: seeds("MA", "AXP", "PYPL"),
};

async function findIndustryPeers(
  ticker: string,
  targetProfile: CompanyProfile,
  marketCap: number | null,
  filings: Filing[] = [],
) {
  const universe = await fetchNasdaqStockUniverse();
  const annualFiling = filings.find((filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  const [filingContext, targetBusinessProfile] = await Promise.all([
    fetchPeerFilingContext(annualFiling),
    fetchNasdaqProfile(ticker).catch(() => null),
  ]);
  const reviewed = [...(REVIEWED_PEERS[ticker] ?? [])];
  const discovered = annualFiling ? discoverFilingPeers(ticker, filingContext, annualFiling, universe.rows
    .filter((row) => isOperatingCommonStock(String(row.name ?? "")))
    .map((row) => ({ ticker: String(row.symbol ?? "").toUpperCase(), name: cleanedScreenerName(String(row.name ?? "")) }))) : [];
  for (const peer of filingPeerTickers(ticker)) {
    if (!reviewed.some((item) => item.ticker === peer)) reviewed.push({ ticker: peer });
  }
  const reviewedByTicker = new Map(reviewed.map((peer) => [peer.ticker, peer]));
  const pool = new Map<string, PeerCandidateInput>();
  for (const row of universe.rows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    const rawName = String(row.name ?? symbol);
    const industry = String(row.industry ?? "").trim() || null;
    const sector = String(row.sector ?? "").trim() || null;
    const candidateCap = Number(String(row.marketCap ?? "").replaceAll(",", ""));
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || symbol === ticker || !isOperatingCommonStock(rawName) || !Number.isFinite(candidateCap) || candidateCap <= 0) continue;
    // Let the bounded shortlist inspect adjacent industries too, before profile enrichment.
    const evidence = reviewedByTicker.get(symbol);
    pool.set(symbol, {
      ticker: symbol,
      name: cleanedScreenerName(rawName),
      sector,
      industry,
      marketCap: candidateCap,
      reviewedReason: evidence?.reason ?? null,
      evidenceLabel: evidence?.evidenceLabel ?? null,
      evidenceUrl: evidence?.evidenceUrl ?? null,
      evidence: [...competitiveEvidenceFor(ticker, symbol), ...discovered.filter((item) => item.competitor === symbol)],
    });
  }
  for (const evidence of reviewed) {
    if (!pool.has(evidence.ticker)) {
      pool.set(evidence.ticker, {
        ticker: evidence.ticker,
        name: evidence.ticker,
        sector: null,
        industry: null,
        marketCap: null,
        reviewedReason: evidence.reason ?? null,
        evidenceLabel: evidence.evidenceLabel ?? null,
        evidenceUrl: evidence.evidenceUrl ?? null,
        evidence: competitiveEvidenceFor(ticker, evidence.ticker),
      });
    }
  }
  const target = {
    ticker,
    name: targetProfile.name,
    sector: targetProfile.sector,
    industry: targetProfile.industry,
    marketCap,
    description: [targetBusinessProfile?.description, targetProfile.description, filingContext].filter(Boolean).join(" "),
    primaryDescription: targetBusinessProfile?.description ?? targetProfile.description,
  };
  const initial = shortlistPeerCandidates(target, [...pool.values()], 24);
  const shortlistTickers = new Set([
    ...initial.map((peer) => peer.ticker),
  ]);
  const enriched = await Promise.all([...shortlistTickers].map(async (candidateTicker) => {
    const candidate = pool.get(candidateTicker)!;
    const profile = await fetchNasdaqProfile(candidateTicker).catch(() => null);
    return {
      ...candidate,
      name: profile?.name ?? candidate.name,
      sector: profile?.sector ?? candidate.sector,
      industry: profile?.industry ?? candidate.industry,
      description: profile?.description ?? null,
    };
  }));
  const sourceProvider = filingContext && annualFiling
    ? `${NASDAQ_PEER_SOURCE_LABEL} plus ${targetProfile.name}'s latest annual filing`
    : NASDAQ_PEER_SOURCE_LABEL;
  const sourceUrl = filingContext && annualFiling ? annualFiling.source_url : NASDAQ_PEER_SOURCE_URL;
  const ranked = rankPeerCandidates(target, enriched).map((candidate) => candidate.reviewedReason || candidate.evidence?.length ? candidate : ({
    ...candidate,
    sourceLabel: sourceProvider,
    sourceUrl,
  }));
  return {
    ranked,
    candidatesConsidered: pool.size,
    sourceAsOf: universe.asOf,
    sourceProvider,
    sourceUrl,
  };
}

function applyPeerSelection(company: ComparableCompany, candidate: RankedPeerCandidate): ComparableCompany {
  return {
    ...company,
    selection_reason: candidate.selectionReason,
    selection_score: candidate.selectionScore,
    selection_factors: candidate.selectionFactors,
    selection_source: candidate.sourceLabel,
    selection_source_url: candidate.sourceUrl,
    selection_evidence: candidate.evidence,
  };
}

async function buildComparableCompany(
  candidate: RankedPeerCandidate,
  loadCompanyData?: ComparableCompanyDataLoader,
): Promise<ComparableCompany> {
  const cached = compsCache.get(candidate.ticker);
  if (cached && cached.expiresAt > Date.now()) return applyPeerSelection(cached.company, candidate);

  const { financials, quote } = loadCompanyData
    ? await loadCompanyData(candidate.ticker)
    : await Promise.all([fetchFinancialSource(candidate.ticker, false), fetchQuote(candidate.ticker)])
      .then(([nextFinancials, nextQuote]) => ({ financials: nextFinancials, quote: nextQuote }));
  const metrics = calculateMetrics(financials.periods, quote.price, quote.market_cap);
  const company: ComparableCompany = {
    ticker: candidate.ticker,
    name: financials.profile.name,
    sector: financials.profile.sector,
    industry: financials.profile.industry,
    price: quote.price,
    market_cap: metrics.market_cap,
    revenue_growth: metrics.revenue_growth_yoy,
    net_income_growth: metrics.net_income_growth_yoy,
    gross_margin: metrics.gross_margin,
    operating_margin: metrics.operating_margin,
    fcf_margin: metrics.fcf_margin,
    roic: metrics.roic,
    pe: metrics.pe,
    price_to_book: metrics.price_to_book,
    price_fcf: metrics.price_to_fcf,
    fcf_yield: metrics.fcf_yield,
    fiscal_year: financials.periods.at(-1)!.fiscal_year,
    quote_as_of: quote.as_of,
    selection_reason: candidate.selectionReason,
    selection_score: candidate.selectionScore,
    selection_factors: candidate.selectionFactors,
    selection_source: candidate.sourceLabel,
    selection_source_url: candidate.sourceUrl,
    selection_evidence: candidate.evidence,
  };
  compsCache.set(candidate.ticker, { expiresAt: Date.now() + COMPS_CACHE_TTL_MS, company });
  return company;
}

export async function fetchComparableCompanies(
  ticker: string,
  profile: CompanyProfile,
  marketCap: number | null,
  filings: Filing[] = [],
  loadCompanyData?: ComparableCompanyDataLoader,
) {
  const candidateSet = await findIndustryPeers(ticker, profile, marketCap, filings);
  const reviewed = candidateSet.ranked.filter((candidate) => Boolean(candidate.reviewedReason) || Boolean(candidate.evidence?.length));
  const ordered = [...reviewed, ...candidateSet.ranked.filter((candidate) => !candidate.reviewedReason && !candidate.evidence?.length)];
  const desiredCount = Math.min(8, Math.max(4, candidateSet.ranked.length));
  const enrichmentCount = Math.min(14, Math.max(desiredCount + 4, 8));
  const results = await Promise.allSettled(
    ordered.slice(0, enrichmentCount).map((candidate) => buildComparableCompany(candidate, loadCompanyData)),
  );
  const seenIssuers = new Set<string>();
  const minimumDisplayScore = 55;
  const companies = results
    .filter((result): result is PromiseFulfilledResult<ComparableCompany> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((company) => {
      const key = issuerNameKey(company.name);
      if (!key || seenIssuers.has(key)) return false;
      seenIssuers.add(key);
      return true;
    })
    .filter((company) => company.selection_score >= minimumDisplayScore)
    .slice(0, desiredCount);
  return {
    companies,
    methodology: companies.length
      ? `Industry-first peer selection with a minimum relevance score of ${minimumDisplayScore}. A broader classification shortlist is verified against company products, customers and business models before up to eight peers are shown. Metrics are recalculated from current SEC annual facts and delayed Nasdaq prices.`
      : `No peers met the minimum relevance score of ${minimumDisplayScore}. AplexAnalysis leaves the set empty instead of showing companies with weak product, customer, or business-model overlap.`,
    source_provider: candidateSet.sourceProvider,
    source_url: candidateSet.sourceUrl,
    source_as_of: candidateSet.sourceAsOf,
    candidates_considered: candidateSet.candidatesConsidered,
    selection_version: PEER_SELECTION_VERSION,
  };
}

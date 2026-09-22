/** Reviewed disclosures, not an automatically generated or exhaustive competitor graph. */
export type PeerEvidence = {
  kind?: "reviewed" | "discovered";
  reporter: string;
  competitor: string;
  segments: string[];
  sourceUrl: string;
  filingDate: string;
  accession: string;
};

const filing = (reporter: string, filingDate: string, accession: string, sourceUrl: string) =>
  (competitor: string, ...segments: string[]): PeerEvidence => ({ reporter, competitor, segments, sourceUrl, filingDate, accession });

const nvda = filing("NVDA", "2026-02-25", "0001045810-26-000021", "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm");
const amd = filing("AMD", "2026-02-04", "0000002488-26-000018", "https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm");
const intc = filing("INTC", "2026-01-23", "0000050863-26-000011", "https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm");
const hp = filing("HPQ", "2025-12-10", "0000047217-25-000071", "https://www.sec.gov/Archives/edgar/data/47217/000004721725000071/hpq-20251031.htm");
const smci = filing("SMCI", "2026-08-31", "0001375365-26-000022", "https://www.sec.gov/Archives/edgar/data/1375365/000137536526000022/smci-20260630.htm");
const hpe = filing("HPE", "2025-12-18", "0001645590-25-000130", "https://www.sec.gov/Archives/edgar/data/1645590/000164559025000130/hpe-20251031.htm");

export const REVIEWED_COMPETITIVE_EVIDENCE: readonly PeerEvidence[] = [
  nvda("AMD", "GPUs and accelerated computing", "data-center processors"),
  nvda("INTC", "GPUs and accelerated computing", "data-center processors"),
  amd("NVDA", "GPUs and accelerated computing", "data-center processors"),
  amd("INTC", "client CPUs", "data-center processors", "discrete graphics"),
  intc("AMD", "client CPUs", "data-center processors", "discrete graphics"),
  intc("NVDA", "GPUs and accelerated computing", "data-center processors"),
  hp("DELL", "PCs and workstations"),
  smci("DELL", "servers and data-center systems"),
  smci("HPE", "servers and data-center systems"),
  hpe("DELL", "servers and data-center systems"),
  hpe("SMCI", "servers and data-center systems"),
];

export function competitiveEvidenceFor(target: string, candidate: string, records = REVIEWED_COMPETITIVE_EVIDENCE) {
  return records.filter((item) => (item.reporter === target && item.competitor === candidate)
    || (item.reporter === candidate && item.competitor === target));
}

export function filingPeerTickers(target: string, records = REVIEWED_COMPETITIVE_EVIDENCE) {
  return [...new Set(records.flatMap((item) => item.reporter === target ? [item.competitor] : item.competitor === target ? [item.reporter] : []))];
}

export function assessPeerEvidence(target: string, candidate: string, records: readonly PeerEvidence[], now = Date.now()) {
  // Keep the latest disclosure per reporter. Repeated mentions are not independent corroboration.
  const latest = new Map<string, PeerEvidence>();
  for (const item of competitiveEvidenceFor(target, candidate, records)) {
    if (item.kind === "discovered") continue; // Candidate recall only; not reviewed segment evidence.
    const date = Date.parse(item.filingDate);
    if (!Number.isFinite(date) || date > now || !item.segments.length) continue;
    if (!latest.has(item.reporter) || item.filingDate > latest.get(item.reporter)!.filingDate) latest.set(item.reporter, item);
  }
  const evidence = [...latest.values()].sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  if (!evidence.length) return null;
  const ageDays = (now - Date.parse(evidence[0].filingDate)) / 86_400_000;
  const reciprocal = latest.has(target) && latest.has(candidate)
    && (now - Date.parse(latest.get(target)!.filingDate)) / 86_400_000 <= 730
    && (now - Date.parse(latest.get(candidate)!.filingDate)) / 86_400_000 <= 730;
  const segments = [...new Set(evidence.flatMap((item) => item.segments))];
  // Evidence loses priority as it ages; it is never represented as newly verified.
  const base = ageDays <= 548 ? 65 : ageDays <= 730 ? 58 : 40;
  return { evidence, reciprocal, segments, score: base + (reciprocal ? 6 : 0), ageDays };
}

/** Conservative recall from explicit competition statements. Never grants a relevance-gate exemption. */
export function discoverFilingPeers(
  reporter: string,
  context: string,
  filing: { source_url: string; filing_date: string | null; accession_number: string },
  companies: Array<{ ticker: string; name: string }>,
  limit = 12,
): PeerEvidence[] {
  if (!filing.filing_date || !Number.isFinite(Date.parse(filing.filing_date))) return [];
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const statements = context.slice(0, 36_000).split(/(?<=[.!?])\s+(?=[A-Z])/).filter((sentence) =>
    /\b(?:competitors? (?:include|is|are)|compete (?:primarily )?(?:against|with))\b/i.test(sentence)
    && !/\b(?:could|may|potential|formerly|no longer)\b/i.test(sentence),
  ).map((sentence) => ` ${normalize(sentence.slice(0, 1800))} `);
  const names = new Map<string, string[]>();
  for (const company of companies) {
    const name = normalize(company.name.replace(/\b(?:incorporated|corporation|company|limited|inc|corp|ltd|plc)\.?\b/gi, ""));
    if (name.length < 5) continue; // Never match bare short tickers or ambiguous short aliases.
    names.set(name, [...(names.get(name) ?? []), company.ticker]);
  }
  const results: PeerEvidence[] = [];
  for (const [name, tickers] of names) {
    if (tickers.length !== 1 || tickers[0] === reporter) continue;
    if (!statements.some((statement) => statement.includes(` ${name} `))) continue;
    results.push({ reporter, competitor: tickers[0], kind: "discovered", segments: [], sourceUrl: filing.source_url, filingDate: filing.filing_date, accession: filing.accession_number });
  }
  return results.sort((a, b) => a.competitor.localeCompare(b.competitor)).slice(0, Math.max(0, Math.min(limit, 12)));
}

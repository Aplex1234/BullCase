import type { Analysis, AnalysisSection } from "./types";

export const ANALYSIS_SECTIONS: AnalysisSection[] = [
  "overview",
  "financials",
  "valuation",
  "buyTarget",
  "comps",
  "earnings",
  "news",
  "filings",
  "risks",
  "research",
];

export type DeferredSection = Exclude<AnalysisSection, "overview">;
export type AnalysisSectionPanelState = "content" | "loading" | "error";

export function sectionIncludesDetailedFinancials(section: AnalysisSection) {
  return section === "financials" || section === "valuation" || section === "buyTarget";
}

export function sectionIncludesEstimates(section: AnalysisSection) {
  return section === "earnings" || section === "financials";
}

export function isAnalysisSectionLoaded(analysis: Pick<Analysis, "data_scope" | "loaded_sections">, section: AnalysisSection) {
  if (section === "overview") return true;
  if (analysis.loaded_sections) return analysis.loaded_sections.includes(section);
  // Legacy unscoped responses are complete, but explicit partial responses are not.
  return analysis.data_scope == null || analysis.data_scope === "full";
}

export function analysisSectionPanelState(
  analysis: Pick<Analysis, "data_scope" | "loaded_sections">,
  section: AnalysisSection,
  loadingSection: DeferredSection | null,
  sectionError: string | null,
): AnalysisSectionPanelState {
  if (isAnalysisSectionLoaded(analysis, section)) return "content";
  if (sectionError) return "error";
  if (loadingSection === section) return "loading";
  return "loading";
}

export function mergeAnalysisSection(current: Analysis, next: Analysis, section: AnalysisSection): Analysis {
  if (next.data_scope === "full") return next;
  const detailedFinancials = sectionIncludesDetailedFinancials(section);
  const includesEstimates = sectionIncludesEstimates(section);
  const loadedSections = new Set<AnalysisSection>([
    ...(current.loaded_sections ?? ANALYSIS_SECTIONS.filter((item) => isAnalysisSectionLoaded(current, item))),
    ...(next.loaded_sections ?? [section]),
  ]);
  const currentFreshness = current.freshness;
  const nextFreshness = next.freshness;
  let mergedFreshness = currentFreshness && nextFreshness ? {
    ...nextFreshness,
    analyst_estimates: includesEstimates ? nextFreshness.analyst_estimates : currentFreshness.analyst_estimates,
    comps: section === "comps" ? nextFreshness.comps : currentFreshness.comps,
    news: section === "news" ? nextFreshness.news : currentFreshness.news,
    risks: section === "risks" ? nextFreshness.risks : currentFreshness.risks,
  } : nextFreshness ?? currentFreshness;
  if (mergedFreshness && Object.entries(mergedFreshness).some(([key, item]) =>
    key !== "page_status" && item != null && typeof item === "object" && item.status === "stale"
  )) {
    // Keep the page warning in sync with all source data retained by the merge.
    mergedFreshness = { ...mergedFreshness, page_status: "stale" };
  }
  const warnings = [...new Set([
    ...(current.provenance.warnings ?? []),
    ...(next.provenance.warnings ?? []),
  ])];

  return {
    ...current,
    ...next,
    data_scope: "partial",
    loaded_sections: [...loadedSections],
    financials: detailedFinancials ? next.financials : current.financials,
    quarterly_financials: detailedFinancials ? next.quarterly_financials : current.quarterly_financials,
    analyst_estimates: includesEstimates ? next.analyst_estimates : current.analyst_estimates,
    comps: section === "comps" ? next.comps : current.comps,
    peer_selection: section === "comps" ? next.peer_selection : current.peer_selection,
    filings: section === "filings" ? next.filings : current.filings,
    risks: section === "risks" ? next.risks : current.risks,
    news: section === "news" ? next.news : current.news,
    freshness: mergedFreshness,
    provenance: {
      ...next.provenance,
      analyst_estimates: includesEstimates ? next.provenance.analyst_estimates : current.provenance.analyst_estimates,
      risk_factors: section === "risks" ? next.provenance.risk_factors : current.provenance.risk_factors,
      news: section === "news" ? next.provenance.news : current.provenance.news,
      comparables: section === "comps" ? next.provenance.comparables : current.provenance.comparables,
      peer_snapshot_as_of: section === "comps" ? next.provenance.peer_snapshot_as_of : current.provenance.peer_snapshot_as_of,
      warnings,
    },
  };
}

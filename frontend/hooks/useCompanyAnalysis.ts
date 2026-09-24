"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAnalysis, warmAnalysis } from "@/lib/api";
import {
  ANALYSIS_SECTIONS,
  isAnalysisSectionLoaded,
  mergeAnalysisSection,
  type DeferredSection,
} from "@/lib/analysis-sections";
import type { Analysis, AnalysisSection, SecuritySearchResult } from "@/lib/types";

export type RefreshStatus = {
  message: string;
  outcome: "success" | "warning" | "error";
};

function securityFromAnalysis(analysis: Analysis): SecuritySearchResult {
  return {
    issuer_id: analysis.company.cik,
    security_id: `ticker:${analysis.company.ticker}`,
    listing_id: `${analysis.company.exchange ?? "US"}:${analysis.company.ticker}`,
    ticker: analysis.company.ticker,
    name: analysis.company.name,
    cik: analysis.company.cik,
    exchange: analysis.company.exchange ?? "US",
    mic: analysis.company.exchange ?? "US",
    security_type: "Common stock",
    coverage: "SEC filings",
  };
}

export function useCompanyAnalysis({
  ticker,
  activePage,
  initialAnalysis,
  rememberSecurity,
}: {
  ticker: string;
  activePage: AnalysisSection;
  initialAnalysis: Analysis | null;
  rememberSecurity: (result: SecuritySearchResult) => void;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(initialAnalysis);
  const [loading, setLoading] = useState(!initialAnalysis);
  const [loadingSection, setLoadingSection] = useState<DeferredSection | null>(null);
  const [forcedSection, setForcedSection] = useState<DeferredSection | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<AnalysisSection, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [manualRefreshStatus, setManualRefreshStatus] = useState<(RefreshStatus & { ticker: string }) | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const refreshSequence = useRef(0);

  useEffect(() => {
    refreshSequence.current += 1;
    const controller = new AbortController();
    let active = true;
    const hasVisibleSnapshot = requestVersion === 0 && initialAnalysis?.company.ticker === ticker;
    setLoading(!hasVisibleSnapshot);
    setLoadingSection(null);
    setSectionErrors({});
    setManualRefreshing(false);
    setManualRefreshStatus(null);
    if (!hasVisibleSnapshot) setAnalysis(null);
    setError(null);
    fetchAnalysis(ticker, controller.signal, "overview")
      .then((value) => {
        if (!active) return;
        const warming = warmAnalysis(ticker);
        setAnalysis(value);
        rememberSecurity(securityFromAnalysis(value));
        void warming
          .then((warmed) => {
            if (!active || warmed.company.ticker !== ticker) return;
            setAnalysis((current) => current?.company.ticker === ticker ? warmed : current);
          })
          .catch(() => undefined);
      })
      .catch((requestError: Error) => {
        if (active && requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialAnalysis, rememberSecurity, requestVersion, ticker]);

  useEffect(() => {
    if (activePage === "overview" || !analysis || analysis.company.ticker !== ticker) {
      setLoadingSection(null);
      return;
    }
    if (isAnalysisSectionLoaded(analysis, activePage)) {
      setLoadingSection(null);
      return;
    }
    const requestedSection = activePage;
    const controller = new AbortController();
    let active = true;
    setLoadingSection(requestedSection);
    setSectionErrors((current) => ({ ...current, [requestedSection]: undefined }));
    const forceRefresh = forcedSection === requestedSection;
    fetchAnalysis(ticker, controller.signal, requestedSection, forceRefresh)
      .then((value) => {
        if (active) {
          setAnalysis((current) => current && current.company.ticker === ticker
            ? mergeAnalysisSection(current, value, requestedSection)
            : value);
        }
      })
      .catch((requestError: Error) => {
        if (active && requestError.name !== "AbortError") {
          setSectionErrors((current) => ({ ...current, [requestedSection]: requestError.message }));
        }
      })
      .finally(() => {
        if (!active) return;
        setLoadingSection((current) => current === requestedSection ? null : current);
        setForcedSection((current) => current === requestedSection ? null : current);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activePage, analysis, forcedSection, ticker]);

  const retrySection = useCallback((section: DeferredSection) => {
    setForcedSection(section);
    setSectionErrors((current) => ({ ...current, [section]: undefined }));
    setAnalysis((current) => current ? {
      ...current,
      data_scope: "partial",
      loaded_sections: (current.loaded_sections ?? ANALYSIS_SECTIONS)
        .filter((item) => item !== section),
    } : current);
  }, []);

  const retryOverview = useCallback(() => {
    setRequestVersion((value) => value + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!analysis || manualRefreshing) return;
    const refreshTicker = ticker;
    const refreshSection = activePage;
    const sequence = refreshSequence.current;
    setManualRefreshing(true);
    setManualRefreshStatus(null);
    try {
      const refreshed = await fetchAnalysis(refreshTicker, undefined, refreshSection, true);
      if (refreshSequence.current !== sequence) return;
      setAnalysis((current) => {
        if (!current || current.company.ticker !== refreshTicker) return current;
        return refreshSection === "overview"
          ? refreshed
          : mergeAnalysisSection(current, refreshed, refreshSection);
      });
      const status = refreshed.freshness?.page_status;
      const remainsStale = !status || status === "stale" || status === "refreshing";
      setManualRefreshStatus({
        ticker: refreshTicker,
        message: remainsStale ? "Some sources could not refresh. Showing the latest available data." : "Data refreshed just now",
        outcome: remainsStale ? "warning" : "success",
      });
    } catch (refreshError) {
      if (refreshSequence.current !== sequence) return;
      setManualRefreshStatus({
        ticker: refreshTicker,
        message: refreshError instanceof Error ? refreshError.message : "Refresh failed. Try again.",
        outcome: "error",
      });
    } finally {
      if (refreshSequence.current === sequence) setManualRefreshing(false);
    }
  }, [activePage, analysis, manualRefreshing, ticker]);

  return {
    analysis,
    loading,
    loadingSection,
    sectionErrors,
    error,
    manualRefreshing,
    manualRefreshStatus: manualRefreshStatus?.ticker === ticker ? manualRefreshStatus : null,
    retrySection,
    retryOverview,
    refresh,
  };
}

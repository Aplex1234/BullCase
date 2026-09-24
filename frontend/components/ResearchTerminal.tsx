"use client";

import Renew from "@carbon/icons-react/es/Renew.js";
import { useCallback, useState } from "react";

import { useCompanyAnalysis } from "@/hooks/useCompanyAnalysis";
import { useSecuritySearch } from "@/hooks/useSecuritySearch";
import { useTerminalTheme } from "@/hooks/useTerminalTheme";
import type { Analysis, AnalysisSection } from "@/lib/types";
import type { AccountIdentity } from "../lib/account";
import { Button, InlineNotification, SkeletonText, Theme } from "./BullCasePrimitives";
import { CompanyHeader } from "./CompanyHeader";
import { ResearchPages } from "./ResearchPages";
import { TerminalHeader } from "./TerminalHeader";
import { TerminalEasterEgg, type EasterEggMode } from "./TerminalEasterEgg";
import { TerminalNavigation } from "./TerminalNavigation";

const COMPANY_HEADER_PAGES = new Set<AnalysisSection>([
  "overview",
  "buyTarget",
  "earnings",
  "filings",
]);

export type TerminalPage = AnalysisSection;

export function ResearchTerminal({
  initialAnalysis = null,
  account = null,
  signInPath = "/signin-with-chatgpt?return_to=%2F",
  signOutPath = "/signout-with-chatgpt?return_to=%2F",
}: {
  initialAnalysis?: Analysis | null;
  account?: AccountIdentity | null;
  signInPath?: string;
  signOutPath?: string;
}) {
  const [ticker, setTicker] = useState("AAPL");
  const [activePage, setActivePage] = useState<TerminalPage>("overview");
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(() => new Set());
  const [easterEgg, setEasterEgg] = useState<{ mode: EasterEggMode; run: number } | null>(null);
  const selectTicker = useCallback((nextTicker: string) => {
    setTicker(nextTicker);
    setActivePage("overview");
    window.scrollTo({ top: 0 });
  }, []);
  const search = useSecuritySearch(ticker, selectTicker);
  const company = useCompanyAnalysis({
    ticker,
    activePage,
    initialAnalysis,
    rememberSecurity: search.rememberSecurity,
  });
  const { theme, toggleTheme } = useTerminalTheme();
  const { openTicker } = search;

  const openCompanyProfile = useCallback((nextTicker: string) => {
    if (!openTicker(nextTicker)) return;
  }, [openTicker]);
  const dismissSourceWarning = useCallback((warningKey: string) => {
    setDismissedWarnings((current) => {
      const next = new Set(current);
      next.add(warningKey);
      return next;
    });
  }, []);
  const dismissEasterEgg = useCallback(() => setEasterEgg(null), []);

  return (
    <Theme theme={theme === "dark" ? "g100" : "white"}>
      <div className="terminal-shell" data-theme={theme}>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <TerminalHeader
          theme={theme}
          ticker={ticker}
          search={search}
          onHome={() => openCompanyProfile("AAPL")}
          onToggleTheme={toggleTheme}
          account={account}
          signInPath={signInPath}
          signOutPath={signOutPath}
          onSelectCompany={openCompanyProfile}
          onEasterEgg={(mode) => setEasterEgg({ mode, run: Date.now() })}
        />
        <TerminalNavigation activePage={activePage} onSelectPage={setActivePage} />
        {easterEgg && <TerminalEasterEgg key={easterEgg.run} mode={easterEgg.mode} onDone={dismissEasterEgg} />}

        <main id="main-content" className="workspace">
          {company.loading && <LoadingState ticker={ticker} />}
          {!company.loading && company.error && !company.analysis && (
            <ErrorState ticker={ticker} error={company.error} retry={company.retryOverview} />
          )}
          {!company.loading && company.analysis && (
            <>
              {COMPANY_HEADER_PAGES.has(activePage) && (
                <CompanyHeader
                  analysis={company.analysis}
                  refreshing={company.manualRefreshing}
                  refreshStatus={company.manualRefreshStatus}
                  onRefresh={company.refresh}
                  onGmeEasterEgg={() => setEasterEgg({ mode: "gme", run: Date.now() })}
                />
              )}
              {company.analysis.provenance.warnings.map((warning) => {
                const warningKey = `${ticker}:${warning}`;
                if (dismissedWarnings.has(warningKey)) return null;
                return (
                  <InlineNotification
                    key={warningKey}
                    kind="warning"
                    lowContrast
                    title="Source status"
                    subtitle={warning}
                    onClose={() => dismissSourceWarning(warningKey)}
                  />
                );
              })}
              <ResearchPages
                page={activePage}
                analysis={company.analysis}
                onSelectCompany={openCompanyProfile}
                loadingSection={company.loadingSection}
                sectionError={company.sectionErrors[activePage] ?? null}
                onRetrySection={company.retrySection}
              />
            </>
          )}
        </main>
      </div>
    </Theme>
  );
}

function LoadingState({ ticker }: { ticker: string }) {
  return (
    <div className="loading-state" aria-live="polite">
      <div className="loading-heading">
        <SkeletonText heading width="22%" />
        <p>Retrieving and normalizing {ticker} filings</p>
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="skeleton-cell" key={index}>
            <SkeletonText paragraph lineCount={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ ticker, error, retry }: {
  ticker: string;
  error: string;
  retry: () => void;
}) {
  return (
    <div className="error-state">
      <InlineNotification kind="error" title={`Could not analyze ${ticker}`} subtitle={error} hideCloseButton />
      <Button kind="tertiary" renderIcon={Renew} onClick={retry}>Try again</Button>
    </div>
  );
}

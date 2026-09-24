"use client";

import { ProfilePanel } from "./ProfilePanel";
import { useRef, type MouseEvent } from "react";

import type { SecuritySearchController } from "@/hooks/useSecuritySearch";
import type { TerminalTheme } from "@/hooks/useTerminalTheme";
import type { AccountIdentity } from "../lib/account";
import { CompanySearch } from "./CompanySearch";
import { FavoriteButton } from "./FavoriteButton";
import type { EasterEggMode } from "./TerminalEasterEgg";

export function TerminalHeader({
  theme,
  ticker,
  search,
  onHome,
  onToggleTheme,
  account,
  signInPath,
  signOutPath,
  onSelectCompany,
  onEasterEgg,
}: {
  theme: TerminalTheme;
  ticker: string;
  search: SecuritySearchController;
  onHome: () => void;
  onToggleTheme: () => void;
  account: AccountIdentity | null;
  signInPath: string;
  signOutPath: string;
  onSelectCompany: (ticker: string) => void;
  onEasterEgg: (mode: EasterEggMode) => void;
}) {
  const logoClicks = useRef(0);
  const firstLogoClick = useRef(0);
  const lastLogoClick = useRef(0);

  function resetLogoClicks() {
    logoClicks.current = 0;
    firstLogoClick.current = 0;
    lastLogoClick.current = 0;
  }

  function handleLogoClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      resetLogoClicks();
      onHome();
      return;
    }
    const now = performance.now();
    if (logoClicks.current === 0 || now - lastLogoClick.current > 325 || now - firstLogoClick.current > 1100) {
      logoClicks.current = 0;
      firstLogoClick.current = now;
    }
    lastLogoClick.current = now;
    logoClicks.current += 1;
    onHome();
    if (logoClicks.current >= 5) {
      resetLogoClicks();
      onEasterEgg("market");
      return;
    }
  }

  return (
    <header className="topbar">
      <button type="button" className="brand-lockup" aria-label="Go to BullCase overview" onClick={handleLogoClick}>
        <span className="brand-name"><strong>Bull</strong>Case</span>
      </button>
      <CompanySearch search={search} />
      <div className="topbar-status">
        <FavoriteButton ticker={ticker} account={account} />
        <ProfilePanel theme={theme} onToggleTheme={onToggleTheme} account={account} signInPath={signInPath} signOutPath={signOutPath} onSelectCompany={onSelectCompany} />
      </div>
    </header>
  );
}

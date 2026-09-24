"use client";

import Close from "@carbon/icons-react/es/Close.js";
import Favorite from "@carbon/icons-react/es/Favorite.js";
import FavoriteFilled from "@carbon/icons-react/es/FavoriteFilled.js";
import { useEffect, useRef, useState } from "react";

import type { AccountIdentity, AccountSnapshot } from "../lib/account";

const FAVORITES_TIP_KEY = "bullcase:favorites-profile-tip";

export function FavoriteButton({ ticker, account }: { ticker: string; account: AccountIdentity | null }) {
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [callout, setCallout] = useState("");
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFavorite(false);
    setCallout("");
    if (!account) {
      return;
    }
    const controller = new AbortController();
    void fetch("/api/v1/account", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as AccountSnapshot;
        if (!response.ok) throw new Error();
        if (!controller.signal.aborted) setFavorite(result.favorites.some((item) => item.ticker === ticker));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [account, ticker]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  function showCallout(message: string) {
    setCallout(message);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setCallout(""), 5000);
  }

  async function toggleFavorite() {
    if (!account) {
      showCallout("Sign in from Profile to save favorites.");
      return;
    }
    const nextFavorite = !favorite;
    setBusy(true);
    try {
      const response = await fetch(nextFavorite ? "/api/v1/account/favorites" : `/api/v1/account/favorites?ticker=${encodeURIComponent(ticker)}`, {
        method: nextFavorite ? "POST" : "DELETE",
        headers: nextFavorite ? { "Content-Type": "application/json" } : undefined,
        body: nextFavorite ? JSON.stringify({ ticker }) : undefined,
      });
      const result = await response.json() as AccountSnapshot & { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Favorites are temporarily unavailable.");
      setFavorite(result.favorites.some((item) => item.ticker === ticker));
      if (nextFavorite && shouldShowFavoritesTip()) {
        showCallout("Favorited companies are saved in Profile.");
      }
    } catch (reason) {
      showCallout(reason instanceof Error ? reason.message : "Favorites are temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="favorite-control">
    <button
      type="button"
      className={favorite ? "favorite-trigger is-favorite" : "favorite-trigger"}
      aria-label={favorite ? `Remove ${ticker} from favorites` : `Add ${ticker} to favorites`}
      aria-pressed={favorite}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      disabled={busy}
      onClick={() => void toggleFavorite()}
    >
      {favorite ? <FavoriteFilled size={22} aria-hidden="true" /> : <Favorite size={22} aria-hidden="true" />}
    </button>
    {callout && <div className="favorite-callout" role="status">
      <span>{callout}</span>
      <button type="button" aria-label="Dismiss favorites message" onClick={() => setCallout("")}><Close size={14} aria-hidden="true" /></button>
    </div>}
  </div>;
}

function shouldShowFavoritesTip() {
  try {
    if (window.localStorage.getItem(FAVORITES_TIP_KEY)) return false;
    window.localStorage.setItem(FAVORITES_TIP_KEY, "shown");
    return true;
  } catch {
    return true;
  }
}

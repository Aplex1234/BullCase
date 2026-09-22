"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { prefetchAnalysis, searchSecurities } from "@/lib/api";
import {
  addRecentSecurity,
  mergeSecurityOptions,
  loadRecentSecurities,
  saveRecentSecurities,
} from "@/lib/security-search";
import type { SecuritySearchResult } from "@/lib/types";

export function useSecuritySearch(
  currentTicker: string,
  onSelectTicker: (ticker: string) => void,
) {
  const [input, setInput] = useState(currentTicker);
  const [results, setResults] = useState<SecuritySearchResult[]>([]);
  const [recent, setRecent] = useState<SecuritySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    setRecent(loadRecentSecurities());
  }, []);

  const rememberSecurity = useCallback((result: SecuritySearchResult) => {
    setRecent((current) => {
      const next = addRecentSecurity(current, result);
      saveRecentSecurities(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const query = input.trim();
    if (!open || !query || query.toUpperCase() === currentTicker) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchSecurities(query, controller.signal)
        .then((nextResults) => {
          if (controller.signal.aborted) return;
          setResults(nextResults);
          setHighlightedIndex(nextResults.length ? 0 : -1);
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted && error.name !== "AbortError") {
            setResults([]);
            setSearchError(error.message || "Company search is temporarily unavailable.");
            setOpen(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentTicker, input, open]);

  const { uniqueRecent, options } = useMemo(
    () => mergeSecurityOptions(results, recent),
    [recent, results],
  );

  const close = useCallback(() => {
    setOpen(false);
    setHighlightedIndex(-1);
  }, []);

  const openTicker = useCallback((value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return false;
    setInput(normalized);
    onSelectTicker(normalized);
    close();
    return true;
  }, [close, onSelectTicker]);

  const selectSecurity = useCallback((result: SecuritySearchResult) => {
    prefetchAnalysis(result.ticker);
    rememberSecurity(result);
    openTicker(result.ticker);
  }, [openTicker, rememberSecurity]);

  const submit = useCallback((event: FormEvent) => {
    event.preventDefault();
    const normalized = input.trim().toUpperCase();
    if (!normalized) return;
    const exactMatch = [...results, ...recent].find((item) => item.ticker === normalized);
    if (exactMatch) {
      selectSecurity(exactMatch);
      return;
    }
    if (open && highlightedIndex >= 0 && options[highlightedIndex]) {
      selectSecurity(options[highlightedIndex]);
      return;
    }
    openTicker(normalized);
  }, [highlightedIndex, input, open, openTicker, options, recent, results, selectSecurity]);

  const changeInput = useCallback((value: string) => {
    setInput(value);
    setResults([]);
    setSearchError(null);
    setOpen(true);
    setHighlightedIndex(-1);
  }, []);

  const prefetchOption = useCallback((index: number) => {
    setHighlightedIndex(index);
    const option = options[index];
    if (option) prefetchAnalysis(option.ticker);
  }, [options]);

  return {
    input,
    results,
    uniqueRecent,
    options,
    open,
    searching,
    searchError,
    highlightedIndex,
    rememberSecurity,
    selectSecurity,
    submit,
    changeInput,
    openTicker,
    close,
    setOpen,
    setHighlightedIndex,
    prefetchOption,
  };
}

export type SecuritySearchController = ReturnType<typeof useSecuritySearch>;

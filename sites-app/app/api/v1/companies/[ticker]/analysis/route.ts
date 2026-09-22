import { NextResponse } from "next/server";
import type { AnalysisSection } from "@/lib/types";
import {
  acquireCacheRefreshLease,
  acquireRefreshLease,
  readCachedAnalysis,
  recordCompanyViewInBackground,
  recordRefreshFailure,
  scheduleBackgroundRefresh,
  shouldCheckForDueRefresh,
} from "@/lib/server/analysis-cache";
import {
  buildOverviewSnapshot,
  buildSectionSnapshot,
  markSnapshotFreshness,
  rebuildAnalysisFromComponentCaches,
  rebuildAnalysisSectionFromComponentCaches,
  rebuildOverviewFromComponentCaches,
  refreshDueCompanies,
} from "@/lib/server/analysis-service";
import { normalizeTicker } from "@/lib/server/security-master";
import {
  ColdBuildBusyError,
  RequestRateLimitError,
  coordinateAnalysisBuild,
  enforceRequestLimit,
} from "@/lib/server/scaling-protection";
import { EDGE_CACHEABLE_HEADER } from "@/lib/server/edge-cache";
import { InvalidRequestError, toPublicApiError } from "@/lib/server/provider-errors";

const SECTION_VIEWS = new Set<AnalysisSection>(["financials", "valuation", "buyTarget", "comps", "earnings", "news", "filings", "risks", "research"]);
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;

function requestedAnalysisView(request: Request) {
  const requestedView = new URL(request.url).searchParams.get("view");
  if (requestedView != null && requestedView !== "overview" && !SECTION_VIEWS.has(requestedView as AnalysisSection)) {
    throw new InvalidRequestError("Unsupported analysis view.");
  }
  return {
    overviewOnly: requestedView === "overview",
    requestedSection: SECTION_VIEWS.has(requestedView as AnalysisSection) ? requestedView as AnalysisSection : null,
  };
}

async function refreshCachedAnalysis(ticker: string, listingId: string) {
  try {
    await rebuildAnalysisFromComponentCaches(ticker);
  } catch (error) {
    await recordRefreshFailure(listingId, error);
  }
}

async function warmFullAnalysis(request: Request, ticker: string) {
  try {
    await coordinateAnalysisBuild(`${ticker}:full`, async () => {
      await enforceRequestLimit(request, "cold-build");
      return rebuildAnalysisFromComponentCaches(ticker);
    });
  } catch {
    // Overview remains usable when optional background enrichment is busy or unavailable.
  }
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const requestStartedAt = Date.now();
  try {
    await enforceRequestLimit(request, "general");
    const { ticker } = await context.params;
    const normalizedTicker = normalizeTicker(ticker);
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.has("refresh")) {
      return NextResponse.json(
        { detail: "Manual refresh uses POST." },
        { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } },
      );
    }
    const forceRefresh = false;
    const { overviewOnly, requestedSection } = requestedAnalysisView(request);
    const responseScope = overviewOnly ? "overview" : requestedSection ?? "full";
    const cached = forceRefresh || requestedSection ? null : await readCachedAnalysis(normalizedTicker);

    if (cached) {
      let refreshing = false;
      if (!cached.isFresh && await acquireRefreshLease(cached.listingId)) {
        refreshing = await scheduleBackgroundRefresh(refreshCachedAnalysis(normalizedTicker, cached.listingId));
        if (!refreshing) await recordRefreshFailure(cached.listingId, "Background refresh is unavailable in this runtime");
      }
      void recordCompanyViewInBackground(normalizedTicker, cached.listingId);
      if (cached.isFresh && shouldCheckForDueRefresh()) {
        void scheduleBackgroundRefresh(refreshDueCompanies(1, normalizedTicker));
      }
      const analysis = markSnapshotFreshness(cached.analysis, cached.isFresh ? "cached" : "stale");
      const etag = `W/"analysis-${normalizedTicker}-${responseScope}-${cached.generatedAt}-${cached.isFresh ? "fresh" : "stale"}"`;
      const headers = {
        "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
        ETag: etag,
        "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
        [EDGE_CACHEABLE_HEADER]: cached.isFresh ? "yes" : "no",
      };
      if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
      return NextResponse.json({
        data: overviewOnly ? buildOverviewSnapshot(analysis) : requestedSection ? buildSectionSnapshot(analysis, requestedSection) : analysis,
        meta: {
          ticker: normalizedTicker,
          cache: cached.isFresh ? "hit" : "stale",
          cached_at: cached.generatedAt,
          fresh_until: cached.freshUntil,
          refreshing,
        },
      }, { headers });
    }

    const analysis = await coordinateAnalysisBuild(`${normalizedTicker}:${responseScope}`, async () => {
      await enforceRequestLimit(request, "cold-build");
      return overviewOnly
        ? await rebuildOverviewFromComponentCaches(normalizedTicker, forceRefresh)
        : requestedSection
          ? await rebuildAnalysisSectionFromComponentCaches(normalizedTicker, requestedSection, forceRefresh)
          : await rebuildAnalysisFromComponentCaches(normalizedTicker);
    });
    if (overviewOnly) void scheduleBackgroundRefresh(warmFullAnalysis(request, normalizedTicker));
    const persisted = await readCachedAnalysis(normalizedTicker);
    const generatedAt = analysis.provenance.generated_at;
    const etag = `W/"analysis-${normalizedTicker}-${responseScope}-${generatedAt}-live"`;
    const headers = {
      "Cache-Control": forceRefresh ? "no-store" : "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
      ETag: etag,
      "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
      [EDGE_CACHEABLE_HEADER]: ["stale", "refreshing"].includes(analysis.freshness?.page_status ?? "") ? "no" : "yes",
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({
      data: analysis,
      meta: { ticker: normalizedTicker, cache: forceRefresh ? "refresh" : "miss", cached: Boolean(persisted) },
    }, { headers });
  } catch (error) {
    if (error instanceof RequestRateLimitError || error instanceof ColdBuildBusyError) {
      return NextResponse.json(
        { detail: error.message },
        {
          status: error instanceof RequestRateLimitError ? 429 : 503,
          headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    const publicError = toPublicApiError(error, "Analysis is temporarily unavailable.");
    return NextResponse.json(
      { detail: publicError.detail, code: publicError.code },
      {
        status: publicError.status,
        headers: {
          "Cache-Control": "no-store",
          ...(publicError.retryAfterSeconds == null ? {} : { "Retry-After": String(publicError.retryAfterSeconds) }),
        },
      },
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 1_024) {
    return NextResponse.json({ detail: "Refresh request is too large." }, { status: 413 });
  }

  try {
    await enforceRequestLimit(request, "general");
    await enforceRequestLimit(request, "manual-refresh");
    const { ticker } = await context.params;
    const normalizedTicker = normalizeTicker(ticker);
    const { overviewOnly, requestedSection } = requestedAnalysisView(request);
    const cooldownKey = `manual-refresh:${normalizedTicker}`;

    if (!await acquireCacheRefreshLease(cooldownKey, MANUAL_REFRESH_COOLDOWN_MS)) {
      return NextResponse.json(
        { detail: "This company was refreshed recently. Please wait a minute and try again." },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }

    const analysis = overviewOnly
      ? await rebuildOverviewFromComponentCaches(normalizedTicker, true)
      : requestedSection
        ? await rebuildAnalysisSectionFromComponentCaches(normalizedTicker, requestedSection, true)
        : await rebuildAnalysisFromComponentCaches(normalizedTicker);

    return NextResponse.json({
      data: analysis,
      meta: { ticker: normalizedTicker, cache: "refresh", cached: true },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestRateLimitError) {
      return NextResponse.json(
        { detail: error.message },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const publicError = toPublicApiError(error, "Analysis refresh is temporarily unavailable.");
    return NextResponse.json(
      { detail: publicError.detail, code: publicError.code },
      {
        status: publicError.status,
        headers: {
          "Cache-Control": "no-store",
          ...(publicError.retryAfterSeconds == null ? {} : { "Retry-After": String(publicError.retryAfterSeconds) }),
        },
      },
    );
  }
}

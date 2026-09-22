import { NextResponse } from "next/server";
import { getStockPriceHistoryResult, type PriceHistoryRange } from "@/lib/server/market-data";
import { RequestRateLimitError, enforceRequestLimit } from "@/lib/server/scaling-protection";
import { EDGE_CACHEABLE_HEADER } from "@/lib/server/edge-cache";
import { InvalidRequestError, toPublicApiError } from "@/lib/server/provider-errors";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const requestStartedAt = Date.now();
  try {
    await enforceRequestLimit(request, "general");
    const { ticker } = await context.params;
    const requestedRange = new URL(request.url).searchParams.get("range");
    if (requestedRange != null && !["1d", "1y", "5y", "max"].includes(requestedRange)) {
      throw new InvalidRequestError("Unsupported price-history range.");
    }
    const range: PriceHistoryRange = requestedRange as PriceHistoryRange | null ?? "1y";
    const { data, isFresh } = await getStockPriceHistoryResult(ticker, range);
    const etag = `W/"price-history-${data.ticker}-${data.range}-${data.as_of}"`;
    const headers = {
      "Cache-Control": range === "1d"
        ? "public, max-age=15, s-maxage=60, stale-while-revalidate=120"
        : "public, max-age=300, s-maxage=3600, stale-while-revalidate=21600",
      ETag: etag,
      "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
      [EDGE_CACHEABLE_HEADER]: isFresh ? "yes" : "no",
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    if (error instanceof RequestRateLimitError) {
      return NextResponse.json(
        { detail: error.message },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const publicError = toPublicApiError(error, "Price history is temporarily unavailable.");
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

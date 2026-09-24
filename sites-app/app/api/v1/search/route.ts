import { NextResponse } from "next/server";
import { searchSecurities } from "@/lib/server/security-master";
import { RequestRateLimitError, enforceRequestLimit } from "@/lib/server/scaling-protection";
import { toPublicApiError } from "@/lib/server/provider-errors";

export async function GET(request: Request) {
  try {
    await enforceRequestLimit(request, "general");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const requestedLimit = Number(searchParams.get("limit") ?? 8);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 20)) : 8;

    if (!query || query.length > 80) {
      return NextResponse.json(
        { detail: "Search query must contain between 1 and 80 characters." },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    await enforceRequestLimit(request, "search");
    return NextResponse.json(await searchSecurities(query, limit));
  } catch (error) {
    if (error instanceof RequestRateLimitError) {
      return NextResponse.json(
        { detail: error.message },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const publicError = toPublicApiError(error, "Company search is temporarily unavailable.");
    return NextResponse.json(
      { detail: publicError.detail, code: publicError.code },
      { status: publicError.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

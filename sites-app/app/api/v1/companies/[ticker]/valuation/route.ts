import { NextResponse } from "next/server";
import type { Assumptions } from "@/lib/server/analysis";
import { rebuildAnalysisFromComponentCaches } from "@/lib/server/analysis-service";
import { normalizeTicker } from "@/lib/server/security-master";
import { RequestRateLimitError, enforceRequestLimit } from "@/lib/server/scaling-protection";
import { InvalidRequestError, toPublicApiError } from "@/lib/server/provider-errors";
import { DEFAULT_ASSUMPTIONS } from "@/lib/server/financial-model";

const MAX_BODY_BYTES = 8_192;

async function readBoundedJson(request: Request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Valuation request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new InvalidRequestError("Invalid valuation request.");
  }
}

function optionalFiniteNumber(value: unknown, minimum: number, maximum: number) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new InvalidRequestError(`Valuation input must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function parseAssumptions(value: unknown): Partial<Assumptions> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new InvalidRequestError("Invalid valuation assumptions.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["forecast_years", "revenue_growth", "fcf_margin", "wacc", "terminal_growth"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new InvalidRequestError("Unknown valuation assumption.");
  const forecastYears = optionalFiniteNumber(input.forecast_years, 1, 10);
  if (forecastYears != null && !Number.isInteger(forecastYears)) throw new InvalidRequestError("Forecast years must be a whole number.");
  const assumptions = {
    ...(forecastYears == null ? {} : { forecast_years: forecastYears }),
    ...(input.revenue_growth === undefined ? {} : { revenue_growth: optionalFiniteNumber(input.revenue_growth, -0.5, 1) }),
    ...(input.fcf_margin === undefined ? {} : { fcf_margin: optionalFiniteNumber(input.fcf_margin, -0.5, 1) }),
    ...(input.wacc === undefined ? {} : { wacc: optionalFiniteNumber(input.wacc, 0.01, 0.5) as number }),
    ...(input.terminal_growth === undefined ? {} : { terminal_growth: optionalFiniteNumber(input.terminal_growth, -0.05, 0.1) as number }),
  };
  const effectiveWacc = assumptions.wacc ?? DEFAULT_ASSUMPTIONS.wacc;
  const effectiveTerminalGrowth = assumptions.terminal_growth ?? DEFAULT_ASSUMPTIONS.terminal_growth;
  if (effectiveTerminalGrowth >= effectiveWacc) throw new InvalidRequestError("Terminal growth must be lower than WACC.");
  return assumptions;
}

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ detail: "Valuation request is too large." }, { status: 413 });
  }
  try {
    const { ticker } = await context.params;
    const normalizedTicker = normalizeTicker(ticker);
    const parsedPayload = await readBoundedJson(request);
    if (typeof parsedPayload !== "object" || parsedPayload == null || Array.isArray(parsedPayload)) {
      throw new InvalidRequestError("Invalid valuation request.");
    }
    const payload = parsedPayload as { assumptions?: unknown };
    const assumptions = parseAssumptions(payload.assumptions);
    await enforceRequestLimit(request, "general");
    return NextResponse.json({
      data: await rebuildAnalysisFromComponentCaches(normalizedTicker, assumptions, false),
      meta: { ticker: normalizedTicker, custom_assumptions: true },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestRateLimitError) {
      return NextResponse.json(
        { detail: error.message },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof RangeError) {
      return NextResponse.json({ detail: error.message }, { status: 413 });
    }
    const publicError = toPublicApiError(error, "Valuation is temporarily unavailable.");
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

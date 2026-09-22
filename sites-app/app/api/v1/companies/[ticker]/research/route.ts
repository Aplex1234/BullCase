import { runtimeResearchConfig, personalResearchConfig, ResearchProviderError, ResearchAnswerError, parseResearchMessages, buildResearchContext, requestResearchAnswer, readResearchJson, validateResearchCitations, streamResearchResponse } from "@/lib/server/ai-research";
import { loadResearchEvidence } from "@/lib/server/analysis-service";
import { normalizeTicker } from "@/lib/server/security-master";
import { enforceResearchLimit, RequestRateLimitError } from "@/lib/server/scaling-protection";
import { accountResearchConfig } from "@/lib/server/account-settings";

const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") ?? undefined;
  const accountConfig = await accountResearchConfig(request, provider).catch(() => null);
  const config = accountConfig ?? await runtimeResearchConfig(provider);
  return Response.json({ configured: !!config, provider: config?.provider ?? null, model: config?.model ?? null, scope: accountConfig ? "account" : config ? "shared" : null }, { headers });
}

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ detail: "Cross-origin research requests are not allowed." }, { status: 403, headers });
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return Response.json({ detail: "Send JSON research requests." }, { status: 415, headers });
  const selected = new URL(request.url).searchParams.get("provider") ?? undefined;
  let config;
  let messages;
  let ticker;
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(65000)]);
  try {
    ticker = normalizeTicker((await context.params).ticker);
    const payload = await readResearchJson(request, 80000, AbortSignal.any([deadline, AbortSignal.timeout(10000)]));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid conversation.");
    const settings = payload as { connection?: unknown };
    try {
      config = Object.hasOwn(settings, "connection")
        ? personalResearchConfig(settings.connection, selected)
        : await accountResearchConfig(request, selected).catch(() => null) ?? await runtimeResearchConfig(selected);
    } catch {
      return Response.json({ detail: "Check your API key, provider, and model ID in API settings." }, { status: 400, headers });
    }
    if (!config) return Response.json({ detail: "Add an API key to start researching." }, { status: 503, headers });
    messages = parseResearchMessages((payload as { messages?: unknown }).messages);
  } catch {
    return Response.json({ detail: "Invalid or oversized conversation. Keep questions under 2,000 characters." }, { status: 400, headers });
  }
  let stage = "limits";
  try {
    await enforceResearchLimit(request);
    deadline.throwIfAborted();
    stage = "evidence";
    const evidence = await loadResearchEvidence(ticker);
    deadline.throwIfAborted();
    const pack = buildResearchContext(ticker, evidence.data, evidence.freshness);
    if (pack.context.length > 160000) return Response.json({ detail: "Company evidence exceeds the research context limit." }, { status: 503, headers });
    stage = "provider";
    if (request.headers.get("accept")?.includes("application/x-ndjson")) return streamResearchResponse(config, pack.context, messages, pack.sources, deadline);
    const result = await requestResearchAnswer(config, pack.context, messages, deadline);
    stage = "citations";
    const citedSources = validateResearchCitations(result.answer, pack.sources);
    return Response.json({ ...result, sources: citedSources, uncited: citedSources.length === 0, provider: config.provider, model: config.model, ticker }, { headers });
  } catch (error) {
    if (error instanceof ResearchAnswerError) return Response.json({ detail: error.message, code: `research_answer_${error.reason}` }, { status: 502, headers });
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return Response.json({ detail: "The research request timed out. Please try again.", code: "research_timeout" }, { status: 504, headers });
    if (error instanceof ResearchProviderError) return Response.json({ detail: error.message }, { status: error.status === 429 ? 429 : 502, headers });
    if (error instanceof RequestRateLimitError) return Response.json({ detail: "Research request limit reached. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
    // Never return raw upstream bodies, prompts, credentials, or internal exception messages.
    console.error("[research] request failed", { stage });
    const detail = stage === "limits" ? "Research request limits are temporarily unavailable. Try again shortly."
      : stage === "evidence" ? "Company evidence could not be loaded. Refresh the company and try again."
      : stage === "citations" ? "The answer contained an unrecognized citation. Please retry."
      : "The provider returned no usable answer. Try a shorter question or another model.";
    return Response.json({ detail, code: `research_${stage}_unavailable` }, { status: 503, headers });
  }
}

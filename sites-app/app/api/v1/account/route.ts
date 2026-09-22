import {
  accountUserFromRequest,
  isAiProvider,
  readAccount,
  removeAccountProvider,
  saveAccountProvider,
} from "@/lib/server/account-settings";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = accountUserFromRequest(request);
  if (!user) return Response.json({ detail: "Sign in to view your account." }, { status: 401, headers: responseHeaders });
  try {
    return Response.json(await readAccount(user), { headers: responseHeaders });
  } catch {
    return Response.json({ detail: "Account settings are temporarily unavailable." }, { status: 503, headers: responseHeaders });
  }
}

export async function PUT(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  const user = accountUserFromRequest(request);
  if (!user) return Response.json({ detail: "Sign in to save account settings." }, { status: 401, headers: responseHeaders });
  try {
    const payload = await readBoundedJson(request, 10000) as { provider?: unknown; model?: unknown; apiKey?: unknown };
    const provider = typeof payload.provider === "string" ? payload.provider : "";
    const model = typeof payload.model === "string" ? payload.model.trim() : "";
    const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : undefined;
    const hasControlCharacter = [...model].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!isAiProvider(provider) || !model || model.length > 200 || hasControlCharacter) {
      return Response.json({ detail: "Choose a provider and enter a valid model name." }, { status: 400, headers: responseHeaders });
    }
    if (apiKey !== undefined && (apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey))) {
      return Response.json({ detail: "Enter a valid API key without spaces." }, { status: 400, headers: responseHeaders });
    }
    await saveAccountProvider({ user, provider, model, apiKey });
    return Response.json(await readAccount(user), { headers: responseHeaders });
  } catch (error) {
    console.warn("[account] provider settings save failed", { error: error instanceof Error ? error.message : "unknown" });
    const message = error instanceof Error && error.message === "An API key is required for a new provider."
      ? error.message
      : "Could not save provider settings.";
    return Response.json({ detail: message }, { status: message.startsWith("An API key") ? 400 : 503, headers: responseHeaders });
  }
}

export async function DELETE(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  const user = accountUserFromRequest(request);
  if (!user) return Response.json({ detail: "Sign in to change account settings." }, { status: 401, headers: responseHeaders });
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isAiProvider(provider)) return Response.json({ detail: "Choose a valid provider." }, { status: 400, headers: responseHeaders });
  try {
    await removeAccountProvider(user.userId, provider);
    return Response.json(await readAccount(user), { headers: responseHeaders });
  } catch {
    console.warn("[account] provider key removal failed");
    return Response.json({ detail: "Could not remove the provider key." }, { status: 503, headers: responseHeaders });
  }
}

function rejectUnsafeMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ detail: "Cross-origin account changes are not allowed." }, { status: 403, headers: responseHeaders });
  }
  if (request.method === "PUT" && !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ detail: "Send JSON account settings." }, { status: 415, headers: responseHeaders });
  }
  return null;
}

async function readBoundedJson(request: Request, maxBytes: number) {
  if (!request.body) throw new Error("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) throw new Error("Request is too large.");
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

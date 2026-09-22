import {
  accountUserFromRequest,
  readAccount,
  removeFavorite,
  saveFavorite,
} from "@/lib/server/account-settings";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request, true);
  if (rejected) return rejected;
  const user = accountUserFromRequest(request);
  if (!user) return Response.json({ detail: "Sign in to save favorites." }, { status: 401, headers: responseHeaders });
  try {
    const payload = await readBoundedJson(request, 2048) as { ticker?: unknown };
    const ticker = validTicker(payload.ticker);
    if (!ticker) return Response.json({ detail: "Choose a valid company ticker." }, { status: 400, headers: responseHeaders });
    await saveFavorite(user, ticker);
    return Response.json(await readAccount(user), { headers: responseHeaders });
  } catch {
    return Response.json({ detail: "Could not save this favorite." }, { status: 503, headers: responseHeaders });
  }
}

export async function DELETE(request: Request) {
  const rejected = rejectUnsafeMutation(request, false);
  if (rejected) return rejected;
  const user = accountUserFromRequest(request);
  if (!user) return Response.json({ detail: "Sign in to change favorites." }, { status: 401, headers: responseHeaders });
  const ticker = validTicker(new URL(request.url).searchParams.get("ticker"));
  if (!ticker) return Response.json({ detail: "Choose a valid company ticker." }, { status: 400, headers: responseHeaders });
  try {
    await removeFavorite(user.userId, ticker);
    return Response.json(await readAccount(user), { headers: responseHeaders });
  } catch {
    return Response.json({ detail: "Could not remove this favorite." }, { status: 503, headers: responseHeaders });
  }
}

function rejectUnsafeMutation(request: Request, expectsJson: boolean) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ detail: "Cross-origin account changes are not allowed." }, { status: 403, headers: responseHeaders });
  }
  if (expectsJson && !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ detail: "Send JSON favorite settings." }, { status: 415, headers: responseHeaders });
  }
  return null;
}

function validTicker(value: unknown) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

type StreamResult = { answer: string; sources: Array<{ id: string; title: string; url: string; date: string | null }>; truncated?: boolean };

export async function readResearchResponse(response: Response, signal: AbortSignal, onText: (answer: string) => void): Promise<StreamResult> {
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.detail || "Research is unavailable. Try again.");
  }
  // Older deployments and providers without streaming remain compatible.
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const result = await response.json();
    if (typeof result.answer !== "string" || !Array.isArray(result.sources)) throw new Error("The provider returned an invalid answer.");
    return result;
  }
  if (!response.body) throw new Error("The response was interrupted. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", answer = "", bytes = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) throw new Error("The response was interrupted. Please try again.");
      bytes += next.value.byteLength;
      if (bytes > 300000) throw new Error("The response was too long. Please try again.");
      buffer += decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.detail || "The response was interrupted. Please try again.");
        if (event.type === "delta" && typeof event.text === "string") {
          answer += event.text;
          if (answer.length > 12000) throw new Error("The response was too long. Please try again.");
          onText(answer);
        } else if (event.type === "done") {
          if (typeof event.answer !== "string" || !Array.isArray(event.sources) || event.answer !== answer) throw new Error("The provider returned an invalid answer.");
          return event;
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

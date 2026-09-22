export type InFlightMap = Map<string, Promise<unknown>>;

export type ColdBuildCoordinator<T> = {
  key: string;
  build: () => Promise<T>;
  readResult: () => Promise<T | null>;
  writeResult: (value: T) => Promise<void>;
  acquireLease: () => Promise<boolean>;
  releaseLease: () => Promise<void>;
  inFlight?: InFlightMap;
  pollIntervalMs?: number;
  leaseRetryIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class ColdBuildBusyError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 2) {
    super("Analysis is already being prepared. Please retry shortly.");
    this.name = "ColdBuildBusyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sharedInFlight: InFlightMap = new Map();

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function leadBuild<T>(options: ColdBuildCoordinator<T>) {
  try {
    const value = await options.build();
    try {
      await options.writeResult(value);
    } catch {
      // The leader still has a valid response. Cross-isolate followers may retry if persistence is unavailable.
    }
    return value;
  } finally {
    try {
      await options.releaseLease();
    } catch {
      // Lease expiry remains the final recovery path if release is unavailable.
    }
  }
}

export async function coordinateColdBuild<T>(options: ColdBuildCoordinator<T>): Promise<T> {
  const inFlight = options.inFlight ?? sharedInFlight;
  const existing = inFlight.get(options.key) as Promise<T> | undefined;
  if (existing) return existing;

  const coordinated = (async () => {
    const recent = await options.readResult();
    if (recent) return recent;

    if (await options.acquireLease()) return leadBuild(options);

    const sleep = options.sleep ?? defaultSleep;
    const pollIntervalMs = Math.max(20, options.pollIntervalMs ?? 250);
    const leaseRetryIntervalMs = Math.max(pollIntervalMs, options.leaseRetryIntervalMs ?? 1_000);
    let nextLeaseAttemptAt = Date.now() + leaseRetryIntervalMs;
    const deadline = Date.now() + Math.max(pollIntervalMs, options.timeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const completed = await options.readResult();
      if (completed) return completed;
      if (Date.now() >= nextLeaseAttemptAt) {
        if (await options.acquireLease()) return leadBuild(options);
        nextLeaseAttemptAt = Date.now() + leaseRetryIntervalMs;
      }
    }
    throw new ColdBuildBusyError();
  })();

  inFlight.set(options.key, coordinated);
  try {
    return await coordinated;
  } finally {
    if (inFlight.get(options.key) === coordinated) inFlight.delete(options.key);
  }
}

type MemoryWindow = { count: number; expiresAt: number };

export class MemoryFixedWindowCounter {
  private readonly windows = new Map<string, MemoryWindow>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowKey = `${key}:${windowStart}`;
    const existing = this.windows.get(windowKey);
    const nextCount = (existing?.count ?? 0) + 1;
    const expiresAt = windowStart + windowMs;
    this.windows.set(windowKey, { count: nextCount, expiresAt });

    if (this.windows.size > 512) {
      for (const [candidate, value] of this.windows) {
        if (value.expiresAt <= now) this.windows.delete(candidate);
      }
    }

    return {
      allowed: nextCount <= limit,
      remaining: Math.max(0, limit - nextCount),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)),
    };
  }
}

export function reservePacedSlot(currentNextAvailableAt: number, now: number, intervalMs: number) {
  const permitAt = Math.max(currentNextAvailableAt, now);
  return { permitAt, nextAvailableAt: permitAt + intervalMs };
}

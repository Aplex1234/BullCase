/** Storage is best-effort only after valid provider-backed peers have been built. */
export async function persistPeerResult<T>(writeCache: () => Promise<T>, writeAudit: () => Promise<unknown>) {
  const [cache, audit] = await Promise.allSettled([Promise.resolve().then(writeCache), Promise.resolve().then(writeAudit)]);
  if (cache.status === "rejected") console.error("[comps] cache write failed; serving valid live peers");
  if (audit.status === "rejected") console.error("[comps] audit write failed; serving valid live peers");
  return cache.status === "fulfilled" ? cache.value : null;
}

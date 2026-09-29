export async function recoverOptionalSource<T>(request: Promise<T>, unavailable: T, report: (error: unknown) => void): Promise<T> {
  try {
    return await request;
  } catch (error) {
    report(error);
    return unavailable;
  }
}

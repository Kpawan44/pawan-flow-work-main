/**
 * Exclusive persistence: REST only when Admin SDK is unavailable or throws.
 * Never invoke REST after a successful Admin write.
 */
export async function persistExclusive(
  tryAdmin: (() => Promise<void>) | null | undefined,
  tryRest: () => Promise<void>
): Promise<{ wroteViaAdmin: boolean; restCalled: boolean }> {
  if (tryAdmin) {
    try {
      await tryAdmin();
      return { wroteViaAdmin: true, restCalled: false };
    } catch {
      // Admin unavailable or write failed — REST fallback only.
    }
  }
  await tryRest();
  return { wroteViaAdmin: false, restCalled: true };
}

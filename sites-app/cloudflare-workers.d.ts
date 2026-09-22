declare module "cloudflare:workers" {
  export const env: unknown;
  export function waitUntil(promise: Promise<unknown>): void;
}

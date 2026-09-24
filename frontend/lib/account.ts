export type AccountIdentity = {
  displayName: string;
  email: string;
};

export type AccountProvider = "openrouter" | "groq";

export type AccountSnapshot = {
  user: AccountIdentity;
  preferredProvider: AccountProvider;
  providers: Record<AccountProvider, { configured: boolean; model: string }>;
  favorites: Array<{ ticker: string; created_at: string }>;
  limits: {
    capturedAt: string;
    buckets: Array<{
      kind: "general" | "search" | "manual-refresh" | "cold-build" | "ai-research" | "ai-research-shared";
      used: number;
      limit: number;
      remaining: number;
      resetsAt: string;
    }>;
  };
};

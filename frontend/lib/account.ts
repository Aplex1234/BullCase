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
};

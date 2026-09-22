# AI Research setup and current limits

## Connect a provider

Open **AI Research → API keys** to add a personal OpenRouter or Groq key and choose its model. OpenRouter can use the account's default model when the model field is empty. Groq requires a model ID. The dialog stores keys only in React memory for the currently open research view, never in browser storage or the database. Leaving Research, changing company, or reloading clears personal keys and chat. New chat clears messages but keeps the current connection.

Requests send the personal key over HTTPS to the same-origin research endpoint, which uses it only for the selected provider's fixed API endpoint. Keys are never embedded in URLs, model prompts, logs, or responses. Adding a key is not a live validity or credit check; the first question validates provider access. Errors never fall back to a shared key.

For a shared server-managed connection, use the environment settings below. Do not paste keys into chat, frontend source, or a `NEXT_PUBLIC_` variable.

For a local Cloudflare preview, add the following to the ignored `sites-app/.dev.vars` file (preserve any existing settings). Restart the preview after changing it. For the hosted site, set the same names as server environment variables/secrets in Sites.

```dotenv
AI_RESEARCH_ENABLED=true
AI_RESEARCH_PROVIDER=openrouter
OPENROUTER_API_KEY=your-private-key
OPENROUTER_MODEL=your-chosen-model-id
GROQ_API_KEY=your-private-key
GROQ_MODEL=your-chosen-model-id
```

Only set the key/model pair for shared providers you want to enable. Choose a chat-completion model that accepts system messages and sufficient evidence context. Setting `AI_RESEARCH_ENABLED=false` disables shared server credentials; users can still supply their own keys. Personal and shared requests retain the existing shared request caps.

“Configured” checks for settings, not whether the key is valid or has credit. Test an actual question to validate provider access. Set a spending limit in the provider account too. The app currently limits requests to 5 per client per minute and 100 total per UTC day, across both providers. These are request caps, not dollar caps. Failed attempts can consume a request slot. AI requests fail closed if shared database accounting is unavailable.

## Evidence and conversation context

- Up to six annual periods and eight quarterly periods from existing normalized SEC financials.
- Recent filing links and dates, plus up to eight extracted annual-filing risk themes. Links alone are not full filing text.
- Source freshness is sent with the evidence. Financial calculations and scoring are not changed by AI.
- Complete recent chat exchanges are included within a 16,000-character budget. Older exchanges are omitted as whole pairs, never silently cut mid-answer. The UI shows when this happens.
- No chat is stored by the app. Leaving the research tab, changing company, reloading, or choosing New chat clears it. Switching providers retains the conversation and sends recent exchanges to the selected provider; its retention policy still applies.
- Returned source IDs are checked against the supplied source list. This does not prove that a claim is supported by the source. Answers without citations are visibly labeled; factual claims must still be verified.

## Remaining live validation before release

Connect a provider and test a factual financial question, a follow-up referring to the preceding answer, a risk question with a citation, and a question not supported by the evidence. Confirm invalid-key and provider-quota errors. Check model compatibility and costs. Do not treat mocked tests as live model accuracy evaluation.

Full-document filing search, streaming responses, saved memory, and accounts are not implemented in this version.

Provider API references: [OpenRouter](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [Groq](https://console.groq.com/docs/api-reference).

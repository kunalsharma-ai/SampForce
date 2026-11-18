# ADR 0067: More AI providers, entered in the console, with a fallback order

**Status:** accepted (2026-11-18)

**Context.** Kunal asked for AI automation to work with API keys from providers other than Anthropic, including
free keys, and for those keys to live in the database rather than in the server's settings file (ADR 0059). Free
tiers (Google Gemini, Groq, Mistral, OpenRouter's `:free` models) have low per-minute and per-day limits, so one
free key alone would stall automations as soon as it is rate limited.

**Decision.**

- Six more providers sit next to Anthropic in the operator console under Providers > AI providers: OpenAI,
  Google Gemini, Groq, OpenRouter, Mistral, and "Self-hosted or other (OpenAI-compatible)" for Ollama, LM Studio,
  vLLM, LiteLLM or any hosted API with an OpenAI-compatible endpoint. Their keys, models and the self-hosted address
  are managed keys (ADR 0051): sealed in `platform_secrets`, read at call time, never taken from the environment in
  production. Nothing was added to the env templates. Only the providers' public endpoints (`*_API_BASE_URL`) are
  env settings, like `AI_API_BASE_URL`, so tests can point them at a local stand-in.
- One adapter, `OpenAiCompatibleProvider` (`apps/api/src/ai/openai-compatible.ts`), speaks chat completions for all
  six. It translates the Messages-API conversation the agents build (text, `tool_use`, `tool_result`; thinking blocks
  dropped) into chat messages and tool calls, and translates answers back, so Copilot's tool loop, the structured
  agents, redaction, metering and credits run unchanged. Per-provider profiles cover the differences: OpenAI wants
  `max_completion_tokens` and takes `reasoning_effort` on reasoning models; Mistral accepts only 9-character tool
  call ids (mapped by hash so a call still pairs with its result); structured answers use `json_schema` on OpenAI
  and Gemini, `json_object` on Groq and Mistral, and the prompt alone on OpenRouter and self-hosted servers. The
  schema is always written into the system prompt and the JSON is cut out of code fences or think blocks. A 400 on
  `response_format` is retried once without it.
- `AiProviderChain` (`apps/api/src/ai/ai-providers.ts`) is the gateway's provider. It tries the providers that have
  keys in the order the operator sets (`AI_PROVIDER_ORDER`, edited on the "AI providers and fallback order" card;
  a provider left out is switched off; unset means the order the console lists them in: Anthropic, OpenAI, Gemini,
  Groq, OpenRouter, Mistral, self-hosted). A provider that is rate limited (429), unavailable (5xx, timeout, network), refuses the
  key, credit or model (401/402/403/404) or refuses the request (other 4xx) is skipped for the rest of that call and
  rested: Retry-After when sent (at most 15 minutes), otherwise 60 s for rate limits, 30 s for outages and 5 minutes
  for refused keys. While resting it is tried after the ready providers; when all are resting, all are tried anyway.
  Anything that is not a provider failure (a bug) is thrown, never skipped. The Anthropic SDK now retries once
  instead of twice, so a busy Anthropic hands over quickly.
- `ai_usage.provider` records the provider that answered. Each provider's last success, last failure and rest time
  are kept in `platform_settings` (`ai_provider_health:<key>`) and shown on its console card. Workspaces see the
  first provider and its fallbacks on the AI Agents page.
- Every new provider has a no-cost connection test: `GET /models` (Gemini's `models/` prefix ignored), OpenRouter's
  `GET /key` (which also reports free-tier status), and for a self-hosted server a check that the model exists.

**Consequences.** Answer quality and tool calling depend on the model chosen: Copilot needs a model with tool
support, and small local models may answer less well than Claude. Server-side refusal fallbacks exist only on
Anthropic. Usage on other providers is metered with the same credit formula from their reported tokens. The
self-hosted address is trusted like any operator setting: it may be a private address (Ollama on the LAN), which
only an operator Admin can set. The adapter is tested against a local stand-in that imitates chat completions, not
against the real services; the defaults (`gpt-5-mini`, `gemini-2.5-flash`, `llama-3.3-70b-versatile`,
`meta-llama/llama-3.3-70b-instruct:free`, `mistral-small-latest`) are editable in case a provider retires one.
Rest times are per process (the API and the worker each keep their own).

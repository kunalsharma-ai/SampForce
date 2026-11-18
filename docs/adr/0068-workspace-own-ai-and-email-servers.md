# ADR 0068: A workspace's own AI keys, AI server and email server

**Status:** accepted (2026-11-18)

**Context.** After ADR 0067 Kunal asked for "flexibility for users": each workspace should be able to run AI on its
own keys or its own server (for example Ollama) and send email through its own mail server, not only through the
providers the deployment shares. He chose "each workspace, plus you": the operator's shared providers stay, and a
workspace admin can add its own, which are used first.

**Decision.**

- Settings > Integrations has a "Your own servers" section for admins (`integrations:manage`). It holds two
  workspace connections, stored as `AppConnection` rows with the new providers `AI` and `SMTP`: secrets (API keys,
  the SMTP password) sealed with `SecretBox` in `credentialsEncrypted`, everything else, plus each provider's last
  success and failure, in `settings`. Keys and passwords are never returned; the page shows the last four characters.
  Routes: `GET/PUT/DELETE /own-servers/ai`, `POST /own-servers/ai/:kind/test`, `GET/PUT/DELETE /own-servers/email`,
  `POST /own-servers/email/test`.
- AI: the admin lists providers in order (Anthropic, OpenAI, Gemini, Groq, OpenRouter, Mistral, or an own
  OpenAI-compatible server with an address and model) and chooses whether SampForce's shared providers follow.
  `AiProviderChain.generateWith` tries the workspace's providers first, resting a failing one per workspace exactly
  like shared ones, then the shared plan. The known providers keep their fixed public endpoints, so a workspace can
  only choose an address for its own server. Answers from a workspace's own provider are metered as `own:<kind>` and
  cost no AI credits; when the month's credits are used up, the workspace's own providers still answer and the shared
  ones are skipped. AI Agents shows the workspace's provider first with the shared ones as fallbacks.
- Email: email a workspace sends (client portal invitations and replies, portal password resets) goes through the
  workspace's server from its own address; if that fails it goes through the shared SMTP service when there is one,
  and the failure is shown on the card. Account email (SampForce password resets) stays on the shared service. The
  server is checked (connect and sign in, nothing sent) before it is saved, and "Send me a test email" sends one
  message to the admin. TLS or STARTTLS is required; no encryption only for an approved private server.
- Safety: a workspace admin must not be able to make SampForce call into the server's own network. Addresses a
  workspace enters are resolved, and private, loopback, link-local and metadata addresses are refused unless the
  operator lists them in `TRUSTED_PRIVATE_HOSTS` (console > Providers > Workspace servers: host names, addresses or
  ranges such as `10.0.0.0/8` or `2406:b400::/32`). Connections go to the checked address (no second DNS lookup),
  redirects are refused, and plain `http` is allowed only to an approved private server, so a key never crosses the
  internet unencrypted. Code: `apps/api/src/common/trusted-targets.ts`.

**Consequences.** Workspaces can use free keys or their own GPU server without spending plan credits, and send
portal email from their own domain. The operator decides which private networks workspaces may reach. Not tested
against real provider APIs or a real mail provider; the tests use local stand-ins (`own-servers.e2e.test.ts`,
`e2e/own-servers.spec.ts`, `trusted-targets.test.ts`).

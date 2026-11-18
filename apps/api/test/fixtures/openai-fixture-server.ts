import { createOpenAiFixture } from './openai-fixture';

/** Standalone OpenAI-compatible stand-in for the Playwright suite (Groq, Gemini, OpenAI, Mistral, OpenRouter, Ollama). */
const port = Number(process.env.OPENAI_FIXTURE_PORT ?? 4110);
createOpenAiFixture(port).then((f) => process.stdout.write(`OpenAI-compatible fixture listening on ${f.url}\n`));

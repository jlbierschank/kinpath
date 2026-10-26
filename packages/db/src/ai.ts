/**
 * The AI drafting service: one vendor behind one function, used only for non-urgent messages,
 * only with the clinic's approved protocol sections, and always checked by @kinpath/core before
 * a nurse sees it.
 *
 * Off unless configured: KINPATH_AI_PROVIDER=anthropic and ANTHROPIC_API_KEY (an API org with a
 * signed BAA; see docs/AI.md). Without it, drafts come straight from the protocol text, as before.
 */
import type { DraftProvider } from "@kinpath/core";

/** A reason safe to show the nurse (never contains message text). */
export class AIServiceError extends Error { name = "AIServiceError"; }

export class AnthropicProvider implements DraftProvider {
  name: string;
  constructor(private apiKey: string, private model: string, private timeoutMs = 20_000) { this.name = `anthropic:${model}`; }
  async complete(req: { system: string; user: string }): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, max_tokens: 600, temperature: 0.2, system: req.system, messages: [{ role: "user", content: req.user }] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        const msg = body?.error?.message ?? "";
        throw new AIServiceError(
          res.status === 401 || res.status === 403 ? "the AI key was rejected"
          : /credit/i.test(msg) ? "the AI account is out of credits"
          : res.status === 404 ? `the AI model "${this.model}" wasn't found`
          : res.status === 429 || res.status === 529 ? "the AI service is busy"
          : `the AI service returned an error (${res.status})`);
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    } finally {
      clearTimeout(t);
    }
  }
}

/** Whether AI drafting is on, for the nurse screens. */
export function aiDraftingStatus(): { on: boolean; model: string | null } {
  const p = aiProviderFromEnv();
  return { on: !!p, model: p ? p.name.replace(/^anthropic:/, "") : null };
}

/** The configured provider, or null (protocol-only drafting). */
export function aiProviderFromEnv(): DraftProvider | null {
  if (process.env.KINPATH_AI_PROVIDER !== "anthropic" || !process.env.ANTHROPIC_API_KEY) return null;
  return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.KINPATH_AI_MODEL ?? "claude-sonnet-5-5");
}

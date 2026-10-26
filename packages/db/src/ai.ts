/**
 * The AI drafting service: one vendor behind one function, used only for non-urgent messages,
 * only with the clinic's approved protocol sections, and always checked by @kinpath/core before
 * a nurse sees it.
 *
 * Off unless configured: KINPATH_AI_PROVIDER=anthropic and ANTHROPIC_API_KEY (an API org with a
 * signed BAA; see docs/AI.md). Without it, drafts come straight from the protocol text, as before.
 */
import type { DraftProvider } from "@kinpath/core";

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
      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    } finally {
      clearTimeout(t);
    }
  }
}

/** The configured provider, or null (protocol-only drafting). */
export function aiProviderFromEnv(): DraftProvider | null {
  if (process.env.KINPATH_AI_PROVIDER !== "anthropic" || !process.env.ANTHROPIC_API_KEY) return null;
  return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.KINPATH_AI_MODEL ?? "claude-sonnet-5-5");
}

/**
 * Brand voice check (docs/VOICE.md, VOICE-APP.md, VOICE-AI.md): app copy avoids the words the voice
 * avoids, and every AI prompt that writes to people carries the voice rules.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AVOID, buildDraftPrompt, voicePrompt } from "../src";

const ROOT = path.resolve(__dirname, "../../..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  if (f === "node_modules" || f.startsWith(".")) return [];
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
});
// Words a person might choose for themselves (her own word for her partner) live in data, not copy.
const ALLOWED = [/PARTNER_TITLES/, /JourneyPath/, /componentName/];

describe("app copy follows the brand voice", () => {
  const sources = [...files(path.join(ROOT, "apps/patient/src")), path.join(ROOT, "apps/patient/App.tsx"), ...files(path.join(ROOT, "apps/clinic/app"))];
  it("avoids the words the voice avoids", () => {
    const hits: string[] = [];
    for (const f of sources) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (ALLOWED.some((a) => a.test(line))) return;
        for (const { pattern, instead } of AVOID) if (pattern.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1} "${line.trim().slice(0, 80)}" → use ${instead}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("never uses generic buttons (Submit, Learn more, OK, Click here, Continue)", () => {
    const hits: string[] = [];
    for (const f of sources) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/label=\{?[^}]*"(Submit|Learn more|OK|Click here|Continue)"|>\s*(Submit|Learn more|OK|Click here|Continue)\s*</.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("AI prompts carry the voice", () => {
  it("the nurse draft prompt includes the voice rules", () => {
    const { system } = buildDraftPrompt({ message: "Can I shower after retrieval?", sections: [], lang: "en" });
    expect(system).toMatch(/No exclamation points, no emoji, no em dashes/);
  });
  it("the patient AI voice prompt fills what the app knows and never leaves a placeholder", () => {
    const own = voicePrompt({ mode: "own", moment: "worry", patient_name: "Lex", pronouns: "they/them" });
    expect(own).toContain("mode=own, moment=worry");
    expect(own).toContain("The patient's name: Lex.");
    expect(own).not.toMatch(/\{(clinic_name|nurse_name|nurse_line|reply_by)\}/);
    expect(own).toContain("Urgent symptoms skip the AI");
    const clinic = voicePrompt({ mode: "clinic", clinic_name: "Bayside Fertility", nurse_name: "Maria", nurse_line: "(813) 555-0100" });
    expect(clinic).toContain("Call (813) 555-0100");
    expect(clinic).toContain("Maria has your message");
  });
});

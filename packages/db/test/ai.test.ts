import { beforeEach, describe, expect, it } from "vitest";
import type { DraftProvider } from "@kinpath/core";
import { AIServiceError, asActor, draftReply, IDS, migrate, openDb, reportMissedDose, seed, sendPatientMessage, type Actor, type Db } from "../src";

const maria: Actor = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" };
const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };

/** A stand-in AI that records what it was sent and answers with a fixed reply. */
function mock(reply: string | Error) {
  const calls: { system: string; user: string }[] = [];
  const p: DraftProvider = { name: "mock", async complete(req) { calls.push(req); if (reply instanceof Error) throw reply; return reply; } };
  return { p, calls };
}

let db: Db;
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db); });

const ask = (text: string) => sendPatientMessage(db, maya, { patientId: IDS.maya, text });
const saved = (id: string) => asActor(db, maria, async (tx) => (await tx.query<{ draft: string; draft_engine: string; draft_problems: string[] | null; draft_source: string }>(`SELECT draft, draft_engine, draft_problems, draft_source FROM handoffs WHERE id = $1`, [id])).rows[0]!);

describe("AI drafting gate", () => {
  it("saves a draft that only uses the protocol it was given", async () => {
    const { handoffId } = await ask("Is cramping normal during the wait?");
    const ai = mock("Mild cramping can be normal during the wait. Call the nurse line right away if you have heavy bleeding, severe pain, fever, or trouble breathing.\nSOURCES: wait.cramping");
    const d = await draftReply(db, maria, handoffId, { provider: ai.p });
    expect(d.engine).toBe("ai");
    expect(d.draft).toMatch(/^Hi Maya,\n\nMild cramping/);
    expect(d.source).toBe("wait.cramping");
    expect((await saved(handoffId)).draft_engine).toBe("ai");
  });

  it("never sends the patient's name, email or phone to the AI", async () => {
    const { handoffId } = await ask("Is cramping normal? Reach me at maya@example.com or 813-555-0142");
    const ai = mock("NO_ANSWER");
    await draftReply(db, maria, handoffId, { provider: ai.p });
    const sent = JSON.stringify(ai.calls);
    expect(sent).not.toMatch(/Maya|Chen|maya@example|555-0142/);
    expect(sent).toContain("[email]");
  });

  it("holds back a draft with an invented dose and shows the protocol instead", async () => {
    const r = await reportMissedDose(db, maya, { patientId: IDS.maya, doseLogId: await missedDose() });
    const ai = mock("Take 300 units of Gonal-f now if it's been less than 4 hours.\nSOURCES: meds.missed_dose.gonal_f");
    const d = await draftReply(db, maria, r.handoffId, { provider: ai.p });
    expect(d.engine).toBe("ai_held_back");
    expect(d.problems.join(" ")).toMatch(/300/);
    expect(d.draft).toContain("less than 4 hours since your scheduled time"); // the approved text
    expect((await saved(r.handoffId)).draft_problems).toEqual(d.problems);
  });

  it("holds back a draft that tells her not to call", async () => {
    const { handoffId } = await ask("Is cramping normal?");
    const d = await draftReply(db, maria, handoffId, { provider: mock("Mild cramping can be normal, so there's no need to call us about it.\nSOURCES: wait.cramping").p });
    expect(d.engine).toBe("ai_held_back");
  });

  it("falls back when the AI has no answer or doesn't respond", async () => {
    const a = await ask("Is cramping normal?");
    expect((await draftReply(db, maria, a.handoffId, { provider: mock("NO_ANSWER").p })).engine).toBe("ai_held_back");
    const b = await ask("Is cramping normal?");
    const d = await draftReply(db, maria, b.handoffId, { provider: mock(new Error("timeout")).p });
    expect(d.engine).toBe("ai_error");
    expect(d.draft).toMatch(/^Hi Maya,\n\nMild cramping can be normal/); // the closest approved section
    expect(d.source).toBe("wait.cramping");
  });

  it("tells the nurse plainly when the AI key is rejected", async () => {
    const { handoffId } = await ask("Is cramping normal?");
    const d = await draftReply(db, maria, handoffId, { provider: mock(new AIServiceError("the AI key was rejected")).p });
    expect(d.engine).toBe("ai_error");
    expect(d.problems).toEqual(["the AI key was rejected"]);
  });

  it("never calls the AI for an urgent message", async () => {
    const r = await reportMissedDose(db, maya, { patientId: IDS.maya, doseLogId: await missedDose(), note: "I'm short of breath" });
    const ai = mock("anything");
    await expect(draftReply(db, maria, r.handoffId, { provider: ai.p })).rejects.toThrow(/never drafted/);
    expect(ai.calls).toHaveLength(0);
  });

  it("doesn't call the AI when no protocol section matches", async () => {
    const { handoffId } = await ask("xyzzy");
    const ai = mock("anything");
    const d = await draftReply(db, maria, handoffId, { provider: ai.p });
    expect(ai.calls).toHaveLength(0);
    expect(d.engine).toBe("protocol");
  });

  it("keeps draft text out of the audit log", async () => {
    const { handoffId } = await ask("Is cramping normal?");
    await draftReply(db, maria, handoffId, { provider: mock("Mild cramping can be normal during the wait.\nSOURCES: wait.cramping").p });
    const a = await db.query<{ detail: unknown }>(`SELECT detail FROM audit_events WHERE action = 'staff.drafted_reply'`);
    expect(JSON.stringify(a.rows)).not.toMatch(/Mild cramping/);
    expect(JSON.stringify(a.rows)).toContain('"engine":"ai"');
  });
});

async function missedDose(): Promise<string> {
  const r = await asActor(db, maya, (tx) => tx.query<{ id: string }>(`SELECT id FROM dose_logs WHERE taken_at IS NULL AND scheduled_for < now() ORDER BY scheduled_for LIMIT 1`));
  return r.rows[0]!.id;
}

describe("Anthropic connection", () => {
  it("sends the Messages API request Anthropic expects and reads the reply", async () => {
    const { AnthropicProvider } = await import("../src");
    const seen: { url: string; init: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Hello.\nSOURCES: x" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await new AnthropicProvider("sk-test", "claude-sonnet-5-5").complete({ system: "S", user: "U" });
      expect(out).toBe("Hello.\nSOURCES: x");
      expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
      const h = seen[0]!.init.headers as Record<string, string>;
      expect(h["x-api-key"]).toBe("sk-test");
      expect(h["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(String(seen[0]!.init.body));
      expect(body).toMatchObject({ model: "claude-sonnet-5-5", system: "S", messages: [{ role: "user", content: "U" }] });
      expect(body).not.toHaveProperty("temperature"); // newer models reject it
    } finally { globalThis.fetch = real; }
  });

  it("turns a rejected key into a plain reason", async () => {
    const { AnthropicProvider } = await import("../src");
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })) as typeof fetch;
    try {
      await expect(new AnthropicProvider("bad", "m").complete({ system: "", user: "" })).rejects.toThrow("the AI key was rejected");
    } finally { globalThis.fetch = real; }
  });
});

import { describe, expect, it } from "vitest";
import { channelsFor, checkChannelChange, DEFAULT_DELIVERY, inQuiet, kindsFor, KINDS, outsideText, planDelivery, type DeliveryPrefs } from "../src";

const at = (h: number, m = 0) => new Date(2026, 9, 26, h, m);
const quiet: DeliveryPrefs = { ...DEFAULT_DELIVERY, quiet: { on: true, start: "21:00", end: "07:00" } };

describe("notification rules", () => {
  it("urgent safety alerts can't be switched off, only routed", () => {
    expect(checkChannelChange("urgent_message", { push: false, sms: false, email: false })).toMatch(/at least one way/);
    expect(checkChannelChange("urgent_message", { in_app: false })).toMatch(/always show/);
    expect(checkChannelChange("urgent_message", { push: false, sms: false, email: true })).toBeNull();
    const c = channelsFor("urgent_message", { ...DEFAULT_DELIVERY, channels: { urgent_message: { push: false, sms: false, email: false, in_app: false } } });
    expect(c.in_app).toBe(true);
    expect(c.sms).toBe(true);
  });

  it("other alerts follow the person's choices", () => {
    expect(checkChannelChange("thank_you", { in_app: false, push: false })).toBeNull();
    const p: DeliveryPrefs = { ...DEFAULT_DELIVERY, channels: { new_message: { push: false, email: true } } };
    expect(planDelivery("new_message", p, at(10)).outside.map((o) => o.channel)).toEqual(["email"]);
  });

  it("holds non-urgent alerts during quiet hours, but never urgent ones", () => {
    const night = planDelivery("new_message", quiet, at(23));
    expect(night.outside).toEqual([expect.objectContaining({ channel: "push", status: "held" })]);
    expect(night.outside[0]!.sendAfter.getHours()).toBe(7);
    const urgent = planDelivery("urgent_message", quiet, at(23));
    expect(urgent.outside.every((o) => o.status === "send")).toBe(true);
    expect(inQuiet(at(6, 59), quiet.quiet)).toBe(true);
    expect(inQuiet(at(7), quiet.quiet)).toBe(false);
  });

  it("bundles staff text and email into a summary when asked; push stays live", () => {
    const p: DeliveryPrefs = { ...DEFAULT_DELIVERY, digest: "evening", channels: { new_message: { email: true } } };
    const r = planDelivery("new_message", p, at(10));
    expect(r.outside).toEqual([
      expect.objectContaining({ channel: "push", status: "send" }),
      expect.objectContaining({ channel: "email", status: "digest" }),
    ]);
    expect(r.outside[1]!.sendAfter.getHours()).toBe(17);
  });

  it("never puts health details in a push, text or email", () => {
    for (const k of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
      for (const lang of ["en", "es"] as const) {
        const t = outsideText(k, "Bayside Fertility", lang);
        expect(`${t.subject} ${t.body}`).not.toMatch(/result|positive|negative|pregnan|embryo|hcg|estradiol|gonal|menopur|ivf|fertility medication|symptom|bleeding|maya|positiv|negativ|embarazo/i);
      }
    }
  });

  it("each audience has its own list", () => {
    expect(kindsFor("staff")).toContain("urgent_message");
    expect(kindsFor("patient")).not.toContain("urgent_message");
    expect(kindsFor("partner")).toEqual(["news_shared", "access_changed"]);
  });
});

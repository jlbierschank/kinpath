/**
 * On the Costs tab: insurance denial letters she kept, and the year-end packet of what she paid.
 * Pumpkin keeps the letter's own words and dates. It doesn't file appeals, work out deadlines, or say
 * what counts for taxes or an HSA/FSA.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Share, View } from "react-native";
import type { Api, Denial, PacketFile, TaxPacket } from "./api";
import { Button, C, Card, Chip, Chips, F, Icon, Muted, Pill, T } from "./ui";
import { niceDate } from "./datefield";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

function deadline(d: Denial): string {
  if (!d.appealBy) return "The letter didn't print an appeal date. Ask your insurer for it in writing.";
  if (d.daysLeft === null) return `Appeal by ${niceDate(d.appealBy)}`;
  if (d.daysLeft < 0) return `The letter's appeal date was ${niceDate(d.appealBy)}. Ask your insurer if you still have options.`;
  if (d.daysLeft === 0) return "Appeal by today, per the letter";
  return `Appeal by ${niceDate(d.appealBy)}, ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left`;
}

export function DenialsCard({ api, denials, reload, openOriginal }: { api: Api; denials: Denial[]; reload: () => void; openOriginal: (captureId: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  if (!denials.length) return null;
  const set = async (id: string, status: Denial["status"]) => { setErr(null); try { await api.setDenialStatus(id, status); reload(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Card testID="denials-card" style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="shield" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>INSURANCE SAID NO</T></View>
      {denials.map((d, i) => (
        <View key={d.id} testID={`denial-${i}`} style={{ gap: 4, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <T style={{ fontFamily: F.sans600, fontSize: 15.5, flex: 1 }}>{d.service ?? "A claim"}{d.amountCents !== null ? `, ${money(d.amountCents)}` : ""}</T>
            {d.status !== "open" ? <Pill label={d.status === "appealed" ? "Appealed" : "Resolved"} tone={d.status === "appealed" ? "lav" : "sage"} /> : null}
          </View>
          <Muted style={{ fontSize: 14 }}>{[d.payer, d.claimNumber ? `Claim ${d.claimNumber}` : null, d.deniedOn ? `Letter of ${niceDate(d.deniedOn)}` : null].filter(Boolean).join(" · ")}</Muted>
          {d.reason ? <T style={{ fontSize: 15 }}>{`Reason they gave: ${d.reason}`}</T> : null}
          {d.status === "open" ? <T testID={`denial-deadline-${i}`} style={{ fontSize: 14.5, fontFamily: F.sans600, color: d.daysLeft !== null && d.daysLeft <= 14 ? C.clayInk : C.ink }}>{deadline(d)}</T> : null}
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap", marginTop: 2 }}>
            {d.captureId ? <Pressable onPress={() => openOriginal(d.captureId!)} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ color: C.lavInk, fontSize: 14, fontFamily: F.sans600 }}>See letter</T></Pressable> : null}
            {d.status === "open" ? <Pressable testID={`denial-appealed-${i}`} onPress={() => void set(d.id, "appealed")} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ color: C.lavInk, fontSize: 14, fontFamily: F.sans600 }}>I appealed</T></Pressable> : null}
            {d.status !== "resolved" ? <Pressable testID={`denial-resolved-${i}`} onPress={() => void set(d.id, "resolved")} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ color: C.lavInk, fontSize: 14, fontFamily: F.sans600 }}>It's resolved</T></Pressable> : null}
            {d.status !== "open" ? <Pressable onPress={() => void set(d.id, "open")} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ color: C.lavInk, fontSize: 14, fontFamily: F.sans600 }}>Reopen</T></Pressable> : null}
          </View>
        </View>
      ))}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <Muted style={{ fontSize: 13 }}>Pumpkin doesn't file appeals. Your insurer must explain how to appeal, and your clinic's billing team can often help. Pumpkin keeps the letter's dates; it doesn't work them out.</Muted>
    </Card>
  );
}

function save(f: PacketFile) {
  if (Platform.OS === "web") {
    const g = globalThis as unknown as { document: { createElement: (t: string) => { href: string; download: string; click: () => void } }; URL: { createObjectURL: (b: Blob) => string }; atob: (s: string) => string };
    const body = f.base64 ? Uint8Array.from(g.atob(f.base64), (ch) => ch.charCodeAt(0)) : (f.text ?? "");
    const a = g.document.createElement("a"); a.href = g.URL.createObjectURL(new Blob([body], { type: f.mime })); a.download = f.filename; a.click();
    return Promise.resolve(true);
  }
  if (f.text) return Share.share({ title: f.filename, message: f.text }).then(() => true);
  return Promise.resolve(false);
}

/** What she paid toward care in a year, grouped, as a PDF with her receipts or a spreadsheet file. */
export function TaxPacketCard({ api, clinic = false }: { api: Api; clinic?: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [p, setP] = useState<TaxPacket | null>(null);
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { api.taxPacket(year, clinic).then(setP).catch(() => setP(null)); }, [api, year, clinic]);
  useEffect(load, [load]);
  if (!p) return null;
  const years = [...new Set([new Date().getFullYear(), ...p.years])].sort((a, b) => b - a).slice(0, 4);
  const get = async (format: "pdf" | "csv") => {
    setBusy(format); setMsg(null);
    try {
      const ok = await save(await api.taxPacketFile(year, format, clinic));
      setMsg(ok ? (Platform.OS === "web" ? "Downloaded." : "Ready to send.") : "The PDF downloads from Pumpkin in a browser. Sign in on a computer to get it.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Card testID="tax-packet" style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="doc" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>FOR TAXES AND HSA/FSA</T></View>
      {years.length > 1 ? <Chips>{years.map((y) => <Chip key={y} testID={`tax-year-${y}`} label={String(y)} selected={y === year} onPress={() => setYear(y)} />)}</Chips> : null}
      {p.groups.length ? (
        <>
          <T testID="tax-total" style={{ fontFamily: F.sans600, fontSize: 16 }}>{`Paid in ${p.year}: ${money(p.totalCents)}`}</T>
          {p.groups.map((g) => (
            <View key={g.category} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T style={{ fontSize: 14.5 }}>{`${g.label} (${g.payments.length})`}</T><T style={{ fontSize: 14.5, fontFamily: F.sans600 }}>{money(g.totalCents)}</T>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button testID="tax-pdf" kind="esp" label={busy === "pdf" ? "Making it" : "PDF with receipts"} disabled={!!busy} onPress={() => void get("pdf")} /></View>
            <View style={{ flex: 1 }}><Button testID="tax-csv" kind="line" label={busy === "csv" ? "Making it" : "Spreadsheet file"} disabled={!!busy} onPress={() => void get("csv")} /></View>
          </View>
        </>
      ) : <Muted style={{ fontSize: 14.5 }}>{`No payments recorded for ${p.year} yet. Add receipts as you pay, and this fills in.`}</Muted>}
      {msg ? <T testID="tax-msg" style={{ color: C.sageInk, fontFamily: F.sans600, fontSize: 14 }}>{msg}</T> : null}
      <Muted style={{ fontSize: 13 }}>Grouped by Pumpkin's best guess from each description. Your tax preparer or HSA/FSA administrator decides what qualifies.</Muted>
    </Card>
  );
}

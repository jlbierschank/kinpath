/**
 * Send her record (connecting layer, tier 1): she picks the sections every time, and the receiver
 * gets a page, a PDF and a data file (FHIR) by a link that expires. No account needed on their end.
 * Embryo details stay out unless she adds them. Nothing is sent to an employer or insurer by Pumpkin.
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Api, PersonalShare, ShareSection } from "./api";
import { Button, C, CheckList, Chip, Chips, F, Muted, st, T, Toggle } from "./ui";
import { Field } from "./field";
import { niceDate } from "./datefield";

const SECTIONS: [ShareSection, string][] = [
  ["meds", "Medications"],
  ["results", "Test results"],
  ["visits", "Visits"],
  ["pregnancy", "Pregnancy and due date"],
  ["coverage", "Insurance coverage"],
  ["costs", "Costs and payments"],
];

export function SendRecordCard({ api, recipient: fixedRecipient, defaults, intro, testID = "send" }: { api: Api; recipient?: string; defaults: ShareSection[]; intro?: string; testID?: string }) {
  const [name, setName] = useState("");
  const recipient = (fixedRecipient ?? name).trim();
  const [picked, setPicked] = useState<ShareSection[]>(defaults.filter((d) => d !== "embryo"));
  const [embryo, setEmbryo] = useState(false);
  const [days, setDays] = useState<7 | 30>(30);
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shares, setShares] = useState<PersonalShare[]>([]);
  const load = useCallback(() => { api.personalShares().then(setShares).catch(() => {}); }, [api]);
  useEffect(load, [load]);
  const toggle = (id: string) => { setMade(null); setPicked((p) => (p.includes(id as ShareSection) ? p.filter((x) => x !== id) : [...p, id as ShareSection])); };
  const make = async () => {
    setErr(null); setBusy(true);
    try { setMade(await api.sharePersonalSummary({ recipient: recipient || "Someone I chose", sections: embryo ? [...picked, "embryo"] : picked, days })); setCopied(false); load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const message = made ? `Here is my record from Pumpkin: ${made.url} . It opens without an account, and has a PDF and a data file. The link works until ${niceDate(made.expiresAt.slice(0, 10))}.` : "";
  const active = shares.filter((s) => s.active);
  return (
    <View testID={testID} style={{ gap: 12 }}>
      {intro ? <Muted style={{ fontSize: 14.5 }}>{intro}</Muted> : null}
      {fixedRecipient === undefined ? <Field testID={`${testID}-to`} label="Who is it for?" value={name} onChange={(v) => { setName(v); setMade(null); }} placeholder="Like Dr. Lee, or my new clinic" /> : null}
      <T style={{ fontFamily: F.sans600, fontSize: 15 }}>What to include</T>
      <CheckList testIDPrefix={`${testID}-sec-`} options={SECTIONS} selected={picked} onToggle={toggle} />
      <View style={[st.card, { padding: 14, gap: 4, flexDirection: "row", alignItems: "center" }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Embryo details</T>
          <Muted style={{ fontSize: 13.5 }}>How you conceived, like the transfer day. Off unless you add it.</Muted>
        </View>
        <Toggle testID={`${testID}-embryo`} value={embryo} onChange={(v) => { setEmbryo(v); setMade(null); if (v && !picked.includes("pregnancy")) setPicked((p) => [...p, "pregnancy"]); }} />
      </View>
      <View style={{ gap: 6 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>The link works for</T>
        <Chips>
          <Chip testID={`${testID}-days-30`} label="30 days" selected={days === 30} onPress={() => { setDays(30); setMade(null); }} />
          <Chip testID={`${testID}-days-7`} label="7 days" selected={days === 7} onPress={() => { setDays(7); setMade(null); }} />
        </Chips>
      </View>
      <View testID={`${testID}-warning`} style={{ backgroundColor: C.softLav, borderRadius: 14, padding: 12, gap: 4 }}>
        <T style={{ fontSize: 14, color: C.lavDeep }}>Doctors and clinics have to keep your health information private. Others, like a donor bank or a benefits company, may not. Send only what they need. Don't send it to an employer or insurer to decide on coverage.</T>
      </View>
      {made ? (
        <View style={{ gap: 8 }}>
          <Text testID={`${testID}-url`} selectable numberOfLines={2} style={{ fontFamily: F.sans500, fontSize: 14, color: C.lavInk }}>{made.url}</Text>
          <Muted style={{ fontSize: 13 }}>{`They'll see a page with a PDF and a data file (FHIR) to download. Works until ${niceDate(made.expiresAt.slice(0, 10))}. You'll see when it's opened.`}</Muted>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button kind="line" label={copied ? "Copied" : "Copy link"} onPress={async () => { await Clipboard.setStringAsync(made.url); setCopied(true); }} />
            <Button kind="line" label={Platform.OS === "web" ? "Email it" : "Send it"} onPress={() => { if (Platform.OS === "web") void Linking.openURL(`mailto:?subject=${encodeURIComponent("My record")}&body=${encodeURIComponent(message)}`).catch(() => {}); else void Share.share({ message }); }} />
          </View>
        </View>
      ) : <Button testID={`${testID}-make`} kind="esp" label={busy ? "Making the link…" : "Create a secure link"} disabled={busy || !picked.length} onPress={() => void make()} />}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      {active.length ? (
        <View style={[st.card, { paddingHorizontal: 14 }]}>
          {active.map((s, i) => (
            <View key={s.id} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
              <View style={{ flex: 1 }}><T style={{ fontSize: 14.5 }}>{`Shared with ${s.recipient}`}</T><Muted style={{ fontSize: 13 }}>{`Until ${niceDate(s.expiresAt.slice(0, 10))}${s.views ? ` · opened ${s.views} time${s.views > 1 ? "s" : ""}` : ""}`}</Muted></View>
              <Pressable testID={`${testID}-stop-${i}`} onPress={() => void api.stopPersonalShare(s.id).then(load)} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ fontFamily: F.sans600, color: C.clayInk }}>Stop sharing</T></Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

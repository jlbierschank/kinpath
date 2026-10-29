/**
 * Put her visits on someone else's calendar: a partner, a parent, the friend who drives her.
 * Each person gets their own subscription link, which she can stop on its own. Titles say only
 * "Appointment" unless she chooses to show what each visit is for.
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Api } from "./api";
import { Button, C, Card, F, Icon, Muted, st, T, Toggle } from "./ui";
import { Field } from "./field";

export function CalendarShareCard({ api, testID = "calshare" }: { api: Api; testID?: string }) {
  const [shares, setShares] = useState<{ id: string; label: string; detail: boolean }[]>([]);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState(false);
  const [made, setMade] = useState<{ label: string; url: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.calendarShares().then(setShares).catch(() => {}); }, [api]);
  useEffect(load, [load]);
  const make = async () => {
    setErr(null);
    try { const r = await api.shareCalendar(label, detail); setMade({ label: label.trim(), ...r }); setCopied(false); setLabel(""); setDetail(false); load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const message = made ? `Here's a link that adds my appointments to your calendar and keeps them up to date: ${made.webcal}\n(If that doesn't open, subscribe to this address in your calendar app: ${made.url})` : "";
  return (
    <Card testID={testID} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="people" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Put your visits on someone else's calendar</T></View>
      <Muted style={{ fontSize: 14 }}>For a partner, a parent, or whoever drives you. They get new visits on their own. You can stop it anytime.</Muted>
      {made ? (
        <View style={{ gap: 8, backgroundColor: C.softLav, borderRadius: 14, padding: 12 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{`Send this link to ${made.label}`}</T>
          <Text testID={`${testID}-url`} selectable numberOfLines={2} style={{ fontFamily: F.sans500, fontSize: 13.5, color: C.lavInk }}>{made.url}</Text>
          {copied ? <T style={{ fontSize: 13, fontFamily: F.sans600, color: C.sageInk }}>Copied.</T> : null}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button kind="line" label={copied ? "Copied" : "Copy link"} onPress={async () => { await Clipboard.setStringAsync(made.url); setCopied(true); }} />
            <Button testID={`${testID}-send`} kind="line" label={Platform.OS === "web" ? "Text or email it" : "Send it"} onPress={() => {
              const nav = (globalThis as unknown as { navigator?: { share?: (d: { text: string }) => Promise<void> } }).navigator;
              if (Platform.OS !== "web") void Share.share({ message });
              else if (nav?.share) void nav.share({ text: message }).catch(() => {});
              else void Linking.openURL(`mailto:?subject=${encodeURIComponent("My appointments")}&body=${encodeURIComponent(message)}`).catch(() => {});
            }} />
          </View>
          <Button kind="plain" label="Share with someone else" onPress={() => setMade(null)} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Field testID={`${testID}-label`} label="Who's it for?" value={label} onChange={setLabel} placeholder="Jordan" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <T style={{ flex: 1, fontSize: 15 }}>Show what each visit is for</T>
            <Toggle testID={`${testID}-detail`} value={detail} onChange={setDetail} />
          </View>
          <Muted style={{ fontSize: 13 }}>{detail ? "They'll see titles like \"Monitoring visit\"." : "They'll see \"Appointment\" and the time, nothing else."}</Muted>
          <Button testID={`${testID}-make`} kind="esp" label="Make their link" disabled={!label.trim()} onPress={() => void make()} />
        </View>
      )}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      {shares.map((s, i) => (
        <View key={s.id} style={[st.row, { borderTopWidth: 1 }]}>
          <View style={{ flex: 1 }}><T style={{ fontSize: 14.5 }}>{s.label}</T><Muted style={{ fontSize: 13 }}>{s.detail ? "Sees what each visit is for" : "Sees \"Appointment\" only"}</Muted></View>
          <Pressable testID={`${testID}-stop-${i}`} onPress={async () => { await api.stopCalendarShare(s.id); load(); }} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ fontFamily: F.sans600, color: C.clayInk }}>Stop</T></Pressable>
        </View>
      ))}
    </Card>
  );
}

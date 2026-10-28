/**
 * Pumpkin on your own: the people she shares with, and feedback for testers.
 * The server checks every choice; a support person only ever sees what she switches on.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Api, Invite, Relationship, Shareable, SupportPerson } from "./api";
import { APP_VERSION } from "./appinfo";
import { Button, C, Card, Chip, Chips, F, Muted, st, T, Today, Toggle } from "./ui";
import { Field } from "./field";

const OPTIONS: [Shareable, string, string][] = [
  ["schedule", "Where you are", "Your stage and upcoming visits"],
  ["meds", "Meds and doses", "So they can help with tonight's doses"],
  ["results", "Your results", "Your numbers, as you added them"],
  ["money", "Costs", "What's due and what you've paid"],
];
const REL: Record<Relationship, string> = { partner: "Partner", family: "Family", friend: "Friend", other: "Support person" };
const first = (name: string) => name.trim().split(/\s+/)[0] || "them";

/** Where the person she invites opens Pumpkin. */
function appLink() {
  if (Platform.OS === "web") {
    const g = globalThis as unknown as { location?: { origin: string } };
    if (g.location?.origin) return `${g.location.origin}/phone`;
  }
  return "the Pumpkin app";
}

export function PeopleScreen({ api }: { api: Api }) {
  const [data, setData] = useState<{ partners: SupportPerson[]; invites: Invite[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const d = await api.soloSharing(); setData(d); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return err ? <T style={{ color: C.red }}>{err}</T> : <ActivityIndicator color={C.espresso} />;
  if (adding) return <InviteForm api={api} done={() => { setAdding(false); void load(); }} />;
  return (
    <>
      <Today size={34}>Your people</Today>
      <Muted>A partner, family member or friend can follow along. They see only what you switch on, and you can change it or remove them anytime. Your background and your notes are never shared.</Muted>
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      {data.partners.map((p) => <PersonCard key={p.userId} person={p} api={api} reload={load} />)}
      {data.invites.map((i) => (
        <Card key={i.id} style={{ gap: 6 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{`${i.name} · ${REL[i.relationship]}`}</T>
          <Muted>Invited. Waiting for them to join.</Muted>
          <Pressable testID={`cancel-invite-${first(i.name)}`} onPress={async () => { await api.cancelInvite(i.id); await load(); }}><T style={{ fontFamily: F.sans600, color: C.clayInk }}>Cancel invite</T></Pressable>
        </Card>
      ))}
      {data.partners.length + data.invites.length < 5
        ? <Button testID="invite-person" label="Invite someone" onPress={() => setAdding(true)} />
        : <Muted>You can have up to five people. Remove someone to invite another.</Muted>}
    </>
  );
}

function PersonCard({ person, api, reload }: { person: SupportPerson; api: Api; reload: () => Promise<void> }) {
  const name = first(person.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toggle = async (k: Shareable, on: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await api.setSharing(person.userId, on ? [...person.sections, k] : person.sections.filter((s) => s !== k)); await reload(); } finally { setBusy(false); }
  };
  return (
    <Card pad={false}>
      <View style={[st.row, { borderTopWidth: 0 }]}>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.sans700, fontSize: 15.5 }}>{person.name}</T>
          <Muted>{REL[person.relationship]}{person.sections.length === 0 ? " · sees nothing right now" : ""}</Muted>
        </View>
      </View>
      {OPTIONS.map(([k, title, sub]) => (
        <View key={k} style={st.row}>
          <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{title}</T><Muted>{sub}</Muted></View>
          <Toggle testID={`share-${name}-${k}`} value={person.sections.includes(k)} disabled={busy} onChange={(v) => toggle(k, v)} />
        </View>
      ))}
      <View style={st.row}>
        <Pressable testID={`remove-${name}`} onPress={async () => { if (!confirm) { setConfirm(true); return; } setBusy(true); try { await api.removePerson(person.userId); await reload(); } finally { setBusy(false); } }}>
          <T style={{ fontFamily: F.sans600, color: C.clayInk }}>{confirm ? `Tap again to remove ${name}` : `Remove ${name}`}</T>
        </Pressable>
      </View>
    </Card>
  );
}

function InviteForm({ api, done }: { api: Api; done: () => void }) {
  const [name, setName] = useState("");
  const [rel, setRel] = useState<Relationship>("partner");
  const [contact, setContact] = useState("");
  const [sections, setSections] = useState<Shareable[]>(["schedule", "meds"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const who = first(name);

  if (made) {
    const message = `I'd like you to follow along with me on Pumpkin. Open ${appLink()}, tap "I have an invite code" and enter ${made.code}. It works once and expires in 7 days.`;
    const isEmail = contact.includes("@");
    const to = isEmail ? contact.trim() : contact.replace(/[^0-9+]/g, "");
    const url = isEmail
      ? `mailto:${to}?subject=${encodeURIComponent("Follow along with me on Pumpkin")}&body=${encodeURIComponent(message)}`
      : `sms:${to}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(message)}`;
    return (
      <>
        <Today size={32}>{`Send ${who} the invite`}</Today>
        <View style={{ backgroundColor: C.fill, borderRadius: 22, padding: 18, gap: 8 }}>
          <T style={{ fontSize: 13, color: C.fillMuted }}>Invite code</T>
          <Text testID="invite-made-code" selectable style={{ fontFamily: F.display700, fontSize: 34, letterSpacing: 3, color: C.onFill }}>{made.code}</Text>
          <T style={{ fontSize: 13.5, color: C.fillSoft }}>Works once. Expires in 7 days.</T>
        </View>
        <Button testID="send-invite" label={isEmail ? `Email ${who}` : `Text ${who}`} onPress={() => { void Linking.openURL(url).catch(() => setErr("Couldn't open that here. Copy the message instead.")); }} />
        <Button testID="copy-invite" kind="line" label={copied ? "Copied" : "Copy the message"} onPress={async () => { await Clipboard.setStringAsync(message); setCopied(true); }} />
        {Platform.OS !== "web" ? <Button kind="line" label="Other ways to send" onPress={() => { void Share.share({ message }); }} /> : null}
        {err ? <T style={{ color: C.red }}>{err}</T> : null}
        <Muted>{`${who} will see only what you picked. You can change it anytime.`}</Muted>
        <Button kind="plain" label="Done" onPress={done} />
      </>
    );
  }
  return (
    <>
      <Today size={32}>Invite someone</Today>
      <Card style={{ gap: 10 }}>
        <Field testID="invite-person-name" label="Their name" value={name} onChange={setName} />
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Who are they to you?</T>
        <Chips>{(Object.keys(REL) as Relationship[]).map((r) => <Chip key={r} testID={`rel-${r}`} label={REL[r]} selected={rel === r} onPress={() => setRel(r)} />)}</Chips>
        <Field testID="invite-contact" label="Their mobile number or email" value={contact} onChange={setContact} keyboard="email-address" hint="We'll check it's them with a code when they join." />
      </Card>
      <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{`What ${who} can see`}</T>
      <Card pad={false}>
        {OPTIONS.map(([k, title, sub], i) => (
          <View key={k} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{title}</T><Muted>{sub}</Muted></View>
            <Toggle testID={`invite-share-${k}`} value={sections.includes(k)} onChange={(v) => setSections(v ? [...sections, k] : sections.filter((x) => x !== k))} />
          </View>
        ))}
      </Card>
      {err ? <T testID="invite-form-error" style={{ color: C.red }}>{err}</T> : null}
      <Button testID="create-invite" label={busy ? "Creating…" : "Create invite"} disabled={busy || !name.trim() || !contact.trim() || !sections.length}
        onPress={async () => { setBusy(true); setErr(null); try { setMade(await api.createInvite({ name, relationship: rel, contact, sections })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} />
      <Button kind="plain" label="Cancel" onPress={done} />
    </>
  );
}

export function FeedbackScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [body, setBody] = useState("");
  const [screen, setScreen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Today size={34}>Send feedback</Today>
      <Muted>What worked, what was confusing, what's missing. It goes straight to the Pumpkin team. Please don't include real health details.</Muted>
      <Card style={{ gap: 10 }}>
        <Field testID="feedback-screen" label="Which screen? (optional)" value={screen} onChange={setScreen} placeholder="Today, Add, Costs…" />
        <Field testID="feedback-body" label="Your feedback" value={body} onChange={setBody} multiline />
        {err ? <T style={{ color: C.red }}>{err}</T> : null}
        <Button testID="feedback-send" label={busy ? "Sending…" : "Send"} disabled={busy || !body.trim()}
          onPress={async () => { setBusy(true); setErr(null); try { await api.sendFeedback(body, screen || undefined, `${APP_VERSION} ${Platform.OS}`); done("Thank you. Your feedback was sent."); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} />
      </Card>
    </>
  );
}

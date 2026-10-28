/**
 * Pumpkin on your own: the app for a patient whose clinic isn't on Pumpkin (yet).
 *
 * - Sign up from the waitlist with a one-time code, then say where you are.
 * - "Add anything": snap a photo, upload a PDF, say it or type it. Pumpkin reads it into items she
 *   checks one by one. Medications are never added until she ticks that she checked them.
 * - Her record: meds with reminders, results with the lab's own reference range and what each test
 *   measures (never a verdict), visits with a calendar feed, costs with receipts, questions for her visit.
 * - Without a nurse on Pumpkin, urgent symptoms go to her clinic's after-hours line or 911.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { auth, type Api, type CaptureInput, type ItemKind, type PendingItem, type ResultGroup, type SignedInUser, type SoloCosts, type SoloMed, type SoloProfile, type SoloStage, type SoloToday } from "./api";
import { askPermission, remindersSupported, syncReminders } from "./reminders";
import { deviceName } from "./session";
import { Button, C, Cap, Card, Chip, Chips, F, H1, Icon, Muted, Pill, st, T, Today, Toggle } from "./ui";
import { Field } from "./field";
import { AboutScreen, AliasScreen, QuestionIdeas, SummaryScreen, TalkScreen } from "./yours";
import { FeedbackScreen, PeopleScreen } from "./people";
import { TestBanner } from "./appinfo";
import { PRONOUNS } from "@kinpath/core";

const STAGES: [SoloStage, string, string][] = [
  ["just_starting", "Just starting", "Getting ready for a first consult or tests"],
  ["in_cycle", "In a cycle", "Meds, monitoring visits and results"],
  ["two_week_wait", "In the two-week wait", "After a transfer or IUI"],
  ["after_hard_result", "After a hard result", "Taking it one day at a time"],
  ["freezing_eggs", "Freezing eggs", "Meds, visits and costs"],
  ["between_cycles", "Between cycles", "Planning what comes next"],
];
const DEMO = typeof __DEV__ !== "undefined" && __DEV__ || process.env.EXPO_PUBLIC_DEMO === "1";
const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
const telOf = (s: string) => `tel:${s.replace(/[^\d+]/g, "")}`;
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

// ---------- shell ----------

function Frame({ children, top, tabs }: { children: ReactNode; top?: ReactNode; tabs?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.oat }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" }}>
        {top}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 14 }} keyboardShouldPersistTaps="handled"><TestBanner />{children}</ScrollView>
        {tabs}
      </View>
    </SafeAreaView>
  );
}
function Back({ label = "Back", onBack }: { label?: string; onBack: () => void }) {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 }}>
      <Pressable testID="back" onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, alignSelf: "flex-start", minHeight: 44 }}>
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M15 6l-6 6 6 6" stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        <T style={{ fontFamily: F.sans500, fontSize: 15 }}>{label}</T>
      </Pressable>
    </View>
  );
}
function Urgent({ profile, crisis, back }: { profile: SoloProfile | null; crisis: boolean; back: () => void }) {
  return (
    <>
      <View testID="solo-urgent" style={{ backgroundColor: C.alertSoft, borderRadius: 22, padding: 18, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="alert" color={C.red} size={28} /><T style={{ fontFamily: F.sans700, color: C.red, fontSize: 15 }}>Safety check · not an AI answer</T></View>
        <Text style={{ fontFamily: F.display, fontSize: 30, lineHeight: 33, letterSpacing: -0.8, color: C.espresso }}>{crisis ? "You don't have to go through this alone." : "This needs a person now."}</Text>
        <T style={{ fontSize: 16, lineHeight: 23 }}>{crisis
          ? "Call or text 988 any time to reach the Suicide & Crisis Lifeline."
          : `Pumpkin didn't try to answer this, and nothing was saved. Call ${profile?.clinicName ? `${profile.clinicName}'s` : "your clinic's"} after-hours line now.`}</T>
        {crisis
          ? <Button kind="red" label="Call or text 988" onPress={() => Linking.openURL("tel:988")} />
          : profile?.afterHoursPhone
            ? <Button testID="call-after-hours" kind="red" label={`Call ${profile.afterHoursPhone}`} onPress={() => Linking.openURL(telOf(profile.afterHoursPhone!))} />
            : <T style={{ fontFamily: F.sans600 }}>Your clinic's after-hours number is on your paperwork or their website. Add it in Settings so it's here next time.</T>}
        <T style={{ fontFamily: F.sans700 }}>If you have chest pain, trouble breathing or heavy bleeding, call 911.</T>
        <Button kind="line" label="Call 911" onPress={() => Linking.openURL("tel:911")} />
      </View>
      <Button kind="line" label="Back to today" onPress={back} />
    </>
  );
}

// ---------- sign up ----------

type SignupStep = { name: "contact" } | { name: "code"; contact: string; sentTo: string } | { name: "about"; ticket: string };
export function SignupFlow({ onSignedIn, onBack }: { onSignedIn: (u: SignedInUser) => void; onBack: () => void }) {
  const [step, setStep] = useState<SignupStep>({ name: "contact" });
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [preferred, setPreferred] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [stage, setStage] = useState<SoloStage | null>(null);
  const [clinic, setClinic] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const err = error ? <T testID="signup-error" style={{ color: C.red }}>{error}</T> : null;

  if (step.name === "code") return (
    <Frame top={<Back onBack={() => setStep({ name: "contact" })} />}>
      <Today size={34}>Check your messages</Today>
      <Muted style={{ fontSize: 15 }}>{`If it's your turn, we sent a 6-digit code to ${step.sentTo}. If you're still on the waitlist, we'll message you there when it's your turn.`}</Muted>
      <Card style={{ gap: 10 }}>
        <TextInput testID="signup-code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={7} placeholder="123456" placeholderTextColor={C.stone}
          style={[st.input, { minHeight: 48, fontFamily: F.sans600, fontSize: 24, letterSpacing: 6, borderColor: C.espresso }]} />
        {err}
        <Button testID="signup-verify" label={busy ? "Checking…" : "Continue"} disabled={busy || code.replace(/\D/g, "").length !== 6}
          onPress={() => run(async () => { const r = await auth.signupVerify(step.contact, code); setStep({ name: "about", ticket: r.ticket }); })} />
      </Card>
    </Frame>
  );
  if (step.name === "about") return (
    <Frame top={<Back onBack={() => setStep({ name: "contact" })} />}>
      <Today size={34}>A little about you</Today>
      <Muted style={{ fontSize: 15 }}>This shapes your Today screen. You can change it anytime.</Muted>
      <Card style={{ gap: 14 }}>
        <Field testID="signup-first" label="Your first name" value={first} onChange={setFirst} />
        <Field testID="signup-preferred" label="What should we call you? (optional)" value={preferred} onChange={setPreferred} placeholder={first || "If it's different"} />
        <View style={{ gap: 8 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 14 }}>Your pronouns (optional)</T>
          <Chips>{PRONOUNS.map((x) => <Chip key={x} testID={`signup-pronouns-${x}`} label={x} selected={pronouns === x} onPress={() => setPronouns(pronouns === x ? "" : x)} />)}</Chips>
        </View>
        <View style={{ gap: 8 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 14 }}>Where are you right now?</T>
          <Chips>{STAGES.map(([id, label]) => <Chip key={id} testID={`stage-${id}`} label={label} selected={stage === id} onPress={() => setStage(id)} />)}</Chips>
        </View>
        <Field testID="signup-clinic" label="Your clinic (optional)" value={clinic} onChange={setClinic} placeholder="e.g. Coastal Fertility" />
        <Field testID="signup-phone" label="Their after-hours number (optional)" value={phone} onChange={setPhone} keyboard="phone-pad" placeholder="(813) 555-0100"
          hint="Without a nurse on Pumpkin, urgent symptoms go to this number. It's usually on your paperwork." />
        {err}
        <Button testID="signup-finish" label={busy ? "Setting up…" : "Start my record"} disabled={busy || !first.trim() || !stage}
          onPress={() => run(async () => onSignedIn(await auth.signupFinish({ ticket: step.ticket, firstName: first, preferredName: preferred, pronouns, stage: stage!, clinicName: clinic, afterHoursPhone: phone, timeZone: zone(), device: deviceName() })))} />
      </Card>
      <Muted style={{ fontSize: 13 }}>Your record is private. You choose who sees each part, and you can download it or delete it anytime.</Muted>
    </Frame>
  );
  return (
    <Frame top={<Back onBack={onBack} />}>
      <Today size={36}>Start on your own</Today>
      <Muted style={{ fontSize: 15 }}>Keep your meds, numbers and costs in one place, even if your clinic isn't on Pumpkin yet. We're letting people in from the waitlist a few at a time.</Muted>
      <Card style={{ gap: 10 }}>
        <Field testID="signup-contact" label="Mobile number or email" value={contact} onChange={setContact} keyboard="email-address" placeholder="you@email.com" />
        {err}
        <Button testID="signup-start" label={busy ? "Sending…" : "Continue"} disabled={busy || !contact.trim()}
          onPress={() => run(async () => { const r = await auth.signupStart(contact); setCode(""); setStep({ name: "code", contact, sentTo: r.sentTo }); })} />
      </Card>
    </Frame>
  );
}

// ---------- the app ----------

type Tab = "today" | "record" | "add" | "costs" | "more";
type Screen = { name: Tab } | { name: "check" } | { name: "urgent"; crisis: boolean } | { name: "say" } | { name: "type" } | { name: "by-hand"; kind: ItemKind } | { name: "original"; captureId: string; text?: string } | { name: "about" } | { name: "talk" } | { name: "alias" } | { name: "summary" } | { name: "people" } | { name: "feedback" };

export function SoloApp({ api, onSignOut }: { api: Api; onSignOut: () => void }) {
  const [screen, setScreen] = useState<Screen>({ name: "today" });
  const [today, setToday] = useState<SoloToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const d = await api.soloToday(); setToday(d); setError(null); void syncReminders(d.reminders).catch(() => 0); }
    catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const go = (s: Screen) => { setNotice(null); setScreen(s); };
  const home = (msg?: string) => { void load(); setScreen({ name: "today" }); setNotice(msg ?? null); };
  const afterCapture = (r: { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null }) => {
    void load();
    if (r.status === "urgent") return setScreen({ name: "urgent", crisis: r.urgent === "crisis" });
    if (r.items > 0) return setScreen({ name: "check" });
    setScreen({ name: "add" }); setNotice(r.problem ?? "We didn't find anything to add.");
  };

  if (error && !today) return <Frame><Today size={32}>Can't reach Pumpkin</Today><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Frame>;
  if (!today) return <Frame><View style={{ paddingTop: 80, alignItems: "center" }}><ActivityIndicator color={C.espresso} /></View></Frame>;
  const isTab = ["today", "record", "add", "costs", "more"].includes(screen.name);
  const tabs = isTab ? <Tabs current={screen.name} go={go} badge={today.toCheck} /> : undefined;
  const top = isTab
    ? <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontFamily: F.display700, fontSize: 22, letterSpacing: -0.4, color: C.espresso }}>pumpkin</Text>
        <Pressable testID="feeling-unwell" onPress={() => go({ name: "urgent", crisis: false })} style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: C.alertSoft, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40 }}>
          <Icon name="alert" color={C.red} size={18} /><T style={{ fontFamily: F.sans600, color: C.red, fontSize: 13.5 }}>Feeling unwell?</T>
        </Pressable>
      </View>
    : <Back label={screen.name === "original" ? "Back to checking" : "Today"} onBack={() => (screen.name === "original" ? setScreen({ name: "check" }) : home())} />;

  return (
    <Frame top={top} tabs={tabs}>
      {notice ? <View testID="solo-notice" style={{ backgroundColor: C.sage, borderRadius: 16, padding: 14 }}><T style={{ fontFamily: F.sans600, color: C.sageInk, fontSize: 15 }}>{notice}</T></View> : null}
      {screen.name === "today" && <TodayScreen d={today} api={api} go={go} reload={load} />}
      {screen.name === "add" && <AddScreen api={api} profile={today.profile} go={go} done={afterCapture} />}
      {screen.name === "say" && <SayScreen api={api} done={afterCapture} />}
      {screen.name === "type" && <TypeScreen api={api} done={afterCapture} />}
      {screen.name === "check" && <CheckScreen api={api} go={go} done={(n) => home(n)} />}
      {screen.name === "original" && <OriginalScreen api={api} captureId={screen.captureId} text={screen.text} />}
      {screen.name === "by-hand" && <ByHandScreen api={api} kind={screen.kind} done={(msg) => { void load(); setScreen({ name: screen.kind === "cost" ? "costs" : "record" }); setNotice(msg); }} />}
      {screen.name === "record" && <RecordScreen api={api} d={today} go={go} reload={load} />}
      {screen.name === "costs" && <CostsScreen api={api} go={go} />}
      {screen.name === "more" && <MoreScreen api={api} profile={today.profile} reload={load} onSignOut={onSignOut} go={go} />}
      {screen.name === "about" && <AboutScreen api={api} done={(m) => home(m)} />}
      {screen.name === "talk" && <TalkScreen api={api} done={(m) => home(m)} />}
      {screen.name === "alias" && <AliasScreen api={api} done={(m) => { void load(); setScreen({ name: "more" }); setNotice(m); }} />}
      {screen.name === "summary" && <SummaryScreen api={api} />}
      {screen.name === "people" && <PeopleScreen api={api} />}
      {screen.name === "feedback" && <FeedbackScreen api={api} done={(m) => { setScreen({ name: "more" }); setNotice(m); }} />}
      {screen.name === "urgent" && <Urgent profile={today.profile} crisis={screen.crisis} back={() => home()} />}
    </Frame>
  );
}

function Tabs({ current, go, badge }: { current: string; go: (s: Screen) => void; badge: number }) {
  const items: [Tab, string][] = [["today", "Today"], ["record", "Record"], ["add", "Add"], ["costs", "Costs"], ["more", "Settings"]];
  return (
    <View style={{ marginHorizontal: 12, marginTop: 8, marginBottom: 14, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 999, padding: 5, flexDirection: "row", gap: 2 }}>
      {items.map(([name, label]) => {
        const on = current === name; const add = name === "add";
        return (
          <Pressable key={name} testID={`solo-tab-${name}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => go({ name })}
            style={{ flex: add ? 1.1 : 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", backgroundColor: on ? C.espresso : add ? C.marigold : "transparent" }}>
            <Text numberOfLines={1} style={{ fontFamily: on || add ? F.sans700 : F.sans500, fontSize: 13, color: on ? C.paper : C.espresso }}>{add ? "+ Add" : label}{name === "today" && badge ? ` · ${badge}` : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Today ----------

function TodayScreen({ d, api, go, reload }: { d: SoloToday; api: Api; go: (s: Screen) => void; reload: () => Promise<void> }) {
  const p = d.profile;
  // The next day's doses (the next 30 hours), so the 8 pm dose stays visible after tonight's is done.
  const soon = d.schedule.upcoming.filter((x) => new Date(x.scheduledFor).getTime() - Date.now() < 30 * 3600_000);
  const missed = d.schedule.missed.filter((x) => Date.now() - new Date(x.scheduledFor).getTime() < 36 * 3600_000);
  const [logging, setLogging] = useState<string | null>(null);
  const log = async (id: string) => { setLogging(id); try { await api.logDose(id); await reload(); } finally { setLogging(null); } };
  const hard = p.stage === "after_hard_result";
  const f = d.feel;
  const quiet = f.quiet, gentle = f.tender?.mode === "gentle";
  const [shown, setShown] = useState(!d.about.revealResults);
  useEffect(() => { setShown(!d.about.revealResults); }, [d.about.revealResults]);
  const [resuming, setResuming] = useState(false);
  const resume = async () => { setResuming(true); try { await api.setQuiet({ pauseDays: null, onBreak: false }); await reload(); } finally { setResuming(false); } };
  const dueSoon = d.nextDue && (d.about.costCheckins === "always" || (Date.parse(`${d.nextDue.dueOn}T12:00:00`) - Date.now()) / 86400_000 <= 7);
  return (
    <>
      <View style={{ gap: 4 }}>
        <Today>Today</Today>
        <T testID="greeting" style={{ fontSize: 17, fontFamily: F.sans600 }}>{`Hi, ${d.about.displayName}.`}</T>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Muted style={{ fontSize: 15 }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</Muted>
          <Pill tone="lav" label={p.stageLabel} />
        </View>
      </View>
      {f.onBreak || f.paused ? (
        <View testID="quiet-card" style={{ backgroundColor: C.sage, borderRadius: 22, padding: 18, gap: 8 }}>
          <T style={{ fontFamily: F.display, fontSize: 21, lineHeight: 25 }}>{f.onBreak ? "You're taking a break." : `Paused until ${new Date(f.pauseUntil!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}.`}</T>
          <T style={{ fontSize: 15 }}>Pumpkin is keeping things quiet. Your medication reminders still come.</T>
          <Button kind="esp" label={resuming ? "One moment…" : "I'm back"} onPress={resume} />
        </View>
      ) : f.tender ? (
        <View testID="tender-card" style={{ backgroundColor: C.lav, borderRadius: 22, padding: 18, gap: 6 }}>
          <T style={{ fontFamily: F.display, fontSize: 21, lineHeight: 25 }}>{f.tender.mode === "quiet" ? "Today is one of your quiet days." : "Thinking of you today."}</T>
          <T style={{ fontSize: 15 }}>{f.tender.mode === "quiet" ? "Pumpkin is only showing what you need today." : "Go easy on yourself."}</T>
        </View>
      ) : d.about.tone === "reassure" && !hard ? (
        <Muted style={{ fontSize: 15 }}>Whatever today holds, you don't have to keep it all in your head. It's here.</Muted>
      ) : null}
      {hard && !quiet ? (
        <Card style={{ gap: 6 }}><T style={{ fontFamily: F.display, fontSize: 22, lineHeight: 26 }}>{`We're so sorry, ${p.firstName}.`}</T><T style={{ fontSize: 15.5, lineHeight: 22 }}>Take the time you need. Your record is here whenever you want it, and so are your questions for your next visit.</T></Card>
      ) : null}

      {d.toCheck > 0 && !quiet ? (
        <Pressable testID="to-check" onPress={() => go({ name: "check" })} style={{ backgroundColor: C.lav, borderRadius: 22, padding: 18, gap: 4 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="check" color={C.lavInk} /><T style={{ fontFamily: F.sans700, color: C.lavInk, fontSize: 13, letterSpacing: 0.6 }}>READY TO CHECK</T></View>
          <T style={{ fontFamily: F.display, fontSize: 22, lineHeight: 26 }}>{d.toCheck === 1 ? "1 thing Pumpkin read for you" : `${d.toCheck} things Pumpkin read for you`}</T>
          <T style={{ fontSize: 15 }}>Check each one before it goes in your record.</T>
        </Pressable>
      ) : null}

      {(soon.length > 0 || missed.length > 0) && (
        <View style={[st.dark, { gap: 12 }]}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="medication" color={C.marigold} /><T style={{ fontFamily: F.sans700, color: C.marigold, fontSize: 13, letterSpacing: 0.6 }}>MEDS</T></View>
          {missed.map((x) => (
            <View key={x.id} style={{ gap: 6 }}>
              <T style={{ color: C.paper, fontSize: 15.5 }}>{`${x.medication} ${x.dose} · was due ${clock(x.scheduledFor)}`}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable testID={`late-${x.id}`} onPress={() => log(x.id)} style={{ backgroundColor: C.paper, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}><T style={{ fontFamily: F.sans700 }}>{logging === x.id ? "Saving…" : "I took it"}</T></Pressable>
                {p.afterHoursPhone ? <Pressable onPress={() => Linking.openURL(telOf(p.afterHoursPhone!))} style={{ borderColor: C.paper, borderWidth: 1.5, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}><T style={{ fontFamily: F.sans600, color: C.paper }}>Not sure? Call your clinic</T></Pressable> : null}
              </View>
            </View>
          ))}
          {soon.map((x) => (
            <View key={x.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}><T style={{ fontFamily: F.display, fontSize: 20, color: C.paper }}>{`${new Date(x.scheduledFor).toDateString() === new Date().toDateString() ? "" : "Tomorrow "}${clock(x.scheduledFor)}`}</T><T style={{ color: C.tan, fontSize: 15 }}>{`${x.medication} ${x.dose}`}</T></View>
              {x.takenAt ? <Pill tone="sage" label="Done" /> : <Pressable testID={`log-${x.id}`} onPress={() => log(x.id)} style={{ backgroundColor: C.marigold, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" }}><T style={{ fontFamily: F.sans700 }}>{logging === x.id ? "Saving…" : "Log it"}</T></Pressable>}
            </View>
          ))}
        </View>
      )}

      {!quiet && <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="pen" /><T style={{ fontFamily: F.display, fontSize: 21 }}>Got something new?</T></View>
        <T style={{ fontSize: 15, lineHeight: 21 }}>Snap your med instructions, a lab report or a payment plan. Or just say it. Pumpkin sorts it out, and you check it.</T>
        <Button testID="today-add" kind="esp" label="Add something" onPress={() => go({ name: "add" })} />
      </Card>}

      {d.appointments.length > 0 && (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="calendar" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>COMING UP</T></View>
          {d.appointments.slice(0, 2).map((a) => <View key={a.id}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{a.title}</T><Muted style={{ fontSize: 14 }}>{`${when(a.startsAt)}${a.location ? ` · ${a.location}` : ""}`}</Muted></View>)}
          {d.openQuestions > 0 ? <Pressable onPress={() => go({ name: "record" })}><T style={{ color: C.lavInk, fontFamily: F.sans600, paddingVertical: 6 }}>{`${d.openQuestions} question${d.openQuestions === 1 ? "" : "s"} to ask at your visit`}</T></Pressable> : null}
        </Card>
      )}

      {d.nextDue && dueSoon && !quiet ? (
        <Pressable testID="next-payment" onPress={() => go({ name: "costs" })} style={{ backgroundColor: C.clay, borderRadius: 22, padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}><View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="wallet" color={C.clayInk} /><T style={{ fontFamily: F.sans700, color: C.clayInk, fontSize: 13, letterSpacing: 0.6 }}>NEXT PAYMENT</T></View><T style={{ fontSize: 15 }}>{`Due ${dayLabel(d.nextDue.dueOn)}`}</T></View>
          <T style={{ fontFamily: F.display, fontSize: 26 }}>{money(d.nextDue.amountCents)}</T>
        </Pressable>
      ) : null}

      {d.latestResults.length > 0 && !quiet && (shown ? (
        <Pressable onPress={() => go({ name: "record" })} style={[st.card, { padding: 16, gap: 8 }]}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="lab" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR LATEST NUMBERS</T></View>
          {d.latestResults.map((r) => <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between" }}><T style={{ fontSize: 15 }}>{r.name}</T><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{`${r.value} ${r.unit} · ${dayLabel(r.on)}`}</T></View>)}
          <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>See what each test measures</T>
        </Pressable>
      ) : (
        <Pressable testID="reveal-results" onPress={() => setShown(true)} style={[st.card, { padding: 16, gap: 6 }]}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="lab" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR NUMBERS</T></View>
          <T style={{ fontSize: 15.5 }}>Your latest numbers are here when you're ready.</T>
          <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Show me</T>
        </Pressable>
      ))}

      {d.about.stepsLeft.length > 0 && !quiet && !gentle && !hard ? (
        <Pressable testID="make-yours" onPress={() => go({ name: "about" })} style={[st.card, { padding: 16, gap: 6 }]}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="heart" /><T style={{ fontFamily: F.display, fontSize: 20 }}>Make Pumpkin yours</T></View>
          <T style={{ fontSize: 15 }}>{d.about.stepsLeft.includes("name") ? "Tell us what to call you, and a little about how you're building your family." : "A few optional questions so Pumpkin talks to you the way you'd like."}</T>
          <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{`${5 - d.about.stepsLeft.length} of 5 done`}</T>
        </Pressable>
      ) : null}

      {quiet || gentle ? null : !p.askedClinicAt ? <AskClinicCard api={api} profile={p} reload={reload} /> : (
        <View style={{ backgroundColor: C.sage, borderRadius: 22, padding: 16 }}><T style={{ color: C.sageInk, fontFamily: F.sans600, fontSize: 15 }}>{`You asked ${p.clinicName ?? "your clinic"} to join. When they do, your nurse can see what you've logged, if you choose to share it.`}</T></View>
      )}
    </>
  );
}

function AskClinicCard({ api, profile, reload }: { api: Api; profile: SoloProfile; reload: () => Promise<void> }) {
  const [name, setName] = useState(profile.clinicName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (share) return (
    <View testID="ask-clinic-sent" style={{ backgroundColor: C.sage, borderRadius: 22, padding: 18, gap: 10 }}>
      <T style={{ fontFamily: F.display, fontSize: 21 }}>Thanks. We'll reach out to them.</T>
      <T style={{ fontSize: 15 }}>A note from you helps too. Here's one you can send your clinic, or change it however you like:</T>
      <View style={{ backgroundColor: C.paper, borderRadius: 14, padding: 12 }}><T testID="ask-clinic-text" style={{ fontSize: 14.5 }}>{share}</T></View>
      <Button kind="esp" label={copied ? "Copied" : "Copy the note"} onPress={async () => { await Clipboard.setStringAsync(share); setCopied(true); }} />
      {Platform.OS !== "web" ? <Button kind="line" label="Send it" onPress={() => { void Share.share({ message: share }); }} /> : null}
      <Pressable onPress={() => { setShare(null); void reload(); }}><Muted style={{ textDecorationLine: "underline" }}>Done</Muted></Pressable>
    </View>
  );
  return (
    <View style={{ backgroundColor: C.sage, borderRadius: 22, padding: 18, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="people" color={C.sageInk} /><T style={{ fontFamily: F.display, fontSize: 21 }}>Want your clinic on Pumpkin?</T></View>
      <T style={{ fontSize: 15 }}>We'll let them know a patient asked. We never share your health details.</T>
      <Field testID="ask-clinic-name" label="Your clinic's name" value={name} onChange={setName} />
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <Button testID="ask-clinic" kind="esp" label={busy ? "Sending…" : "Ask my clinic to join"} disabled={busy || name.trim().length < 2}
        onPress={async () => { setBusy(true); setErr(null); try { const r = await api.askMyClinic(name); setShare(r.shareText); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} />
    </View>
  );
}

// ---------- Add anything ----------

async function blobToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("We couldn't open that file."));
    r.readAsDataURL(blob);
  });
}

function AddScreen({ api, profile, go, done }: { api: Api; profile: SoloProfile; go: (s: Screen) => void; done: (r: { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ id: string; label: string; description: string }[]>([]);
  useEffect(() => { if (DEMO) api.samples().then(setSamples).catch(() => {}); }, [api]);
  const send = async (label: string, input: () => Promise<CaptureInput | null>) => {
    setError(null);
    try {
      const i = await input();
      if (!i) return;
      setBusy(label);
      done(await api.capture(i));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const photo = (camera: boolean) => send("photo", async () => {
    if (camera && Platform.OS !== "web") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) throw new Error("Pumpkin needs camera access to take a photo. You can turn it on in your phone's Settings, or choose a photo instead.");
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.7, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
    const r = camera && Platform.OS !== "web" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    const base64 = a.base64 ?? (a.uri.startsWith("data:") ? a.uri.replace(/^data:[^,]*,/, "") : await blobToBase64(a.uri));
    const mime = a.mimeType && a.mimeType !== "image/heic" ? a.mimeType : "image/jpeg";
    return { kind: "photo", mime, base64, filename: a.fileName ?? "Photo" };
  });
  const pdf = () => send("pdf", async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    return { kind: "pdf", mime: "application/pdf", base64: await blobToBase64(a.uri), filename: a.name };
  });
  const Option = ({ id, icon, title, sub, onPress }: { id: string; icon: Parameters<typeof Icon>[0]["name"]; title: string; sub: string; onPress: () => void }) => (
    <Pressable testID={`add-${id}`} onPress={onPress} disabled={!!busy} style={[st.card, { padding: 16, flexDirection: "row", gap: 14, alignItems: "center", opacity: busy && busy !== id ? 0.5 : 1 }]}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.oat, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={26} /></View>
      <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 16 }}>{title}</T><Muted style={{ fontSize: 14 }}>{sub}</Muted></View>
      {busy === id ? <ActivityIndicator color={C.espresso} /> : null}
    </Pressable>
  );
  return (
    <>
      <Today size={34}>Add something</Today>
      <Muted style={{ fontSize: 15 }}>Pumpkin reads it and sorts it into meds, results, visits and costs. Nothing goes in your record until you check it.</Muted>
      {profile.aiReads.on && profile.aiReads.limit !== null ? (
        <View testID="ai-reads" style={{ backgroundColor: profile.aiReads.left === 0 ? C.clay : C.oat, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.line }}>
          <T style={{ fontFamily: F.sans600, fontSize: 14.5, color: profile.aiReads.left === 0 ? C.clayInk : C.espresso }}>{profile.aiReads.left === 0
            ? `You've used your ${profile.aiReads.limit} free reads this month. They start again on the 1st.`
            : `${profile.aiReads.left} of ${profile.aiReads.limit} free reads left this month.`}</T>
          <Muted style={{ fontSize: 13 }}>{profile.aiReads.left === 0 ? "Typed and spoken notes still work, and you can always add things by hand." : "Each thing Pumpkin reads for you uses one. Samples don't."}</Muted>
        </View>
      ) : null}
      {busy ? <View style={{ backgroundColor: C.lav, borderRadius: 16, padding: 14, flexDirection: "row", gap: 10, alignItems: "center" }}><ActivityIndicator color={C.lavInk} /><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Reading it now. This can take a few seconds.</T></View> : null}
      {error ? <T testID="add-error" style={{ color: C.red, fontSize: 15 }}>{error}</T> : null}
      {Platform.OS !== "web" ? <Option id="camera" icon="doc" title="Take a photo" sub="Instruction sheets, lab reports, receipts" onPress={() => photo(true)} /> : null}
      <Option id="photo" icon="doc" title={Platform.OS === "web" ? "Upload a photo or screenshot" : "Choose a photo or screenshot"} sub="A portal screenshot works too" onPress={() => photo(false)} />
      <Option id="pdf" icon="doc" title="Upload a PDF" sub="Lab results, payment plans, consent packets" onPress={pdf} />
      <Option id="say" icon="message" title="Say it" sub={'"Gonal-f 225 at 8 tonight, starting tomorrow"'} onPress={() => go({ name: "say" })} />
      <Option id="type" icon="pen" title="Type it" sub="A quick note, a number, a question" onPress={() => go({ name: "type" })} />
      <Card style={{ gap: 6 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Forward an email</T>
        <Muted style={{ fontSize: 14 }}>Send appointment emails, results and payment plans to your private address. They'll show up here to check.</Muted>
        <Pressable testID="copy-forward" onPress={() => Clipboard.setStringAsync(profile.forwardAddress)} style={{ backgroundColor: C.oat, borderRadius: 12, padding: 12 }}><T style={{ fontFamily: F.sans600 }}>{profile.forwardAddress}</T><Muted style={{ fontSize: 13 }}>Tap to copy</Muted></Pressable>
      </Card>
      {samples.length > 0 && (
        <View style={{ gap: 8 }}>
          <Cap>Demo build · try a sample document (synthetic)</Cap>
          <Chips>{samples.map((s) => <Chip key={s.id} testID={`sample-${s.id}`} label={busy === `sample-${s.id}` ? "Reading…" : s.label} onPress={() => send(`sample-${s.id}`, async () => ({ kind: "sample", sampleId: s.id }))} />)}</Chips>
        </View>
      )}
      <Muted style={{ fontSize: 13 }}>Feeling unwell? Don't add it here. Tap "Feeling unwell?" at the top.</Muted>
    </>
  );
}

type SpeechRec = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; interimResults: boolean; continuous: boolean; lang: string };
function speech(): (new () => SpeechRec) | null {
  if (Platform.OS !== "web") return null;
  const w = globalThis as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function SayScreen({ api, done }: { api: Api; done: (r: { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null }) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState<SpeechRec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Rec = useMemo(speech, []);
  const listen = () => {
    if (!Rec) return;
    const r = new Rec(); r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    const base = text ? `${text.trim()}\n` : "";
    r.onresult = (e) => { let s = ""; for (let i = 0; i < e.results.length; i++) s += e.results[i]![0]!.transcript; setText(base + s.trim()); };
    r.onend = () => setListening(null);
    r.start(); setListening(r);
  };
  return (
    <>
      <Today size={34}>Say it</Today>
      <Muted style={{ fontSize: 15 }}>{Rec ? "Tap Start talking and say it like you'd tell a friend. One thing per sentence works best." : "Tap the microphone on your keyboard and talk. One thing per sentence works best."}</Muted>
      <Card style={{ gap: 10 }}>
        {Rec ? <Button testID="say-start" kind={listening ? "line" : "esp"} label={listening ? "Stop" : "Start talking"} onPress={() => (listening ? listening.stop() : listen())} /> : null}
        <TextInput testID="say-text" value={text} onChangeText={setText} multiline placeholder={"Menopur 75 units at 8 pm starting tomorrow.\nBlood work Thursday at 7:30 am."} placeholderTextColor={C.stone} style={[st.input, { minHeight: 140, fontSize: 16, borderColor: C.espresso }]} />
        {error ? <T style={{ color: C.red }}>{error}</T> : null}
        <Button testID="say-send" label={busy ? "Reading…" : "Sort it out"} disabled={busy || !text.trim()} onPress={async () => { listening?.stop(); setBusy(true); setError(null); try { done(await api.capture({ kind: "voice", text })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />
      </Card>
    </>
  );
}

function TypeScreen({ api, done }: { api: Api; done: (r: { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null }) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Today size={34}>Type it</Today>
      <Muted style={{ fontSize: 15 }}>Meds, a number from your portal, a visit, a payment, or a question for your next appointment.</Muted>
      <Card style={{ gap: 10 }}>
        <TextInput testID="type-text" value={text} onChangeText={setText} multiline placeholder={"Estradiol 612 pg/mL today\n$1,790 due Nov 1\nCan I keep running during stims?"} placeholderTextColor={C.stone} style={[st.input, { minHeight: 140, fontSize: 16, borderColor: C.espresso }]} />
        {error ? <T style={{ color: C.red }}>{error}</T> : null}
        <Button testID="type-send" label={busy ? "Reading…" : "Sort it out"} disabled={busy || !text.trim()} onPress={async () => { setBusy(true); setError(null); try { done(await api.capture({ kind: "text", text })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />
      </Card>
    </>
  );
}

// ---------- checking what Pumpkin read ----------

const KIND_LABEL: Record<ItemKind, string> = { medication: "Medication", result: "Test result", appointment: "Appointment", cost: "Cost", question: "Question for your visit" };
const KIND_TINT: Record<ItemKind, [string, string]> = { medication: [C.lav, C.lavInk], result: [C.lav, C.lavInk], appointment: [C.oat, C.espresso], cost: [C.clay, C.clayInk], question: [C.sage, C.sageInk] };
const KIND_ICON: Record<ItemKind, Parameters<typeof Icon>[0]["name"]> = { medication: "medication", result: "lab", appointment: "calendar", cost: "wallet", question: "message" };

function CheckScreen({ api, go, done }: { api: Api; go: (s: Screen) => void; done: (msg: string) => void }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [saved, setSaved] = useState(0);
  const load = useCallback(async () => setItems(await api.itemsToCheck()), [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (items && items.length === 0 && saved > 0) done(saved === 1 ? "Added to your record." : `Added ${saved} things to your record.`); }, [items, saved, done]);
  if (!items) return <ActivityIndicator color={C.espresso} />;
  if (!items.length) return <><Today size={34}>All checked</Today><Muted style={{ fontSize: 15 }}>Nothing is waiting. Add something new anytime.</Muted><Button label="Add something" onPress={() => go({ name: "add" })} /></>;
  return (
    <>
      <Today size={34}>Check what Pumpkin read</Today>
      <Muted style={{ fontSize: 15 }}>Compare each one with what you sent. Fix anything that's off. Pumpkin copies what's written; it doesn't decide what anything means.</Muted>
      {items.map((it) => <ItemCard key={it.id} item={it} api={api} go={go} onDone={(kept) => { if (kept) setSaved((n) => n + 1); setItems((xs) => xs!.filter((x) => x.id !== it.id)); }} />)}
    </>
  );
}

function ItemCard({ item, api, go, onDone }: { item: PendingItem; api: Api; go: (s: Screen) => void; onDone: (kept: boolean) => void }) {
  const [data, setData] = useState<Record<string, unknown>>(item.data);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bg, fg] = KIND_TINT[item.kind];
  const from = item.source.kind === "sample" ? "Sample document" : item.source.kind === "email" ? `Email${item.source.filename ? `: ${item.source.filename}` : ""}` : item.source.kind === "voice" ? "What you said" : item.source.kind === "text" ? "What you typed" : item.source.filename ?? "Your photo";
  return (
    <View testID={`item-${item.kind}`} style={[st.card, { overflow: "hidden" }]}>
      <View style={{ backgroundColor: bg, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1 }}><Icon name={KIND_ICON[item.kind]} color={fg} /><T style={{ fontFamily: F.sans700, color: fg, fontSize: 14 }}>{KIND_LABEL[item.kind]}</T></View>
        {item.source.hasFile || item.source.kind !== "sample" ? (
          <Pressable onPress={() => go({ name: "original", captureId: item.captureId })} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ color: fg, fontFamily: F.sans600, textDecorationLine: "underline", fontSize: 13.5 }}>See original</T></Pressable>
        ) : null}
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <Muted style={{ fontSize: 13 }}>{`From: ${from}`}</Muted>
        <ItemFields kind={item.kind} data={data} unsure={item.unsure} onChange={setData} />
        {item.kind === "medication" ? (
          <Pressable testID="med-checked" accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked((c) => !c)} style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.oat, borderRadius: 14, padding: 12, minHeight: 48 }}>
            <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.espresso, backgroundColor: checked ? C.espresso : C.paper, alignItems: "center", justifyContent: "center" }}>{checked ? <Icon name="check" color={C.paper} size={18} /> : null}</View>
            <T style={{ flex: 1, fontSize: 15, fontFamily: F.sans600 }}>I checked the name, dose and time against my instructions.</T>
          </Pressable>
        ) : null}
        {error ? <T testID="item-error" style={{ color: C.red }}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 2 }}><Button testID="item-save" kind="esp" label={busy ? "Adding…" : "Add to my record"} disabled={busy || (item.kind === "medication" && !checked)}
            onPress={async () => { setBusy(true); setError(null); try { await api.saveItem(item.id, data, checked); onDone(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} /></View>
          <View style={{ flex: 1 }}><Button testID="item-dismiss" kind="line" label="Not this" disabled={busy} onPress={async () => { setBusy(true); setError(null); try { await api.dismissItem(item.id); onDone(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} /></View>
        </View>
      </View>
    </View>
  );
}

/** The editable fields for each kind of item. Used for checking what Pumpkin read and for adding by hand. */
function ItemFields({ kind, data, unsure, onChange }: { kind: ItemKind; data: Record<string, unknown>; unsure: string[]; onChange: (d: Record<string, unknown>) => void }) {
  const s = (k: string) => (data[k] === undefined || data[k] === null ? "" : String(data[k]));
  const set = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const chk = (k: string) => unsure.includes(k) || (["dose", "startsAt"].includes(k) && !s(k));
  if (kind === "medication") return (
    <>
      <Field testID="f-name" label="Medication" value={s("name")} onChange={(v) => set("name", v)} check={chk("name")} />
      <Field testID="f-dose" label="Dose" value={s("dose")} onChange={(v) => set("dose", v)} check={chk("dose")} placeholder="e.g. 225 IU" />
      <Field testID="f-times" label="Time each day" value={Array.isArray(data.times) ? (data.times as string[]).join(", ") : ""} onChange={(v) => set("times", v.split(/[,;]\s*/).filter(Boolean))} check={chk("times") || !(data.times as string[] | undefined)?.length} placeholder="20:00" hint="24-hour time, like 20:00 for 8 pm. Separate two times with a comma." />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Field testID="f-start" label="First day" value={s("startsOn")} onChange={(v) => set("startsOn", v)} check={chk("startsOn")} placeholder="YYYY-MM-DD" /></View>
        <View style={{ flex: 1 }}><Field testID="f-end" label="Last day" value={s("endsOn")} onChange={(v) => set("endsOn", v)} check={chk("endsOn")} placeholder="YYYY-MM-DD" /></View>
      </View>
      {s("instructions") ? <Field label="Instructions" value={s("instructions")} onChange={(v) => set("instructions", v)} multiline /> : null}
    </>
  );
  if (kind === "result") return (
    <>
      <Field testID="f-test" label="Test" value={s("test")} onChange={(v) => set("test", v)} check={chk("test")} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Field testID="f-value" label="Number" value={s("value")} onChange={(v) => set("value", v)} check={chk("value")} keyboard="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field testID="f-unit" label="Unit" value={s("unit")} onChange={(v) => set("unit", v)} check={chk("unit")} placeholder="pg/mL" /></View>
      </View>
      <Field testID="f-on" label="Date of the test" value={s("collectedOn")} onChange={(v) => set("collectedOn", v)} check={chk("collectedOn")} placeholder="YYYY-MM-DD" />
      <Field label="Lab's reference range (as printed)" value={s("refText")} onChange={(v) => set("refText", v)} check={chk("refText")} placeholder="Optional, e.g. 27-433 pg/mL" />
    </>
  );
  if (kind === "appointment") {
    const [d, t] = s("startsAt").split("T");
    return (
      <>
        <Field testID="f-title" label="What it's for" value={s("title")} onChange={(v) => set("title", v)} check={chk("title")} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field testID="f-date" label="Date" value={d ?? ""} onChange={(v) => set("startsAt", `${v}T${t ?? ""}`)} check={chk("startsAt")} placeholder="YYYY-MM-DD" /></View>
          <View style={{ flex: 1 }}><Field testID="f-time" label="Time" value={t ?? ""} onChange={(v) => set("startsAt", `${d ?? ""}T${v}`)} check={chk("startsAt")} placeholder="07:30" /></View>
        </View>
        <Field label="Where" value={s("location")} onChange={(v) => set("location", v)} placeholder="Optional" />
      </>
    );
  }
  if (kind === "cost") {
    const payment = data.type === "payment";
    return (
      <>
        <Chips>
          <Chip testID="f-charge" label="A bill to pay" selected={!payment} onPress={() => set("type", "charge")} />
          <Chip testID="f-payment" label="A payment I made" selected={payment} onPress={() => set("type", "payment")} />
        </Chips>
        <Field testID="f-desc" label="What it's for" value={s("description")} onChange={(v) => set("description", v)} check={chk("description")} />
        <Field testID="f-amount" label="Amount ($)" value={s("amount")} onChange={(v) => set("amount", v)} check={chk("amount")} keyboard="decimal-pad" />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field testID="f-date" label={payment ? "Date paid" : "Date of the bill"} value={s("date")} onChange={(v) => set("date", v)} check={chk("date")} placeholder="YYYY-MM-DD" /></View>
          {!payment ? <View style={{ flex: 1 }}><Field testID="f-due" label="Due" value={s("dueOn")} onChange={(v) => set("dueOn", v)} placeholder="YYYY-MM-DD" /></View> : null}
        </View>
        {payment ? <Chips>{["card", "bank", "check", "cash", "financing", "other"].map((m) => <Chip key={m} label={m[0]!.toUpperCase() + m.slice(1)} selected={data.method === m} onPress={() => set("method", m)} />)}</Chips> : null}
      </>
    );
  }
  return <Field testID="f-question" label="Your question" value={s("text")} onChange={(v) => set("text", v)} multiline />;
}

function OriginalScreen({ api, captureId, text }: { api: Api; captureId: string; text?: string }) {
  const [file, setFile] = useState<{ mime: string; filename: string; base64: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!text) api.captureOriginal(captureId).then(setFile).catch((e: Error) => setError(e.message)); }, [api, captureId, text]);
  return (
    <>
      <Today size={30}>What you sent</Today>
      {text ? <Card><T style={{ fontSize: 16 }}>{text}</T></Card> : null}
      {error ? <Muted style={{ fontSize: 15 }}>{error === "There's no file for this one." ? "This one came from something you said, typed or emailed." : error}</Muted> : null}
      {file && file.mime.startsWith("image/") ? <Image source={{ uri: `data:${file.mime};base64,${file.base64}` }} style={{ width: "100%", aspectRatio: 0.75, borderRadius: 14, backgroundColor: C.paper }} resizeMode="contain" accessibilityLabel="The photo you sent" /> : null}
      {file && file.mime === "application/pdf" ? <Card style={{ gap: 8 }}><T style={{ fontFamily: F.sans600 }}>{file.filename}</T>
        {Platform.OS === "web" ? <Button kind="line" label="Open the PDF" onPress={() => { const w = globalThis as unknown as { open: (u: string) => void }; w.open(`data:application/pdf;base64,${file.base64}`); }} /> : <Muted>Open it from the place you saved it to compare.</Muted>}
      </Card> : null}
      {!file && !error && !text ? <ActivityIndicator color={C.espresso} /> : null}
    </>
  );
}

// ---------- adding by hand ----------

const BLANK: Record<ItemKind, Record<string, unknown>> = {
  medication: { name: "", dose: "", times: [], startsOn: "", endsOn: "" },
  result: { test: "", value: "", unit: "", collectedOn: "", refText: "" },
  appointment: { title: "", startsAt: "", location: "" },
  cost: { type: "charge", description: "", amount: "", date: "", dueOn: "" },
  question: { text: "" },
};
function ByHandScreen({ api, kind, done }: { api: Api; kind: ItemKind; done: (msg: string) => void }) {
  const [data, setData] = useState<Record<string, unknown>>(BLANK[kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Today size={32}>{`Add ${kind === "question" ? "a question" : kind === "appointment" ? "an appointment" : kind === "cost" ? "a cost" : kind === "result" ? "a result" : "a medication"}`}</Today>
      <Card style={{ gap: 12 }}>
        <ItemFields kind={kind} data={data} unsure={[]} onChange={setData} />
        {error ? <T testID="byhand-error" style={{ color: C.red }}>{error}</T> : null}
        <Button testID="byhand-save" label={busy ? "Saving…" : "Save"} disabled={busy} onPress={async () => {
          setBusy(true); setError(null);
          try { await api.addByHand(kind, { ...data, value: data.value === "" ? undefined : Number(data.value), amount: data.amount === "" ? undefined : Number(String(data.amount).replace(/[$,]/g, "")) }); done("Saved."); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }} />
      </Card>
    </>
  );
}

// ---------- record ----------

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 280, h = 56, pad = 8;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), h - pad - ((v - lo) / span) * (h - pad * 2)] as const);
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} accessibilityLabel={`Trend: ${values.join(", ")}`}>
      <Path d={pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")} stroke={C.lavInk} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={4} fill={i === pts.length - 1 ? C.lavInk : C.paper} stroke={C.lavInk} strokeWidth={2} />)}
      <SvgText x={pts[pts.length - 1]![0] - 10} y={Math.max(12, pts[pts.length - 1]![1] - 10)} textAnchor="end" fontFamily={F.sans600} fontSize={11} fill={C.espresso}>{String(values[values.length - 1])}</SvgText>
    </Svg>
  );
}

function ResultCard({ g, api, reload, waitForMe }: { g: ResultGroup; api: Api; reload: () => void; waitForMe: boolean }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(!waitForMe);
  const latest = g.points[0]!;
  const showText = g.reviewed || DEMO;
  if (!shown) return (
    <Pressable testID={`result-${g.key}`} onPress={() => setShown(true)} style={[st.card, { padding: 16, gap: 4 }]}>
      <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{g.name}</T>
      <T style={{ fontSize: 15 }}>{`A result from ${dayLabel(latest.on)} is here when you're ready.`}</T>
      <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Show me</T>
    </Pressable>
  );
  return (
    <View testID={`result-${g.key}`} style={[st.card, { padding: 16, gap: 8 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{g.name}</T><Muted style={{ fontSize: 13.5 }}>{dayLabel(latest.on)}</Muted></View>
        <T style={{ fontFamily: F.display, fontSize: 26 }}>{`${latest.value}`}<T style={{ fontSize: 14 }}>{` ${latest.unit}`}</T></T>
      </View>
      {latest.refText || latest.refLow !== null || latest.refHigh !== null ? (
        <T style={{ fontSize: 14 }}>{`Lab's reference range: ${latest.refText ?? `${latest.refLow ?? ""}–${latest.refHigh ?? ""} ${latest.unit}`}`}</T>
      ) : null}
      <Sparkline values={[...g.points].reverse().map((p) => p.value)} />
      {g.measures ? (
        <Pressable onPress={() => setOpen((o) => !o)}><T style={{ color: C.lavInk, fontFamily: F.sans600, paddingVertical: 6 }}>{open ? "Hide" : "What this test measures"}</T></Pressable>
      ) : null}
      {open && g.measures ? (showText
        ? <View style={{ backgroundColor: C.oat, borderRadius: 14, padding: 12, gap: 6 }}>
            <T style={{ fontSize: 15, lineHeight: 21 }}>{g.measures}</T><T style={{ fontSize: 15, lineHeight: 21 }}>{g.inTreatment}</T>
            <Muted style={{ fontSize: 13 }}>{g.reviewed ? "Reviewed by Pumpkin's clinical advisors." : "Draft text, waiting for clinical review (demo build only)."} What your number means for you is your care team's call.</Muted>
          </View>
        : <Muted style={{ fontSize: 14 }}>This explainer is waiting for clinical review. Ask your care team what your number means for you.</Muted>) : null}
      {g.points.length > 1 ? <Muted style={{ fontSize: 13 }}>{`Earlier: ${g.points.slice(1, 4).map((p) => `${p.value} on ${dayLabel(p.on)}`).join(" · ")}`}</Muted> : null}
      {latest.mine ? <Pressable onPress={async () => { await api.removeMine("delete-result", latest.id); reload(); }}><Muted style={{ fontSize: 13, textDecorationLine: "underline" }}>Remove this entry</Muted></Pressable> : null}
    </View>
  );
}

function RecordScreen({ api, d, go, reload }: { api: Api; d: SoloToday; go: (s: Screen) => void; reload: () => Promise<void> }) {
  const [meds, setMeds] = useState<SoloMed[] | null>(null);
  const [results, setResults] = useState<ResultGroup[] | null>(null);
  const [questions, setQuestions] = useState<{ id: string; question: string; asked: boolean }[]>([]);
  const load = useCallback(async () => { const [m, r, q] = await Promise.all([api.soloMeds(), api.soloResults(), api.questions()]); setMeds(m); setResults(r); setQuestions(q); }, [api]);
  useEffect(() => { void load(); }, [load]);
  const Section = ({ icon, title, add, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; add: ItemKind; children: ReactNode }) => (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name={icon} /><H1>{title}</H1></View>
        <Pressable testID={`byhand-${add}`} onPress={() => go({ name: "by-hand", kind: add })} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Add</T></Pressable>
      </View>
      {children}
    </View>
  );
  if (!meds || !results) return <ActivityIndicator color={C.espresso} />;
  return (
    <>
      <Today size={36}>Your record</Today>
      <Section icon="medication" title="Meds" add="medication">
        {meds.length ? meds.map((m) => (
          <View key={m.id} style={[st.card, { padding: 14, gap: 4 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{`${m.medication} ${m.dose}`}</T><T style={{ fontSize: 15 }}>{m.time}</T></View>
            <Muted style={{ fontSize: 13.5 }}>{`${dayLabel(m.startsOn)}${m.endsOn && m.endsOn !== m.startsOn ? ` to ${dayLabel(m.endsOn)}` : ""}${m.nextAt ? ` · next ${when(m.nextAt)}` : ""}`}</Muted>
            {m.instructions ? <T style={{ fontSize: 14 }}>{m.instructions}</T> : null}
            {m.mine ? <Pressable onPress={async () => { await api.removeMine("stop-med", m.id); await load(); await reload(); }}><Muted style={{ fontSize: 13, textDecorationLine: "underline" }}>Stop this medication</Muted></Pressable> : null}
          </View>
        )) : <Muted style={{ fontSize: 15 }}>No meds yet. Snap your instruction sheet to add them.</Muted>}
      </Section>
      <Section icon="lab" title="Results" add="result">
        {results.length ? results.map((g) => <ResultCard key={g.key} g={g} api={api} reload={() => void load()} waitForMe={d.about.revealResults} />) : <Muted style={{ fontSize: 15 }}>No results yet. A portal screenshot works.</Muted>}
        <Muted style={{ fontSize: 13 }}>Pumpkin shows what each test measures and the range your lab printed. It never says whether a number is good or bad; your care team decides that.</Muted>
      </Section>
      <Section icon="calendar" title="Visits" add="appointment">
        {d.appointments.length ? d.appointments.map((a) => (
          <View key={a.id} style={[st.card, { padding: 14 }]}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{a.title}</T><Muted style={{ fontSize: 14 }}>{`${when(a.startsAt)}${a.location ? ` · ${a.location}` : ""}`}</Muted>
            {a.mine ? <Pressable onPress={async () => { await api.removeMine("delete-appointment", a.id); await reload(); }}><Muted style={{ fontSize: 13, textDecorationLine: "underline", paddingTop: 4 }}>Remove</Muted></Pressable> : null}</View>
        )) : <Muted style={{ fontSize: 15 }}>No visits coming up.</Muted>}
      </Section>
      <Section icon="message" title="For my next visit" add="question">
        {questions.length ? <Card pad={false}>{questions.map((q, i) => (
          <Pressable key={q.id} onPress={async () => { await api.setQuestionAsked(q.id, !q.asked); await load(); }} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.espresso, backgroundColor: q.asked ? C.espresso : C.paper, alignItems: "center", justifyContent: "center" }}>{q.asked ? <Icon name="check" size={16} color={C.paper} /> : null}</View>
            <T style={{ flex: 1, fontSize: 15, textDecorationLine: q.asked ? "line-through" : "none", color: q.asked ? C.stone : C.ink }}>{q.question}</T>
          </Pressable>
        ))}</Card> : <Muted style={{ fontSize: 15 }}>Write questions down when you think of them. Tick them off at your visit.</Muted>}
        <QuestionIdeas api={api} added={() => void load()} />
        <Button testID="open-summary" kind="line" label="My visit summary" onPress={() => go({ name: "summary" })} />
      </Section>
    </>
  );
}

// ---------- costs ----------

function CostsScreen({ api, go }: { api: Api; go: (s: Screen) => void }) {
  const [c, setC] = useState<SoloCosts | null>(null);
  const load = useCallback(async () => setC(await api.soloCosts()), [api]);
  useEffect(() => { void load(); }, [load]);
  if (!c) return <ActivityIndicator color={C.espresso} />;
  return (
    <>
      <Today size={36}>Costs</Today>
      <View style={{ backgroundColor: C.clay, borderRadius: 22, padding: 18, gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="wallet" color={C.clayInk} /><T style={{ fontFamily: F.sans700, color: C.clayInk, fontSize: 13, letterSpacing: 0.6 }}>WHERE YOU STAND</T></View>
        {c.nextDue ? <T testID="costs-next" style={{ fontFamily: F.display, fontSize: 24, lineHeight: 28 }}>{`${money(c.nextDue.amountCents)} due ${dayLabel(c.nextDue.dueOn)}`}</T> : <T style={{ fontFamily: F.display, fontSize: 22 }}>Nothing due</T>}
        {c.nextDue ? <T style={{ fontSize: 15 }}>{c.nextDue.description}</T> : null}
        <T style={{ fontSize: 15 }}>{`Paid in ${c.year}: ${money(c.paidThisYearCents)} (handy for HSA, FSA and taxes)`}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Button kind="esp" label="Add a bill" onPress={() => go({ name: "by-hand", kind: "cost" })} /></View>
        <View style={{ flex: 1 }}><Button kind="line" label="Snap a receipt" onPress={() => go({ name: "add" })} /></View>
      </View>
      {c.entries.length ? <Card pad={false}>{c.entries.map((e, i) => (
        <View key={e.id} style={[st.row, i === 0 && { borderTopWidth: 0 }, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{e.description}</T>
            <Muted style={{ fontSize: 13.5 }}>{e.kind === "charge" ? (e.dueOn ? `Due ${dayLabel(e.dueOn)}` : `Billed ${dayLabel(e.occurredOn)}`) : `${e.kind === "payment" ? "Paid" : e.kind === "refund" ? "Refunded" : "Adjusted"} ${dayLabel(e.occurredOn)}${e.method ? ` · ${e.method}` : ""}`}</Muted>
            {e.captureId ? <Pressable onPress={() => go({ name: "original", captureId: e.captureId! })}><T style={{ color: C.lavInk, fontSize: 13.5, fontFamily: F.sans600 }}>See receipt</T></Pressable> : null}
            {e.mine ? <Pressable onPress={async () => { await api.removeMine("delete-cost", e.id); await load(); }}><Muted style={{ fontSize: 13, textDecorationLine: "underline" }}>Remove</Muted></Pressable> : null}
          </View>
          <T style={{ fontFamily: F.sans700, fontSize: 15, color: e.kind === "payment" ? C.sageInk : C.ink }}>{`${e.kind === "payment" ? "−" : ""}${money(e.amountCents)}`}</T>
        </View>
      ))}</Card> : <Muted style={{ fontSize: 15 }}>Snap your payment plan or a receipt, and Pumpkin keeps track of what's due.</Muted>}
      <Muted style={{ fontSize: 13 }}>Pumpkin doesn't take payments. Pay your clinic the way they ask; keep the receipt here.</Muted>
    </>
  );
}

// ---------- settings ----------

function MoreScreen({ api, profile, reload, onSignOut, go }: { api: Api; profile: SoloProfile; reload: () => Promise<void>; onSignOut: () => void; go: (s: Screen) => void }) {
  const [stage, setStage] = useState<SoloStage>(profile.stage);
  const [clinic, setClinic] = useState(profile.clinicName ?? "");
  const [phone, setPhone] = useState(profile.afterHoursPhone ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState<{ url: string; webcal: string } | null>(null);
  const [detail, setDetail] = useState(profile.calendarDetail);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); await reload(); } catch (e) { setErr((e as Error).message); } };
  return (
    <>
      <Today size={36}>Settings</Today>
      {msg ? <T testID="more-msg" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{msg}</T> : null}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <Card pad={false}>
        {([["about", "heart", "Make Pumpkin yours", "Your name, pronouns, family and background"], ["talk", "message", "How Pumpkin talks to me", "Tone, quiet days, pauses, new results"], ["summary", "doc", "My visit summary", "One page to bring to an appointment"], ["people", "people", "Your people", "Invite a partner or friend, choose what they see"], ["alias", "people", "My community name", "How you'll appear in the community"], ["feedback", "message", "Send feedback", "Tell the Pumpkin team what to fix"]] as const).map(([name, icon, title, sub], i) => (
          <Pressable key={name} testID={`more-${name}`} onPress={() => go({ name })} style={[st.row, i === 0 && { borderTopWidth: 0 }, { minHeight: 64 }]}>
            <Icon name={icon} /><View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{title}</T><Muted style={{ fontSize: 13.5 }}>{sub}</Muted></View>
          </Pressable>
        ))}
      </Card>
      <Card style={{ gap: 12 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Where are you right now?</T>
        <Chips>{STAGES.map(([id, label]) => <Chip key={id} label={label} selected={stage === id} onPress={() => setStage(id)} />)}</Chips>
        <Field label="Your clinic" value={clinic} onChange={setClinic} />
        <Field label="Their after-hours number" value={phone} onChange={setPhone} keyboard="phone-pad" hint="Urgent symptoms go here (or 911)." />
        <Button kind="esp" label="Save" onPress={() => act(() => api.saveSoloProfile({ stage, clinicName: clinic, afterHoursPhone: phone }), "Saved.")} />
      </Card>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="calendar" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Your appointments in your calendar</T></View>
        <Muted style={{ fontSize: 14 }}>Subscribe once and new visits show up on their own. Titles say only "Appointment" unless you turn on details, since calendars are often shared.</Muted>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><T style={{ fontSize: 15 }}>Show what each visit is for</T><Toggle value={detail} onChange={setDetail} /></View>
        <Button testID="calendar-link" kind="esp" label={profile.calendarOn ? "Make a new calendar link" : "Get my calendar link"} onPress={() => act(async () => setCal(await api.calendarLink(detail)), "Your calendar link is ready. Any older link stopped working.")} />
        {cal ? <>
          <Button kind="line" label="Add to my calendar" onPress={() => Linking.openURL(Platform.OS === "web" ? cal.url : cal.webcal)} />
          <Pressable onPress={() => Clipboard.setStringAsync(cal.url)} style={{ backgroundColor: C.oat, borderRadius: 12, padding: 12 }}><T testID="calendar-url" style={{ fontSize: 13 }} numberOfLines={2}>{cal.url}</T><Muted style={{ fontSize: 13 }}>Tap to copy. Keep this link private.</Muted></Pressable>
        </> : null}
        {profile.calendarOn ? <Pressable onPress={() => act(() => api.calendarOff(), "Calendar link turned off.")}><Muted style={{ textDecorationLine: "underline" }}>Turn off my calendar link</Muted></Pressable> : null}
      </Card>
      {remindersSupported ? <Card style={{ gap: 8 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Dose reminders</T><Muted style={{ fontSize: 14 }}>A reminder 15 minutes before each dose. The lock screen says only "You have a reminder."</Muted><Button kind="line" label="Turn on reminders" onPress={() => act(async () => { if (!(await askPermission())) throw new Error("Reminders are off in your phone's Settings."); }, "Reminders are on.")} /></Card> : null}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="shield" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Your data, your call</T></View>
        <Button testID="download" kind="line" label="Download my record" onPress={() => act(async () => {
          const data = await api.exportData();
          const json = JSON.stringify(data, null, 2);
          if (Platform.OS === "web") {
            const g = globalThis as unknown as { document: { createElement: (t: string) => { href: string; download: string; click: () => void } }; URL: { createObjectURL: (b: Blob) => string } };
            const a = g.document.createElement("a"); a.href = g.URL.createObjectURL(new Blob([json], { type: "application/json" })); a.download = "pumpkin-record.json"; a.click();
          } else await Share.share({ title: "My Pumpkin record", message: json });
        }, "Your record is downloaded.")} />
        <View style={{ height: 1, backgroundColor: C.line }} />
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Delete my account</T>
        <Muted style={{ fontSize: 14 }}>This deletes everything in Pumpkin: meds, results, photos, costs, and anyone you shared with. It can't be undone. Download your record first if you want a copy.</Muted>
        <Field testID="delete-confirm" label={'Type "delete" to confirm'} value={confirm} onChange={setConfirm} keyboard="email-address" />
        <Button testID="delete-account" kind="red" label={deleting ? "Deleting…" : "Delete everything"} disabled={deleting || confirm.trim().toLowerCase() !== "delete"}
          onPress={async () => { setDeleting(true); setErr(null); try { await api.deleteAccount(confirm); onSignOut(); } catch (e) { setErr((e as Error).message); setDeleting(false); } }} />
      </Card>
      <Button testID="solo-signout" kind="plain" label="Sign out" onPress={onSignOut} />
      <Muted style={{ fontSize: 12.5 }}>Pumpkin supports your care team; it doesn't replace them. In an emergency, call 911.</Muted>
    </>
  );
}

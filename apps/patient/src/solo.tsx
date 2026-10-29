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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFocusEffect, useIsFocused, useRouter, type Href } from "expo-router";
import { WebSheet } from "./websheet";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, useWindowDimensions, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { Api, auth, type CaptureInput, type ItemKind, type PendingItem, type Refill, type ResultGroup, type SignedInUser, type SoloCosts, type SoloMed, type SoloProfile, type SoloStage, type SoloToday } from "./api";
import { askPermission, onDoseAction, reminderPermission, remindersSupported, sendTestReminder, snoozeDose, syncReminders, type ReminderPermission } from "./reminders";
import { SwipeRow, tick } from "./swipe";
import { deviceName, loadPref, savePref } from "./session";
import { AppearanceCard, Button, C, ChoiceList, isDark, Cap, Card, Logo, Chip, Chips, F, H1, Icon, Muted, Pill, st, T, Today, Toggle } from "./ui";
import { Field } from "./field";
import { applyFirstRun, FirstRun, STAGES, type FirstRunAnswers } from "./firstrun";
import { DateField, niceDate, niceTime, TimeField, TimesField } from "./datefield";
import { AboutScreen, AliasScreen, QuestionIdeas, SummaryScreen, TalkScreen } from "./yours";
import { FeedbackScreen, PeopleScreen } from "./people";
import { TestBanner } from "./appinfo";
import { CalendarShareCard } from "./calshare";
import { AppLockSetting } from "./privacy";
import { ItemAction, useUndo } from "./undo";
import { addVisitToCalendar, nativeCalendar } from "./nativecal";
import { PlusMenu, type PlusItem } from "./plusmenu";
import { MedNameField } from "./medname";
import { ConsultKitScreen, nextTest, obDue, ObHandoffScreen, TestCalendarScreen, testCalendarOn } from "./kits";
import { CONSULT_BRING, OB_RECORDS } from "@kinpath/core";
import { BrushSketch, DrawCheck, DrawPumpkin, PulseOnce, RiseIn, useReduceMotion } from "./motion";

/** Set when someone has just finished signing up, so the app greets them once. */
let welcomeNext = false;
import { PRONOUNS } from "@kinpath/core";


const DEMO = typeof __DEV__ !== "undefined" && __DEV__ || process.env.EXPO_PUBLIC_DEMO === "1";
const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
const telOf = (s: string) => `tel:${s.replace(/[^\d+]/g, "")}`;
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

// ---------- shell ----------

function Frame({ children, top, tabs, inTabs }: { children: ReactNode; top?: ReactNode; tabs?: ReactNode; inTabs?: boolean }) {
  return (
    <SafeAreaView edges={inTabs ? ["left", "right"] : undefined} style={{ flex: 1, backgroundColor: C.oat }}>
      <StatusBar style={isDark() ? "light" : "dark"} />
      <View style={{ flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" }}>
        {top}
        {/* In the tabs, the floating tab bar sits over the bottom, so leave room for it on the web. */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: inTabs && Platform.OS === "web" ? 120 : 28, gap: 14 }} keyboardShouldPersistTaps="handled"><TestBanner />{children}</ScrollView>
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
function Urgent({ profile, crisis, back, api, reload }: { profile: SoloProfile | null; crisis: boolean; back: () => void; api: Api; reload: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const phone = profile?.afterHoursPhone || saved;
  const save = async () => {
    setSaving(true); setErr(null);
    try { await api.saveSoloProfile({ afterHoursPhone: typed.trim() }); setSaved(typed.trim()); void reload(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
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
          : phone
            ? <Button testID="call-after-hours" kind="red" label={`Call ${phone}`} onPress={() => Linking.openURL(telOf(phone))} />
            : (
              <View style={{ gap: 8 }}>
                <T style={{ fontFamily: F.sans600 }}>Your clinic's after-hours number is on your paperwork or their website. Add it here and the call button shows up, now and next time.</T>
                <Field testID="urgent-phone" label="Their after-hours nurse line" value={typed} onChange={setTyped} keyboard="phone-pad" placeholder="(813) 555-0100" />
                {err ? <T style={{ color: C.red }}>{err}</T> : null}
                <Button testID="urgent-phone-save" kind="esp" label={saving ? "Saving…" : "Save and show the call button"} disabled={saving || typed.replace(/\D/g, "").length < 7} onPress={save} />
              </View>
            )}
        <T style={{ fontFamily: F.sans700 }}>If you have chest pain, trouble breathing or heavy bleeding, call 911.</T>
        <Button kind="line" label="Call 911" onPress={() => Linking.openURL("tel:911")} />
      </View>
      <Button kind="line" label="Back to today" onPress={back} />
    </>
  );
}

// ---------- sign up ----------

type SignupStep = { name: "first" } | { name: "contact" } | { name: "code"; contact: string; sentTo: string } | { name: "about"; ticket: string };
export function SignupFlow({ onSignedIn, onBack }: { onSignedIn: (u: SignedInUser) => void; onBack: () => void }) {
  const [step, setStep] = useState<SignupStep>({ name: "first" });
  const [answers, setAnswers] = useState<FirstRunAnswers | null>(null);
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [preferred, setPreferred] = useState("");
  const [pronouns, setPronouns] = useState("");
  const stage = answers?.stage ?? null;
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
        <Button testID="signup-verify" label={busy ? "Checking…" : "Next: about you"} disabled={busy || code.replace(/\D/g, "").length !== 6}
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
        <Field testID="signup-clinic" label="Your clinic (optional)" value={clinic} onChange={setClinic} placeholder="e.g. Coastal Fertility" />
        <Field testID="signup-phone" label="Their after-hours nurse line (optional)" value={phone} onChange={setPhone} keyboard="phone-pad" placeholder="(813) 555-0100"
          hint="Without a nurse on Pumpkin, urgent symptoms go to this number. It's usually on your paperwork." />
        {err}
        <Button testID="signup-finish" label={busy ? "Setting up…" : "Start my record"} disabled={busy || !first.trim() || !stage}
          onPress={() => run(async () => { const u = await auth.signupFinish({ ticket: step.ticket, firstName: first, preferredName: preferred, pronouns, stage: stage!, clinicName: clinic, afterHoursPhone: phone, timeZone: zone(), device: deviceName() }); if (answers) await applyFirstRun(new Api({ token: u.token }), answers); welcomeNext = true; onSignedIn(u); })} />
      </Card>
      <Muted style={{ fontSize: 13 }}>Your record is private. You choose who sees each part, and you can download it or delete it anytime.</Muted>
    </Frame>
  );
  if (step.name === "first") return (
    <Frame><FirstRun onBack={onBack} onSave={(a) => { setAnswers(a); setStep({ name: "contact" }); }} /></Frame>
  );
  return (
    <Frame top={<Back onBack={() => setStep({ name: "first" })} />}>
      <Today size={36}>Save your record</Today>
      <Muted style={{ fontSize: 15 }}>We'll send a code to confirm it's you. We're letting people in from the waitlist a few at a time.</Muted>
      <Card style={{ gap: 10 }}>
        <Field testID="signup-contact" label="Mobile number or email" value={contact} onChange={setContact} keyboard="email-address" placeholder="you@email.com" />
        {err}
        <Button testID="signup-start" label={busy ? "Sending…" : "Send me a code"} disabled={busy || !contact.trim()}
          onPress={() => run(async () => { const r = await auth.signupStart(contact); setCode(""); setStep({ name: "code", contact, sentTo: r.sentTo }); })} />
      </Card>
    </Frame>
  );
}

// ---------- the app ----------

type Tab = "today" | "record" | "add" | "costs" | "more";
type Screen = { name: Tab } | { name: "check" } | { name: "urgent"; crisis: boolean } | { name: "say" } | { name: "type" } | { name: "by-hand"; kind: ItemKind } | { name: "original"; captureId: string; text?: string } | { name: "about" } | { name: "talk" } | { name: "alias" } | { name: "summary" } | { name: "people" } | { name: "feedback" } | { name: "edit-today" } | { name: "consult" } | { name: "tests" } | { name: "ob" };

// ---------- the app shell: shared state, and one route per screen (Expo Router) ----------

export type { Screen as SoloScreenSpec };
type Capture = { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null };
interface SoloState {
  api: Api; today: SoloToday | null; error: string | null; load: () => Promise<void>; onSignOut: () => void;
  notice: string | null; setNotice: (m: string | null) => void;
  layout: ReturnType<typeof useTodayLayout>; prefs: ReturnType<typeof useTodayPrefs>;
}
const SoloCtx = createContext<SoloState | null>(null);
export const useSolo = () => { const c = useContext(SoloCtx); if (!c) throw new Error("useSolo outside SoloProvider"); return c; };

const TAB_PATH: Record<Tab, string> = { today: "/today", record: "/record", add: "/add", costs: "/costs", more: "/you" };
/** Where each screen lives. Tabs switch; everything else is pushed (or opened as a sheet). */
export function hrefFor(s: Screen): Href {
  switch (s.name) {
    case "today": case "record": case "add": case "costs": case "more": return TAB_PATH[s.name] as Href;
    case "urgent": return { pathname: "/urgent", params: s.crisis ? { crisis: "1" } : {} } as Href;
    case "by-hand": return `/by-hand/${s.kind}` as Href;
    case "original": return { pathname: "/original/[id]", params: { id: s.captureId, ...(s.text ? { text: s.text } : {}) } } as Href;
    default: return `/${s.name}` as Href;
  }
}
const SHEETS = new Set<Screen["name"]>(["add", "say", "type", "by-hand"]);

/** Navigation that speaks in screens. `home` closes any sheets and pushed screens, then shows Today. */
export function useSoloNav() {
  const router = useRouter();
  const { setNotice, load } = useSolo();
  const go = useCallback((s: Screen) => {
    setNotice(null);
    if (s.name === "today" || s.name === "record" || s.name === "costs" || s.name === "more") { if (router.canDismiss()) router.dismissAll(); router.navigate(hrefFor(s)); }
    else router.push(hrefFor(s));
  }, [router, setNotice]);
  const home = useCallback((msg?: string, to: Screen = { name: "today" }) => {
    void load();
    if (router.canDismiss()) router.dismissAll();
    router.navigate(hrefFor(to));
    setNotice(msg ?? null);
  }, [router, load, setNotice]);
  const back = useCallback(() => { if (router.canGoBack()) router.back(); else router.navigate("/today" as Href); }, [router]);
  /** After Pumpkin reads something: urgent goes to people, items go to checking, nothing goes back to Add. */
  const afterCapture = useCallback((r: Capture) => {
    void load();
    if (router.canDismiss()) router.dismissAll();
    if (r.status === "urgent") return router.push(hrefFor({ name: "urgent", crisis: r.urgent === "crisis" }));
    if (r.items > 0) return router.push("/check" as Href);
    router.push("/add" as Href); setNotice(r.problem ?? "We didn't find anything to add.");
  }, [router, load, setNotice]);
  return { go, home, back, afterCapture };
}

export function SoloProvider({ api, onSignOut, children }: { api: Api; onSignOut: () => void; children: ReactNode }) {
  const [today, setToday] = useState<SoloToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const layout = useTodayLayout();
  const prefs = useTodayPrefs();
  const load = useCallback(async () => {
    try { const d = await api.soloToday(); setToday(d); setError(null); void syncReminders(d.reminders).catch(() => 0); }
    catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const value = useMemo(() => ({ api, today, error, load, onSignOut, notice, setNotice, layout, prefs }), [api, today, error, load, onSignOut, notice, layout, prefs]);
  return <SoloCtx.Provider value={value}>{children}<SoloEffects /></SoloCtx.Provider>;
}

/** Things that run once for the whole app: notification actions and the first-time welcome. */
function SoloEffects() {
  const { api, today, load, setNotice } = useSolo();
  const router = useRouter();
  const reduce = useReduceMotion();
  const [welcome, setWelcome] = useState(() => { const w = welcomeNext; welcomeNext = false; return w; });
  const toToday = useCallback(() => { if (router.canDismiss()) router.dismissAll(); router.navigate("/today" as Href); }, [router]);
  // Log it / Snooze tapped on a dose reminder.
  useEffect(() => onDoseAction(async (a) => {
    if (a.action === "log") {
      try { for (const id of a.doseIds) await api.logDose(id).catch(() => null); tick(); toToday(); setNotice("Logged."); } finally { void load(); }
    } else if (a.action === "snooze") {
      const at = await snoozeDose(a.doseIds, a.title, a.body);
      toToday(); setNotice(at ? `We'll remind you again at ${clock(at.toISOString())}.` : "Snoozed.");
    } else toToday();
  }), [api, load, toToday, setNotice]);
  const ready = today !== null;
  useEffect(() => { if (!welcome || !ready) return; const t = setTimeout(() => setWelcome(false), 2600); return () => clearTimeout(t); }, [welcome, ready]);
  if (!welcome || reduce || !today) return null;
  return (
    <Pressable testID="welcome" accessibilityRole="button" accessibilityLabel="Welcome to Pumpkin. Tap to continue." onPress={() => setWelcome(false)}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.oat, alignItems: "center", justifyContent: "center", gap: 18, padding: 24, zIndex: 100 }}>
      <DrawPumpkin size={150} />
      <RiseIn delay={900}><Today size={30}>{`Welcome, ${today.about.displayName}.`}</Today></RiseIn>
      <RiseIn delay={1200}><Muted style={{ fontSize: 15.5, textAlign: "center" }}>Your record is ready. It's yours to keep.</Muted></RiseIn>
    </Pressable>
  );
}

function Notice() {
  const { notice } = useSolo();
  const focused = useIsFocused(); // only the screen she's looking at shows it
  return notice && focused ? <RiseIn key={notice}><View testID="solo-notice" accessibilityLiveRegion="polite" style={{ backgroundColor: C.sage, borderRadius: 16, padding: 14 }}><T style={{ fontFamily: F.sans600, color: C.sageInk, fontSize: 15 }}>{notice}</T></View></RiseIn> : null;
}

/** The top of the tabs (drawn once by the tab layout): the logo, a calm way to get help, and Add. */
export function TabTop() {
  const { go } = useSoloNav();
  const { setNotice } = useSolo();
  const narrow = useWindowDimensions().width < 370;
  const [menu, setMenu] = useState(false);
  // Pickers must open straight from the tap (browsers block them otherwise); then the Add sheet reads it.
  const read = (pick: () => Promise<CaptureInput | null>) => { void pick().then((input) => { if (input) { pendingCapture = input; go({ name: "add" }); } }).catch((e: Error) => setNotice(e.message)); };
  const hand = (kind: ItemKind) => () => go({ name: "by-hand", kind });
  const sections: { title?: string; items: PlusItem[] }[] = [
    { title: "Pumpkin reads it for you", items: [
      { id: "camera", label: "Camera", icon: "camera", tint: [C.clay, C.clayInk], onPress: () => read(() => pickPhoto(true)) },
      { id: "photos", label: "Photos", icon: "photo", tint: [C.lav, C.lavInk], onPress: () => read(() => pickPhoto(false)) },
      { id: "pdf", label: "PDF", icon: "doc", tint: [C.sage, C.sageInk], onPress: () => read(pickPdf) },
      { id: "say", label: "Say it", icon: "message", tint: [C.softLav, C.lavInk], onPress: () => go({ name: "say" }) },
      { id: "type", label: "Type it", icon: "pen", tint: [C.oat, C.espresso], onPress: () => go({ name: "type" }) },
    ] },
    { title: "Add it yourself", items: [
      { id: "medication", label: "Medication", icon: "medication", tint: [C.lav, C.lavInk], onPress: hand("medication") },
      { id: "appointment", label: "Appointment", icon: "calendar", tint: [C.sage, C.sageInk], onPress: hand("appointment") },
      { id: "result", label: "Test result", icon: "lab", tint: [C.softLav, C.lavInk], onPress: hand("result") },
      { id: "cost", label: "Cost", icon: "wallet", tint: [C.clay, C.clayInk], onPress: hand("cost") },
      { id: "question", label: "Question", icon: "message", tint: [C.oat, C.espresso], onPress: hand("question") },
    ] },
    { items: [{ id: "more", label: "More ways to add", icon: "sliders", tint: [C.oat, C.stone], onPress: () => go({ name: "add" }) }] },
  ];
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 480, alignSelf: "center" }}>
      <Logo width={narrow ? 100 : 124} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Pressable testID="feeling-unwell" accessibilityRole="button" accessibilityLabel="Feeling unwell? Get help now" onPress={() => go({ name: "urgent", crisis: false })}
        style={{ flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 44 }}>
        <Icon name="alert" color={C.red} size={18} /><T style={{ fontFamily: F.sans600, color: C.ink, fontSize: 13.5 }}>{narrow ? "Unwell?" : "Feeling unwell?"}</T>
      </Pressable>
      <Pressable testID="solo-tab-add" accessibilityRole="button" accessibilityLabel="Add something" accessibilityState={{ expanded: menu }} onPress={() => setMenu(true)}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}>
        <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke={C.onFill} strokeWidth={2.4} strokeLinecap="round" /></Svg>
      </Pressable>
      </View>
      <PlusMenu open={menu} onClose={() => setMenu(false)} sections={sections} />
    </View>
  );
}

/** One screen of the on-your-own app, rendered by its route file. */
export function SoloScreen({ screen }: { screen: Screen }) {
  const { api, today, error, load, onSignOut, setNotice, layout: tl, prefs: tp } = useSolo();
  const { go, home, back, afterCapture } = useSoloNav();
  const sheet = SHEETS.has(screen.name);
  const tab = screen.name === "today" || screen.name === "record" || screen.name === "costs" || screen.name === "more";
  // A plain function, not a component, so screens keep their state when Today reloads.
  const shell = (children: ReactNode) => (sheet
    ? <SheetFrame onClose={back}><Notice />{children}</SheetFrame>
    : <Frame inTabs={tab} top={tab ? undefined : <Back label={screen.name === "original" ? "Back to checking" : "Back"} onBack={back} />}><Notice />{children}</Frame>);
  if (error && !today) return <Frame><Today size={32}>Can't reach Pumpkin</Today><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Frame>;
  if (!today) return <Frame inTabs={tab}><Skeleton /></Frame>;
  return shell(
    <>
      {screen.name === "today" && tl.loaded && <TodayScreen d={today} api={api} go={go} reload={load} layout={tl.layout} notice={setNotice} prefs={tp.prefs} setPrefs={tp.save} />}
      {screen.name === "edit-today" && <EditTodayScreen stage={today.profile.stage} layout={tl.layout} save={tl.save} done={() => home("Today is set up your way.")} />}
      {screen.name === "add" && <AddScreen api={api} profile={today.profile} go={go} done={afterCapture} />}
      {screen.name === "say" && <SayScreen api={api} done={afterCapture} />}
      {screen.name === "type" && <TypeScreen api={api} done={afterCapture} />}
      {screen.name === "check" && <CheckScreen api={api} go={go} done={(n) => home(n)} />}
      {screen.name === "original" && <OriginalScreen api={api} captureId={screen.captureId} text={screen.text} />}
      {screen.name === "by-hand" && <ByHandScreen api={api} kind={screen.kind} done={(msg) => home(msg, { name: screen.kind === "cost" ? "costs" : "record" })} />}
      {screen.name === "record" && <RecordScreen api={api} d={today} go={go} reload={load} />}
      {screen.name === "costs" && <CostsScreen api={api} go={go} />}
      {screen.name === "more" && <MoreScreen api={api} profile={today.profile} reload={load} onSignOut={onSignOut} go={go} />}
      {screen.name === "about" && <AboutScreen api={api} done={(m) => home(m)} />}
      {screen.name === "talk" && <TalkScreen api={api} done={(m) => home(m)} />}
      {screen.name === "alias" && <AliasScreen api={api} done={(m) => home(m, { name: "more" })} />}
      {screen.name === "summary" && <SummaryScreen api={api} />}
      {screen.name === "people" && <PeopleScreen api={api} />}
      {screen.name === "feedback" && <FeedbackScreen api={api} done={(m) => home(m, { name: "more" })} />}
      {screen.name === "consult" && <ConsultKitScreen api={api} initial={today.kit} reload={() => void load()} openTests={() => go({ name: "tests" })} openRecord={() => go({ name: "record" })}
        onUrgent={(crisis) => go({ name: "urgent", crisis })} onCapture={async (text) => { try { afterCapture(await api.capture({ kind: "text", text })); } catch (e) { setNotice((e as Error).message); } }} />}
      {screen.name === "tests" && <TestCalendarScreen api={api} initial={today.kit} reload={() => void load()} />}
      {screen.name === "ob" && <ObHandoffScreen api={api} initial={today.kit} reload={() => void load()} notice={setNotice} />}
      {screen.name === "urgent" && <Urgent profile={today.profile} crisis={screen.crisis} back={() => home()} api={api} reload={load} />}
    </>
  );
}

export const Chevron = () => <Svg width={16} height={16} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no"><Path d="M9 6l6 6-6 6" stroke={C.stone} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

/** A gray outline of a screen while it loads, so it never looks blank. */
function Skeleton() {
  const bar = (w: number | `${number}%`, h: number) => <View style={{ width: w, height: h, borderRadius: 10, backgroundColor: C.line, opacity: 0.55 }} />;
  return (
    <View testID="skeleton" accessibilityLabel="Loading" style={{ gap: 14, paddingTop: 8 }}>
      {bar("55%", 34)}{bar("35%", 16)}
      {[0, 1, 2].map((i) => <View key={i} style={[st.card, { padding: 16, gap: 10 }]}>{bar("40%", 14)}{bar("85%", 20)}{bar("60%", 14)}</View>)}
    </View>
  );
}

/**
 * A sheet: slides up over the screen it came from. On iPhone the system draws it (swipe down to close);
 * on the web it's drawn here, with a grabber to drag down, a tap outside or Escape to close.
 */
function SheetFrame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const close = (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 12, paddingTop: Platform.OS === "web" ? 0 : 12 }}>
      <Pressable testID="sheet-close" accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" }}>
        <T style={{ fontFamily: F.sans600, color: C.lavInk, fontSize: 16 }}>Cancel</T>
      </Pressable>
    </View>
  );
  const body = <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 14 }} keyboardShouldPersistTaps="handled"><TestBanner />{children}</ScrollView>;
  if (Platform.OS !== "web") return <View style={{ flex: 1, backgroundColor: C.oat }}>{close}{body}</View>;
  return <WebSheet onClose={onClose} header={close}>{body}</WebSheet>;
}


// ---------- Today: a "Right now" card, then tiles in the order she chose ----------

export type TileId = "meds" | "check" | "coming" | "numbers" | "payment" | "refill" | "add" | "yours" | "clinic" | "reminders" | "result" | "consult" | "tests" | "ob";
export const TILE_INFO: Record<TileId, { label: string; locked?: boolean }> = {
  meds: { label: "Tonight's meds", locked: true },
  reminders: { label: "Turn on reminders", locked: true },
  result: { label: "Your result", locked: true },
  check: { label: "Ready to check", locked: true },
  coming: { label: "Coming up" },
  numbers: { label: "Your latest numbers" },
  payment: { label: "Next payment" },
  refill: { label: "Refills" },
  add: { label: "Got something new?" },
  yours: { label: "Make Pumpkin yours" },
  clinic: { label: "Your clinic on Pumpkin" },
  consult: { label: "Your first-consult kit" },
  tests: { label: "Your test calendar" },
  ob: { label: "Getting ready for your OB" },
};
/** Pumpkin's starting order for each stage; she can change it in Edit Today. */
export function defaultOrder(stage: SoloStage): TileId[] {
  const base = stageOrder(stage);
  const at = base.indexOf("meds");
  return ["result", ...base.slice(0, at + 1), "reminders", ...base.slice(at + 1)];
}
function stageOrder(stage: SoloStage): TileId[] {
  switch (stage) {
    case "trying": return ["check", "coming", "add", "numbers", "yours", "payment", "meds", "refill", "clinic"];
    case "just_starting": return ["check", "consult", "tests", "coming", "add", "numbers", "payment", "yours", "meds", "refill", "clinic"];
    case "pregnant": return ["meds", "ob", "coming", "numbers", "check", "refill", "add", "payment", "yours", "clinic"];
    case "storage": return ["payment", "check", "coming", "add", "numbers", "meds", "refill", "yours", "clinic"];
    case "two_week_wait": return ["coming", "meds", "check", "add", "payment", "refill", "numbers", "yours", "clinic"];
    case "after_hard_result": return ["coming", "check", "add", "numbers", "payment", "meds", "refill", "yours", "clinic"];
    case "between_cycles": return ["check", "coming", "add", "payment", "numbers", "meds", "refill", "yours", "clinic"];
    default: return ["meds", "check", "coming", "numbers", "refill", "add", "payment", "yours", "clinic"];
  }
}
export type TodayLayout = { order: TileId[]; hidden: TileId[] };
/** Small things Today remembers on this device: the swipe tip after first use, and cards she put off. */
export type TodayPrefs = { swiped: boolean; hideUntil: Record<string, string> };
export function useTodayPrefs() {
  const [prefs, set] = useState<TodayPrefs>({ swiped: false, hideUntil: {} });
  useEffect(() => { void loadPref<TodayPrefs>("today-prefs").then((p) => { if (p) set({ swiped: !!p.swiped, hideUntil: p.hideUntil ?? {} }); }); }, []);
  const save = (p: TodayPrefs) => { set(p); void savePref("today-prefs", p); };
  return { prefs, save };
}
/** Off by default (the + Add tab does this job); she can turn it back on in Edit Today. */
const DEFAULT_HIDDEN: TileId[] = ["add"];
/** One-time setup cards: at most one on Today, only when nothing else needs her. */
const SETUP: TileId[] = ["yours", "clinic"];
const LAYOUT_KEY = "today-layout";
export function useTodayLayout() {
  const [layout, setLayout] = useState<TodayLayout | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void loadPref<TodayLayout>(LAYOUT_KEY).then((l) => { setLayout(l); setLoaded(true); }); }, []);
  const save = (l: TodayLayout | null) => { setLayout(l); void savePref(LAYOUT_KEY, l); };
  return { layout, loaded, save };
}
/** Her saved order, with any tile added since then placed where the stage default puts it. Locked tiles never hide. */
export function orderFor(stage: SoloStage, layout: TodayLayout | null): { order: TileId[]; hidden: Set<TileId> } {
  const def = defaultOrder(stage);
  if (!layout) return { order: def, hidden: new Set(DEFAULT_HIDDEN) };
  const order = layout.order.filter((t) => t in TILE_INFO);
  for (const t of def) if (!order.includes(t)) order.splice(Math.min(def.indexOf(t), order.length), 0, t);
  return { order, hidden: new Set(layout.hidden.filter((t) => !TILE_INFO[t]?.locked)) };
}

function TodayScreen({ d, api, go, reload, layout, notice, prefs, setPrefs }: { d: SoloToday; api: Api; go: (s: Screen) => void; reload: () => Promise<void>; layout: TodayLayout | null; notice: (m: string) => void; prefs: TodayPrefs; setPrefs: (p: TodayPrefs) => void }) {
  const p = d.profile;
  // The next day's doses (the next 30 hours), so the 8 pm dose stays visible after tonight's is done.
  const soon = d.schedule.upcoming.filter((x) => new Date(x.scheduledFor).getTime() - Date.now() < 30 * 3600_000);
  const missed = d.schedule.missed.filter((x) => Date.now() - new Date(x.scheduledFor).getTime() < 36 * 3600_000);
  const [logging, setLogging] = useState<string | null>(null);
  const log = async (id: string) => { setLogging(id); try { await api.logDose(id); setJustLogged(id); await reload(); } finally { setLogging(null); } };
  const snooze = async (x: { id: string; scheduledFor: string }) => {
    const at = await snoozeDose([x.id], "Dose reminder", `It's time for your ${clock(x.scheduledFor)} dose.`);
    notice(at ? `We'll remind you again at ${clock(at.toISOString())}.` : "Reminders work in the phone app.");
  };
  const hard = p.stage === "after_hard_result";
  const f = d.feel;
  const quiet = f.quiet, gentle = f.tender?.mode === "gentle";
  // No flourishes on quiet or gentle days, during a pause, in the two-week wait or after a hard result.
  const calm = quiet || !!f.tender || f.paused || f.onBreak || hard || p.stage === "two_week_wait";
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const [shown, setShown] = useState(!d.about.revealResults);
  useEffect(() => { setShown(!d.about.revealResults); }, [d.about.revealResults]);
  const [resuming, setResuming] = useState(false);
  const resume = async () => { setResuming(true); try { await api.setQuiet({ pauseDays: null, onBreak: false }); await reload(); } finally { setResuming(false); } };
  const daysTo = (ymd: string) => (Date.parse(`${ymd}T12:00:00`) - Date.now()) / 86400_000;
  const dueSoon = !!d.nextDue && (d.about.costCheckins === "always" || daysTo(d.nextDue.dueOn) <= 7);
  const refills = d.refills.filter((r) => r.daysLeft !== null && r.daysLeft <= 5);
  // Ask for notifications once there's a reminder worth ringing, then prove they work.
  const [perm, setPerm] = useState<ReminderPermission>("unsupported");
  useEffect(() => { void reminderPermission().then(setPerm).catch(() => {}); }, []);
  const turnOn = async () => {
    const ok = await askPermission();
    setPerm(ok ? "granted" : await reminderPermission());
    if (ok) { await sendTestReminder(); notice("Reminders are on. A test one will ring in a few seconds."); }
  };
  const snoozed = (k: string) => { const u = prefs.hideUntil[k]; return !!u && Date.parse(u) > Date.now(); };
  const notNow = (k: string, days = 7) => ({ label: "Not now", bg: C.oat, fg: C.stone, run: () => { setPrefs({ ...prefs, hideUntil: { ...prefs.hideUntil, [k]: new Date(Date.now() + days * 86400_000).toISOString() } }); } });

  // ----- what matters most right now -----
  const nextDose = soon.find((x) => !x.takenAt);
  const minsToDose = nextDose ? (new Date(nextDose.scheduledFor).getTime() - Date.now()) / 60000 : Infinity;
  const visit = d.appointments.find((a) => { const h = (new Date(a.startsAt).getTime() - Date.now()) / 3600_000; return h > 0 && h < 20; });
  const freshResult = d.latestResults.find((r) => daysTo(r.on) > -2);
  let nowId: TileId | null = null; let nowWhy = "";
  if (!quiet && !f.onBreak) {
    if (missed.length) { nowId = "meds"; nowWhy = "A dose isn't logged yet"; }
    else if (nextDose && minsToDose <= 180) { nowId = "meds"; nowWhy = minsToDose <= 0 ? "It's time" : `In ${minsToDose < 60 ? `${Math.max(1, Math.round(minsToDose))} min` : `${Math.round(minsToDose / 60)} h`}`; }
    else if (d.toCheck > 0 && !hard) { nowId = "check"; nowWhy = "Waiting for you to check"; }
    else if (visit) { nowId = "coming"; nowWhy = new Date(visit.startsAt).toDateString() === new Date().toDateString() ? "Today" : "Tomorrow"; }
    else if (freshResult && !hard) { nowId = "numbers"; nowWhy = "New since yesterday"; }
    else if (refills.some((r) => (r.daysLeft ?? 9) <= 2) && !hard) { nowId = "refill"; nowWhy = "Running low"; }
    else if (d.nextDue && daysTo(d.nextDue.dueOn) <= 3 && !hard && p.stage !== "two_week_wait") { nowId = "payment"; nowWhy = "Due soon"; }
  }

  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const doseRow = (x: (typeof soon)[number]) => {
    if (!isToday(x.scheduledFor) && !x.takenAt && x !== nextDose) return (
      <T key={x.id} testID={`later-${x.id}`} style={{ color: C.fillMuted, fontSize: 14.5 }}>{`Tomorrow ${clock(x.scheduledFor)} · ${x.medication} ${x.dose}`}</T>
    );
    const row = (
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 4 }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.display, fontSize: 20, color: C.onFill }}>{`${new Date(x.scheduledFor).toDateString() === new Date().toDateString() ? "" : "Tomorrow "}${clock(x.scheduledFor)}`}</T>
          <T style={{ color: C.fillMuted, fontSize: 15 }}>{`${x.medication} ${x.dose}`}</T>
          {!x.takenAt && remindersSupported && minsToDose < 24 * 60 && x === nextDose ? <Pressable testID={`snooze-${x.id}`} onPress={() => snooze(x)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><T style={{ color: C.fillMuted, fontSize: 13.5, textDecorationLine: "underline" }}>Snooze 15 min</T></Pressable> : null}
        </View>
        {!x.takenAt && (new Date(x.scheduledFor).getTime() - Date.now()) / 3600_000 > 3 ? null : x.takenAt ? (justLogged === x.id && !calm
          ? <View testID={`logged-${x.id}`} style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: C.sage, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}><DrawCheck size={18} /><T style={{ fontFamily: F.sans600, color: C.sageInk, fontSize: 13.5 }}>Done</T></View>
          : <Pill tone="sage" label="Done" />) : <Pressable testID={`log-${x.id}`} onPress={() => log(x.id)} style={{ backgroundColor: C.marigold, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" }}><T style={{ fontFamily: F.sans700, color: C.onMarigold }}>{logging === x.id ? "Saving…" : "Log it"}</T></Pressable>}
      </View>
    );
    if (x.takenAt) return <View key={x.id}>{row}</View>;
    return (
      <SwipeRow key={x.id} testID={`swipe-${x.id}`} surface={C.fill} radius={12}
        right={{ label: "Log it", bg: C.sage, fg: C.sageInk, run: async () => { await log(x.id); if (!prefs.swiped) setPrefs({ ...prefs, swiped: true }); } }}
        left={remindersSupported ? { label: "Snooze 15 min", bg: C.lav, fg: C.lavInk, run: () => snooze(x) } : undefined}>
        {row}
      </SwipeRow>
    );
  };

  // Pregnant and moved to her OB: Today stays light (meds until their last day, visits, and the OB card).
  const light = p.stage === "pregnant" && !!d.kit.ob.movedOn;
  const LIGHT_KEEP: TileId[] = ["meds", "reminders", "check", "coming", "ob"];
  const kitNext = nextTest(d.kit.tests);
  const ob = obDue(d.kit.ob);
  const kitCard = (testID: string, icon: Parameters<typeof Icon>[0]["name"], title: string, line: string, sub: string, to: Screen) => (
    <Pressable testID={testID} onPress={() => go(to)} style={[st.card, { padding: 16, gap: 6 }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name={icon} /><T style={{ fontFamily: F.display, fontSize: 20, flex: 1 }}>{title}</T></View>
      <T style={{ fontSize: 15 }}>{line}</T>
      <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{sub}</T>
    </Pressable>
  );
  const tiles: Record<TileId, ReactNode> = {
    consult: p.stage === "just_starting" && !quiet ? kitCard("consult-tile", "pen", "Your first-consult kit",
      d.kit.consult.on ? `Your consult: ${niceDate(d.kit.consult.on)}. ${d.kit.consult.bring.length} of ${CONSULT_BRING.length} things to bring are ready.` : "What a first visit covers, what to bring and your questions, in one place.",
      d.kit.consult.notes ? "Open your notes" : "Open the kit", { name: "consult" }) : null,
    tests: p.stage === "just_starting" && testCalendarOn && !quiet ? kitCard("tests-tile", "calendar", "Your test calendar",
      kitNext ? `Next: ${kitNext.test.name} · ${kitNext.text}` : "Every test is done or off your list.",
      d.kit.tests.day1 || d.kit.tests.irregular ? "See all tests" : "Add your cycle day 1 to see dates", { name: "tests" }) : null,
    ob: p.stage === "pregnant" && !hard ? (light
      ? <Pressable testID="ob-tile" onPress={() => go({ name: "ob" })} style={{ backgroundColor: C.sage, borderRadius: 22, padding: 16, gap: 4 }}><T style={{ color: C.sageInk, fontFamily: F.sans600, fontSize: 15 }}>You're with your OB now. Your record and summary stay here.</T>{ob.due ? <Muted style={{ fontSize: 13.5 }}>{`Estimated due date ${niceDate(ob.due)}`}</Muted> : null}</Pressable>
      : kitCard("ob-tile", "heart", "Getting ready for your OB",
        ob.due ? `Estimated due date ${niceDate(ob.due)}${ob.weeks ? ` · ${ob.weeks.weeks} weeks ${ob.weeks.days} days` : ""}. ${d.kit.ob.records.length} of ${OB_RECORDS.length} records ready.` : "Your due date, records to take, when meds stop, and a summary to share.",
        "Open", { name: "ob" })) : null,
    reminders: (perm === "undetermined" || perm === "denied") && d.schedule.upcoming.length > 0 && !quiet ? (
      <View testID="reminders-tile" style={[st.card, { padding: 16, gap: 8 }]}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="medication" /><T style={{ fontFamily: F.display, fontSize: 20 }}>Get a reminder for each dose</T></View>
        <T style={{ fontSize: 15 }}>{perm === "denied" ? "Reminders are off for Pumpkin. Turn them on in your phone's Settings, under Pumpkin." : "15 minutes before each dose. The lock screen only says \"You have a reminder.\" We'll send a test so you know it works."}</T>
        {perm === "undetermined" ? <Button testID="reminders-on" kind="esp" label="Turn on reminders" onPress={() => void turnOn()} /> : null}
      </View>
    ) : null,
    result: p.stage === "two_week_wait" && !f.onBreak ? <ResultTile api={api} reveal={d.about.revealResults} reload={reload} go={go} notice={notice} /> : null,
    meds: soon.length > 0 || missed.length > 0 ? (
      <View style={[st.dark, { gap: 12 }]}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="medication" color={C.marigoldOnFill} /><T style={{ fontFamily: F.sans700, color: C.marigoldOnFill, fontSize: 13, letterSpacing: 0.6 }}>MEDS</T></View>
        {missed.map((x) => (
          <View key={x.id} style={{ gap: 6 }}>
            <T style={{ color: C.onFill, fontSize: 15.5 }}>{`${x.medication} ${x.dose} · was due ${clock(x.scheduledFor)}`}</T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID={`late-${x.id}`} onPress={() => log(x.id)} style={{ backgroundColor: C.onFill, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}><T style={{ fontFamily: F.sans700, color: C.fill }}>{logging === x.id ? "Saving…" : "I took it"}</T></Pressable>
              {p.afterHoursPhone ? <Pressable onPress={() => Linking.openURL(telOf(p.afterHoursPhone!))} style={{ borderColor: C.onFill, borderWidth: 1.5, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}><T style={{ fontFamily: F.sans600, color: C.onFill }}>Not sure? Call your clinic</T></Pressable> : null}
            </View>
          </View>
        ))}
        {soon.map(doseRow)}
        {nextDose && !calm && !prefs.swiped ? <T style={{ fontSize: 12.5, color: C.fillMuted }}>{remindersSupported ? "Tip: swipe right to log, left to snooze." : "Tip: swipe right to log."}</T> : null}
      </View>
    ) : null,
    check: d.toCheck > 0 && !quiet ? (
      <Pressable testID="to-check" onPress={() => go({ name: "check" })} style={{ backgroundColor: C.lav, borderRadius: 22, padding: 18, gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="check" color={C.lavInk} /><T style={{ fontFamily: F.sans700, color: C.lavInk, fontSize: 13, letterSpacing: 0.6 }}>READY TO CHECK</T></View>
        <T style={{ fontFamily: F.display, fontSize: 22, lineHeight: 26 }}>{d.toCheck === 1 ? "1 thing Pumpkin read for you" : `${d.toCheck} things Pumpkin read for you`}</T>
      </Pressable>
    ) : null,
    coming: d.appointments.length > 0 ? (
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="calendar" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>COMING UP</T></View>
        {d.appointments.slice(0, 2).map((a) => <View key={a.id}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{a.title}</T><Muted style={{ fontSize: 14 }}>{`${when(a.startsAt)}${a.location ? ` · ${a.location}` : ""}`}</Muted></View>)}
        {d.openQuestions > 0 ? <Pressable onPress={() => go({ name: "record" })}><T style={{ color: C.lavInk, fontFamily: F.sans600, paddingVertical: 6 }}>{`${d.openQuestions} question${d.openQuestions === 1 ? "" : "s"} to ask at your visit`}</T></Pressable> : null}
        {nowId === "coming" ? <Button testID="now-summary" kind="line" label="Open my visit summary" onPress={() => go({ name: "summary" })} /> : null}
      </Card>
    ) : null,
    numbers: d.latestResults.length > 0 && !quiet ? (shown ? (
      <Pressable onPress={() => go({ name: "record" })} style={[st.card, { padding: 16, gap: 8 }]}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="lab" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR LATEST NUMBERS</T></View>
        {d.latestResults.map((r) => <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}><T numberOfLines={1} style={{ fontSize: 15, flex: 1 }}>{r.name.split(" (")[0]!}</T><T numberOfLines={1} style={{ fontFamily: F.sans600, fontSize: 15 }}>{`${r.value} ${r.unit}`}<T style={{ fontSize: 13, color: C.stone }}>{` · ${new Date(`${r.on}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}</T></T></View>)}
        <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>See what each test measures</T>
      </Pressable>
    ) : (
      <Pressable testID="reveal-results" onPress={() => setShown(true)} style={[st.card, { padding: 16, gap: 6 }]}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="lab" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR NUMBERS</T></View>
        <T style={{ fontSize: 15.5 }}>Your latest numbers are here when you're ready.</T>
        <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Show me</T>
      </Pressable>
    )) : null,
    payment: d.nextDue && dueSoon && !quiet && !hard && p.stage !== "two_week_wait" ? (
      <Pressable testID="next-payment" onPress={() => go({ name: "costs" })} style={{ backgroundColor: C.clay, borderRadius: 22, padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}><View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="wallet" color={C.clayInk} /><T style={{ fontFamily: F.sans700, color: C.clayInk, fontSize: 13, letterSpacing: 0.6 }}>NEXT PAYMENT</T></View><T style={{ fontSize: 15 }}>{`Due ${dayLabel(d.nextDue.dueOn)}`}</T></View>
        <T style={{ fontFamily: F.display, fontSize: 26 }}>{money(d.nextDue.amountCents)}</T>
      </Pressable>
    ) : null,
    refill: refills.length > 0 && !quiet ? <RefillTile refills={refills} go={go} /> : null,
    add: !quiet ? (
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="pen" /><T style={{ fontFamily: F.display, fontSize: 21 }}>Got something new?</T></View>
        <T style={{ fontSize: 15, lineHeight: 21 }}>Snap your med calendar, a lab report or a payment plan. Or just say it. Pumpkin sorts it out, and you check it.</T>
        <Button testID="today-add" kind="esp" label="Add something" onPress={() => go({ name: "add" })} />
      </Card>
    ) : null,
    yours: d.about.stepsLeft.length > 0 && !quiet && !gentle && !hard && !snoozed("yours") ? (
      <SwipeRow surface={C.paper} radius={22} right={notNow("yours")} left={notNow("yours")}>
        <View style={[st.card, { padding: 16, gap: 6 }]}>
          <Pressable testID="make-yours" onPress={() => go({ name: "about" })} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="heart" /><T style={{ fontFamily: F.display, fontSize: 20 }}>Make Pumpkin yours</T></View>
            <T style={{ fontSize: 15 }}>{d.about.stepsLeft.includes("name") ? "Tell us what to call you, and a little about how you're building your family. One question at a time." : "A few optional questions so Pumpkin talks to you the way you'd like."}</T>
            <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{`${5 - d.about.stepsLeft.length} of 5 done`}</T>
          </Pressable>
          <Pressable testID="yours-not-now" onPress={() => void notNow("yours").run()} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}><Muted style={{ fontSize: 13.5, textDecorationLine: "underline" }}>Not now</Muted></Pressable>
        </View>
      </SwipeRow>
    ) : null,
    clinic: quiet || gentle || hard ? null : !p.askedClinicAt ? (snoozed("clinic") ? null : <AskClinicCard api={api} profile={p} reload={reload} onNotNow={() => void notNow("clinic").run()} />)
      : Date.now() - new Date(p.askedClinicAt).getTime() < 24 * 3600_000 && !snoozed("clinicSent") ? (
      // The confirmation shows for a day, then lives in Settings. Swipe it away sooner.
      <SwipeRow surface={C.sage} radius={22} right={notNow("clinicSent", 3650)} left={notNow("clinicSent", 3650)}>
        <View testID="clinic-sent" style={{ backgroundColor: C.sage, borderRadius: 22, padding: 16, gap: 4 }}><T style={{ color: C.sageInk, fontFamily: F.sans600, fontSize: 15 }}>{`You asked ${p.clinicName ?? "your clinic"} to join. When they do, your nurse can see what you've logged, if you choose to share it.`}</T><Muted style={{ fontSize: 12.5 }}>Swipe to clear. It's in Settings too.</Muted></View>
      </SwipeRow>
    ) : null,
  };
  const { order, hidden } = orderFor(p.stage, layout);
  const shownTiles = order.filter((t) => t !== nowId && !hidden.has(t) && tiles[t] && (!light || LIGHT_KEEP.includes(t)));
  // Setup cards: one at a time, and only on a day nothing else needs her (a sent-clinic note shows for its one day).
  const setupOk = (t: TileId) => (t === "clinic" && !!p.askedClinicAt) || (!nowId && !missed.length && d.toCheck === 0);
  const firstSetup = shownTiles.find((t) => SETUP.includes(t) && setupOk(t));
  const rest = shownTiles.filter((t) => !SETUP.includes(t) || t === firstSetup);

  return (
    <>
      <View style={{ gap: 6 }}>
        <Text testID="greeting" accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 34, lineHeight: 37, letterSpacing: -1, color: C.espresso }}>{`Hi, ${d.about.displayName}.`}</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Muted style={{ fontSize: 15 }}>{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</Muted>
          <PulseOnce still={calm}><Pill tone="lav" label={p.stageLabel} /></PulseOnce>
          <View style={{ flex: 1 }} />
          {!quiet ? <Pressable testID="edit-today" accessibilityRole="button" accessibilityLabel="Edit Today" onPress={() => go({ name: "edit-today" })} style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}><T style={{ color: C.lavInk, fontFamily: F.sans600, fontSize: 15.5 }}>Edit</T></Pressable> : null}
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

      {nowId && tiles[nowId] && (!light || LIGHT_KEEP.includes(nowId)) ? (
        <View testID="now" style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.marigold }} />
            <T testID="now-why" style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6, color: C.stone }}>{`RIGHT NOW · ${nowWhy.toUpperCase()}`}</T>
          </View>
          {tiles[nowId]}
        </View>
      ) : null}
      {rest.map((t) => <View key={t} testID={`tile-${t}`}>{tiles[t]}</View>)}
    </>
  );
}

/**
 * In the two-week wait: how she wants to see her result, and a place to tell Pumpkin when she has it.
 * A negative offers quiet mode and a positive offers the next stage; neither happens without her say.
 */
function ResultTile({ api, reveal, reload, go, notice }: { api: Api; reveal: boolean; reload: () => Promise<void>; go: (s: Screen) => void; notice: (m: string) => void }) {
  const [said, setSaid] = useState<"positive" | "negative" | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); await reload(); notice(msg); } finally { setBusy(false); } };
  if (said === "negative") return (
    <View testID="result-negative" style={{ backgroundColor: C.lav, borderRadius: 22, padding: 18, gap: 10 }}>
      <T style={{ fontFamily: F.display, fontSize: 22, lineHeight: 26 }}>We're so sorry.</T>
      <T style={{ fontSize: 15, lineHeight: 21 }}>You don't have to decide anything today. Want Pumpkin to keep things quiet for a while? Only what you need will show.</T>
      <T style={{ fontSize: 13.5, color: C.lavInk }}>Keep taking any medication until your clinic tells you to stop. Your reminders stay on.</T>
      <Button testID="quiet-yes" kind="esp" label={busy ? "One moment…" : "Yes, keep things quiet"} disabled={busy} onPress={() => act(() => api.saveSoloProfile({ stage: "after_hard_result" }), "Pumpkin will keep things quiet.")} />
      <Button kind="plain" label="Not now" onPress={() => setSaid(null)} />
    </View>
  );
  if (said === "positive") return (
    <View testID="result-positive" style={{ backgroundColor: C.sage, borderRadius: 22, padding: 18, gap: 10 }}>
      <T style={{ fontFamily: F.display, fontSize: 22, lineHeight: 26, color: C.sageInk }}>Your test is positive.</T>
      <T style={{ fontSize: 15, lineHeight: 21 }}>Your clinic will usually repeat it to confirm. Pumpkin can switch to early scans and getting ready for your OB, whenever you like.</T>
      <Button testID="pregnant-yes" kind="esp" label={busy ? "One moment…" : "Switch to Pregnant after treatment"} disabled={busy} onPress={() => act(() => api.saveSoloProfile({ stage: "pregnant" }), "Switched to Pregnant after treatment.")} />
      <Button kind="plain" label="Not yet" onPress={() => setSaid(null)} />
    </View>
  );
  return (
    <View testID="result-tile" style={[st.card, { padding: 16, gap: 10 }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="lab" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR RESULT</T></View>
      <T style={{ fontSize: 15 }}>When a result is added to Pumpkin:</T>
      <Chips>
        <Chip testID="reveal-now" label="Show it right away" selected={!reveal} onPress={() => void act(() => api.saveAbout({ revealResults: false }), "Results will show right away.")} />
        <Chip testID="reveal-tap" label="Wait until I tap" selected={reveal} onPress={() => void act(() => api.saveAbout({ revealResults: true }), "Results will wait until you tap.")} />
      </Chips>
      <Pressable onPress={() => go({ name: "people" })} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Choose who else sees it</T></Pressable>
      <View style={{ borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: 10, gap: 8 }}>
        <T style={{ fontSize: 15 }}>Have your result? Tell Pumpkin when you're ready, and it will adjust what you see.</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button testID="said-positive" kind="line" label="Positive" onPress={() => setSaid("positive")} /></View>
          <View style={{ flex: 1 }}><Button testID="said-negative" kind="line" label="Negative" onPress={() => setSaid("negative")} /></View>
        </View>
      </View>
    </View>
  );
}

/** Reorder, hide and show the tiles on Today. Tonight's meds and things to check always stay. */
function EditTodayScreen({ stage, layout, save, done }: { stage: SoloStage; layout: TodayLayout | null; save: (l: TodayLayout | null) => void; done: () => void }) {
  const cur = orderFor(stage, layout);
  cur.order = cur.order.filter((t) => t !== "reminders" && t !== "result");
  const [order, setOrder] = useState<TileId[]>(cur.order);
  const [hidden, setHidden] = useState<Set<TileId>>(cur.hidden);
  const move = (i: number, by: number) => setOrder((o) => { const n = [...o]; const j = i + by; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const arrow = (dir: "up" | "down", onPress: () => void, disabled: boolean, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <Svg width={16} height={16} viewBox="0 0 24 24"><Path d={dir === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} stroke={C.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </Pressable>
  );
  return (
    <>
      <Today size={34}>Edit Today</Today>
      <Muted style={{ fontSize: 15 }}>Put what matters most to you at the top. Whatever needs you right now still shows first, and the urgent help button is always there.</Muted>
      <Card pad={false}>
        {order.map((t, i) => {
          const info = TILE_INFO[t]; const off = hidden.has(t);
          return (
            <View key={t} testID={`edit-${t}`} style={[st.row, i === 0 && { borderTopWidth: 0 }, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: F.sans600, fontSize: 15, color: off ? C.stone : C.ink }}>{info.label}</T>
                {info.locked ? <Muted style={{ fontSize: 12.5 }}>Always shown</Muted> : null}
              </View>
              {info.locked ? null : <Toggle testID={`show-${t}`} value={!off} onChange={(v) => setHidden((h) => { const n = new Set(h); if (v) n.delete(t); else n.add(t); return n; })} />}
              {arrow("up", () => move(i, -1), i === 0, `Move ${info.label} up`)}
              {arrow("down", () => move(i, 1), i === order.length - 1, `Move ${info.label} down`)}
            </View>
          );
        })}
      </Card>
      <Button testID="edit-save" kind="esp" label="Save" onPress={() => { save({ order, hidden: [...hidden] }); done(); }} />
      <Button testID="edit-reset" kind="plain" label="Go back to Pumpkin's order" onPress={() => { save(null); done(); }} />
    </>
  );
}

// ---------- refills ----------

const refillLine = (r: Refill) => r.dosesLeft === null ? "Not counted yet"
  : r.enough ? `${r.dosesLeft} left. Enough to finish this medication.`
  : r.daysLeft !== null && r.daysLeft <= 1 ? `${r.dosesLeft} left. Runs out ${niceDate(r.runOutOn!)}. Order today.`
  : `${r.dosesLeft} left. Order more by ${niceDate(r.orderBy!)}.`;

/** On Today when something runs out within 5 days. Counting only; her pharmacy and nurse handle the rest. */
function RefillTile({ refills, go }: { refills: Refill[]; go: (s: Screen) => void }) {
  return (
    <Pressable testID="refill-tile" onPress={() => go({ name: "record" })} style={[st.card, { padding: 16, gap: 8 }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="medication" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>REFILLS</T></View>
      {refills.map((r) => <View key={r.medication}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{r.medication}</T><Muted style={{ fontSize: 14.5 }}>{refillLine(r)}</Muted></View>)}
      <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Update my counts</T>
    </Pressable>
  );
}

/** In her record: how many doses she has of each medication, so Pumpkin can say when to reorder. */
function SupplyCard({ api, refills, reload }: { api: Api; refills: Refill[]; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [n, setN] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async (med: string, doses: number | null) => { setErr(null); try { await api.setSupply(med, doses); setEdit(null); await reload(); } catch (e) { setErr((e as Error).message); } };
  return (
    <View testID="supply" style={[st.card, { padding: 14, gap: 10 }]}>
      <T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>How much do you have?</T>
      <Muted style={{ fontSize: 13.5 }}>Count doses, not boxes. Pumpkin subtracts each one you log and tells you when to reorder.</Muted>
      {refills.map((r) => (
        <View key={r.medication} style={{ gap: 6, borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{r.medication}</T><Muted style={{ fontSize: 13.5 }}>{refillLine(r)}</Muted></View>
            {edit === r.medication ? null : <Pressable testID={`count-${r.medication}`} onPress={() => { setEdit(r.medication); setN(r.dosesLeft === null ? "" : String(r.dosesLeft)); }} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{r.dosesLeft === null ? "Count" : "Update"}</T></Pressable>}
          </View>
          {edit === r.medication ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
              <View style={{ flex: 1 }}><Field testID="supply-count" label="Doses on hand" value={n} onChange={setN} keyboard="numeric" placeholder="6" /></View>
              <View style={{ width: 96 }}><Button testID="supply-save" kind="esp" label="Save" disabled={!/^\d{1,4}$/.test(n.trim())} onPress={() => save(r.medication, Number(n.trim()))} /></View>
            </View>
          ) : null}
        </View>
      ))}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
    </View>
  );
}

function AskClinicCard({ api, profile, reload, onNotNow }: { api: Api; profile: SoloProfile; reload: () => Promise<void>; onNotNow?: () => void }) {
  const [name, setName] = useState(profile.clinicName ?? "");
  const [phone, setPhone] = useState(profile.afterHoursPhone ?? "");
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
      {profile.afterHoursPhone ? null : <Field testID="ask-clinic-phone" label="Their after-hours nurse line (optional)" value={phone} onChange={setPhone} keyboard="phone-pad" placeholder="(813) 555-0100" hint="If something's urgent, Pumpkin shows a button to call it." />}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <Button testID="ask-clinic" kind="esp" label={busy ? "Sending…" : "Ask my clinic to join"} disabled={busy || name.trim().length < 2}
        onPress={async () => { setBusy(true); setErr(null); try { const r = await api.askMyClinic(name); if (!profile.afterHoursPhone && phone.trim()) await api.saveSoloProfile({ afterHoursPhone: phone.trim() }); setShare(r.shareText); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} />
      {onNotNow ? <Pressable testID="clinic-not-now" onPress={onNotNow} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}><Muted style={{ fontSize: 13.5, textDecorationLine: "underline" }}>Not now</Muted></Pressable> : null}
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

/** Take or choose a photo (a med calendar, a lab report, a medicine bottle). Null if she cancels. */
export async function pickPhoto(camera: boolean): Promise<CaptureInput | null> {
  if (camera && Platform.OS !== "web") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Pumpkin needs camera access to take a photo. You can turn it on in your phone's Settings, or choose a photo instead.");
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.7, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible, cameraType: ImagePicker.CameraType.back };
  // On a phone's browser, the camera option opens the camera directly.
  const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const base64 = a.base64 ?? (a.uri.startsWith("data:") ? a.uri.replace(/^data:[^,]*,/, "") : await blobToBase64(a.uri));
  const mime = a.mimeType && a.mimeType !== "image/heic" ? a.mimeType : "image/jpeg";
  return { kind: "photo", mime, base64, filename: a.fileName ?? "Photo" };
}
export async function pickPdf(): Promise<CaptureInput | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { kind: "pdf", mime: "application/pdf", base64: await blobToBase64(a.uri), filename: a.name };
}
/** A photo or PDF picked from the + menu, waiting for the Add sheet to read it. */
let pendingCapture: CaptureInput | null = null;

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
  const photo = (camera: boolean) => send("photo", () => pickPhoto(camera));
  const pdf = () => send("pdf", pickPdf);
  // Something picked from the + menu: read it now, with the reading state showing here.
  useEffect(() => { const p = pendingCapture; pendingCapture = null; if (p) void send(p.kind === "pdf" ? "pdf" : "photo", async () => p); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      <View style={{ backgroundColor: C.softLav, borderRadius: 16, padding: 14, gap: 2 }}>
        <T style={{ fontFamily: F.sans600, color: C.lavDeep, fontSize: 15 }}>Got a meds calendar from your clinic?</T>
        <T style={{ color: C.lavDeep, fontSize: 14 }}>Snap it. Pumpkin sets up every dose, dose change and reminder for you to check.</T>
      </View>
      {profile.aiReads.on && profile.aiReads.limit !== null ? (
        <View testID="ai-reads" style={{ backgroundColor: profile.aiReads.left === 0 ? C.clay : C.oat, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.line }}>
          <T style={{ fontFamily: F.sans600, fontSize: 14.5, color: profile.aiReads.left === 0 ? C.clayInk : C.espresso }}>{profile.aiReads.left === 0
            ? `You've used your ${profile.aiReads.limit} free reads this month. They start again on the 1st.`
            : `${profile.aiReads.left} of ${profile.aiReads.limit} free reads left this month.`}</T>
          <Muted style={{ fontSize: 13 }}>{profile.aiReads.left === 0 ? "Typed and spoken notes still work, and you can always add things by hand." : "Each thing Pumpkin reads for you uses one. Samples don't."}</Muted>
        </View>
      ) : null}
      {busy ? <View style={{ backgroundColor: C.lav, borderRadius: 16, padding: 14, flexDirection: "row", gap: 10, alignItems: "center" }}><BrushSketch /><T style={{ color: C.lavInk, fontFamily: F.sans600, flex: 1 }}>Reading it now. This can take a few seconds.</T></View> : null}
      {error ? <T testID="add-error" style={{ color: C.red, fontSize: 15 }}>{error}</T> : null}
      {Platform.OS !== "web" ? <Option id="camera" icon="doc" title="Take a photo" sub="Your meds calendar, lab reports, receipts" onPress={() => photo(true)} /> : null}
      <Option id="photo" icon="doc" title={Platform.OS === "web" ? "Upload a photo or screenshot" : "Choose a photo or screenshot"} sub="A portal screenshot works too" onPress={() => photo(false)} />
      <Option id="pdf" icon="doc" title="Upload a PDF" sub="Lab results, payment plans, consent packets" onPress={pdf} />
      <Option id="say" icon="message" title="Say it" sub={'"Gonal-f 225 at 8 tonight, starting tomorrow"'} onPress={() => go({ name: "say" })} />
      <Option id="type" icon="pen" title="Type it" sub="A quick note, a number, a question" onPress={() => go({ name: "type" })} />
      <View testID="add-yourself" style={{ gap: 8 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Or add it yourself</T>
        <Chips>
          {([["appointment", "Appointment"], ["medication", "Medication"], ["result", "Test result"], ["cost", "Cost"], ["question", "Question"]] as [ItemKind, string][]).map(([k, label]) => (
            <Chip key={k} testID={`add-hand-${k}`} label={label} onPress={() => go({ name: "by-hand", kind: k })} />
          ))}
        </Chips>
      </View>
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

type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechRec = {
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; onstart: (() => void) | null;
  interimResults: boolean; continuous: boolean; lang: string;
};
const IOS_WEB = Platform.OS === "web" && typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
/**
 * The browser's speech recognition, where it works well. Not in an iPhone home-screen web app,
 * where Safari's version can hang after the microphone prompt; the keyboard's microphone works there.
 */
function speech(): (new () => SpeechRec) | null {
  if (Platform.OS !== "web") return null;
  const w = globalThis as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec; navigator?: { standalone?: boolean }; matchMedia?: (q: string) => { matches: boolean } };
  const standalone = w.navigator?.standalone === true || !!w.matchMedia?.("(display-mode: standalone)").matches;
  if (standalone && IOS_WEB) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed": "Pumpkin can't use the microphone. Allow it in your browser settings, or use the microphone on your keyboard.",
  "service-not-allowed": "Speech isn't available in this browser. Use the microphone on your keyboard instead.",
  "no-speech": "We didn't hear anything. Tap Start talking and try again.",
  "audio-capture": "We couldn't find a microphone. Use the microphone on your keyboard instead.",
  "network": "Speech needs an internet connection. Use the microphone on your keyboard instead.",
};

function SayScreen({ api, done }: { api: Api; done: (r: { status: string; urgent: "urgent" | "crisis" | null; items: number; problem: string | null }) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [Rec, setRec] = useState(speech);
  const rec = useRef<SpeechRec | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const clearWatch = () => { if (watchdog.current) clearTimeout(watchdog.current); watchdog.current = null; };
  const stop = () => { clearWatch(); const r = rec.current; rec.current = null; setListening(false); try { r?.stop(); } catch { /* already stopped */ } };
  // Never leave the microphone running after she leaves the screen.
  useEffect(() => () => { clearWatch(); try { rec.current?.abort(); } catch { /* ignore */ } if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const listen = () => {
    if (!Rec) return;
    setError(null);
    let r: SpeechRec;
    try { r = new Rec(); } catch { setRec(null); return; }
    r.lang = "en-US"; r.interimResults = true;
    // Continuous listening is unreliable in Safari; there each tap captures one stretch of speech.
    r.continuous = !IOS_WEB;
    const base = text ? `${text.trim()}\n` : "";
    let finals = ""; let latest = "";
    r.onstart = () => clearWatch();
    r.onresult = (e) => {
      clearWatch();
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]!; if (x.isFinal) finals += `${x[0]!.transcript} `; else interim += x[0]!.transcript; }
      latest = base + `${finals}${interim}`.trim();
      // One update per frame, so a fast stream of words can't lock up the screen.
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setText(latest); });
    };
    r.onerror = (e) => { if (e.error !== "aborted") setError(SPEECH_ERRORS[e.error] ?? "Speech stopped. Use the microphone on your keyboard instead."); if (e.error === "service-not-allowed") setRec(null); stop(); };
    r.onend = () => { clearWatch(); if (rec.current === r) { rec.current = null; setListening(false); } };
    rec.current = r; setListening(true);
    try { r.start(); } catch { stop(); setError("Speech didn't start. Use the microphone on your keyboard instead."); return; }
    // If nothing starts within 8 seconds of the microphone prompt, let go so the screen never sticks.
    watchdog.current = setTimeout(() => { stop(); setError("Speech didn't start. Use the microphone on your keyboard instead."); }, 8000);
  };
  return (
    <>
      <Today size={34}>Say it</Today>
      <Muted style={{ fontSize: 15 }}>{Rec ? "Tap Start talking and say it like you'd tell a friend. One thing per sentence works best." : "Tap the microphone on your keyboard and talk. One thing per sentence works best."}</Muted>
      <Card style={{ gap: 10 }}>
        {Rec ? <Button testID="say-start" kind={listening ? "line" : "esp"} label={listening ? "Stop" : "Start talking"} onPress={() => (listening ? stop() : listen())} /> : null}
        <TextInput testID="say-text" value={text} onChangeText={setText} multiline placeholder={"Menopur 75 units at 8 pm starting tomorrow.\nBlood work Thursday at 7:30 am."} placeholderTextColor={C.stone} style={[st.input, { minHeight: 140, fontSize: 16, borderColor: C.espresso }]} />
        {error ? <T style={{ color: C.red }}>{error}</T> : null}
        <Button testID="say-send" label={busy ? "Reading…" : "Sort it out"} disabled={busy || !text.trim()} onPress={async () => { stop(); setBusy(true); setError(null); try { done(await api.capture({ kind: "voice", text })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />
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
const KIND_TINT = (): Record<ItemKind, [string, string]> => ({ medication: [C.lav, C.lavInk], result: [C.lav, C.lavInk], appointment: [C.oat, C.espresso], cost: [C.clay, C.clayInk], question: [C.sage, C.sageInk] });
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
      <ScheduleSummary items={items} />
      {saved > 0 ? <RiseIn key={saved}><View style={{ backgroundColor: C.sage, borderRadius: 14, padding: 12, flexDirection: "row", gap: 8, alignItems: "center" }}><DrawCheck size={18} /><T style={{ fontFamily: F.sans600, color: C.sageInk }}>{saved === 1 ? "Added to your record." : `${saved} added to your record.`}</T></View></RiseIn> : null}
      {items.map((it) => <ItemCard key={it.id} item={it} api={api} go={go} onDone={(kept) => { if (kept) setSaved((n) => n + 1); setItems((xs) => xs!.filter((x) => x.id !== it.id)); }} />)}
    </>
  );
}

/** When a meds calendar comes in: the whole schedule at a glance before she checks each piece. */
function ScheduleSummary({ items }: { items: PendingItem[] }) {
  const d = (k: string, x: PendingItem) => (typeof x.data[k] === "string" ? (x.data[k] as string) : "");
  const meds = items.filter((i) => i.kind === "medication").sort((x, y) => (d("startsOn", x) || "9").localeCompare(d("startsOn", y) || "9") || d("name", x).localeCompare(d("name", y)));
  if (meds.length < 2) return null;
  const days = meds.flatMap((m) => [d("startsOn", m), d("endsOn", m)]).filter(Boolean).sort();
  const visits = items.filter((i) => i.kind === "appointment").length;
  return (
    <View testID="schedule-summary" style={[st.card, { padding: 16, gap: 10 }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="calendar" /><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>YOUR SCHEDULE</T></View>
      <T style={{ fontSize: 15 }}>{`${meds.length} medication steps${days.length ? `, ${niceDate(days[0]!)} to ${niceDate(days[days.length - 1]!)}` : ""}${visits ? `, and ${visits} visit${visits === 1 ? "" : "s"}` : ""}. Once you add them, every dose gets a reminder.`}</T>
      {meds.map((m) => (
        <View key={m.id} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: C.lavInk }} />
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.sans600, fontSize: 14.5 }}>{`${d("name", m)} ${d("dose", m)}`}</T>
            <Muted style={{ fontSize: 13.5 }}>{[((m.data.times as string[] | undefined) ?? []).map(niceTime).join(", "), d("startsOn", m) ? (d("startsOn", m) === d("endsOn", m) ? niceDate(d("startsOn", m)) : `${niceDate(d("startsOn", m))} to ${d("endsOn", m) ? niceDate(d("endsOn", m)) : "?"}`) : "Dates to check"].filter(Boolean).join(" · ")}</Muted>
          </View>
        </View>
      ))}
    </View>
  );
}

function ItemCard({ item, api, go, onDone }: { item: PendingItem; api: Api; go: (s: Screen) => void; onDone: (kept: boolean) => void }) {
  const [data, setData] = useState<Record<string, unknown>>(item.data);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bg, fg] = KIND_TINT()[item.kind];
  const from = item.source.kind === "sample" ? "Sample document" : item.source.kind === "email" ? `Email${item.source.filename ? `: ${item.source.filename}` : ""}` : item.source.kind === "voice" ? "What you said" : item.source.kind === "text" ? "What you typed" : item.source.filename ?? "Your photo";
  return (
    <View testID={`item-${item.kind}`} style={[st.card, { overflow: "hidden" }]}>
      <View style={{ backgroundColor: bg, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1 }}><Icon name={KIND_ICON[item.kind]} color={fg} /><T style={{ fontFamily: F.sans700, color: fg, fontSize: 14 }}>{KIND_LABEL[item.kind]}</T></View>
        {item.source.hasFile || item.source.kind !== "sample" ? (
          <Pressable onPress={() => go({ name: "original", captureId: item.captureId })} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: fg, fontFamily: F.sans600, textDecorationLine: "underline", fontSize: 13.5 }}>See original</T></Pressable>
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
      <MedNameField testID="f-name" label="Medication" value={s("name")} onChange={(v) => set("name", v)} check={chk("name")} />
      <Field testID="f-dose" label="Dose" value={s("dose")} onChange={(v) => set("dose", v)} check={chk("dose")} placeholder="e.g. 225 IU" />
      <TimesField testID="f-times" label="Time each day" value={Array.isArray(data.times) ? (data.times as string[]) : []} onChange={(v) => set("times", v)} check={chk("times") || !(data.times as string[] | undefined)?.length} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><DateField testID="f-start" label="First day" value={s("startsOn")} onChange={(v) => set("startsOn", v)} check={chk("startsOn")} /></View>
        <View style={{ flex: 1 }}><DateField testID="f-end" label="Last day" value={s("endsOn")} onChange={(v) => set("endsOn", v)} check={chk("endsOn")} /></View>
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
      <DateField testID="f-on" label="Date of the test" value={s("collectedOn")} onChange={(v) => set("collectedOn", v)} check={chk("collectedOn")} />
      <Field label="Lab's reference range (as printed)" value={s("refText")} onChange={(v) => set("refText", v)} check={chk("refText")} placeholder="Optional, e.g. 27-433 pg/mL" />
    </>
  );
  if (kind === "appointment") {
    const [d, t] = s("startsAt").split("T");
    return (
      <>
        <Field testID="f-title" label="What it's for" value={s("title")} onChange={(v) => set("title", v)} check={chk("title")} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><DateField testID="f-date" label="Date" value={d ?? ""} onChange={(v) => set("startsAt", `${v}T${t ?? ""}`)} check={chk("startsAt")} /></View>
          <View style={{ flex: 1 }}><TimeField testID="f-time" label="Time" value={t ?? ""} onChange={(v) => set("startsAt", `${d ?? ""}T${v}`)} check={chk("startsAt")} /></View>
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
          <View style={{ flex: 1 }}><DateField testID="f-date" label={payment ? "Date paid" : "Date of the bill"} value={s("date")} onChange={(v) => set("date", v)} check={chk("date")} /></View>
          {!payment ? <View style={{ flex: 1 }}><DateField testID="f-due" label="Due" value={s("dueOn")} onChange={(v) => set("dueOn", v)} /></View> : null}
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
  const [saved, setSaved] = useState(false);
  // After a visit: offer to put visits on someone else's calendar too.
  if (saved) return (
    <>
      <Today size={32}>Visit saved</Today>
      <Muted style={{ fontSize: 15 }}>It's in your record and on Today. If you've linked your own calendar, it shows up there too.</Muted>
      <CalendarShareCard api={api} testID="byhand-calshare" />
      <Button testID="byhand-done" kind="line" label="Done" onPress={() => done("Saved.")} />
    </>
  );
  return (
    <>
      <Today size={32}>{`Add ${kind === "question" ? "a question" : kind === "appointment" ? "an appointment" : kind === "cost" ? "a cost" : kind === "result" ? "a result" : "a medication"}`}</Today>
      <Card style={{ gap: 12 }}>
        <ItemFields kind={kind} data={data} unsure={[]} onChange={setData} />
        {error ? <T testID="byhand-error" style={{ color: C.red }}>{error}</T> : null}
        <Button testID="byhand-save" label={busy ? "Saving…" : "Save"} disabled={busy} onPress={async () => {
          setBusy(true); setError(null);
          try { await api.addByHand(kind, { ...data, value: data.value === "" ? undefined : Number(data.value), amount: data.amount === "" ? undefined : Number(String(data.amount).replace(/[$,]/g, "")) }); (kind === "appointment" ? setSaved(true) : done("Saved.")); }
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

function ResultCard({ g, api, reload, waitForMe, onRemove }: { g: ResultGroup; api: Api; reload: () => void; waitForMe: boolean; onRemove?: (id: string, label: string) => void }) {
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
      {latest.mine && onRemove ? <ItemAction testID={`remove-result-${g.key}`} label="Remove this entry" onPress={() => onRemove(latest.id, g.name.split(" (")[0]!)} /> : null}
    </View>
  );
}

function RecordScreen({ api, d, go, reload }: { api: Api; d: SoloToday; go: (s: Screen) => void; reload: () => Promise<void> }) {
  const [meds, setMeds] = useState<SoloMed[] | null>(null);
  const [results, setResults] = useState<ResultGroup[] | null>(null);
  const [questions, setQuestions] = useState<{ id: string; question: string; asked: boolean }[]>([]);
  const load = useCallback(async () => { const [m, r, q] = await Promise.all([api.soloMeds(), api.soloResults(), api.questions()]); setMeds(m); setResults(r); setQuestions(q); }, [api]);
  // Tabs stay open in the background, so refresh whenever she comes back to this one.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const after = useCallback(() => { void load(); void reload(); }, [load, reload]);
  const undo = useUndo(after);
  const [stopping, setStopping] = useState<string | null>(null);
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
      {undo.bar}
      <Section icon="medication" title="Meds" add="medication">
        {meds.length ? meds.map((m) => (
          <View key={m.id} style={[st.card, { padding: 14, gap: 4 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{`${m.medication} ${m.dose}`}</T><T style={{ fontSize: 15 }}>{niceTime(m.time)}</T></View>
            <Muted style={{ fontSize: 13.5 }}>{`${dayLabel(m.startsOn)}${m.endsOn && m.endsOn !== m.startsOn ? ` to ${dayLabel(m.endsOn)}` : ""}${m.nextAt ? ` · next ${when(m.nextAt)}` : ""}`}</Muted>
            {m.instructions ? <T style={{ fontSize: 14 }}>{m.instructions}</T> : null}
            {m.mine && stopping !== m.id ? <ItemAction testID={`stop-${m.id}`} label="Stop this medication" onPress={() => setStopping(m.id)} /> : null}
            {stopping === m.id ? (
              <View testID="stop-confirm" style={{ backgroundColor: C.alertSoft, borderRadius: 14, padding: 12, gap: 8 }}>
                <T style={{ fontSize: 14.5 }}>{`Stop ${m.medication} and its reminders? Only stop when your clinic tells you to.`}</T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><Button testID="stop-yes" kind="red" label="Stop it" onPress={async () => { setStopping(null); await api.removeMine("stop-med", m.id); after(); }} /></View>
                  <View style={{ flex: 1 }}><Button kind="line" label="Keep it" onPress={() => setStopping(null)} /></View>
                </View>
              </View>
            ) : null}
          </View>
        )) : <Muted style={{ fontSize: 15 }}>No meds yet. Snap your instruction sheet to add them.</Muted>}
        {d.refills.length ? <SupplyCard api={api} refills={d.refills} reload={reload} /> : null}
      </Section>
      <Section icon="lab" title="Results" add="result">
        {results.length ? results.map((g) => (undo.hidden(g.points[0]!.id) ? null : <ResultCard key={g.key} g={g} api={api} reload={() => void load()} waitForMe={d.about.revealResults} onRemove={(id, label) => void undo.remove({ id, label, commit: () => api.removeMine("delete-result", id) })} />)) : <Muted style={{ fontSize: 15 }}>No results yet. A portal screenshot works.</Muted>}
        <Muted style={{ fontSize: 13 }}>Pumpkin shows what each test measures and the range your lab printed. It never says whether a number is good or bad; your care team decides that.</Muted>
      </Section>
      <Section icon="calendar" title="Visits" add="appointment">
        {d.appointments.length ? d.appointments.filter((a) => !undo.hidden(a.id)).map((a) => (
          <View key={a.id} style={[st.card, { padding: 14 }]}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{a.title}</T><Muted style={{ fontSize: 14 }}>{`${when(a.startsAt)}${a.location ? ` · ${a.location}` : ""}`}</Muted>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {nativeCalendar ? <ItemAction label="Add to my calendar" onPress={() => void addVisitToCalendar(a)} /> : null}
              {a.mine ? <ItemAction testID={`remove-visit-${a.id}`} label="Remove" onPress={() => void undo.remove({ id: a.id, label: a.title, commit: () => api.removeMine("delete-appointment", a.id) })} /> : null}
            </View></View>
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
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const undo = useUndo(useCallback(() => { void load(); }, [load]));
  if (!c) return <ActivityIndicator color={C.espresso} />;
  return (
    <>
      <Today size={36}>Costs</Today>
      {undo.bar}
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
      {c.entries.length ? <Card pad={false}>{c.entries.filter((e) => !undo.hidden(e.id)).map((e, i) => (
        <View key={e.id} style={[st.row, i === 0 && { borderTopWidth: 0 }, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{e.description}</T>
            <Muted style={{ fontSize: 13.5 }}>{e.kind === "charge" ? (e.dueOn ? `Due ${dayLabel(e.dueOn)}` : `Billed ${dayLabel(e.occurredOn)}`) : `${e.kind === "payment" ? "Paid" : e.kind === "refund" ? "Refunded" : "Adjusted"} ${dayLabel(e.occurredOn)}${e.method ? ` · ${e.method}` : ""}`}</Muted>
            {e.captureId ? <Pressable onPress={() => go({ name: "original", captureId: e.captureId! })}><T style={{ color: C.lavInk, fontSize: 13.5, fontFamily: F.sans600 }}>See receipt</T></Pressable> : null}
            {e.mine ? <ItemAction testID={`remove-cost-${e.id}`} label="Remove" onPress={() => void undo.remove({ id: e.id, label: e.description, commit: () => api.removeMine("delete-cost", e.id) })} /> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <T style={{ fontFamily: F.sans700, fontSize: 15, color: e.kind === "payment" ? C.sageInk : C.ink }}>{money(e.amountCents)}</T>
            <Muted style={{ fontSize: 12.5 }}>{e.kind === "payment" ? "Paid" : e.kind === "refund" ? "Refund" : e.kind === "charge" ? (e.dueOn ? "Due" : "Billed") : "Adjusted"}</Muted>
          </View>
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
  const [pickStage, setPickStage] = useState(false);
  // The You tab stays open in the background, so pick up changes made elsewhere (like the urgent screen).
  useEffect(() => { setStage(profile.stage); setClinic(profile.clinicName ?? ""); setPhone(profile.afterHoursPhone ?? ""); setDetail(profile.calendarDetail); }, [profile.stage, profile.clinicName, profile.afterHoursPhone, profile.calendarDetail]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); await reload(); } catch (e) { setErr((e as Error).message); } };
  return (
    <>
      <Today size={36}>You</Today>
      {msg ? <T testID="more-msg" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{msg}</T> : null}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <Card style={{ gap: 12 }}>
        <Pressable testID="stage-change" accessibilityRole="button" accessibilityState={{ expanded: pickStage }} onPress={() => setPickStage((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 }}>
          <View style={{ flex: 1 }}><Muted style={{ fontSize: 13.5 }}>Where you are right now</Muted><T style={{ fontFamily: F.sans600, fontSize: 16 }}>{STAGES.find(([k]) => k === stage)?.[1] ?? ""}</T></View>
          <T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{pickStage ? "Done" : "Change"}</T>
        </Pressable>
        {pickStage ? <ChoiceList testIDPrefix="settings-stage-" options={STAGES} value={stage} onChange={setStage} /> : null}
        <Field label="Your clinic" value={clinic} onChange={setClinic} />
        {profile.askedClinicAt ? <T testID="clinic-asked" style={{ fontSize: 13.5, marginTop: -6, color: C.stone }}>{`You asked them to join Pumpkin on ${new Date(profile.askedClinicAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`}</T> : null}
        <Field testID="settings-phone" label="Their after-hours nurse line" value={phone} onChange={setPhone} keyboard="phone-pad" hint="Urgent symptoms go here (or 911)." />
        <Button testID="settings-save" kind="esp" label="Save" onPress={() => act(() => api.saveSoloProfile({ stage, clinicName: clinic, afterHoursPhone: phone }), "Saved.")} />
      </Card>
      <Card pad={false}>
        {([["about", "heart", "Make Pumpkin yours", "Your name, pronouns, family and background"], ["talk", "message", "How Pumpkin talks to me", "Tone, quiet days, pauses, new results"], ["summary", "doc", "My visit summary", "One page to bring to an appointment"], ["people", "people", "Your people", "Invite a partner or friend, choose what they see"], ["alias", "people", "My community name", "How you'll appear in the community"], ["feedback", "message", "Send feedback", "Tell the Pumpkin team what to fix"]] as const).map(([name, icon, title, sub], i) => (
          <Pressable key={name} testID={`more-${name}`} onPress={() => go({ name })} style={[st.row, i === 0 && { borderTopWidth: 0 }, { minHeight: 64 }]}>
            <Icon name={icon} /><View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{title}</T><Muted style={{ fontSize: 13.5 }}>{sub}</Muted></View>
            <Chevron />
          </Pressable>
        ))}
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
      <CalendarShareCard api={api} />
      {remindersSupported ? <Card style={{ gap: 8 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Dose reminders</T><Muted style={{ fontSize: 14 }}>A reminder 15 minutes before each dose. The lock screen says only "You have a reminder."</Muted><Button kind="line" label="Turn on reminders and test" onPress={() => act(async () => { if (!(await askPermission())) throw new Error("Reminders are off. Turn them on in your phone's Settings, under Pumpkin."); await sendTestReminder(); }, "Reminders are on. A test one will ring in a few seconds.")} /></Card> : null}
      <AppearanceCard />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="shield" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Your data, your call</T></View>
        <AppLockSetting />
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

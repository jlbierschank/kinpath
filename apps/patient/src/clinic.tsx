/**
 * The app for a clinic's patients, in the same shell as Pumpkin on your own: the same header, the same
 * tab bar, the same greeting and sheets. What's inside comes from her clinic: doses her nurse sees,
 * messages with her care team, results with the clinic's labels, the wait and the result.
 *
 * Tabs: Today, Messages, Record, Costs, You. Everything else is pushed on top with a Back button.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useIsFocused, useRouter, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import type { Api, SendResult, Today as TodayData } from "./api";
import {
  Breathe, CareTeam, Community, GraduationHome, Home, InviteScreen, KeepsakeScreen, Missed, NextCycleScreen, Record, ResultHome, RoughDay, Settings, ShareSummary, Urgent, WaitHome, Walk,
  type ClinicScreenSpec, type Tx,
} from "../App";
import { Back, Frame } from "./solo";
import { CostsScreen, ReceiptScreen } from "./money";
import { InboxScreen, NotificationSettingsScreen } from "./account";
import { RefillAsk } from "./refillask";
import { PlusMenu, type PlusItem } from "./plusmenu";
import { onDoseAction, snoozeDose, syncReminders } from "./reminders";
import { tick } from "./swipe";
import { RiseIn } from "./motion";
import { Button, C, F, Icon, Logo, Muted, T, Today, useTheme } from "./ui";

export type ClinicTabName = "today" | "messages" | "record" | "costs" | "you";
type Screen = ClinicScreenSpec;

interface ClinicState {
  api: Api; data: TodayData | null; error: string | null; load: () => Promise<void>;
  scheduled: number; alerts: number; refreshAlerts: () => void;
  notice: string | null; setNotice: (m: string | null) => void;
  onSignOut: () => void; demo: boolean; t: Tx;
}
const Ctx = createContext<ClinicState | null>(null);
export const useClinic = () => { const c = useContext(Ctx); if (!c) throw new Error("useClinic outside ClinicProvider"); return c; };

const TAB_OF: Partial<Record<Screen["name"], ClinicTabName>> = { home: "today", team: "messages", record: "record", costs: "costs", settings: "you" };

// Screens pushed on top carry objects (tonight's doses, a dose), so they're kept here by a short key.
const pushed = new Map<string, Screen>();
let seq = 0;
export const pushedScreen = (k: string | undefined) => (k ? pushed.get(k) ?? null : null);

export function ClinicProvider({ api, onSignOut, demo, children }: { api: Api; onSignOut: () => void; demo: boolean; children: ReactNode }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(0);
  const [alerts, setAlerts] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshAlerts = useCallback(() => { api.notifications().then((n) => setAlerts(n.unread)).catch(() => {}); }, [api]);
  const load = useCallback(async () => {
    try { const d = await api.today(); setData(d); setError(null); setScheduled(await syncReminders(d.reminders).catch(() => 0)); refreshAlerts(); }
    catch (e) { setError((e as Error).message); }
  }, [api, refreshAlerts]);
  useEffect(() => { void load(); }, [load]);
  const lang = data?.lang ?? "en";
  const t = useCallback<Tx>((en, es) => (lang === "es" ? es : en), [lang]);
  const value = useMemo(() => ({ api, data, error, load, scheduled, alerts, refreshAlerts, notice, setNotice, onSignOut, demo, t }), [api, data, error, load, scheduled, alerts, refreshAlerts, notice, onSignOut, demo, t]);
  return <Ctx.Provider value={value}>{children}<DoseActions /></Ctx.Provider>;
}

/** Log it / Snooze tapped on a dose reminder. */
function DoseActions() {
  const { api, load, setNotice } = useClinic();
  const router = useRouter();
  useEffect(() => onDoseAction(async (x) => {
    const toToday = () => { if (router.canDismiss()) router.dismissAll(); router.navigate("/clinic/today" as Href); };
    if (x.action === "log") { for (const id of x.doseIds) await api.logDose(id).catch(() => null); tick(); toToday(); setNotice("Logged."); void load(); }
    else if (x.action === "snooze") { const at = await snoozeDose(x.doseIds, x.title, x.body); toToday(); setNotice(at ? `We'll remind you again at ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.` : "Snoozed."); }
    else toToday();
  }), [api, load, router, setNotice]);
  return null;
}

/** Navigation that speaks in screens: tabs switch, everything else is pushed. */
export function useClinicNav() {
  const router = useRouter();
  const { load, setNotice } = useClinic();
  const go = useCallback((s: Screen) => {
    setNotice(null);
    const tab = TAB_OF[s.name];
    if (tab) { if (router.canDismiss()) router.dismissAll(); router.navigate(`/clinic/${tab}` as Href); return; }
    if (s.name === "urgent") { router.push({ pathname: "/clinic/urgent", params: { kind: s.kind } } as Href); return; }
    const k = String(++seq); pushed.set(k, s);
    router.push({ pathname: "/clinic/screen", params: { k } } as Href);
  }, [router, setNotice]);
  const home = useCallback((msg?: string) => {
    void load();
    if (router.canDismiss()) router.dismissAll();
    router.navigate("/clinic/today" as Href);
    setNotice(msg ?? null);
  }, [router, load, setNotice]);
  const back = useCallback(() => { if (router.canGoBack()) router.back(); else router.navigate("/clinic/today" as Href); }, [router]);
  const afterSend = useCallback((r: SendResult) => {
    if (r.kind === "urgent_symptom" || r.kind === "crisis") return go({ name: "urgent", kind: r.kind });
    void load(); go({ name: "team" });
  }, [go, load]);
  return { go, home, back, afterSend };
}

/** The top of the tabs: the logo, a calm way to get help, and + for the things she does most. */
export function ClinicTabTop() {
  useTheme();
  const { t } = useClinic();
  const { go } = useClinicNav();
  const narrow = useWindowDimensions().width < 370;
  const [menu, setMenu] = useState(false);
  const items: PlusItem[] = [
    { id: "message", label: t("Message my care team", "Escribir a mi equipo"), sub: t("A question, or how you're doing", "Una pregunta, o cómo estás"), icon: "message", tint: [C.sage, C.sageInk], onPress: () => go({ name: "team" }) },
    { id: "refill", label: t("Ask for a refill", "Pedir un resurtido"), sub: t("When a medication is running low", "Cuando se te acaba un medicamento"), icon: "medication", tint: [C.lav, C.lavInk], onPress: () => go({ name: "refill" }) },
    { id: "rough", label: t("Having a rough day", "Tengo un día difícil"), sub: t("A few minutes for you, or a call", "Unos minutos para ti, o una llamada"), icon: "heart", tint: [C.clay, C.clayInk], onPress: () => go({ name: "rough" }) },
  ];
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 480, alignSelf: "center" }}>
      <Logo width={narrow ? 100 : 124} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable testID="feeling-unwell" accessibilityRole="button" accessibilityLabel={t("Feeling unwell? Get help now", "¿Te sientes mal? Pide ayuda ahora")} onPress={() => go({ name: "urgent", kind: "urgent_symptom" })}
          style={{ flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 44 }}>
          <Icon name="alert" color={C.red} size={18} /><T style={{ fontFamily: F.sans600, color: C.ink, fontSize: 13.5 }}>{narrow ? t("Unwell?", "¿Mal?") : t("Feeling unwell?", "¿Te sientes mal?")}</T>
        </Pressable>
        <Pressable testID="clinic-add" accessibilityRole="button" accessibilityLabel={t("Do something", "Hacer algo")} accessibilityState={{ expanded: menu }} onPress={() => setMenu(true)}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}>
          <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke={C.onFill} strokeWidth={2.4} strokeLinecap="round" /></Svg>
        </Pressable>
      </View>
      <PlusMenu open={menu} onClose={() => setMenu(false)} sections={[{ items }]} />
    </View>
  );
}

function Notice() {
  const { notice } = useClinic();
  const focused = useIsFocused();
  return notice && focused ? <RiseIn key={notice}><View testID="clinic-notice" accessibilityLiveRegion="polite" style={{ backgroundColor: C.sage, borderRadius: 16, padding: 14 }}><T style={{ fontFamily: F.sans600, color: C.sageInk, fontSize: 15 }}>{notice}</T></View></RiseIn> : null;
}

/** One screen of the clinic app, rendered by its route file. Tabs stay mounted; each repaints with the theme. */
export function ClinicScreen({ screen }: { screen: Screen }) {
  useTheme();
  const { api, data, error, load, scheduled, alerts, refreshAlerts, setNotice, onSignOut, demo, t } = useClinic();
  const { go, home, back, afterSend } = useClinicNav();
  const tab = !!TAB_OF[screen.name];
  if (error && !data) return <Frame><Today size={32}>{t("Can't reach Pumpkin", "No podemos conectar con Pumpkin")}</Today><Muted>{error}</Muted><Button label={t("Try again", "Intentar de nuevo")} onPress={load} /></Frame>;
  if (!data) return <Frame inTabs={tab}><Muted>{t("Loading…", "Cargando…")}</Muted></Frame>;
  const openAlert = (n: { kind: string }) => go(n.kind === "nurse_reply" ? { name: "team" } : n.kind === "support_joined" ? { name: "settings" } : { name: "home" });
  const done = (msg: string) => home(msg);
  return (
    <Frame inTabs={tab} top={tab ? undefined : <Back label={t("Back", "Atrás")} onBack={back} />}>
      <Notice />
      {screen.name === "home" && (data.stage === "graduated"
        ? <GraduationHome data={data} api={api} t={t} go={go} reload={load} notice={null} setNotice={setNotice} afterSend={afterSend} />
        : data.wait.result
          ? <ResultHome data={data} api={api} t={t} go={go} reload={load} notice={null} setNotice={setNotice} />
          : data.wait.stage === "wait"
            ? <WaitHome data={data} api={api} t={t} go={go} reload={load} notice={null} />
            : <Home data={data} api={api} t={t} go={go} afterSend={afterSend} reload={load} />)}
      {screen.name === "team" && <CareTeam data={data} api={api} t={t} reload={load} afterSend={afterSend} />}
      {screen.name === "record" && <Record data={data} api={api} t={t} go={go} />}
      {screen.name === "costs" && <CostsScreen api={api} t={t} lang={data.lang} openReceipt={(id) => go({ name: "receipt", id })} />}
      {screen.name === "settings" && <Settings data={data} api={api} t={t} reload={load} scheduled={scheduled} onSignOut={onSignOut} go={go} demo={demo} unread={alerts} />}
      {screen.name === "next-cycle" && <NextCycleScreen api={api} t={t} />}
      {screen.name === "keepsake" && <KeepsakeScreen api={api} t={t} lang={data.lang} />}
      {screen.name === "share-summary" && <ShareSummary api={api} t={t} ob={screen.ob} />}
      {screen.name === "rough" && <RoughDay api={api} t={t} go={go} done={done} />}
      {screen.name === "breathe" && <Breathe t={t} done={() => done(t("That was a few minutes just for you.", "Fueron unos minutos solo para ti."))} />}
      {screen.name === "walk" && <Walk doses={screen.doses} focus={screen.focus} api={api} lang={data.lang} t={t} done={() => home()} quiet={data.wait.quietUntil !== null} somethingWrong={() => go({ name: "team" })} />}
      {screen.name === "missed" && <Missed dose={screen.dose} api={api} t={t} reload={load} afterSend={afterSend} done={() => home()} />}
      {screen.name === "receipt" && <ReceiptScreen api={api} t={t} id={screen.id} />}
      {screen.name === "community" && <Community t={t} />}
      {screen.name === "inbox" && <InboxScreen api={api} t={t} open={(n) => { void load(); openAlert(n); }} changed={refreshAlerts} />}
      {screen.name === "notif-settings" && <NotificationSettingsScreen api={api} t={t} lang={data.lang} />}
      {screen.name === "invite" && <InviteScreen api={api} t={t} reload={load} done={() => { void load(); go({ name: "settings" }); }} />}
      {screen.name === "refill" && <RefillAsk startOpen meds={[...data.schedule.upcoming, ...data.schedule.recent].map((d) => d.medication)} clinicName={data.clinic.name} t={t} send={(m, n) => api.askRefill(m, n)} />}
      {screen.name === "urgent" && <Urgent kind={screen.kind} t={t} back={() => home()} />}
    </Frame>
  );
}

/** Tab labels and icons, in her language. Badges: unread replies on Messages, updates on You. */
export function useClinicTabs() {
  const { data, alerts, t } = useClinic();
  const replies = data?.inbox.filter((m) => m.status === "sent").length ?? 0;
  const initial = (data?.firstName ?? "").trim().charAt(0).toUpperCase();
  const tabs = [
    { name: "today", label: t("Today", "Hoy"), icon: "calendar" as const, testID: "tab-today", badge: 0 },
    { name: "messages", label: t("Messages", "Mensajes"), icon: "message" as const, testID: "tab-messages", badge: replies },
    { name: "record", label: t("Record", "Expediente"), icon: "doc" as const, testID: "tab-record", badge: 0 },
    { name: "costs", label: t("Costs", "Costos"), icon: "wallet" as const, testID: "tab-costs", badge: 0 },
    { name: "you", label: t("You", "Tú"), icon: "you" as const, testID: "tab-you", badge: alerts },
  ];
  return { tabs, initial };
}

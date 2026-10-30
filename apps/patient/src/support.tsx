/**
 * The app for a support person (a partner, family, a friend), in the same shell as everyone else's:
 * the same header, tab bar and greeting. What's inside is only what she chose to share.
 *
 * Tabs: Today, Costs, You. Everything else is pushed on top with a Back button.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import type { Api, PartnerHome } from "./api";
import { PartnerHomeScreen, PartnerNotes, PartnerSettings, PartnerUrgent, Walk, type PScreen, type Tx } from "../App";
import { Back, Frame } from "./solo";
import { CostsScreen } from "./money";
import { InboxScreen, NotificationSettingsScreen } from "./account";
import { PlusMenu, type PlusItem } from "./plusmenu";
import { Button, C, F, Icon, Logo, Muted, T, Today, useTheme } from "./ui";

const NURSE_LINE = "tel:+18135550100"; // placeholder, the same as the clinic app's
const TAB_OF: Partial<Record<PScreen["name"], string>> = { home: "today", costs: "costs", settings: "you" };
const pushed = new Map<string, PScreen>();
let seq = 0;
export const pushedSupportScreen = (k: string | undefined) => (k ? pushed.get(k) ?? null : null);

interface SupportState { api: Api; data: PartnerHome | null; error: string | null; load: () => Promise<void>; alerts: number; refreshAlerts: () => void; onSignOut: () => void; demo: boolean }
const Ctx = createContext<SupportState | null>(null);
export const useSupport = () => { const c = useContext(Ctx); if (!c) throw new Error("useSupport outside SupportProvider"); return c; };

export function SupportProvider({ api, onSignOut, demo, children }: { api: Api; onSignOut: () => void; demo: boolean; children: ReactNode }) {
  const [data, setData] = useState<PartnerHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(0);
  const refreshAlerts = useCallback(() => { api.notifications().then((n) => setAlerts(n.unread)).catch(() => {}); }, [api]);
  const load = useCallback(async () => { try { setData(await api.partnerHome()); setError(null); refreshAlerts(); } catch (e) { setError((e as Error).message); } }, [api, refreshAlerts]);
  useEffect(() => { void load(); }, [load]);
  const value = useMemo(() => ({ api, data, error, load, alerts, refreshAlerts, onSignOut, demo }), [api, data, error, load, alerts, refreshAlerts, onSignOut, demo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSupportNav() {
  const router = useRouter();
  const { load } = useSupport();
  const go = useCallback((s: PScreen) => {
    const tab = TAB_OF[s.name];
    if (tab) { if (router.canDismiss()) router.dismissAll(); router.navigate(`/support/${tab}` as Href); return; }
    const k = String(++seq); pushed.set(k, s);
    router.push({ pathname: "/support/screen", params: { k } } as Href);
  }, [router]);
  const home = useCallback(() => { void load(); if (router.canDismiss()) router.dismissAll(); router.navigate("/support/today" as Href); }, [router, load]);
  const back = useCallback(() => { if (router.canGoBack()) router.back(); else router.navigate("/support/today" as Href); }, [router]);
  return { go, home, back };
}

const herOf = (d: PartnerHome | null) => (d && d.shared ? d.firstName ?? "your partner" : "your partner");

/** The top of the tabs: the logo, help if she's unwell, and + for a note or tonight's injections. */
export function SupportTabTop() {
  useTheme();
  const { data } = useSupport();
  const { go } = useSupportNav();
  const width = useWindowDimensions().width;
  const narrow = width < 370;
  const [menu, setMenu] = useState(false);
  const her = herOf(data);
  const shared = data && data.shared ? data : null;
  const tonight = shared?.schedule ? (() => { const p = shared.schedule.upcoming.filter((d) => !d.takenAt); return p.filter((d) => d.scheduledFor === p[0]?.scheduledFor); })() : [];
  const items: PlusItem[] = shared ? [
    { id: "note", label: `Send ${her} a note`, sub: "A few words she'll see on her home screen", icon: "heart", tint: [C.clay, C.clayInk], onPress: () => go({ name: "note" }) },
    ...(shared.sections.includes("meds") && tonight.length ? [{ id: "help", label: "Help with tonight's injections", sub: "Step by step, with her", icon: "medication" as const, tint: [C.lav, C.lavInk] as [string, string], onPress: () => go({ name: "walk", doses: tonight }) }] : []),
  ] : [];
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 480, alignSelf: "center" }}>
      <Logo width={narrow ? 100 : 124} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable testID="feeling-unwell" accessibilityRole="button" accessibilityLabel={`Worried about ${her}? Get help now`} onPress={() => go({ name: "urgent", level: "urgent", fromNote: false })}
          style={{ flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 44 }}>
          <Icon name="alert" color={C.red} size={18} /><T style={{ fontFamily: F.sans600, color: C.ink, fontSize: 13.5 }}>{width < 440 ? "Worried?" : `Worried about ${her === "your partner" ? "her" : her}?`}</T>
        </Pressable>
        {items.length ? (
          <Pressable testID="support-add" accessibilityRole="button" accessibilityLabel="Do something" accessibilityState={{ expanded: menu }} onPress={() => setMenu(true)}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}>
            <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke={C.onFill} strokeWidth={2.4} strokeLinecap="round" /></Svg>
          </Pressable>
        ) : null}
      </View>
      <PlusMenu open={menu} onClose={() => setMenu(false)} sections={[{ items }]} />
    </View>
  );
}

const t: Tx = (en) => en;

export function SupportScreen({ screen }: { screen: PScreen }) {
  useTheme();
  const { api, data, error, load, alerts, refreshAlerts, onSignOut, demo } = useSupport();
  const { go, home, back } = useSupportNav();
  const tab = !!TAB_OF[screen.name];
  if (error && !data) return <Frame><Today size={32}>Can't reach Pumpkin</Today><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Frame>;
  if (!data) return <Frame inTabs={tab}><Muted>Loading…</Muted></Frame>;
  const her = herOf(data);
  return (
    <Frame inTabs={tab} top={tab ? undefined : <Back label="Back" onBack={back} />}>
      {screen.name === "home" && (data.shared
        ? <PartnerHomeScreen data={data} api={api} go={go} reload={load} />
        : <>
            <Today size={34}>Nothing shared right now</Today>
            <Muted>When she shares parts of her treatment with you in her app, they'll show up here.</Muted>
          </>)}
      {screen.name === "note" && (data.shared ? <PartnerNotes data={data} api={api} go={go} reload={load} /> : <Muted>Nothing is shared with you right now.</Muted>)}
      {screen.name === "walk" && <Walk doses={screen.doses} focus={screen.focus} api={api} lang="en" t={t} done={home} helper={her} somethingWrong={() => Linking.openURL(NURSE_LINE)} />}
      {screen.name === "urgent" && <PartnerUrgent level={screen.level} her={her} back={back} personal={!!data.clinic.personal} fromNote={screen.fromNote !== false} />}
      {screen.name === "costs" && (data.shared && data.sections.includes("money")
        ? <CostsScreen api={api} t={t} lang="en" partner herName={data.firstName ?? undefined} />
        : <><Today size={34}>Costs</Today><Muted>{`${her === "your partner" ? "She hasn't" : `${her} hasn't`} shared costs with you. She can turn this on in her app.`}</Muted></>)}
      {screen.name === "inbox" && <InboxScreen api={api} t={t} open={() => home()} changed={refreshAlerts} />}
      {screen.name === "notif-settings" && <NotificationSettingsScreen api={api} t={t} lang="en" />}
      {screen.name === "settings" && <PartnerSettings data={data} api={api} onSignOut={onSignOut} demo={demo} go={go} unread={alerts} />}
    </Frame>
  );
}

export function useSupportTabs() {
  const { data, alerts } = useSupport();
  const initial = (data?.name ?? "").trim().charAt(0).toUpperCase();
  const tabs = [
    { name: "today", label: "Today", icon: "calendar" as const, testID: "tab-today", badge: 0 },
    { name: "costs", label: "Costs", icon: "wallet" as const, testID: "tab-costs", badge: 0 },
    { name: "you", label: "You", icon: "you" as const, testID: "tab-you", badge: alerts },
  ];
  return { tabs, initial };
}

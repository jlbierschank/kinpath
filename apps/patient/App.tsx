import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Newsreader_400Regular_Italic, Newsreader_500Medium } from "@expo-google-fonts/newsreader";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import Svg, { Path } from "react-native-svg";
import { acceptInvite, Api, type Dose, type Guide, type Invite, type PartnerHome, type Relationship, type SendResult, type Shareable, type SupportPerson, type Today as TodayData } from "./src/api";
import { askPermission, remindersSupported, syncReminders } from "./src/reminders";
import { AskBox, Avatar, Button, C, Cap, Card, Chip, Chips, F, H1, JourneyPath, Moment, Muted, Pill, Row, st, T, TimelineItem, Today, Toggle } from "./src/ui";

// DEV ONLY: synthetic seed people. Real passwordless sign-in replaces this screen.
const DEV_PEOPLE = [
  { id: "00000000-0000-4000-8000-000000000010", name: "Maya Torres", initials: "MT", note: "Patient · stimulation day 6", partner: false },
  { id: "00000000-0000-4000-8000-000000000012", name: "Priya Shah", initials: "PS", note: "Patient · prefers Spanish", partner: false },
  { id: "00000000-0000-4000-8000-000000000011", name: "Jordan Torres", initials: "JT", note: "Maya's partner · sees what she shares", partner: true },
];
type DevPerson = (typeof DEV_PEOPLE)[number];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const NURSE_LINE = "tel:+18135550100"; // placeholder

type Tab = "home" | "community" | "record" | "team";
type Screen = { name: Tab } | { name: "walk"; doses: Dose[]; focus?: string } | { name: "settings" } | { name: "urgent"; kind: SendResult["kind"] } | { name: "missed"; dose: Dose } | { name: "invite" };
type Tx = (en: string, es: string) => string;

const STAGES = ["Consult", "Testing", "Stims", "Retrieval", "Transfer", "Wait", "Result", "OB-GYN"];
const STAGES_ES = ["Consulta", "Pruebas", "Estimulación", "Extracción", "Transferencia", "Espera", "Resultado", "Ginecólogo"];
const stageIndex = (stage: string | null) => ({ consult: 0, testing: 1, stimulation: 2, retrieval: 3, transfer: 4, wait: 5, result: 6, graduated: 7 } as Record<string, number>)[stage ?? ""] ?? 2;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", " ");
const dayClock = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function App() {
  return <SafeAreaProvider><AppInner /></SafeAreaProvider>;
}

function AppInner() {
  const [fontsLoaded] = useFonts({ Newsreader_400Regular_Italic, Newsreader_500Medium, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold });
  const [who, setWho] = useState<DevPerson | null>(null);
  // People who joined with an invite code during this session (dev only; real sign-in remembers them).
  const [joined, setJoined] = useState<DevPerson[]>([]);
  const [joining, setJoining] = useState(false);
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.oat, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={C.espresso} /></View>;
  if (joining) return <AcceptInvite onBack={() => setJoining(false)} onJoined={(p) => { setJoined([...joined, p]); setJoining(false); setWho(p); }} />;
  if (!who) return <DevSignIn people={[...DEV_PEOPLE, ...joined]} onPick={setWho} onInvite={() => setJoining(true)} />;
  if (who.partner) return <PartnerApp api={new Api(who.id)} initials={who.initials} onSignOut={() => setWho(null)} />;
  return <Signed api={new Api(who.id)} initials={who.initials} onSignOut={() => setWho(null)} />;
}

function Frame({ children, tabs, top }: { children: ReactNode; tabs?: ReactNode; top?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.oat }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" }}>
        {top}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24, gap: 14 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {tabs}
      </View>
    </SafeAreaView>
  );
}

function DevSignIn({ people, onPick, onInvite }: { people: DevPerson[]; onPick: (p: DevPerson) => void; onInvite: () => void }) {
  return (
    <Frame top={<View style={{ padding: 18, paddingBottom: 6 }}><Muted>Kinpath dev build · synthetic data only</Muted></View>}>
      <Today size={34}>Who are you testing as?</Today>
      <Card pad={false}>
        {people.map((p, i) => (
          <Pressable key={p.id} testID={`pick-${p.name}`} onPress={() => onPick(p)} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Avatar text={p.initials} /><View><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{p.name}</T><Muted>{p.note}</Muted></View></View>
          </Pressable>
        ))}
      </Card>
      <Button testID="have-code" kind="line" label="I have an invite code" onPress={onInvite} />
    </Frame>
  );
}

function AcceptInvite({ onBack, onJoined }: { onBack: () => void; onJoined: (p: DevPerson) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true); setError(null);
    try {
      const r = await acceptInvite(code, name);
      onJoined({ id: r.userId, name: r.name, initials: initialsOf(r.name), note: `Supporting ${r.patientFirstName}`, partner: true });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Frame top={<BackBar label="Back" onBack={onBack} />}>
      <Today size={34}>Join with an invite</Today>
      <Muted>Someone going through treatment at Bayside invited you to follow along. You'll see only what they choose to share.</Muted>
      <Card style={{ gap: 10 }}>
        <Cap>Invite code</Cap>
        <TextInput testID="invite-code" style={[st.input, { fontFamily: F.sans600, fontSize: 20, letterSpacing: 2 }]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-EFGH" placeholderTextColor={C.stone} />
        <Cap>Your name</Cap>
        <TextInput testID="invite-name" style={st.input} value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={C.stone} />
        {error && <T testID="invite-error" style={{ color: C.red }}>{error}</T>}
        <Button testID="join" label={busy ? "Joining…" : "Join"} disabled={busy || !code.trim() || !name.trim()} onPress={join} />
      </Card>
      <Muted style={{ fontSize: 12 }}>In the released app, you'll also confirm your phone number or email with a one-time sign-in link.</Muted>
    </Frame>
  );
}

function TopBar({ clinic, initials, onAvatar }: { clinic: string; initials: string; onAvatar: () => void }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <T style={{ fontFamily: F.sans500, fontSize: 14, color: C.stone }}>{clinic}</T>
      <Pressable testID="avatar" accessibilityLabel="Settings and notifications" onPress={onAvatar}><Avatar text={initials} /></Pressable>
    </View>
  );
}
function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 }}>
      <Pressable testID="back" onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, alignSelf: "flex-start" }}>
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M15 6l-6 6 6 6" stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        <T style={{ fontFamily: F.sans500, fontSize: 14 }}>{label}</T>
      </Pressable>
    </View>
  );
}
function TabBar({ current, t, go, badge }: { current: string; t: Tx; go: (s: Screen) => void; badge: number }) {
  const items: [Tab, string][] = [["home", t("Home", "Inicio")], ["community", t("Community", "Comunidad")], ["record", t("Record", "Expediente")], ["team", t("Care team", "Equipo")]];
  return (
    <View style={{ marginHorizontal: 14, marginTop: 8, marginBottom: 14, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderBottomWidth: 3, borderRadius: 999, padding: 5, flexDirection: "row" }}>
      {items.map(([name, label]) => {
        const on = current === name;
        return (
          <Pressable key={name} testID={`tab-${name}`} onPress={() => go({ name })} style={{ flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: "center", backgroundColor: on ? C.espresso : "transparent" }}>
            <Text numberOfLines={1} style={{ fontFamily: on ? F.sans600 : F.sans, fontSize: 12.5, color: on ? C.paper : C.stone }}>{label}{name === "team" && badge ? ` · ${badge}` : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Signed({ api, initials, onSignOut }: { api: Api; initials: string; onSignOut: () => void }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [scheduled, setScheduled] = useState(0);
  const load = useCallback(async () => {
    try { const d = await api.today(); setData(d); setError(null); setScheduled(await syncReminders(d.reminders)); }
    catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Frame><Today size={34}>Can't reach Bayside</Today><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Frame>;
  if (!data) return <Frame><Muted>Loading…</Muted></Frame>;
  const t: Tx = (en, es) => (data.lang === "es" ? es : en);
  const go = (s: Screen) => setScreen(s);
  const home = () => { void load(); go({ name: "home" }); };
  const afterSend = (r: SendResult) => (r.kind === "urgent_symptom" || r.kind === "crisis" ? go({ name: "urgent", kind: r.kind }) : (void load(), go({ name: "team" })));
  const unread = data.inbox.filter((m) => m.status === "sent").length;
  const isTab = ["home", "community", "record", "team"].includes(screen.name);
  const top = isTab ? <TopBar clinic={data.clinic.name} initials={initials} onAvatar={() => go({ name: "settings" })} /> : <BackBar label={t("Home", "Inicio")} onBack={home} />;
  const tabs = isTab ? <TabBar current={screen.name} t={t} go={go} badge={unread} /> : undefined;

  return (
    <Frame top={top} tabs={tabs}>
      {screen.name === "home" && <Home data={data} api={api} t={t} go={go} afterSend={afterSend} reload={load} />}
      {screen.name === "walk" && <Walk doses={screen.doses} focus={screen.focus} api={api} lang={data.lang} t={t} done={home} somethingWrong={() => go({ name: "team" })} />}
      {screen.name === "missed" && <Missed dose={screen.dose} api={api} t={t} reload={load} afterSend={afterSend} done={home} />}
      {screen.name === "team" && <CareTeam data={data} api={api} t={t} reload={load} afterSend={afterSend} />}
      {screen.name === "record" && <Record data={data} t={t} />}
      {screen.name === "community" && <Community t={t} />}
      {screen.name === "settings" && <Settings data={data} api={api} t={t} reload={load} scheduled={scheduled} onSignOut={onSignOut} go={go} />}
      {screen.name === "invite" && <InviteScreen api={api} t={t} reload={load} done={() => { void load(); go({ name: "settings" }); }} />}
      {screen.name === "urgent" && <Urgent kind={screen.kind} t={t} back={home} />}
    </Frame>
  );
}

// ---------- Home (matches the demo's "Today") ----------
function Home({ data, api, t, go, afterSend, reload }: { data: TodayData; api: Api; t: Tx; go: (s: Screen) => void; afterSend: (r: SendResult) => void; reload: () => Promise<void> }) {
  const [ask, setAsk] = useState("");
  const [sending, setSending] = useState(false);
  const pending = useMemo(() => data.schedule.upcoming.filter((d) => !d.takenAt), [data]);
  const nextAt = pending[0]?.scheduledFor;
  const tonight = useMemo(() => pending.filter((d) => d.scheduledFor === nextAt), [pending, nextAt]);
  const loggedTonight = [...data.schedule.upcoming, ...data.schedule.recent].filter((d) => d.takenAt && Math.abs(Date.now() - new Date(d.scheduledFor).getTime()) < 24 * 3600_000);
  const missed = data.schedule.missed;
  const replies = data.inbox.filter((m) => m.status === "sent");
  const reviewing = data.results.filter((r) => r.status !== "in_range");
  const day = data.stimDay;
  const notes = data.sharing.notes.filter((n) => !n.seenAt);
  const send = async (text: string) => { if (!text.trim() || sending) return; setSending(true); const r = await api.sendMessage(text); setAsk(""); setSending(false); afterSend(r); };

  return (
    <>
      <View style={{ gap: 4 }}>
        <Today>{t("Today", "Hoy")}</Today>
        <Muted>{day ? t(`Stimulation, day ${day} · We're here for anything.`, `Estimulación, día ${day} · Estamos aquí para lo que necesites.`) : t("We're here for anything.", "Estamos aquí para lo que necesites.")}</Muted>
        <Muted style={{ fontSize: 12 }}>{data.clinic.replyWindow[data.lang]} {t("Urgent? Call the nurse line anytime.", "¿Urgente? Llama a enfermería a cualquier hora.")}</Muted>
      </View>

      {notes.map((n) => n.level !== "routine" ? (
        <View key={n.id} testID="partner-note-worried" style={[st.card, { padding: 16, gap: 8, borderColor: C.red, borderWidth: 1.5, borderBottomColor: C.red }]}>
          <Cap>{t(`From ${n.fromName}`, `De ${n.fromName}`)}</Cap>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 24, lineHeight: 28, color: C.red }}>{t(`${n.fromName} sounds worried about you.`, `${n.fromName} está preocupado por ti.`)}</Text>
          <T style={{ fontSize: 15, lineHeight: 22 }}>“{n.body}”</T>
          <T style={{ fontSize: 14 }}>{n.level === "crisis"
            ? t("If you're thinking about hurting yourself, call or text 988 now. You don't have to go through this alone.", "Si estás pensando en hacerte daño, llama o escribe al 988 ahora. No tienes que pasar por esto sola.")
            : t("If you have chest pain, trouble breathing, heavy bleeding or you fainted, call the nurse line now. Call 911 in an emergency.", "Si tienes dolor de pecho, dificultad para respirar, sangrado abundante o te desmayaste, llama a enfermería ahora. En una emergencia llama al 911.")}</T>
          {n.level === "crisis"
            ? <Button kind="red" label={t("Call or text 988", "Llamar o escribir al 988")} onPress={() => Linking.openURL("tel:988")} />
            : <Button kind="red" label={t("Call the nurse line", "Llamar a enfermería")} onPress={() => Linking.openURL(NURSE_LINE)} />}
          <Button testID="note-ok" kind="line" label={t("I'm okay", "Estoy bien")} onPress={async () => { await api.noteSeen(n.id); await reload(); }} />
        </View>
      ) : (
        <View key={n.id} testID="partner-note" style={{ backgroundColor: C.softLav, borderRadius: 18, padding: 16, gap: 8 }}>
          <Cap>{t(`From ${n.fromName}`, `De ${n.fromName}`)}</Cap>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 21, lineHeight: 26, color: C.lavDeep }}>{n.body}</Text>
          <Button testID="note-thanks" kind="line" label={t("Thanks ♥", "Gracias ♥")} onPress={async () => { await api.noteSeen(n.id); await reload(); }} />
        </View>
      ))}

      <JourneyPath current={stageIndex(data.stage)} labels={data.lang === "es" ? STAGES_ES : STAGES} />

      <AskBox testID="ask" value={ask} onChange={setAsk} onSubmit={() => send(ask)} placeholder={t("Ask a question or tell us how you're doing", "Haz una pregunta o cuéntanos cómo estás")} />

      <View style={{ gap: 8 }}>
        <Cap>{day ? t(`Others ask this on day ${day}`, `Otras personas preguntan esto en el día ${day}`) : t("Others ask this", "Otras personas preguntan esto")}</Cap>
        <Chips>
          {missed[0] && <Chip testID="chip-missed" label={t("I missed a dose", "Olvidé una dosis")} onPress={() => go({ name: "missed", dose: missed[0]! })} />}
          <Chip label={t("What did my results mean?", "¿Qué significan mis resultados?")} onPress={() => go({ name: "record" })} />
          {tonight.some((d) => d.medication === "Menopur") && <Chip label={t("How do I mix Menopur?", "¿Cómo preparo el Menopur?")} onPress={() => go({ name: "walk", doses: tonight, focus: "Menopur" })} />}
          <Chip label={t("Can I have coffee?", "¿Puedo tomar café?")} onPress={() => setAsk(t("Can I have coffee during stims?", "¿Puedo tomar café durante la estimulación?"))} />
        </Chips>
      </View>

      <View style={{ gap: 8 }}>
        <Cap>{t("Up next", "Lo siguiente")}</Cap>
        {tonight.length > 0 ? (
          <View style={st.dark}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={{ fontFamily: F.serif, fontSize: 26, letterSpacing: -0.5, color: C.paper }}>{clock(nextAt!)}</Text>
              <T style={{ fontSize: 13, color: C.tan }}>{t(`${tonight.length} injection${tonight.length > 1 ? "s" : ""} tonight`, `${tonight.length} inyección${tonight.length > 1 ? "es" : ""} esta noche`)}</T>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {tonight.map((d) => (
                <Pressable key={d.id} onPress={() => go({ name: "walk", doses: tonight, focus: d.medication })} style={st.medchip}>
                  <T style={{ fontSize: 13.5, color: C.paper }}>{d.medication}</T>
                </Pressable>
              ))}
            </View>
            <Button testID="start-walkthrough" label={t("Walk me through tonight", "Guíame paso a paso esta noche")} onPress={() => go({ name: "walk", doses: tonight })} />
          </View>
        ) : (
          <View style={st.dark}>
            <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.paper }}>{t("All set for tonight", "Todo listo por esta noche")}</Text>
            <T style={{ fontSize: 14.5, color: "#E9DED3" }}>{t(`${loggedTonight.length} logged. Maria can see them.`, `${loggedTonight.length} registradas. María puede verlas.`)}</T>
          </View>
        )}
      </View>

      <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }} pad={false}>
        {missed.map((d, i) => (
          <TimelineItem key={d.id} first={i === 0} icon="drop" tone="clay" when={t("Not logged", "Sin registrar")} what={t(`${d.medication} · ${dayClock(d.scheduledFor)}`, `${d.medication} · ${dayClock(d.scheduledFor)}`)} action={t("Tell us what happened", "Cuéntanos qué pasó")} onAction={() => go({ name: "missed", dose: d })} />
        ))}
        {replies.map((m, i) => (
          <TimelineItem key={m.id} first={missed.length === 0 && i === 0} icon="phone" tone="sage" when={t("New", "Nuevo")} what={t(`${m.sender ?? "Your nurse"} replied`, `${m.sender ?? "Tu enfermera"} respondió`)} action={t("Read it", "Leer")} onAction={() => go({ name: "team" })} />
        ))}
        {reviewing.map((r, i) => (
          <TimelineItem key={r.id} first={missed.length + replies.length === 0 && i === 0} icon="cal" tone="lav" when={t("Your nurse is reviewing", "Tu enfermera está revisando")} what={`${r.analyte[0]!.toUpperCase()}${r.analyte.slice(1)} ${r.value} ${r.unit}`} action={t("See results", "Ver resultados")} onAction={() => go({ name: "record" })} />
        ))}
        {missed.length + replies.length + reviewing.length === 0 && <TimelineItem first icon="cal" tone="lav" when={t("Later", "Más tarde")} what={t("Nothing else today", "Nada más por hoy")} />}
      </Card>

      <Chips>
        <Chip label={t("Medications", "Medicamentos")} onPress={() => go({ name: "record" })} />
        <Chip label={t("Results", "Resultados")} onPress={() => go({ name: "record" })} />
        <Chip label={t("Message my team", "Escribir a mi equipo")} onPress={() => go({ name: "team" })} />
      </Chips>
    </>
  );
}

// ---------- Injection walkthrough (demo layout: one medication per screen) ----------
function Walk({ doses, focus, api, lang, t, done, somethingWrong, helper }: { doses: Dose[]; focus?: string; api: Api; lang: "en" | "es"; t: Tx; done: () => void; somethingWrong: () => void; helper?: string }) {
  const start = Math.max(0, doses.findIndex((d) => d.medication === focus));
  const [i, setI] = useState(start);
  const [logged, setLogged] = useState(0);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(false);
  const dose = doses[i];
  useEffect(() => { if (dose) { setGuide(null); api.guide(dose.medication).then(setGuide).catch(() => setGuide({ medication: dose.medication, steps: [], videoUrl: null, approvedBy: "" })); } }, [dose, api]);

  if (helper && !dose) {
    return (
      <>
        <H1 testID="walk-done">{`That's all ${doses.length}.`}</H1>
        <Card style={{ gap: 6 }}><T style={{ fontSize: 15 }}>{`${helper} logs each one on her phone, so Bayside sees them. Thanks for being there.`}</T></Card>
        <Button kind="esp" label="Back" onPress={done} />
      </>
    );
  }
  if (!dose || logged === doses.length) {
    return (
      <>
        <H1 testID="walk-done">{t(`Done. That's all ${doses.length}.`, `Listo. Son las ${doses.length}.`)}</H1>
        <Card style={{ gap: 6 }}>
          <T style={{ fontSize: 15 }}>{t("Logged. Maria can see it, so no need to call in.", "Registrado. María puede verlo, así que no necesitas llamar.")}</T>
          <Pill tone="sage" label={t(`${logged} of ${doses.length} logged`, `${logged} de ${doses.length} registradas`)} />
        </Card>
        <Button kind="esp" label={t("Back to today", "Volver a hoy")} onPress={done} />
      </>
    );
  }
  const next = () => { const n = doses.findIndex((d, k) => k > i); setI(n === -1 ? doses.length : n); };
  return (
    <>
      {helper && <Moment tone="lav">{`Helping ${helper}. She logs each dose on her phone.`}</Moment>}
      {logged === 1 && <Moment>{t("First one done. The hardest part is behind you.", "La primera, lista. Lo más difícil ya pasó.")}</Moment>}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {doses.map((d, k) => <View key={d.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k <= i ? C.lavInk : "#B9ACDF" }} />)}
      </View>
      <Cap>{t(`Injection ${i + 1} of ${doses.length}`, `Inyección ${i + 1} de ${doses.length}`)}</Cap>
      <H1 testID="walk-med">{dose.medication}</H1>
      <Muted>{dose.dose} · {clock(dose.scheduledFor)}</Muted>
      <View style={{ height: 150, borderRadius: 18, backgroundColor: C.well, alignItems: "center", justifyContent: "center" }}>
        <T style={{ color: C.tan, fontSize: 13 }}>{guide?.videoUrl ? t("Play video", "Ver video") : t(`Video for ${dose.medication} coming from your clinic`, `Video de ${dose.medication} pronto, de tu clínica`)}</T>
      </View>
      {!guide && <Muted>{t("Loading steps…", "Cargando pasos…")}</Muted>}
      {guide && guide.steps.length > 0 && (
        <View style={{ gap: 8 }}>
          {guide.steps.map((s, k) => (
            <View key={k} style={{ flexDirection: "row", gap: 10 }}>
              <T style={{ fontFamily: F.sans600, fontSize: 15, width: 20 }}>{k + 1}.</T>
              <T testID={k === 0 ? "step-text" : undefined} style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{s[lang]}</T>
            </View>
          ))}
          <Muted style={{ fontSize: 12 }}>{t("Written by your care team · approved by", "Escrito por tu equipo · aprobado por")} {guide.approvedBy}</Muted>
        </View>
      )}
      {helper
        ? <Button testID="helper-next" label={i < doses.length - 1 ? "Next injection" : "Finish"} disabled={!guide} onPress={next} />
        : <Button testID="log-dose" label={t("Done, log it", "Listo, registrar")} disabled={busy || !guide} onPress={async () => { setBusy(true); await api.logDose(dose.id); setLogged(logged + 1); setBusy(false); next(); }} />}
      <Button kind="line" label={helper ? "Something went wrong? Call the nurse line" : t("Something went wrong", "Algo salió mal")} onPress={somethingWrong} />
    </>
  );
}

// ---------- Missed dose ----------
function Missed({ dose, api, t, reload, afterSend, done }: { dose: Dose; api: Api; t: Tx; reload: () => Promise<void>; afterSend: (r: SendResult) => void; done: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <H1>{t(`Your ${dose.medication} at ${clock(dose.scheduledFor)}`, `Tu ${dose.medication} de las ${clock(dose.scheduledFor)}`)}</H1>
      <Muted>{t("Took it late? Log it. Missed it? Tell Maria here instead of calling. She gets your dose log with it.", "¿La tomaste tarde? Regístrala. ¿La olvidaste? Avísale a María aquí en vez de llamar. Recibe tu registro de dosis.")}</Muted>
      <TextInput testID="missed-note" style={st.input} multiline value={note} onChangeText={setNote} placeholder={t("Anything else? (optional)", "¿Algo más? (opcional)")} placeholderTextColor={C.stone} />
      <Button testID="missed-it" label={t("I missed this dose", "Olvidé esta dosis")} disabled={busy} onPress={async () => { setBusy(true); afterSend(await api.reportMissed(dose.id, note)); }} />
      <Button testID="took-late" kind="line" label={t("I took it late", "La tomé tarde")} disabled={busy} onPress={async () => { setBusy(true); await api.logDose(dose.id); await reload(); done(); }} />
    </>
  );
}

// ---------- Care team (messages) ----------
function CareTeam({ data, api, t, reload, afterSend }: { data: TodayData; api: Api; t: Tx; reload: () => Promise<void>; afterSend: (r: SendResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const items = [...data.inbox].reverse();
  return (
    <>
      <H1>{t("Your care team", "Tu equipo")}</H1>
      <Muted>{data.clinic.replyWindow[data.lang]}</Muted>
      {items.length === 0 && <Muted>{t("No messages yet.", "Aún no hay mensajes.")}</Muted>}
      {items.map((m) => (
        <View key={m.id} style={{ gap: 8 }}>
          <View style={{ alignSelf: "flex-end", maxWidth: "82%", backgroundColor: C.espresso, borderRadius: 18, borderBottomRightRadius: 4, paddingVertical: 11, paddingHorizontal: 14 }}>
            <T style={{ color: C.paper, fontSize: 15 }}>{m.patientMessage}</T>
          </View>
          {m.sentText ? (
            <Card style={{ gap: 8, ...(m.status === "sent" ? { borderColor: C.marigold } : {}) }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Avatar text="ML" bg={C.sage} fg={C.sageInk} size={30} /><T style={{ fontFamily: F.sans600 }}>{m.sender ?? t("Your nurse", "Tu enfermera")}</T>{m.status === "sent" && <Pill tone="lav" label={t("New", "Nuevo")} />}</View>
              <T style={{ fontSize: 15, lineHeight: 22 }}>{m.sentText}</T>
              {m.status === "sent" && <Button testID="got-it" kind="line" label={t("Got it", "Entendido")} onPress={async () => { await api.markRead(m.id); await reload(); }} />}
            </Card>
          ) : <View style={{ alignSelf: "flex-start" }}>{m.kind === "urgent_symptom" || m.kind === "crisis"
                ? <Pill tone="clay" label={t("Sent to the on-call nurse · call the nurse line", "Enviado a la enfermera de guardia · llama a enfermería")} />
                : <Pill tone="lav" label={t("Waiting for your nurse", "Esperando a tu enfermera")} />}</View>}
        </View>
      ))}
      <AskBox testID="message" value={text} onChange={setText} onSubmit={async () => { if (!text.trim() || busy) return; setBusy(true); const r = await api.sendMessage(text); setText(""); setBusy(false); afterSend(r); }} placeholder={t("Message your care team", "Escribe a tu equipo")} />
    </>
  );
}

// ---------- Record ----------
function Record({ data, t }: { data: TodayData; t: Tx }) {
  return (
    <>
      <Today size={34}>{t("Your record", "Tu expediente")}</Today>
      <Muted>{t("Yours to keep, and to share as you choose.", "Tuyo para guardar y compartir como quieras.")}</Muted>
      <Cap>{t("Results", "Resultados")}</Cap>
      <Card pad={false}>
        {data.results.length === 0 && <Row title={t("No results yet", "Aún no hay resultados")} />}
        {data.results.map((r) => (
          <Row key={r.id} title={`${r.analyte[0]!.toUpperCase()}${r.analyte.slice(1)} ${r.value} ${r.unit}`} sub={r.text}
            right={<Pill tone={r.status === "in_range" ? "sage" : "clay"} label={r.status === "in_range" ? t("In Bayside's range", "En el rango de Bayside") : t("Nurse reviewing", "En revisión")} />} />
        ))}
      </Card>
      <Cap>{t("Medications", "Medicamentos")}</Cap>
      <Card pad={false}>
        {data.schedule.recent.slice(0, 8).map((d) => (
          <Row key={d.id} title={d.medication} sub={`${d.dose} · ${dayClock(d.scheduledFor)}`}
            right={d.takenAt ? <Pill tone="sage" label={t("Logged", "Registrada")} /> : d.reportedMissed ? <Pill tone="clay" label={t("With Maria", "Con María")} /> : <Pill tone="stone" label={t("Not logged", "Sin registrar")} />} />
        ))}
      </Card>
    </>
  );
}

function Community({ t }: { t: Tx }) {
  return (
    <>
      <Today size={34}>{t("Community", "Comunidad")}</Today>
      <View style={{ backgroundColor: C.lav, borderRadius: 18, padding: 16, gap: 8 }}>
        <T style={{ fontFamily: F.sans700, fontSize: 15, color: C.lavDeep }}>{t("Coming soon", "Muy pronto")}</T>
        <T style={{ color: C.lavDeep }}>{t("Small groups for people on the same step, moderated by Bayside. Partners get their own space too.", "Grupos pequeños para personas en el mismo paso, moderados por Bayside. Las parejas también tendrán su espacio.")}</T>
      </View>
    </>
  );
}

// ---------- Settings ----------
function Settings({ data, api, t, reload, scheduled, onSignOut, go }: { data: TodayData; api: Api; t: Tx; reload: () => Promise<void>; scheduled: number; onSignOut: () => void; go: (s: Screen) => void }) {
  const [perm, setPerm] = useState<string | null>(null);
  return (
    <>
      <H1>{t("Settings and notifications", "Ajustes y notificaciones")}</H1>
      <Cap>{t("Reminders", "Recordatorios")}</Cap>
      <Card style={{ gap: 8 }}>
        <Muted>{remindersSupported
          ? t(`${scheduled} reminder(s) set on this phone. Dose reminders still ring during quiet hours (${data.prefs.quietStart}–${data.prefs.quietEnd}); follow-ups wait until morning.`, `${scheduled} recordatorio(s) en este teléfono. Los de dosis suenan aun en horas de silencio (${data.prefs.quietStart}–${data.prefs.quietEnd}); los seguimientos esperan a la mañana.`)
          : t("Reminders work in the phone app, not in a web browser.", "Los recordatorios funcionan en la app del teléfono, no en el navegador.")}</Muted>
        {remindersSupported && <Button kind="esp" label={t("Turn on reminders", "Activar recordatorios")} onPress={async () => { const ok = await askPermission(); setPerm(ok ? t("Reminders are on.", "Recordatorios activados.") : t("Reminders are off in your phone's settings.", "Los recordatorios están desactivados en los ajustes del teléfono.")); await reload(); }} />}
        {perm && <Muted>{perm}</Muted>}
      </Card>
      <Card pad={false}>
        <View style={[st.row, { borderTopWidth: 0 }]}>
          <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t("Show medication names on the lock screen", "Mostrar medicamentos en la pantalla de bloqueo")}</T><Muted>{t("Off keeps it private: \"You have a reminder.\"", "Desactivado es privado: \"Tienes un recordatorio.\"")}</Muted></View>
          <Toggle testID={"lock-detail"} value={data.prefs.lockScreenDetail} onChange={async (v) => { await api.setLockScreenDetail(v); await reload(); }} />
        </View>
      </Card>
      <Cap>{t("Your support people", "Tus personas de apoyo")}</Cap>
      <Muted>{t("People you invite see only what you choose. Your messages with your care team are always private.", "Las personas que invites solo ven lo que elijas. Tus mensajes con tu equipo siempre son privados.")}</Muted>
      {data.sharing.partners.map((p) => <SharingCard key={p.userId} partner={p} api={api} t={t} reload={reload} />)}
      {data.sharing.invites.map((inv) => <PendingInvite key={inv.id} invite={inv} api={api} t={t} reload={reload} />)}
      <Button testID="invite-someone" kind="esp" label={t("Invite someone", "Invitar a alguien")} onPress={() => go({ name: "invite" })} />
      <Cap>{t("Planned reminders", "Recordatorios programados")}</Cap>
      <Card pad={false}>
        {data.reminders.length === 0 && <Row title={t("None right now", "Ninguno por ahora")} />}
        {data.reminders.map((r) => <Row key={r.key} title={dayClock(r.at)} sub={r.body} />)}
      </Card>
      <Button kind="plain" label={t("Switch test patient", "Cambiar paciente de prueba")} onPress={onSignOut} />
    </>
  );
}

const SHARE_OPTIONS: [Shareable, string, string, string, string][] = [
  ["schedule", "Where you are in your cycle", "Stage and day", "Dónde estás en tu ciclo", "Etapa y día"],
  ["meds", "Injections and walkthroughs", "So they can help with tonight's doses", "Inyecciones y guías", "Para que te ayude con las dosis"],
  ["results", "Your results", "With your nurse's labels", "Tus resultados", "Con las indicaciones de tu enfermera"],
];
const REL: Record<Relationship, [string, string]> = { partner: ["Partner", "Pareja"], family: ["Family", "Familia"], friend: ["Friend", "Amistad"], other: ["Support person", "Apoyo"] };
function PendingInvite({ invite, api, t, reload }: { invite: Invite; api: Api; t: Tx; reload: () => Promise<void> }) {
  const days = Math.max(1, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 86_400_000));
  return (
    <Card pad={false}>
      <Row title={`${invite.name} · ${t(...REL[invite.relationship])}`} sub={t(`Invited · waiting for them to join · code expires in ${days} day${days > 1 ? "s" : ""}`, `Invitada · esperando · el código vence en ${days} día${days > 1 ? "s" : ""}`)}
        right={<Pressable testID={`cancel-invite-${invite.name}`} onPress={async () => { await api.cancelInvite(invite.id); await reload(); }}><T style={{ fontFamily: F.sans600, color: C.clayInk }}>{t("Cancel", "Cancelar")}</T></Pressable>} />
    </Card>
  );
}
function SharingCard({ partner, api, t, reload }: { partner: SupportPerson; api: Api; t: Tx; reload: () => Promise<void> }) {
  const first = partner.name.split(" ")[0]!;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toggle = async (k: Shareable, on: boolean) => {
    if (busy) return;
    setBusy(true);
    const next = on ? [...partner.sections, k] : partner.sections.filter((s) => s !== k);
    try { await api.setSharing(partner.userId, next); await reload(); } finally { setBusy(false); }
  };
  return (
    <>
      <Card pad={false}>
        <View style={[st.row, { borderTopWidth: 0 }]}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flex: 1 }}>
            <Avatar text={initialsOf(partner.name)} size={34} />
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans700, fontSize: 15.5 }}>{t(`Sharing with ${first}`, `Compartir con ${first}`)}</T><Muted>{t(...REL[partner.relationship])}{partner.sections.length === 0 ? t(" · sees nothing right now", " · no ve nada por ahora") : ""}</Muted></View>
          </View>
        </View>
        {SHARE_OPTIONS.map(([k, en, enSub, es, esSub]) => (
          <View key={k} style={st.row}>
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t(en, es)}</T><Muted>{t(enSub, esSub)}</Muted></View>
            <Toggle testID={`share-${first}-${k}`} value={partner.sections.includes(k)} disabled={busy} onChange={(v) => toggle(k, v)} />
          </View>
        ))}
        <View style={st.row}>
          <Pressable testID={`remove-${first}`} onPress={async () => { if (!confirm) { setConfirm(true); return; } setBusy(true); try { await api.removePerson(partner.userId); await reload(); } finally { setBusy(false); } }}>
            <T style={{ fontFamily: F.sans600, color: C.clayInk }}>{confirm ? t(`Tap again to remove ${first}`, `Toca de nuevo para quitar a ${first}`) : t(`Remove ${first}`, `Quitar a ${first}`)}</T>
          </Pressable>
        </View>
      </Card>
    </>
  );
}

// ---------- Invite a support person ----------
const RELATIONSHIPS: Relationship[] = ["partner", "family", "friend", "other"];
function InviteScreen({ api, t, reload, done }: { api: Api; t: Tx; reload: () => Promise<void>; done: () => void }) {
  const [name, setName] = useState("");
  const [rel, setRel] = useState<Relationship>("partner");
  const [contact, setContact] = useState("");
  const [sections, setSections] = useState<Shareable[]>(["schedule", "meds"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const first = name.trim().split(" ")[0] || t("them", "esa persona");

  if (made) {
    const message = t(
      `I'd like you to follow along with my care at Bayside Fertility. Download the Bayside Fertility app, tap "I have an invite code" and enter ${made.code}. The code works once and expires in 7 days.`,
      `Me gustaría que me acompañes en mi tratamiento en Bayside Fertility. Descarga la app de Bayside Fertility, toca "Tengo un código de invitación" e ingresa ${made.code}. El código funciona una vez y vence en 7 días.`);
    // Send straight to the number or email Maya entered, with the message filled in.
    const isEmail = contact.includes("@");
    const to = isEmail ? contact.trim() : contact.replace(/[^0-9+]/g, "");
    const url = isEmail
      ? `mailto:${to}?subject=${encodeURIComponent(t("Follow along with me at Bayside Fertility", "Acompáñame en Bayside Fertility"))}&body=${encodeURIComponent(message)}`
      : `sms:${to}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(message)}`;
    const send = async () => {
      setSendNote(null);
      try { await Linking.openURL(url); }
      catch { setSendNote(t(`Couldn't open ${isEmail ? "Mail" : "Messages"} here. Copy the code and send it yourself.`, `No se pudo abrir ${isEmail ? "el correo" : "Mensajes"}. Copia el código y envíalo tú.`)); }
    };
    const copy = async () => { await Clipboard.setStringAsync(made.code); setCopied(true); };
    return (
      <>
        <H1>{t(`Send ${first} the invite`, `Envía la invitación a ${first}`)}</H1>
        <View style={st.dark}>
          <T style={{ fontSize: 13, color: C.tan }}>{t("Invite code", "Código de invitación")}</T>
          <Text testID="invite-made-code" selectable numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 36, letterSpacing: 3, color: C.paper }}>{made.code}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <T style={{ fontSize: 13.5, color: "#E9DED3" }}>{t("Works once. Expires in 7 days.", "Funciona una vez. Vence en 7 días.")}</T>
            <Pressable testID="copy-code" accessibilityLabel={t("Copy code", "Copiar código")} onPress={copy} style={{ borderRadius: 999, borderWidth: 1, borderColor: C.tan, paddingHorizontal: 14, paddingVertical: 8 }}>
              <T style={{ fontFamily: F.sans600, color: C.paper }}>{copied ? t("Copied ✓", "Copiado ✓") : t("Copy code", "Copiar código")}</T>
            </Pressable>
          </View>
        </View>
        <Button testID="send-invite" label={isEmail ? t(`Email ${first}`, `Enviar correo a ${first}`) : t(`Text ${first}`, `Enviar mensaje a ${first}`)} onPress={send} />
        <Muted>{isEmail
          ? t(`Opens your email with ${to} and the invite already filled in. You just tap send.`, `Abre tu correo con ${to} y la invitación ya escrita. Solo tienes que enviarla.`)
          : t(`Opens Messages with ${to} and the invite already filled in. You just tap send.`, `Abre Mensajes con ${to} y la invitación ya escrita. Solo tienes que enviarla.`)}</Muted>
        {sendNote && <T style={{ color: C.clayInk }}>{sendNote}</T>}
        <Button testID="share-invite" kind="line" label={t("Other ways to send (WhatsApp and more)", "Otras formas de enviar (WhatsApp y más)")} onPress={() => { void Share.share({ message }).catch(() => setSendNote(t("Sharing isn't available here. Copy the code instead.", "No se puede compartir aquí. Copia el código."))); }} />
        <Muted>{t(`${first} will see only what you picked. You can change it or remove ${first} anytime in Settings.`, `${first} verá solo lo que elegiste. Puedes cambiarlo o quitar a ${first} cuando quieras en Ajustes.`)}</Muted>
        <Button kind="line" label={t("Done", "Listo")} onPress={done} />
      </>
    );
  }
  const create = async () => {
    setBusy(true); setError(null);
    try { setMade(await api.createInvite({ name, relationship: rel, contact, sections })); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <H1>{t("Invite a support person", "Invita a una persona de apoyo")}</H1>
      <Muted>{t("A partner, family member or friend. They'll see only what you choose.", "Tu pareja, un familiar o una amistad. Solo verá lo que elijas.")}</Muted>
      <Card style={{ gap: 10 }}>
        <Cap>{t("Their name", "Su nombre")}</Cap>
        <TextInput testID="invite-person-name" style={st.input} value={name} onChangeText={setName} placeholder={t("First and last name", "Nombre y apellido")} placeholderTextColor={C.stone} />
        <Cap>{t("Who are they to you?", "¿Quién es para ti?")}</Cap>
        <Chips>{RELATIONSHIPS.map((r) => <Chip key={r} testID={`rel-${r}`} label={t(...REL[r])} selected={rel === r} onPress={() => setRel(r)} />)}</Chips>
        <Cap>{t("Their mobile number or email", "Su celular o correo")}</Cap>
        <TextInput testID="invite-contact" style={st.input} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" placeholder={t("(813) 555-0142 or name@email.com", "(813) 555-0142 o nombre@correo.com")} placeholderTextColor={C.stone} />
      </Card>
      <Cap>{t(`What ${first} can see`, `Qué puede ver ${first}`)}</Cap>
      <Card pad={false}>
        {SHARE_OPTIONS.map(([k, en, enSub, es, esSub], i) => (
          <View key={k} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t(en, es)}</T><Muted>{t(enSub, esSub)}</Muted></View>
            <Toggle testID={`invite-share-${k}`} value={sections.includes(k)} onChange={(v) => setSections(v ? [...sections, k] : sections.filter((x) => x !== k))} />
          </View>
        ))}
        <View style={st.row}><Muted style={{ flex: 1 }}>{t("Messages with your care team are never shared.", "Los mensajes con tu equipo nunca se comparten.")}</Muted></View>
      </Card>
      {error && <T testID="invite-form-error" style={{ color: C.red }}>{error}</T>}
      <Button testID="create-invite" label={busy ? t("Creating…", "Creando…") : t("Create invite", "Crear invitación")} disabled={busy || !name.trim() || !contact.trim() || sections.length === 0} onPress={create} />
    </>
  );
}

// ---------- Urgent ----------
function Urgent({ kind, t, back }: { kind: SendResult["kind"]; t: Tx; back: () => void }) {
  const crisis = kind === "crisis";
  return (
    <>
      <View style={[st.card, { padding: 16, gap: 10, borderColor: C.red, borderWidth: 1.5, borderBottomColor: C.red }]}>
        <Pill tone="red" label={t("Safety check · not an AI answer", "Control de seguridad · no es una respuesta de IA")} />
        <Text testID="urgent-title" style={{ fontFamily: F.serifItalic, fontSize: 32, lineHeight: 34, color: C.red }}>{crisis ? t("You don't have to go through this alone.", "No tienes que pasar por esto sola.") : t("This needs a nurse now.", "Esto necesita a una enfermera ahora.")}</Text>
        <T style={{ fontSize: 15, lineHeight: 22 }}>{crisis
          ? t("Call or text 988 any time to reach the Suicide & Crisis Lifeline. We've also let Bayside's care team know.", "Llama o envía un mensaje al 988 en cualquier momento para hablar con la Línea de Prevención del Suicidio y Crisis. También avisamos al equipo de Bayside.")
          : t("Kinpath didn't try to answer this. We've put it at the top of your nurse's list. Please call the nurse line now.", "Kinpath no intentó responder esto. Lo pusimos primero en la lista de tu enfermera. Por favor llama a enfermería ahora.")}</T>
        {crisis ? <Button kind="red" label={t("Call or text 988", "Llamar o escribir al 988")} onPress={() => Linking.openURL("tel:988")} /> : <Button kind="red" label={t("Call the nurse line now", "Llamar a enfermería ahora")} onPress={() => Linking.openURL(NURSE_LINE)} />}
        <T style={{ fontFamily: F.sans600 }}>{t("If you can't catch your breath or have chest pain, call 911.", "Si no puedes respirar bien o tienes dolor de pecho, llama al 911.")}</T>
      </View>
      <Button kind="line" label={t("Back to today", "Volver a hoy")} onPress={back} />
    </>
  );
}

// ---------- Partner side ----------
// English only for now; partner Spanish follows once the medical translator has reviewed the patient text.
type PScreen = { name: "home" } | { name: "walk"; doses: Dose[]; focus?: string } | { name: "settings" } | { name: "urgent"; level: "urgent" | "crisis" };
// Injection offers only appear when injections are shared with this person.
const quickNotes = (meds: boolean) => meds
  ? ["So proud of you", "I'll set up tonight's meds", "Want me to do the injection?", "Dinner's on me tonight"]
  : ["Thinking of you today", "So proud of you", "Whatever you need, I'm here", "Dinner's on me tonight"];
const label = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function PartnerApp({ api, initials, onSignOut }: { api: Api; initials: string; onSignOut: () => void }) {
  const [data, setData] = useState<PartnerHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<PScreen>({ name: "home" });
  const load = useCallback(async () => {
    try { setData(await api.partnerHome()); setError(null); } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Frame><Today size={34}>Can't reach Bayside</Today><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Frame>;
  if (!data) return <Frame><Muted>Loading…</Muted></Frame>;
  const home = () => { void load(); setScreen({ name: "home" }); };
  const top = screen.name === "home"
    ? <TopBar clinic={data.clinic.name} initials={initials} onAvatar={() => setScreen({ name: "settings" })} />
    : <BackBar label="Home" onBack={home} />;
  const her = data.shared ? data.firstName ?? "your partner" : "your partner";
  const t: Tx = (en) => en;

  return (
    <Frame top={top}>
      {screen.name === "home" && (data.shared
        ? <PartnerHomeScreen data={data} api={api} go={setScreen} reload={load} />
        : (
          <>
            <Today size={34}>Nothing shared right now</Today>
            <Muted>When your partner shares parts of her treatment with you in her Bayside app, they'll show up here.</Muted>
            <Button kind="plain" label="Switch test person" onPress={onSignOut} />
          </>
        ))}
      {screen.name === "walk" && <Walk doses={screen.doses} focus={screen.focus} api={api} lang="en" t={t} done={home} helper={her} somethingWrong={() => Linking.openURL(NURSE_LINE)} />}
      {screen.name === "urgent" && <PartnerUrgent level={screen.level} her={her} back={home} />}
      {screen.name === "settings" && (
        <>
          <H1>Your access</H1>
          <Card style={{ gap: 8 }}>
            <T style={{ fontSize: 15, lineHeight: 22 }}>{data.shared ? `You see what ${her} chooses to share: ${data.sections.map((s) => ({ schedule: "her cycle", meds: "injections", results: "results" })[s]).join(", ")}.` : "Nothing is shared with you right now."}</T>
            <Muted>{`${her === "your partner" ? "Her" : `${her}'s`} messages with the care team are always private. She can change what you see at any time, and Bayside keeps a record each time you look.`}</Muted>
          </Card>
          <Button kind="plain" label="Switch test person" onPress={onSignOut} />
        </>
      )}
    </Frame>
  );
}

function PartnerHomeScreen({ data, api, go, reload }: { data: Extract<PartnerHome, { shared: true }>; api: Api; go: (s: PScreen) => void; reload: () => Promise<void> }) {
  const her = data.firstName ?? "your partner";
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = data.schedule?.upcoming.filter((d) => !d.takenAt) ?? [];
  const nextAt = pending[0]?.scheduledFor;
  const tonight = pending.filter((d) => d.scheduledFor === nextAt);
  const loggedToday = data.schedule ? [...data.schedule.upcoming, ...data.schedule.recent].filter((d) => d.takenAt && Math.abs(Date.now() - new Date(d.scheduledFor).getTime()) < 24 * 3600_000) : [];
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.sendNote(text);
      setNote("");
      if (r.level !== "routine") { go({ name: "urgent", level: r.level }); return; }
      setSent(true);
      await reload();
    } finally { setBusy(false); }
  };

  return (
    <>
      <View style={{ gap: 4 }}>
        <Cap>{`Supporting ${her}`}</Cap>
        <Today>{`Hi ${data.name.split(" ")[0]}.`}</Today>
        <Muted>{data.stimDay ? `${her} is on stimulation, day ${data.stimDay}. Small things help a lot right now.` : "Small things help a lot right now."}</Muted>
      </View>

      {data.sections.includes("schedule") && <JourneyPath current={stageIndex(data.stage)} labels={STAGES} />}

      {data.sections.includes("meds") && (
        <View style={{ gap: 8 }}>
          <Cap>Tonight</Cap>
          {tonight.length > 0 ? (
            <View style={st.dark}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={{ fontFamily: F.serif, fontSize: 26, letterSpacing: -0.5, color: C.paper }}>{clock(nextAt!)}</Text>
                <T style={{ fontSize: 13, color: C.tan }}>{`${tonight.length} injection${tonight.length > 1 ? "s" : ""}`}</T>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {tonight.map((d) => (
                  <Pressable key={d.id} onPress={() => go({ name: "walk", doses: tonight, focus: d.medication })} style={st.medchip}>
                    <T style={{ fontSize: 13.5, color: C.paper }}>{d.medication}</T>
                  </Pressable>
                ))}
              </View>
              <Button testID="help-tonight" label="How to help with tonight's injections" onPress={() => go({ name: "walk", doses: tonight })} />
            </View>
          ) : (
            <View style={st.dark}>
              <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.paper }}>All set for tonight</Text>
              <T style={{ fontSize: 14.5, color: "#E9DED3" }}>{`${her} logged ${loggedToday.length}. Bayside can see them.`}</T>
            </View>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Cap>{`Send ${her} a note`}</Cap>
        {sent && <Moment>{`Sent. ${her} will see it on her home screen.`}</Moment>}
        <Chips>{quickNotes(data.sections.includes("meds")).map((q) => <Chip key={q} label={q} onPress={() => { setSent(false); setNote(q); }} />)}</Chips>
        <AskBox testID="note" value={note} onChange={(v) => { setSent(false); setNote(v); }} onSubmit={() => send(note)} placeholder={`Write something for ${her}`} />
        <Muted style={{ fontSize: 12 }}>{`Notes go to ${her}, not to the clinic. If something's wrong medically, call the nurse line.`}</Muted>
        {data.notes.length > 0 && (
          <Card pad={false}>
            {data.notes.map((n, i) => <Row key={n.id} title={n.body} sub={dayClock(n.createdAt)} right={<Pill tone={n.seenAt ? "sage" : "stone"} label={n.seenAt ? "Seen" : "Sent"} />} />)}
          </Card>
        )}
      </View>

      {data.results && (
        <View style={{ gap: 8 }}>
          <Cap>Results</Cap>
          <Card pad={false}>
            {data.results.length === 0 && <Row title="No results yet" />}
            {data.results.map((r) => (
              <Row key={r.id} title={`${label(r.analyte)} ${r.value} ${r.unit}`} sub={r.status === "in_range" ? r.text : `${her}'s nurse will go over this with her.`}
                right={<Pill tone={r.status === "in_range" ? "sage" : "clay"} label={r.status === "in_range" ? "In Bayside's range" : "Nurse reviewing"} />} />
            ))}
          </Card>
        </View>
      )}

      <View style={{ backgroundColor: C.lav, borderRadius: 18, padding: 16, gap: 6 }}>
        <T style={{ fontFamily: F.sans700, fontSize: 15, color: C.lavDeep }}>{`What ${her} shares with you`}</T>
        <T testID="shared-list" style={{ color: C.lavDeep }}>{data.sections.map((s) => ({ schedule: "Her cycle", meds: "Injections", results: "Results" })[s]).join(" · ")}</T>
        <T style={{ color: C.lavDeep, fontSize: 13 }}>Her messages with the care team are always private. She can change this anytime.</T>
      </View>
    </>
  );
}

function PartnerUrgent({ level, her, back }: { level: "urgent" | "crisis"; her: string; back: () => void }) {
  const crisis = level === "crisis";
  return (
    <>
      <View style={[st.card, { padding: 16, gap: 10, borderColor: C.red, borderWidth: 1.5, borderBottomColor: C.red }]}>
        <Pill tone="red" label="Safety check · not an AI answer" />
        <Text testID="urgent-title" style={{ fontFamily: F.serifItalic, fontSize: 32, lineHeight: 34, color: C.red }}>{crisis ? "Please reach out now." : "This needs a nurse now."}</Text>
        <T style={{ fontSize: 15, lineHeight: 22 }}>{crisis
          ? `If ${her} may be thinking about hurting herself, call or text 988 now and stay with her. Your note went to ${her}, but Bayside doesn't see notes.`
          : `Your note went to ${her}, but Bayside doesn't see notes. Please call Bayside's nurse line now, or help ${her} call.`}</T>
        {crisis ? <Button kind="red" label="Call or text 988" onPress={() => Linking.openURL("tel:988")} /> : <Button kind="red" label="Call the nurse line now" onPress={() => Linking.openURL(NURSE_LINE)} />}
        <T style={{ fontFamily: F.sans600 }}>{`If ${her} can't catch her breath, has chest pain, or passes out, call 911.`}</T>
      </View>
      <Button kind="line" label="Back" onPress={back} />
    </>
  );
}

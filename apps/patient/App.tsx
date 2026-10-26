import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Api, type Dose, type Guide, type SendResult, type Today } from "./src/api";
import { askPermission, remindersSupported, syncReminders } from "./src/reminders";
import { Button, C, Card, Moment, Muted, Pill, s, Title } from "./src/ui";

// DEV ONLY: synthetic seed patients. Real passwordless sign-in replaces this screen.
const DEV_PATIENTS = [
  { id: "00000000-0000-4000-8000-000000000010", name: "Maya Torres", note: "Stimulation day 6, English" },
  { id: "00000000-0000-4000-8000-000000000012", name: "Priya Shah", note: "Prefers Spanish" },
];
const NURSE_LINE = "tel:+18135550100"; // placeholder number

type Screen = { name: "today" } | { name: "walk"; doses: Dose[] } | { name: "messages" } | { name: "settings" } | { name: "urgent"; kind: SendResult["kind"] };

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  if (!userId) return <DevSignIn onPick={setUserId} />;
  return <Signed api={new Api(userId)} onSignOut={() => setUserId(null)} />;
}

function DevSignIn({ onPick }: { onPick: (id: string) => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.oat }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Muted>Kinpath dev build · synthetic data only</Muted>
        <Title>Who are you testing as?</Title>
        {DEV_PATIENTS.map((p) => (
          <Pressable key={p.id} testID={`pick-${p.name}`} onPress={() => onPick(p.id)}>
            <Card><Text style={{ fontSize: 17, fontWeight: "700" }}>{p.name}</Text><Muted>{p.note}</Muted></Card>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Signed({ api, onSignOut }: { api: Api; onSignOut: () => void }) {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "today" });
  const [scheduled, setScheduled] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api.today();
      setData(d); setError(null);
      setScheduled(await syncReminders(d.reminders));
    } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Shell><Title>Can't reach Bayside</Title><Muted>{error}</Muted><Button label="Try again" onPress={load} /></Shell>;
  if (!data) return <Shell><Muted>Loading…</Muted></Shell>;
  const t = (en: string, es: string) => (data.lang === "es" ? es : en);
  const go = (sc: Screen) => setScreen(sc);
  const afterSend = (r: SendResult) => (r.kind === "urgent_symptom" || r.kind === "crisis" ? go({ name: "urgent", kind: r.kind }) : (void load(), go({ name: "today" })));

  return (
    <Shell tabs={<Tabs current={screen.name} t={t} go={go} unread={data.inbox.filter((m) => m.status === "sent").length} />}>
      <Muted style={{ marginBottom: 2 }}>{data.clinic.name} · powered by Kinpath</Muted>
      {screen.name === "today" && <TodayScreen data={data} api={api} t={t} go={go} reload={load} afterSend={afterSend} />}
      {screen.name === "walk" && <Walkthrough doses={screen.doses} api={api} lang={data.lang} t={t} done={() => { void load(); go({ name: "today" }); }} />}
      {screen.name === "messages" && <Messages data={data} api={api} t={t} reload={load} afterSend={afterSend} />}
      {screen.name === "settings" && <Settings data={data} api={api} t={t} reload={load} scheduled={scheduled} onSignOut={onSignOut} />}
      {screen.name === "urgent" && <Urgent kind={screen.kind} t={t} back={() => { void load(); go({ name: "today" }); }} />}
    </Shell>
  );
}

function Shell({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.oat }}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>{children}</ScrollView>
      {tabs}
    </SafeAreaView>
  );
}

function Tabs({ current, t, go, unread }: { current: string; t: (en: string, es: string) => string; go: (s: Screen) => void; unread: number }) {
  const items: [Screen["name"], string][] = [["today", t("Today", "Hoy")], ["messages", t("Messages", "Mensajes") + (unread ? ` (${unread})` : "")], ["settings", t("Settings", "Ajustes")]];
  return (
    <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.linen, backgroundColor: C.paper, padding: 8, gap: 8 }}>
      {items.map(([name, label]) => (
        <Pressable key={name} testID={`tab-${name}`} onPress={() => go({ name } as Screen)} style={{ flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center", backgroundColor: current === name ? C.espresso : "transparent" }}>
          <Text style={{ color: current === name ? "#fff" : C.stone, fontWeight: "600" }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TodayScreen({ data, api, t, go, reload, afterSend }: { data: Today; api: Api; t: (en: string, es: string) => string; go: (s: Screen) => void; reload: () => Promise<void>; afterSend: (r: SendResult) => void }) {
  const next = data.schedule.upcoming;
  const nextTime = next[0]?.scheduledFor;
  const tonight = next.filter((d) => d.scheduledFor === nextTime);
  const newReplies = data.inbox.filter((m) => m.status === "sent");
  return (
    <View>
      <Title>{t("Today", "Hoy")}</Title>
      <Muted>{data.stimDay ? t(`Stimulation, day ${data.stimDay}. `, `Estimulación, día ${data.stimDay}. `) : ""}{data.clinic.replyWindow[data.lang]} {t("Urgent? Call the nurse line anytime.", "¿Urgente? Llama a enfermería a cualquier hora.")}</Muted>

      {newReplies.length > 0 && (
        <Pressable onPress={() => go({ name: "messages" })}><Card style={{ borderColor: C.marigold, marginTop: 14 }}><Text style={{ fontWeight: "700" }}>{t("New reply from your care team", "Nueva respuesta de tu equipo")}</Text><Muted>{t("Tap to read it.", "Toca para leerla.")}</Muted></Card></Pressable>
      )}

      {data.schedule.missed.map((d) => <MissedDose key={d.id} dose={d} api={api} t={t} reload={reload} afterSend={afterSend} />)}

      {tonight.length > 0 && (
        <View style={{ backgroundColor: C.espresso, borderRadius: 20, padding: 18, marginTop: 14 }}>
          <Text style={{ color: "#F6F1E8", fontSize: 13 }}>{t("Next injections", "Próximas inyecciones")} · {time(nextTime!)}</Text>
          <Text style={{ color: "#fff", fontSize: 22, marginVertical: 6 }}>{tonight.map((d) => d.medication).join(", ")}</Text>
          <Text style={{ color: "#E6DED2", fontSize: 14 }}>{t("We'll walk you through each one, step by step.", "Te guiaremos en cada una, paso a paso.")}</Text>
          <Button testID="start-walkthrough" label={t("Start walkthrough", "Empezar guía")} onPress={() => go({ name: "walk", doses: tonight })} />
        </View>
      )}
      {next.length === 0 && data.schedule.missed.length === 0 && <Moment>{t("Nothing left for today. Rest up.", "No queda nada por hoy. Descansa.")}</Moment>}

      <Text style={s.h2}>{t("Results", "Resultados")}</Text>
      <Card>
        {data.results.length === 0 && <Muted>{t("No results yet.", "Aún no hay resultados.")}</Muted>}
        {data.results.map((r) => (
          <View key={r.id} style={s.row}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: "700", textTransform: "capitalize" }}>{r.analyte} <Text style={{ fontWeight: "400" }}>{r.value} {r.unit}</Text></Text><Muted>{r.text}</Muted></View>
            <Pill label={r.status === "in_range" ? t("In range", "En rango") : t("Nurse reviewing", "En revisión")} tone={r.status === "in_range" ? "sage" : "clay"} />
          </View>
        ))}
      </Card>

      <Text style={s.h2}>{t("Recent doses", "Dosis recientes")}</Text>
      <Card>
        {data.schedule.recent.slice(0, 6).map((d) => (
          <View key={d.id} style={s.row}>
            <Text>{d.medication} <Text style={{ color: C.stone }}>{time(d.scheduledFor)}</Text></Text>
            {d.takenAt ? <Pill label={t("Logged", "Registrada")} tone="sage" /> : d.reportedMissed ? <Pill label={t("With your nurse", "Con tu enfermera")} tone="clay" /> : <Pill label={t("Not logged", "Sin registrar")} tone="lav" />}
          </View>
        ))}
      </Card>
    </View>
  );
}

function MissedDose({ dose, api, t, reload, afterSend }: { dose: Dose; api: Api; t: (en: string, es: string) => string; reload: () => Promise<void>; afterSend: (r: SendResult) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ marginTop: 14 }}>
      <Text style={{ fontWeight: "700", fontSize: 16 }}>{t(`${dose.medication} at ${time(dose.scheduledFor)} isn't logged`, `${dose.medication} de las ${time(dose.scheduledFor)} no está registrada`)}</Text>
      <Muted>{t("Took it late? Log it. Missed it? Tell your nurse here instead of calling. She'll get your dose log with it.", "¿La tomaste tarde? Regístrala. ¿La olvidaste? Avísale a tu enfermera aquí en vez de llamar. Recibirá tu registro de dosis.")}</Muted>
      <TextInput testID="missed-note" style={[s.input, { marginTop: 10 }]} multiline placeholder={t("Anything else? (optional)", "¿Algo más? (opcional)")} value={note} onChangeText={setNote} />
      <Button testID="took-late" kind="line" label={t("I took it late", "La tomé tarde")} disabled={busy} onPress={async () => { setBusy(true); await api.logDose(dose.id); await reload(); }} />
      <Button testID="missed-it" label={t("I missed this dose", "Olvidé esta dosis")} disabled={busy} onPress={async () => { setBusy(true); afterSend(await api.reportMissed(dose.id, note)); }} />
    </Card>
  );
}

function Walkthrough({ doses, api, lang, t, done }: { doses: Dose[]; api: Api; lang: "en" | "es"; t: (en: string, es: string) => string; done: () => void }) {
  const [i, setI] = useState(0); // which medication
  const [step, setStep] = useState(0);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [logged, setLogged] = useState<string[]>([]);
  const dose = doses[i];
  useEffect(() => { if (dose) { setGuide(null); setStep(0); api.guide(dose.medication).then(setGuide).catch(() => setGuide({ medication: dose.medication, steps: [], videoUrl: null, approvedBy: "" })); } }, [dose, api]);

  if (!dose) {
    return <View><Title>{t("All done for tonight.", "Listo por esta noche.")}</Title><Moment>{t(`You logged ${logged.length} of ${doses.length}. Your nurse can see them.`, `Registraste ${logged.length} de ${doses.length}. Tu enfermera puede verlas.`)}</Moment><Button label={t("Back to today", "Volver a hoy")} onPress={done} /></View>;
  }
  const steps = guide?.steps ?? [];
  const onLast = step >= steps.length - 1;
  return (
    <View>
      {logged.length === 1 && <Moment>{t("First one done. The hardest part is behind you.", "La primera, lista. Lo más difícil ya pasó.")}</Moment>}
      <Muted>{t(`Injection ${i + 1} of ${doses.length}`, `Inyección ${i + 1} de ${doses.length}`)}</Muted>
      <Title>{dose.medication}</Title>
      <Muted>{dose.dose}</Muted>
      {!guide && <Muted>{t("Loading steps…", "Cargando pasos…")}</Muted>}
      {guide && steps.length === 0 && <Card><Text>{t("No walkthrough yet. Follow your nurse's instructions, then log it.", "Aún no hay guía. Sigue las instrucciones de tu enfermera y luego regístrala.")}</Text></Card>}
      {guide && steps.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <Muted>{t(`Step ${step + 1} of ${steps.length}`, `Paso ${step + 1} de ${steps.length}`)}</Muted>
          <Text testID="step-text" style={{ fontSize: 19, lineHeight: 27, marginTop: 6 }}>{steps[step]![lang]}</Text>
          <Muted style={{ marginTop: 10, fontSize: 12 }}>{t("Written by your care team · approved by", "Escrito por tu equipo · aprobado por")} {guide.approvedBy}</Muted>
        </Card>
      )}
      {guide && !onLast && steps.length > 0 && <Button testID="next-step" label={t("Next step", "Siguiente paso")} onPress={() => setStep(step + 1)} />}
      {guide && (onLast || steps.length === 0) && (
        <Button testID="log-dose" label={t(`Log ${dose.medication}`, `Registrar ${dose.medication}`)} onPress={async () => { await api.logDose(dose.id); setLogged([...logged, dose.id]); setI(i + 1); }} />
      )}
      {step > 0 && <Button kind="line" label={t("Back", "Atrás")} onPress={() => setStep(step - 1)} />}
      <Pressable onPress={() => Linking.openURL(NURSE_LINE)} style={{ marginTop: 16 }}><Text style={{ color: C.red, fontWeight: "600" }}>{t("Something feels wrong? Call the nurse line.", "¿Algo no se siente bien? Llama a enfermería.")}</Text></Pressable>
    </View>
  );
}

function Messages({ data, api, t, reload, afterSend }: { data: Today; api: Api; t: (en: string, es: string) => string; reload: () => Promise<void>; afterSend: (r: SendResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View>
      <Title>{t("Your care team", "Tu equipo")}</Title>
      <Muted>{data.clinic.replyWindow[data.lang]}</Muted>
      {data.inbox.map((m) => (
        <Card key={m.id} style={{ marginTop: 12, ...(m.status === "sent" ? { borderColor: C.marigold } : {}) }}>
          <Muted style={{ fontSize: 12 }}>{t("You wrote", "Escribiste")}: “{m.patientMessage}”</Muted>
          {m.sentText ? (
            <>
              <Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22 }}>{m.sentText}</Text>
              <Muted style={{ fontSize: 12, marginTop: 4 }}>{m.sender}</Muted>
              {m.status === "sent" && <Button testID="got-it" kind="line" label={t("Got it", "Entendido")} onPress={async () => { await api.markRead(m.id); await reload(); }} />}
            </>
          ) : <View style={{ marginTop: 8 }}><Pill label={t("Waiting for your nurse", "Esperando a tu enfermera")} tone="lav" /></View>}
        </Card>
      ))}
      <Text style={s.h2}>{t("New message", "Nuevo mensaje")}</Text>
      <TextInput testID="message-text" style={s.input} multiline value={text} onChangeText={setText} placeholder={t("Ask anything. If it sounds urgent, we'll page the on-call nurse.", "Pregunta lo que quieras. Si suena urgente, avisaremos a la enfermera de guardia.")} />
      <Button testID="send-message" kind="dark" label={t("Send", "Enviar")} disabled={busy || !text.trim()} onPress={async () => { setBusy(true); const r = await api.sendMessage(text); setText(""); setBusy(false); afterSend(r); }} />
    </View>
  );
}

function Settings({ data, api, t, reload, scheduled, onSignOut }: { data: Today; api: Api; t: (en: string, es: string) => string; reload: () => Promise<void>; scheduled: number; onSignOut: () => void }) {
  const [perm, setPerm] = useState<string | null>(null);
  return (
    <View>
      <Title>{t("Settings", "Ajustes")}</Title>
      <Text style={s.h2}>{t("Reminders", "Recordatorios")}</Text>
      <Card>
        <Muted>{remindersSupported
          ? t(`${scheduled} reminder(s) set on this phone. Dose reminders still ring during quiet hours (${data.prefs.quietStart}–${data.prefs.quietEnd}); follow-ups wait until morning.`, `${scheduled} recordatorio(s) en este teléfono. Los recordatorios de dosis suenan aun en horas de silencio (${data.prefs.quietStart}–${data.prefs.quietEnd}); los seguimientos esperan a la mañana.`)
          : t("Reminders work in the phone app, not in a web browser.", "Los recordatorios funcionan en la app del teléfono, no en el navegador.")}</Muted>
        {remindersSupported && <Button kind="line" label={t("Turn on reminders", "Activar recordatorios")} onPress={async () => { const ok = await askPermission(); setPerm(ok ? t("Reminders are on.", "Recordatorios activados.") : t("Reminders are off in your phone settings.", "Los recordatorios están desactivados en los ajustes del teléfono.")); await reload(); }} />}
        {perm && <Muted style={{ marginTop: 8 }}>{perm}</Muted>}
        <View style={[s.row, { borderBottomWidth: 0, marginTop: 6 }]}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: "600" }}>{t("Show medication names on the lock screen", "Mostrar nombres de medicamentos en la pantalla de bloqueo")}</Text><Muted>{t("Off keeps it private: \"You have a reminder.\"", "Desactivado es privado: \"Tienes un recordatorio.\"")}</Muted></View>
          <Switch testID="lock-detail" value={data.prefs.lockScreenDetail} onValueChange={async (v) => { await api.setLockScreenDetail(v); await reload(); }} />
        </View>
      </Card>
      <Text style={s.h2}>{t("Planned reminders", "Recordatorios programados")}</Text>
      <Card>
        {data.reminders.length === 0 && <Muted>{t("None right now.", "Ninguno por ahora.")}</Muted>}
        {data.reminders.map((r) => <View key={r.key} style={s.row}><Text>{time(r.at)}</Text><Muted>{r.body}</Muted></View>)}
      </Card>
      <Button kind="line" label={t("Switch test patient", "Cambiar paciente de prueba")} onPress={onSignOut} />
    </View>
  );
}

function Urgent({ kind, t, back }: { kind: SendResult["kind"]; t: (en: string, es: string) => string; back: () => void }) {
  const crisis = kind === "crisis";
  return (
    <View>
      <Card style={{ borderColor: C.red, borderWidth: 1.5, marginTop: 12 }}>
        <Pill label={t("Safety check · not an AI answer", "Control de seguridad · no es una respuesta de IA")} tone="red" />
        <Text testID="urgent-title" style={{ fontSize: 28, color: C.red, marginVertical: 10, fontStyle: "italic" }}>{crisis ? t("You don't have to go through this alone.", "No tienes que pasar por esto sola.") : t("This needs a nurse now.", "Esto necesita a una enfermera ahora.")}</Text>
        <Text style={{ fontSize: 15, lineHeight: 22 }}>{crisis
          ? t("Call or text 988 any time to reach the Suicide & Crisis Lifeline. We've also let Bayside's care team know.", "Llama o envía un mensaje al 988 en cualquier momento para hablar con la Línea de Prevención del Suicidio y Crisis. También avisamos al equipo de Bayside.")
          : t("Kinpath didn't try to answer this. We've put it at the top of your nurse's list. Please call the nurse line now.", "Kinpath no intentó responder esto. Lo pusimos primero en la lista de tu enfermera. Por favor llama a enfermería ahora.")}</Text>
        {crisis ? <Button kind="red" label={t("Call or text 988", "Llamar o escribir al 988")} onPress={() => Linking.openURL("tel:988")} /> : <Button kind="red" label={t("Call the nurse line", "Llamar a enfermería")} onPress={() => Linking.openURL(NURSE_LINE)} />}
        <Text style={{ marginTop: 12, fontWeight: "600" }}>{t("If you can't catch your breath or have chest pain, call 911.", "Si no puedes respirar bien o tienes dolor de pecho, llama al 911.")}</Text>
      </Card>
      <Button kind="line" label={t("Back to today", "Volver a hoy")} onPress={back} />
    </View>
  );
}

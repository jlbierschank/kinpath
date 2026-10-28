/**
 * Account screens shared by patients and support people: the notification inbox, notification
 * settings, and sign-in devices.
 */
import { SwipeRow } from "./swipe";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Api, AppNotification, Channel, NotificationSettings } from "./api";
import { Button, C, Cap, Card, F, H1, Moment, Muted, Pill, st, T, Toggle } from "./ui";

type Tx = (en: string, es: string) => string;

export function Bell({ unread, onPress, t }: { unread: number; onPress: () => void; t: Tx }) {
  return (
    <Pressable testID="bell" accessibilityLabel={unread ? t(`Notifications, ${unread} unread`, `Notificaciones, ${unread} sin leer`) : t("Notifications", "Notificaciones")} onPress={onPress}
      style={{ width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, alignItems: "center", justifyContent: "center" }}>
      <Svg width={19} height={19} viewBox="0 0 24 24"><Path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" fill="none" stroke={C.espresso} strokeWidth={1.8} strokeLinejoin="round" /></Svg>
      {unread > 0 && (
        <View testID="bell-count" style={{ position: "absolute", top: -4, right: -6, backgroundColor: C.red, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Text style={{ color: C.onRed, fontFamily: F.sans700, fontSize: 11 }}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const ago = (iso: string, t: Tx) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? t("just now", "ahora") : m < 60 ? t(`${m} min ago`, `hace ${m} min`) : m < 1440 ? t(`${Math.round(m / 60)} h ago`, `hace ${Math.round(m / 60)} h`) : new Date(iso).toLocaleDateString();
};

/** Opens a notification: marks it read and goes where it points. */
export function InboxScreen({ api, t, open, changed }: { api: Api; t: Tx; open: (n: AppNotification) => void; changed: () => void }) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const load = useCallback(async () => setItems((await api.notifications()).items), [api]);
  useEffect(() => { void load(); }, [load]);
  if (!items) return <Muted>{t("Loading…", "Cargando…")}</Muted>;
  const unread = items.filter((i) => !i.read).length;
  return (
    <>
      <H1>{t("Notifications", "Notificaciones")}</H1>
      <Muted>{unread ? t(`${unread} unread`, `${unread} sin leer`) : t("You're all caught up.", "Estás al día.")}</Muted>
      <Card pad={false}>
        {items.length === 0 && <View style={[st.row, { borderTopWidth: 0 }]}><Muted>{t("Nothing yet.", "Nada todavía.")}</Muted></View>}
        {items.map((n, i) => (
          <SwipeRow key={n.id} surface={C.paper} radius={0} right={n.read ? undefined : { label: t("Mark read", "Marcar leído"), bg: C.sage, fg: C.sageInk, run: async () => { await api.markNotificationsRead([n.id]); changed(); await load(); } }}>
          <Pressable testID="notification" onPress={async () => { await api.markNotificationsRead([n.id]); changed(); open(n); }} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flex: 1 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.read ? "transparent" : C.lavInk }} />
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: n.read ? F.sans : F.sans600, fontSize: 15 }}>{n.title}</T>
                <Muted style={{ fontSize: 12.5 }}>{ago(n.at, t)}</Muted>
              </View>
            </View>
          </Pressable>
          </SwipeRow>
        ))}
      </Card>
      {unread > 0 ? <Muted style={{ fontSize: 12.5, textAlign: "center" }}>{t("Tip: swipe right to mark one read.", "Consejo: desliza a la derecha para marcar como leído.")}</Muted> : null}
      {unread > 0 && <Button testID="mark-all-read" kind="line" label={t("Mark all read", "Marcar todo como leído")} onPress={async () => { await api.markNotificationsRead("all"); changed(); await load(); }} />}
    </>
  );
}

const CH: [Channel, string, string][] = [["in_app", "In the app", "En la app"], ["push", "Push", "Push"], ["sms", "Text", "Mensaje"], ["email", "Email", "Correo"]];

export function NotificationSettingsScreen({ api, t, lang }: { api: Api; t: Tx; lang: "en" | "es" }) {
  const [s, setS] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { api.notificationSettings().then((x) => { setS(x); setPhone(x.phone ?? ""); }).catch((e) => setError((e as Error).message)); }, [api]);
  if (!s) return <Muted>{error ?? t("Loading…", "Cargando…")}</Muted>;
  const save = async (change: Parameters<Api["saveNotificationSettings"]>[0], note?: string) => {
    setError(null); setSaved(null);
    try { setS(await api.saveNotificationSettings(change)); if (note) setSaved(note); } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <H1>{t("Notifications", "Notificaciones")}</H1>
      <Muted>{t("Choose which alerts you get and how. Texts, emails and lock-screen alerts never include health details, only \"You have a new update.\"", "Elige qué alertas recibes y cómo. Los mensajes, correos y alertas de la pantalla de bloqueo nunca incluyen detalles de salud, solo \"Tienes una novedad.\"")}</Muted>
      {error && <T testID="notif-error" style={{ color: C.red }}>{error}</T>}
      {s.kinds.map((k) => (
        <Card key={k.kind} style={{ gap: 6 }}>
          <T style={{ fontFamily: F.sans700, fontSize: 15 }}>{k.label[lang]}</T>
          <Muted>{k.description[lang]}</Muted>
          {CH.map(([ch, en, es]) => (
            <View key={ch} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 2 }}>
              <T>{t(en, es)}</T>
              <Toggle testID={`notif-${k.kind}-${ch}`} value={k.channels[ch]} onChange={(v) => save({ kind: k.kind, channels: { [ch]: v } })} />
            </View>
          ))}
        </Card>
      ))}
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans700, fontSize: 15 }}>{t("Quiet hours", "Horas de silencio")}</T><Muted>{t(`Hold push, texts and email from ${s.quiet.start} to ${s.quiet.end}. Medication reminders still ring.`, `Pausar push, mensajes y correos de ${s.quiet.start} a ${s.quiet.end}. Los recordatorios de medicamentos siguen sonando.`)}</Muted></View>
          <Toggle testID="quiet-hours" value={s.quiet.on} onChange={(v) => save({ quiet: { ...s.quiet, on: v } })} />
        </View>
      </Card>
      <Card style={{ gap: 8 }}>
        <Cap>{t("Mobile number for texts", "Celular para mensajes")}</Cap>
        <TextInput testID="notif-phone" style={st.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="(813) 555-0142" placeholderTextColor={C.stone} />
        <Button kind="line" label={t("Save number", "Guardar número")} onPress={() => save({ phone }, t("Saved.", "Guardado."))} />
        {saved && <T style={{ color: C.sageInk, fontSize: 13 }}>{saved}</T>}
      </Card>
    </>
  );
}

/** Sign out, and sign out of other devices. */
export function SignInSection({ api, t, onSignOut, demo }: { api: Api; t: Tx; onSignOut: () => void; demo: boolean }) {
  const [devices, setDevices] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!demo) api.sessions().then((x) => setDevices(x.length)).catch(() => {}); }, [api, demo]);
  return (
    <>
      <Cap>{t("Sign-in", "Inicio de sesión")}</Cap>
      <Card style={{ gap: 8 }}>
        <Muted>{demo
          ? t("You're using a demo test person.", "Estás usando una persona de prueba.")
          : t("You sign in with a one-time code. There's no password to remember.", "Entras con un código de un solo uso. No hay contraseña que recordar.")}</Muted>
        {devices !== null && devices > 1 && (
          <Button testID="signout-others" kind="line" label={t(`Sign out of your other ${devices - 1} device${devices > 2 ? "s" : ""}`, `Cerrar sesión en tus otros ${devices - 1} dispositivo${devices > 2 ? "s" : ""}`)}
            onPress={async () => { const r = await api.signOutOthers(); setDevices(1); setMsg(t(`Signed out of ${r.signedOut} device${r.signedOut === 1 ? "" : "s"}.`, `Se cerró la sesión en ${r.signedOut} dispositivo${r.signedOut === 1 ? "" : "s"}.`)); }} />
        )}
        {msg && <Moment>{msg}</Moment>}
        <Button testID="sign-out" kind="plain" label={demo ? t("Switch test person", "Cambiar persona de prueba") : t("Sign out", "Cerrar sesión")} onPress={onSignOut} />
      </Card>
    </>
  );
}

export { Pill };

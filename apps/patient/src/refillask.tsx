/**
 * Ask your clinic for a refill. In the clinic's app it's always there; in her own Pumpkin it shows when
 * she connected to her clinic and shares her medications. It reaches a nurse, who marks what happened.
 * A note that sounds urgent is treated as urgent: Pumpkin doesn't wait on it.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { Api, MyRefill, SendResult } from "./api";
import { Button, C, Card, Chip, Chips, F, Muted, T } from "./ui";
import { Field } from "./field";

type Tx = (en: string, es: string) => string;
const en: Tx = (e) => e;

export function RefillAsk({ meds, clinicName, send, t = en, testID = "refill-ask" }: {
  meds: string[]; clinicName: string; send: (medication: string, note: string) => Promise<SendResult>; t?: Tx; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [med, setMed] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SendResult["kind"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = [...new Set(meds)].slice(0, 8);

  if (done) return (
    <Card testID={`${testID}-sent`} style={{ gap: 6, backgroundColor: done === "refill_request" ? C.sage : C.alertSoft }}>
      <T style={{ fontFamily: F.sans600, fontSize: 15, color: done === "refill_request" ? C.sageInk : C.ink }}>
        {done === "refill_request"
          ? t(`Sent to ${clinicName}. A nurse will mark it when it's handled.`, `Enviado a ${clinicName}. Una enfermera lo marcará cuando esté listo.`)
          : t(`Part of your note sounds urgent, so it went to the on-call nurse. If you can, call ${clinicName} now.`, `Parte de tu nota parece urgente y se envió a la enfermera de guardia. Si puedes, llama a ${clinicName} ahora.`)}
      </T>
      <Button kind="plain" label={t("Ask for another", "Pedir otro")} onPress={() => { setDone(null); setMed(null); setNote(""); setOpen(true); }} />
    </Card>
  );

  if (!open) return (
    <Card style={{ gap: 8 }}>
      <T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{t("Running low?", "¿Te queda poco?")}</T>
      <Muted style={{ fontSize: 14 }}>{t(`Ask ${clinicName} for a refill. A nurse sees it in their queue.`, `Pide a ${clinicName} un resurtido. Una enfermera lo verá en su lista.`)}</Muted>
      <Button testID={testID} kind="line" label={t("Ask for a refill", "Pedir un resurtido")} onPress={() => setOpen(true)} />
    </Card>
  );

  const go = async () => {
    if (!med || busy) return;
    setBusy(true); setErr(null);
    try { const r = await send(med, note.trim()); setDone(r.kind); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Card testID={`${testID}-form`} style={{ gap: 10 }}>
      <T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{t("Which medication?", "¿Qué medicamento?")}</T>
      {list.length ? (
        <Chips>{list.map((m, i) => <Chip key={m} testID={`${testID}-med-${i}`} label={m} selected={med === m} onPress={() => setMed(m)} />)}</Chips>
      ) : null}
      <Field testID={`${testID}-name`} label={list.length ? t("Or type it", "O escríbelo") : t("Medication", "Medicamento")} value={list.includes(med ?? "") ? "" : med ?? ""} onChange={(v) => setMed(v.trim() ? v : null)} placeholder={t("Name on the box", "Nombre en la caja")} />
      <Field testID={`${testID}-note`} label={t("Anything they should know? (optional)", "¿Algo que deban saber? (opcional)")} value={note} onChange={setNote} multiline placeholder={t("Like how many doses you have left, or your pharmacy", "Por ejemplo, cuántas dosis te quedan o tu farmacia")} />
      <Muted style={{ fontSize: 13 }}>{t("For anything urgent, call your clinic instead of waiting here.", "Si es urgente, llama a tu clínica en vez de esperar aquí.")}</Muted>
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button testID={`${testID}-send`} kind="esp" label={busy ? t("Sending", "Enviando") : t("Send to my nurse", "Enviar a mi enfermera")} disabled={!med || busy} onPress={() => void go()} /></View>
        <View style={{ flex: 1 }}><Button kind="line" label={t("Not now", "Ahora no")} onPress={() => { setOpen(false); setErr(null); }} /></View>
      </View>
    </Card>
  );
}

/** In her own Pumpkin: shows only when connected to a clinic that sees her medications, plus what happened to past asks. */
export function LinkedRefills({ api, meds }: { api: Api; meds: string[] }) {
  const [clinic, setClinic] = useState<string | null>(null);
  const [mine, setMine] = useState<MyRefill[]>([]);
  const load = useCallback(() => {
    api.clinicLinks().then((ls) => { const l = ls.find((x) => x.status === "active" && x.share.meds); setClinic(l ? l.clinicName : null); }).catch(() => setClinic(null));
    api.myRefills().then(setMine).catch(() => setMine([]));
  }, [api]);
  useFocusEffect(load);
  if (!clinic && !mine.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {clinic ? <RefillAsk meds={meds} clinicName={clinic} send={async (m, n) => { const r = await api.linkRefill(m, n); load(); return r; }} /> : null}
      {mine.length ? (
        <Card testID="my-refills" style={{ gap: 8 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Refills you asked for</T>
          {mine.slice(0, 4).map((r) => (
            <View key={r.id} style={{ gap: 2 }}>
              <T style={{ fontFamily: F.sans600, fontSize: 14.5 }}>{r.medication}</T>
              <Muted style={{ fontSize: 13.5 }}>{r.status === "waiting" ? `Waiting for ${r.clinicName}.` : r.outcome ?? `${r.clinicName} handled it.`}</Muted>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/**
 * Her choices about her data: research and predictions. Both off until she turns them on, only she
 * sees them, and each change is recorded. Neither does anything yet; the copy says so plainly.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { Api, DataChoices } from "./api";
import { C, Card, F, Icon, Muted, st, T, Toggle } from "./ui";

type Tx = (en: string, es: string) => string;
const en: Tx = (e) => e;

export function DataChoicesCard({ api, clinic = false, t = en }: { api: Api; clinic?: boolean; t?: Tx }) {
  const [c, setC] = useState<DataChoices | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.dataChoices(clinic).then(setC).catch(() => setC(null)); }, [api, clinic]);
  useEffect(load, [load]);
  if (!c) return null;
  const set = async (choice: "research" | "predictions", on: boolean) => {
    setErr(null);
    try { setC(await api.setDataChoice(choice, on, clinic)); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card testID="data-choices" style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="shield" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t("Your data choices", "Tus decisiones sobre tus datos")}</T></View>
      <Muted style={{ fontSize: 13.5 }}>{t("Both are off unless you turn them on. Only you see these, not your clinic or your people. Change them anytime.", "Las dos están apagadas a menos que las actives. Solo tú las ves, ni tu clínica ni tus personas. Cámbialas cuando quieras.")}</Muted>
      <View style={[st.row, { borderTopWidth: 0, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t("Help research", "Ayudar a la investigación")}</T>
          <Muted style={{ fontSize: 13.5 }}>{t("Let Pumpkin include your information, with your name and details removed, in research about fertility care. There's no research yet. Before any study uses it, we'll tell you what it's for, and you can say no.", "Permite que Pumpkin incluya tu información, sin tu nombre ni datos personales, en investigaciones sobre la atención de fertilidad. Aún no hay investigaciones. Antes de que un estudio la use, te diremos para qué es y podrás decir que no.")}</Muted>
        </View>
        <Toggle testID="choice-research" value={c.research} onChange={(v) => void set("research", v)} />
      </View>
      <View style={[st.row, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{t("Show me estimates", "Mostrarme estimaciones")}</T>
          <Muted style={{ fontSize: 13.5 }}>{t("Pumpkin may later show ranges for what's ahead, like typical timelines and costs for a plan like yours. None are available yet. If you turn this on, you'll still choose each time, and they never show during the two-week wait or after hard news unless you ask. They're estimates, not medical advice.", "Más adelante, Pumpkin podría mostrar rangos de lo que viene, como tiempos y costos habituales para un plan como el tuyo. Aún no hay ninguna disponible. Si lo activas, igual eliges cada vez, y nunca aparecen durante la espera de dos semanas ni después de una mala noticia a menos que lo pidas. Son estimaciones, no consejo médico.")}</Muted>
        </View>
        <Toggle testID="choice-predictions" value={c.predictions} onChange={(v) => void set("predictions", v)} />
      </View>
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
    </Card>
  );
}

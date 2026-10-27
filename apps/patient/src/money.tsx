/**
 * Costs in the phone app: what she owes and when, her estimate, her coverage, receipts, ways to pay,
 * and questions for the financial counselor. Support people see a read-only summary if she shares it.
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Share, TextInput, View } from "react-native";
import type { Api, Money, Receipt } from "./api";
import { Button, C, Cap, Card, F, Moment, Muted, Pill, Row, st, T } from "./ui";

type Tx = (en: string, es: string) => string;
export const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (d: string, es = false) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(es ? "es-US" : "en-US", { month: "short", day: "numeric" });
const CAT: Record<string, [string, string]> = {
  clinic: ["Clinic and procedure fees", "Clínica y procedimientos"], medications: ["Medications", "Medicamentos"], lab: ["Lab and embryology", "Laboratorio y embriología"],
  anesthesia: ["Anesthesia", "Anestesia"], storage: ["Storage", "Almacenamiento"], other: ["Other", "Otro"],
};

function Bar({ used, max }: { used: number; max: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((used / Math.max(1, max)) * 100)));
  return <View style={{ height: 8, backgroundColor: C.line, borderRadius: 4 }}><View style={{ width: `${pct}%`, height: 8, backgroundColor: C.lavInk, borderRadius: 4 }} /></View>;
}

/** Home card: only when there's something to plan for. */
export function CostsCard({ api, t, open }: { api: Api; t: Tx; open: () => void }) {
  const [m, setM] = useState<Money | null>(null);
  useEffect(() => { api.money().then(setM).catch(() => {}); }, [api]);
  if (!m || (!m.estimates.length && m.balanceCents <= 0 && !m.questions.some((q) => q.answer && !q.read))) return null;
  const answered = m.questions.some((q) => q.answer && !q.read);
  return (
    <Pressable testID="costs-card" onPress={open}>
      <Card style={{ gap: 4 }}>
        <Cap>{t("Costs", "Costos")}</Cap>
        {m.balanceCents > 0
          ? <T style={{ fontFamily: F.sans600, fontSize: 16 }}>{m.nextDue ? t(`${usd(m.nextDue.amountCents)} due ${day(m.nextDue.dueOn)}`, `${usd(m.nextDue.amountCents)} vence el ${day(m.nextDue.dueOn, true)}`) : t(`You owe ${usd(m.balanceCents)}`, `Debes ${usd(m.balanceCents)}`)}</T>
          : <T style={{ fontFamily: F.sans600, fontSize: 16 }}>{t("You're all paid up", "Estás al día")}</T>}
        <Muted style={{ fontSize: 13.5 }}>{answered ? t("Sam answered your question.", "Sam respondió tu pregunta.") : t("Your estimate, coverage and receipts", "Tu presupuesto, cobertura y recibos")}</Muted>
      </Card>
    </Pressable>
  );
}

export function CostsScreen({ api, t, lang, openReceipt, partner = false, herName }: { api: Api; t: Tx; lang: "en" | "es"; openReceipt?: (id: string) => void; partner?: boolean; herName?: string }) {
  const [m, setM] = useState<Money | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState(false);
  const es = lang === "es";
  const load = useCallback(async () => {
    try {
      const x = partner ? await api.partnerMoney() : await api.money();
      setM(x);
      if (!partner && x.questions.some((y) => y.answer && !y.read)) void api.markCostRead().catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }, [api, partner]);
  useEffect(() => { void load(); }, [load]);
  if (!m) return <Muted>{error ?? t("Loading…", "Cargando…")}</Muted>;
  const est = m.estimates[0];
  const cov = m.coverage.find((c) => c.active);
  const nothing = !est && !cov && !m.ledger.length;
  return (
    <>
      <T style={{ fontFamily: F.serif, fontSize: 34, letterSpacing: -0.6 }}>{partner ? t(`${herName ?? "Her"} costs`, `Costos de ${herName ?? "ella"}`) : t("Your costs", "Tus costos")}</T>
      {nothing && <Muted>{partner ? t("Nothing shared yet.", "Nada compartido todavía.") : t("Your financial counselor will share your estimate here.", "Tu consejera financiera compartirá tu presupuesto aquí.")}</Muted>}

      {!nothing && (
        <View testID="balance" style={[st.dark, { gap: 4 }]}>
          {m.balanceCents > 0 ? (
            <>
              <T style={{ color: C.tan, fontSize: 13 }}>{partner ? t("Owed", "Pendiente") : t("You owe", "Debes")}</T>
              <T style={{ fontFamily: F.serif, fontSize: 32, color: C.paper }}>{usd(m.balanceCents)}</T>
              {m.nextDue && <T style={{ color: "#E9DED3", fontSize: 14 }}>{t(`${usd(m.nextDue.amountCents)} due ${day(m.nextDue.dueOn)}`, `${usd(m.nextDue.amountCents)} vence el ${day(m.nextDue.dueOn, true)}`)}</T>}
            </>
          ) : <T style={{ fontFamily: F.serif, fontSize: 24, color: C.paper }}>{t("All paid up", "Todo pagado")}</T>}
          <T style={{ color: "#E9DED3", fontSize: 13 }}>{t(`Paid so far: ${usd(m.paidCents)}`, `Pagado hasta ahora: ${usd(m.paidCents)}`)}</T>
        </View>
      )}

      {est && (
        <>
          <Cap>{t("Estimate", "Presupuesto")}</Cap>
          <Card testID="estimate" style={{ gap: 6 }}>
            <T style={{ fontFamily: F.sans700, fontSize: 16 }}>{est.title}</T>
            {est.items.map((i) => (
              <View key={i.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1 }}><T style={{ fontSize: 14.5 }}>{i.label}</T><Muted style={{ fontSize: 12 }}>{(CAT[i.category] ?? CAT.other)![es ? 1 : 0]}{i.insuranceCents ? t(` · insurance ${usd(i.insuranceCents)}`, ` · seguro ${usd(i.insuranceCents)}`) : ""}</Muted></View>
                <T style={{ fontSize: 14.5 }}>{usd(i.amountCents - i.insuranceCents)}</T>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Muted>{t("Total cost", "Costo total")}</Muted><Muted>{usd(est.totalCents)}</Muted></View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Muted>{t("Insurance (expected)", "Seguro (estimado)")}</Muted><Muted>−{usd(est.insuranceCents)}</Muted></View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T style={{ fontFamily: F.sans700 }}>{partner ? t("Her share", "Su parte") : t("Your share", "Tu parte")}</T><T testID="you-pay" style={{ fontFamily: F.sans700 }}>{usd(est.youPayCents)}</T></View>
            {est.note && <Muted style={{ fontSize: 13 }}>{est.note}</Muted>}
          </Card>
        </>
      )}

      {cov && (
        <>
          <Cap>{t("Coverage", "Cobertura")}</Cap>
          <Card testID="coverage" style={{ gap: 6 }}>
            <T style={{ fontFamily: F.sans700, fontSize: 15 }}>{cov.payerName ?? t("Your plan", "Tu plan")}{cov.planName ? ` · ${cov.planName}` : ""}</T>
            {cov.fertilityBenefit && <Muted style={{ fontSize: 13.5 }}>{cov.fertilityBenefit}</Muted>}
            {cov.lifetimeMaxCents != null && (
              <View style={{ gap: 4 }}>
                <T style={{ fontSize: 14 }}>{t(`${usd(cov.lifetimeMaxCents - cov.lifetimeUsedCents)} left of ${usd(cov.lifetimeMaxCents)}`, `Quedan ${usd(cov.lifetimeMaxCents - cov.lifetimeUsedCents)} de ${usd(cov.lifetimeMaxCents)}`)}</T>
                <Bar used={cov.lifetimeUsedCents} max={cov.lifetimeMaxCents} />
              </View>
            )}
            {cov.cyclesMax != null && <Muted style={{ fontSize: 13.5 }}>{t(`Cycles used: ${cov.cyclesUsed} of ${cov.cyclesMax}`, `Ciclos usados: ${cov.cyclesUsed} de ${cov.cyclesMax}`)}</Muted>}
            {cov.deductibleCents != null && <Muted style={{ fontSize: 13.5 }}>{t(`Deductible met: ${usd(cov.deductibleMetCents)} of ${usd(cov.deductibleCents)}`, `Deducible cubierto: ${usd(cov.deductibleMetCents)} de ${usd(cov.deductibleCents)}`)}</Muted>}
            {cov.priorAuth !== "none" && <Pill tone={cov.priorAuth === "approved" ? "sage" : cov.priorAuth === "denied" ? "red" : "clay"} label={({ needed: t("Prior approval needed", "Se necesita aprobación previa"), submitted: t("Prior approval requested", "Aprobación previa solicitada"), approved: t("Prior approval approved", "Aprobación previa aprobada"), denied: t("Prior approval denied", "Aprobación previa negada") } as Record<string, string>)[cov.priorAuth] ?? cov.priorAuth} />}
          </Card>
        </>
      )}

      {m.ledger.length > 0 && (
        <>
          <Cap>{t("Payments and charges", "Pagos y cargos")}</Cap>
          <Card pad={false}>
            {m.ledger.map((l) => (
              <Row key={l.id} testID={l.kind === "payment" ? "payment-row" : undefined} title={l.description}
                sub={`${day(l.occurredOn, es)}${l.dueOn ? t(` · due ${day(l.dueOn)}`, ` · vence el ${day(l.dueOn, true)}`) : ""}${l.kind === "payment" && !partner ? t(" · tap for receipt", " · toca para ver el recibo") : ""}`}
                right={<T style={{ fontSize: 14.5 }}>{l.kind === "payment" || l.kind === "adjustment" ? "−" : ""}{usd(l.amountCents)}</T>}
                onPress={l.kind === "payment" && !partner && openReceipt ? () => openReceipt(l.id) : undefined} />
            ))}
          </Card>
          {!partner && <Muted style={{ fontSize: 12.5 }}>{t("Pay through Bayside's billing office for now. Paying in the app is coming.", "Por ahora, paga a través de la oficina de facturación de Bayside. Pronto podrás pagar en la app.")}</Muted>}
        </>
      )}

      {m.partners.length > 0 && (
        <>
          <Cap>{t("Ways to pay", "Formas de pagar")}</Cap>
          <Card pad={false}>
            {m.partners.map((p) => (
              <Row key={p.id} title={p.name} sub={p.description} onPress={p.url ? () => void Linking.openURL(p.url!) : undefined} right={p.url ? <T style={{ color: C.lavInk }}>›</T> : undefined} />
            ))}
          </Card>
        </>
      )}

      {!partner && (
        <>
          <Cap>{t("Questions about costs", "Preguntas sobre costos")}</Cap>
          {m.questions.map((x) => (
            <Card key={x.id} style={{ gap: 4 }}>
              <T style={{ fontSize: 14.5 }}>&ldquo;{x.question}&rdquo;</T>
              <Muted style={{ fontSize: 13.5 }}>{x.answer ? `${x.answeredBy}: ${x.answer}` : t("Waiting for an answer.", "Esperando respuesta.")}</Muted>
            </Card>
          ))}
          <Card style={{ gap: 8 }}>
            <TextInput testID="cost-question" style={[st.input, { minHeight: 70 }]} multiline value={q} onChangeText={(v) => { setQ(v); setSent(false); }}
              placeholder={t("Ask the financial counselor…", "Pregunta a la consejera financiera…")} placeholderTextColor={C.stone} />
            <Muted style={{ fontSize: 12.5 }}>{t("This goes to billing, not your nurse.", "Esto va a facturación, no a tu enfermera.")}</Muted>
            {sent && <Moment>{t("Sent. You'll get an answer here.", "Enviado. Recibirás la respuesta aquí.")}</Moment>}
            {error && <T style={{ color: C.red }}>{error}</T>}
            <Button testID="ask-cost" label={t("Send", "Enviar")} disabled={!q.trim()} onPress={async () => {
              setError(null);
              try { await api.askCost(q.trim(), est?.id); setQ(""); setSent(true); await load(); } catch (e) { setError((e as Error).message); }
            }} />
          </Card>
        </>
      )}
    </>
  );
}

export function ReceiptScreen({ api, t, id }: { api: Api; t: Tx; id: string }) {
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.receipt(id).then(setR).catch((e) => setError((e as Error).message)); }, [api, id]);
  if (!r) return <Muted>{error ?? t("Loading…", "Cargando…")}</Muted>;
  const date = new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const text = [`Payment receipt: ${r.clinicName}`, `Receipt number: ${r.receiptNumber}`, `Patient: ${r.patientName}`, `Date paid: ${date}`, `For: ${r.description}`, `Amount: ${usd(r.amountCents)}`, r.method ? `Paid by: ${r.method}` : null, `Paid to: ${r.clinicName}`].filter(Boolean).join("\n");
  return (
    <>
      <T style={{ fontFamily: F.serif, fontSize: 30 }}>{t("Payment receipt", "Recibo de pago")}</T>
      <Card testID="receipt" style={{ gap: 6 }}>
        {[[t("Receipt number", "Número de recibo"), r.receiptNumber], [t("Patient", "Paciente"), r.patientName], [t("Date paid", "Fecha de pago"), date], [t("For", "Por"), r.description],
          [t("Amount", "Monto"), usd(r.amountCents)], ...(r.method ? [[t("Paid by", "Pagado con"), r.method]] : []), [t("Paid to", "Pagado a"), r.clinicName]].map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Muted>{k}</Muted><T style={{ fontFamily: F.sans600, flexShrink: 1, textAlign: "right" }}>{v}</T></View>
        ))}
      </Card>
      <Muted style={{ fontSize: 13 }}>{t("For your HSA, FSA or tax records.", "Para tu HSA, FSA o tus impuestos.")}</Muted>
      <Button testID="share-receipt" kind="line" label={t("Share or save", "Compartir o guardar")} onPress={() => void Share.share({ message: text, title: "Payment receipt" }).catch(() => {})} />
    </>
  );
}

/** Read-only summary for a support person she shares costs with. */
export function PartnerCostsCard({ api, open }: { api: Api; open: () => void }) {
  const [m, setM] = useState<Money | null>(null);
  useEffect(() => { api.partnerMoney().then(setM).catch(() => {}); }, [api]);
  if (!m || (!m.estimates.length && !m.ledger.length && !m.coverage.length)) return null;
  return (
    <Pressable testID="partner-costs" onPress={open}>
      <Card style={{ gap: 4 }}>
        <Cap>Costs</Cap>
        <T style={{ fontFamily: F.sans600, fontSize: 16 }}>{m.balanceCents > 0 ? (m.nextDue ? `${usd(m.nextDue.amountCents)} due ${day(m.nextDue.dueOn)}` : `${usd(m.balanceCents)} owed`) : "All paid up"}</T>
        {m.estimates[0] && <Muted style={{ fontSize: 13.5 }}>{`Estimate: ${usd(m.estimates[0].youPayCents)} after insurance`}</Muted>}
      </Card>
    </Pressable>
  );
}

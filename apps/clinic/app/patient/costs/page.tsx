import Link from "next/link";
import { dollars, ESTIMATE_CATEGORIES, markCostAnswersRead, patientMoney, patientToday } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { askCostAction } from "./actions";

const pct = (a: number, b: number | null) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

export default async function Costs({ searchParams }: { searchParams: Promise<{ asked?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["patient"]);
  const db = await getDb();
  const [m, today] = await Promise.all([patientMoney(db, s, s.patientId!), patientToday(db, s, s.patientId!)]);
  if (m.questions.some((q) => q.answer && !q.read)) await markCostAnswersRead(db, s, s.patientId!);
  const es = today.lang === "es";
  const t = (en: string, sp2: string) => (es ? sp2 : en);
  const loc = es ? "es-US" : "en-US";
  const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(loc, { month: "long", day: "numeric" });
  const est = m.estimates[0];
  const cov = m.coverage.find((c) => c.active);
  return (
    <>
      <p><Link href="/patient">← {t("Today", "Hoy")}</Link></p>
      <h1>{t("Your costs", "Tus costos")}</h1>
      <div className="card" data-testid="cost-summary" style={{ background: "var(--lav)", borderColor: "var(--lav)" }}>
        {m.balanceCents > 0 ? (
          <><p style={{ margin: 0, fontSize: 15 }}>{t("You owe", "Debes")}</p><p style={{ margin: "2px 0", fontSize: 30 }}><b>{dollars(m.balanceCents)}</b></p>
            {m.nextDue && <p className="muted" style={{ margin: 0 }}>{t(`${dollars(m.nextDue.amountCents)} is due ${day(m.nextDue.dueOn)}.`, `${dollars(m.nextDue.amountCents)} vence el ${day(m.nextDue.dueOn)}.`)}</p>}</>
        ) : <p style={{ margin: 0, fontSize: 18 }}>{t("You're all paid up.", "Estás al día con tus pagos.")}</p>}
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{t(`Paid so far: ${dollars(m.paidCents)}. Pay through Bayside's billing office for now.`, `Pagado hasta ahora: ${dollars(m.paidCents)}. Por ahora, paga a través de la oficina de facturación de Bayside.`)}</p>
      </div>

      <div className="grid">
        <div>
          {est && (
            <>
              <h2>{t("Your estimate", "Tu presupuesto")}</h2>
              <div className="card" data-testid="patient-estimate">
                <p style={{ marginTop: 0 }}><b>{est.title}</b>{est.validUntil ? <span className="muted"> · {t(`good through ${day(est.validUntil)}`, `válido hasta el ${day(est.validUntil)}`)}</span> : null}</p>
                <table>
                  <thead><tr><th /><th style={{ textAlign: "right" }}>{t("Cost", "Costo")}</th><th style={{ textAlign: "right" }}>{t("Insurance", "Seguro")}</th><th style={{ textAlign: "right" }}>{t("You", "Tú")}</th></tr></thead>
                  <tbody>
                    {est.items.map((i) => <tr key={i.id}><td>{i.label}<div className="muted" style={{ fontSize: 12 }}>{ESTIMATE_CATEGORIES[i.category]}</div></td><td style={{ textAlign: "right" }}>{dollars(i.amountCents)}</td><td style={{ textAlign: "right" }}>{dollars(i.insuranceCents)}</td><td style={{ textAlign: "right" }}>{dollars(i.amountCents - i.insuranceCents)}</td></tr>)}
                    <tr><td><b>{t("Total", "Total")}</b></td><td style={{ textAlign: "right" }}>{dollars(est.totalCents)}</td><td style={{ textAlign: "right" }}>{dollars(est.insuranceCents)}</td><td style={{ textAlign: "right" }}><b>{dollars(est.youPayCents)}</b></td></tr>
                  </tbody>
                </table>
                {est.note && <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>{est.note}</p>}
              </div>
            </>
          )}

          <h2>{t("Payments and charges", "Pagos y cargos")}</h2>
          <div className="card">
            {m.ledger.length === 0 && <div className="muted">{t("Nothing yet.", "Nada todavía.")}</div>}
            {m.ledger.map((l) => (
              <div className="row" key={l.id}>
                <div>{l.description}<div className="muted" style={{ fontSize: 12.5 }}>{day(l.occurredOn)}{l.dueOn ? t(` · due ${day(l.dueOn)}`, ` · vence el ${day(l.dueOn)}`) : ""}</div></div>
                <div style={{ textAlign: "right" }}>{l.kind === "payment" || l.kind === "adjustment" ? "−" : ""}{dollars(l.amountCents)}
                  {l.kind === "payment" && <div><Link href={`/patient/receipt/${l.id}`} style={{ fontSize: 13 }} data-testid="receipt-link">{t("Receipt", "Recibo")}</Link></div>}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          {cov && (
            <>
              <h2>{t("Your coverage", "Tu cobertura")}</h2>
              <div className="card" data-testid="patient-coverage">
                <p style={{ marginTop: 0 }}><b>{cov.payerName ?? t("Your plan", "Tu plan")}</b>{cov.planName ? ` · ${cov.planName}` : ""}{cov.memberLast4 ? <span className="muted"> · …{cov.memberLast4}</span> : null}</p>
                {cov.fertilityBenefit && <p style={{ fontSize: 14 }}>{cov.fertilityBenefit}</p>}
                {cov.lifetimeMaxCents != null && (
                  <div style={{ margin: "8px 0" }}>
                    <div style={{ fontSize: 13.5 }}>{t(`Fertility benefit: ${dollars(cov.lifetimeMaxCents - cov.lifetimeUsedCents)} left of ${dollars(cov.lifetimeMaxCents)}`, `Beneficio de fertilidad: quedan ${dollars(cov.lifetimeMaxCents - cov.lifetimeUsedCents)} de ${dollars(cov.lifetimeMaxCents)}`)}</div>
                    <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}><div style={{ width: `${pct(cov.lifetimeUsedCents, cov.lifetimeMaxCents)}%`, height: 8, background: "var(--lav-ink)", borderRadius: 4 }} /></div>
                  </div>
                )}
                {cov.cyclesMax != null && <div style={{ fontSize: 13.5 }}>{t(`Cycles: ${cov.cyclesUsed} of ${cov.cyclesMax} used`, `Ciclos: ${cov.cyclesUsed} de ${cov.cyclesMax} usados`)}</div>}
                {cov.deductibleCents != null && <div style={{ fontSize: 13.5 }}>{t(`Deductible: ${dollars(cov.deductibleMetCents)} of ${dollars(cov.deductibleCents)} met`, `Deducible: ${dollars(cov.deductibleMetCents)} de ${dollars(cov.deductibleCents)} cubierto`)}</div>}
                {cov.oopMaxCents != null && <div style={{ fontSize: 13.5 }}>{t(`Out-of-pocket: ${dollars(cov.oopMetCents)} of ${dollars(cov.oopMaxCents)}`, `Gastos de bolsillo: ${dollars(cov.oopMetCents)} de ${dollars(cov.oopMaxCents)}`)}</div>}
                {cov.priorAuth !== "none" && <p style={{ marginBottom: 0 }}><span className={`pill ${cov.priorAuth === "approved" ? "p-sage" : cov.priorAuth === "denied" ? "p-red" : "p-clay"}`}>{({ needed: t("Prior approval needed", "Se necesita aprobación previa"), submitted: t("Prior approval requested", "Aprobación previa solicitada"), approved: t("Prior approval approved", "Aprobación previa aprobada"), denied: t("Prior approval denied: Sam will call you", "Aprobación previa negada: Sam te llamará") } as Record<string, string>)[cov.priorAuth]}</span></p>}
              </div>
            </>
          )}

          {m.partners.length > 0 && (
            <>
              <h2>{t("Ways to pay", "Formas de pagar")}</h2>
              <div className="card">
                {m.partners.map((p) => (
                  <div className="row" key={p.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <b>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}</b>
                    <span className="muted" style={{ fontSize: 13.5 }}>{p.description}{p.phone ? ` · ${p.phone}` : ""}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 id="ask">{t("Questions about costs", "Preguntas sobre costos")}</h2>
          {sp.asked && <div className="note" role="status" style={{ marginBottom: 8 }}>{t("Sent to Bayside's financial counselor.", "Enviado a la consejera financiera de Bayside.")}</div>}
          {sp.error && <div className="card urgent" role="alert">{sp.error}</div>}
          {m.questions.map((q) => (
            <div className="card" key={q.id} data-testid="my-cost-question">
              <div>&ldquo;{q.question}&rdquo;</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{q.answer ? `${q.answeredBy}: ${q.answer}` : t("Waiting for an answer.", "Esperando respuesta.")}</div>
            </div>
          ))}
          <form className="card" action={askCostAction}>
            {est && <input type="hidden" name="estimateId" value={est.id} />}
            <label htmlFor="question">{t("Ask the financial counselor", "Pregunta a la consejera financiera")}</label>
            <textarea id="question" name="question" rows={3} required />
            <p className="muted" style={{ fontSize: 12.5 }}>{t("This goes to billing, not your nurse. For anything about your health, message your care team.", "Esto va a facturación, no a tu enfermera. Para cualquier cosa sobre tu salud, escribe a tu equipo.")}</p>
            <button className="btn btn-main" type="submit">{t("Send", "Enviar")}</button>
          </form>
        </div>
      </div>
    </>
  );
}

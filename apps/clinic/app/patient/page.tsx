import { patientInbox, patientResults, patientToday } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { markRead, messageTeam, reportMissed } from "../actions";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default async function PatientHome() {
  const s = await requireSession(["patient"]);
  const db = await getDb();
  const [today, inbox, results] = await Promise.all([
    patientToday(db, s, s.patientId!), patientInbox(db, s, s.patientId!), patientResults(db, s, s.patientId!),
  ]);
  const es = today.lang === "es";
  const t = (en: string, sp: string) => (es ? sp : en);
  const missed = today.doses.filter((d) => !d.takenAt && !d.reportedMissed && new Date(d.scheduledFor).getTime() < Date.now());
  const replies = inbox.filter((m) => m.sentText);
  const waiting = inbox.filter((m) => !m.sentText);

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Bayside Fertility · powered by The Pumpkin</p>
      <h1>{t("Today", "Hoy")}</h1>
      <p className="muted">
        {today.stimDay ? t(`Stimulation, day ${today.stimDay}.`, `Estimulación, día ${today.stimDay}.`) : ""}{" "}
        {t("Nurses reply 8 am–6 pm, usually within 2 hours. Urgent? Call the nurse line anytime.", "Las enfermeras responden de 8 am a 6 pm, normalmente en 2 horas. ¿Urgente? Llama a enfermería a cualquier hora.")}
      </p>
      <div className="grid">
        <div>
          {replies.map((m) => (
            <div className="card" key={m.id} style={m.status === "sent" ? { borderColor: "var(--marigold)" } : undefined}>
              <div className="muted" style={{ fontSize: 12.5 }}>{t("From", "De")} {m.sender ?? "your care team"} {m.status === "sent" && <span className="pill p-lav">{t("New", "Nuevo")}</span>}</div>
              <p style={{ whiteSpace: "pre-wrap" }}>{m.sentText}</p>
              {m.status === "sent" && (
                <form action={markRead}><input type="hidden" name="handoffId" value={m.id} /><button className="btn btn-line" type="submit">{t("Got it", "Entendido")}</button></form>
              )}
            </div>
          ))}
          {waiting.length > 0 && <div className="note">{t(`Your care team has ${waiting.length} message${waiting.length > 1 ? "s" : ""} from you and will reply soon.`, `Tu equipo tiene ${waiting.length} mensaje(s) tuyo(s) y responderá pronto.`)}</div>}

          <h2>{t("Medications", "Medicamentos")}</h2>
          <div className="card">
            {today.doses.map((d) => (
              <div className="row" key={d.id}>
                <div><b>{d.medication}</b> <span className="muted">{d.dose} · {fmt(d.scheduledFor)}</span></div>
                {d.takenAt ? <span className="pill p-sage">{t("Logged", "Registrada")}</span> : d.reportedMissed ? <span className="pill p-clay">{t("Sent to your nurse", "Enviado a tu enfermera")}</span> : <span className="pill p-clay">{t("Not logged", "Sin registrar")}</span>}
              </div>
            ))}
          </div>
          {missed.map((d) => (
            <form className="card" action={reportMissed} key={d.id}>
              <input type="hidden" name="doseLogId" value={d.id} />
              <b>{t(`Did you miss your ${d.medication}?`, `¿Olvidaste tu ${d.medication}?`)}</b>
              <p className="muted" style={{ fontSize: 13.5 }}>{t("Tell us here instead of calling. Your nurse gets your dose log with it.", "Avísanos aquí en vez de llamar. Tu enfermera recibe tu registro de dosis.")}</p>
              <label htmlFor={`note-${d.id}`}>{t("Anything else? (optional)", "¿Algo más? (opcional)")}</label>
              <textarea id={`note-${d.id}`} name="note" rows={2} />
              <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">{t("I missed this dose", "Olvidé esta dosis")}</button></div>
            </form>
          ))}
        </div>
        <div>
          <h2>{t("Results", "Resultados")}</h2>
          <div className="card">
            {results.length === 0 && <div className="muted">{t("No results yet.", "Aún no hay resultados.")}</div>}
            {results.map((r) => (
              <div className="row" key={r.id}>
                <div>
                  <b style={{ textTransform: "capitalize" }}>{r.analyte}</b> {r.value} {r.unit}
                  <div className="muted" style={{ fontSize: 13.5 }}>{r.label.patientText}</div>
                  {r.label.approvedBy && <div className="muted" style={{ fontSize: 12 }}>{t("Approved by", "Aprobado por")} {r.label.approvedBy}</div>}
                </div>
                <span className={`pill ${r.label.status === "in_range" ? "p-sage" : "p-clay"}`}>{r.label.status === "in_range" ? t("In Bayside's range", "En el rango de Bayside") : t("Nurse reviewing", "Revisión de enfermera")}</span>
              </div>
            ))}
          </div>
          <h2>{t("Message your care team", "Escribe a tu equipo")}</h2>
          <form className="card" action={messageTeam}>
            <textarea name="text" rows={3} placeholder={t("Ask anything. If it sounds urgent, we'll page the on-call nurse.", "Pregunta lo que quieras. Si suena urgente, avisaremos a la enfermera de guardia.")} />
            <div style={{ marginTop: 10 }}><button className="btn btn-dark" type="submit">{t("Send", "Enviar")}</button></div>
          </form>
        </div>
      </div>
    </>
  );
}

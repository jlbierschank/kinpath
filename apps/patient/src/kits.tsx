/**
 * Stage kits on your own: the first-consult kit (Getting started with a clinic), the test calendar
 * by cycle day, and getting ready to move from the fertility clinic to an OB (Pregnant after treatment).
 * Plain facts and timing only. Her clinic's instructions come first, and every screen says so.
 */
import { SendRecordCard } from "./sendrecord";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  CONCEPTION, CONSULT_BRING, CONSULT_COVERS, CONSULT_NEXT, dueDate, OB_RECORDS, RECORDS_HOW, testWindow, weeksToday, WORKUP, WORKUP_REVIEWED_BY, WORKUP_SOURCE,
  type Conception, type StageKit, type WorkupTest,
} from "@kinpath/core";
import type { Api, PersonalShare, ResultGroup, SoloMed } from "./api";
import { useFocusEffect } from "expo-router";
import { Button, C, Card, CheckList, ChoiceList, F, Icon, Muted, st, T, Toggle } from "./ui";
import { DateField, niceDate, TimeField, toYmd } from "./datefield";
import { Field } from "./field";

const DEMO = (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_DEMO === "1";
/** The test calendar shows in demo builds, or once the clinical reviewers have signed off. */
export const testCalendarOn = DEMO || WORKUP_REVIEWED_BY !== null;
const today = () => toYmd(new Date());
const short = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Her kit, saved as she goes. Each change is sent on its own and merged on the server. */
export function useKit(api: Api, initial: StageKit, onSaved?: () => void) {
  const [kit, setKit] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async (patch: Partial<{ [K in keyof StageKit]: Partial<StageKit[K]> }>) => {
    setKit((k) => ({ consult: { ...k.consult, ...patch.consult }, tests: { ...k.tests, ...patch.tests }, ob: { ...k.ob, ...patch.ob } }));
    try { const r = await api.saveKit(patch); setKit(r.kit); setError(null); onSaved?.(); return r; }
    catch (e) { setError((e as Error).message); return null; }
  }, [api, onSaved]);
  return { kit, save, error };
}
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

const Title = ({ children, sub }: { children: string; sub?: string }) => (
  <View style={{ gap: 6 }}>
    <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 32, lineHeight: 35, letterSpacing: -0.8, color: C.espresso }}>{children}</Text>
    {sub ? <Muted style={{ fontSize: 15 }}>{sub}</Muted> : null}
  </View>
);
const Section = ({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) => (
  <View testID={testID} style={{ gap: 8 }}>
    <T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6, color: C.stone }}>{title.toUpperCase()}</T>
    {children}
  </View>
);
const Bullets = ({ items }: { items: string[] }) => (
  <View style={{ gap: 6 }}>{items.map((t) => <View key={t} style={{ flexDirection: "row", gap: 10 }}><T style={{ color: C.lavInk, fontFamily: F.sans700 }}>·</T><T style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>{t}</T></View>)}</View>
);
const Link = ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
  <Pressable testID={testID} onPress={onPress} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>{label}</T></Pressable>
);

// ---------- first consult ----------

export function ConsultKitScreen({ api, initial, reload, openTests, openRecord, onUrgent, onCapture }: {
  api: Api; initial: StageKit; reload: () => void; openTests: () => void; openRecord: () => void;
  onUrgent: (crisis: boolean) => void; onCapture: (text: string) => Promise<void>;
}) {
  const { kit, save, error } = useKit(api, initial, reload);
  const c = kit.consult;
  const [time, setTime] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [questions, setQuestions] = useState<{ id: string; question: string; asked: boolean }[]>([]);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState(c.notes);
  const [busy, setBusy] = useState(false);
  const loadQs = useCallback(() => { api.questions().then(setQuestions).catch(() => {}); }, [api]);
  useEffect(loadQs, [loadQs]);
  const open = questions.filter((x) => !x.asked);

  const addVisit = async () => {
    if (!c.on || !time) return;
    await api.addByHand("appointment", { title: "First consult", startsAt: `${c.on}T${time}` });
    setAdded(`Added to your visits: ${niceDate(c.on)}.`); reload();
  };
  const saveNotes = async () => {
    setBusy(true);
    try { const r = await save({ consult: { notes } }); if (r?.urgent) onUrgent(r.urgent === "crisis"); } finally { setBusy(false); }
  };
  return (
    <>
      <Title sub="What a first visit usually covers, what to bring, and a place for what you hear. It's a lot at once, so it's all kept here.">Your first-consult kit</Title>
      {error ? <T style={{ color: C.red }}>{error}</T> : null}

      <Section title="When" testID="kit-when">
        <Card style={{ gap: 10 }}>
          <DateField testID="kit-consult-on" label="Your consult date" value={c.on ?? ""} onChange={(v) => void save({ consult: { on: v } })} />
          {c.on ? <TimeField testID="kit-consult-time" label="Time (to add it to your visits)" value={time} onChange={setTime} /> : null}
          {c.on && time ? <Button testID="kit-consult-add" kind="line" label="Add to my visits" onPress={() => void addVisit()} /> : null}
          {added ? <T testID="kit-consult-added" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{added}</T> : null}
        </Card>
      </Section>

      <Section title="What it usually covers"><Card><Bullets items={CONSULT_COVERS} /></Card></Section>

      <Section title={`What to bring · ${c.bring.length} of ${CONSULT_BRING.length} ready`} testID="kit-bring">
        <CheckList testIDPrefix="kit-bring-" options={CONSULT_BRING} selected={c.bring} onToggle={(id) => void save({ consult: { bring: toggle(c.bring, id) } })} />
      </Section>

      <Section title="Your questions" testID="kit-questions">
        <Card style={{ gap: 10 }}>
          {open.length ? <Bullets items={open.slice(0, 6).map((x) => x.question)} /> : <Muted style={{ fontSize: 14.5 }}>No questions yet. Anything you're wondering is worth asking.</Muted>}
          {open.length > 6 ? <Link label={`See all ${open.length}`} onPress={openRecord} /> : null}
          <Field testID="kit-question" label="Add a question" value={q} onChange={setQ} placeholder="How many cycles do people usually try?" />
          <Button testID="kit-question-add" kind="line" label="Add" disabled={!q.trim()} onPress={async () => { await api.addByHand("question", { text: q }); setQ(""); loadQs(); reload(); }} />
        </Card>
      </Section>

      <Section title="After the visit" testID="kit-after">
        <Card style={{ gap: 10 }}>
          <Field testID="kit-notes" label="What did they say?" multiline value={notes} onChange={setNotes} placeholder={"AMH any day\nHSG after my period\nNext visit in 3 weeks"} hint="Jot it down while it's fresh. Only you see this." />
          <Button testID="kit-notes-save" kind="esp" label={busy ? "Saving…" : "Save my notes"} disabled={busy || notes === c.notes} onPress={() => void saveNotes()} />
          {c.notes ? <Button testID="kit-notes-sort" kind="line" label="Pull out dates, meds and costs" onPress={() => void onCapture(c.notes)} /> : null}
          {c.notes ? <Muted style={{ fontSize: 13 }}>Pumpkin reads your notes and you check each thing before it goes in your record.</Muted> : null}
        </Card>
      </Section>

      <Section title="What usually happens next" testID="kit-next">
        <Muted style={{ fontSize: 14 }}>Every clinic is a little different. Tick each step as you get there.</Muted>
        <CheckList testIDPrefix="kit-next-" options={CONSULT_NEXT.map(([id, label, sub]) => [id, `${label}. ${sub}`])} selected={c.next} onToggle={(id) => void save({ consult: { next: toggle(c.next, id) } })} />
        {testCalendarOn ? <Link testID="kit-open-tests" label="See your test calendar" onPress={openTests} /> : null}
      </Section>
    </>
  );
}

// ---------- test calendar ----------

function whenText(t: WorkupTest, k: StageKit["tests"]): string {
  if (t.when.kind === "any") return "Any day";
  if (k.irregular) return "Your clinic will time this one with you";
  const w = testWindow(t, k.day1, k.length, today());
  if (!w) return t.when.label;
  return `${short(w.from)} to ${short(w.to)}${w.nextCycle ? " (next cycle)" : ""}`;
}
/** The next test with a date, for the Today tile. */
export function nextTest(k: StageKit["tests"]): { test: WorkupTest; text: string } | null {
  const left = WORKUP.filter((t) => !k.done.includes(t.id) && !k.hidden.includes(t.id));
  if (!k.day1 || k.irregular) return left[0] ? { test: left[0], text: left[0].when.label } : null;
  const dated = left.map((t) => ({ t, w: testWindow(t, k.day1, k.length, today()) })).filter((x) => x.w).sort((a, b) => a.w!.from.localeCompare(b.w!.from));
  const first = dated[0];
  return first ? { test: first.t, text: whenText(first.t, k) } : left[0] ? { test: left[0], text: "Any day" } : null;
}

export function TestCalendarScreen({ api, initial, reload, addResult, addReport }: { api: Api; initial: StageKit; reload: () => void; addResult: (test: string) => void; addReport: () => void }) {
  const { kit, save, error } = useKit(api, initial, reload);
  const k = kit.tests;
  // Her results already in Pumpkin, so each test shows what she's added (numbers only, never what they mean).
  const [results, setResults] = useState<ResultGroup[]>([]);
  useFocusEffect(useCallback(() => { api.soloResults().then(setResults).catch(() => {}); }, [api]));
  const latest = (key: string) => results.find((g) => g.key === key)?.points[0];
  const [len, setLen] = useState(String(k.length));
  const shown = WORKUP.filter((t) => !k.hidden.includes(t.id));
  const hidden = WORKUP.filter((t) => k.hidden.includes(t.id));
  return (
    <>
      <Title sub="Some tests happen on set days of your cycle. Add the first day of your period and Pumpkin fills in the dates.">Your test calendar</Title>
      {error ? <T style={{ color: C.red }}>{error}</T> : null}
      <Card style={{ gap: 12 }}>
        <DateField testID="kit-day1" label="First day of your period (cycle day 1)" value={k.day1 ?? ""} onChange={(v) => void save({ tests: { day1: v } })} hint="Day 1 is the first day of full bleeding, not spotting." />
        <Field testID="kit-length" label="How long your cycles usually are, in days" keyboard="numeric" value={len} onChange={(v) => { setLen(v); const n = Number(v); if (n >= 21 && n <= 45) void save({ tests: { length: n } }); }} hint="28 if you're not sure." />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T style={{ flex: 1, fontSize: 15 }}>My cycles are irregular, or I don't get periods</T>
          <Toggle testID="kit-irregular" value={k.irregular} onChange={(v) => void save({ tests: { irregular: v } })} />
        </View>
      </Card>

      <View style={{ gap: 10 }}>
        {shown.map((t) => {
          const entered = (t.results ?? []).map((r) => ({ ...r, p: latest(r.key) })).filter((r) => r.p);
          const done = k.done.includes(t.id) || (!!t.results?.length && entered.length > 0);
          return (
            <View key={t.id} testID={`kit-test-${t.id}`} style={[st.card, { padding: 14, gap: 6, opacity: done ? 0.7 : 1 }]}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontFamily: F.sans600, fontSize: 16 }}>{t.name}</T>
                  <T testID={`kit-when-${t.id}`} style={{ fontFamily: F.sans600, fontSize: 14, color: C.lavInk }}>{whenText(t, k)}</T>
                </View>
                <Pressable testID={`kit-done-${t.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`${t.name} done`} onPress={() => void save({ tests: { done: toggle(k.done, t.id) } })}
                  style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center", backgroundColor: done ? C.sage : C.oat }}>
                  <T style={{ fontFamily: F.sans600, fontSize: 13.5, color: done ? C.sageInk : C.espresso }}>{done ? "Done" : "Mark done"}</T>
                </Pressable>
              </View>
              <T style={{ fontSize: 14.5, lineHeight: 20 }}>{t.measures}</T>
              {t.note ? <Muted style={{ fontSize: 13.5 }}>{t.note}</Muted> : null}
              {entered.map((r) => (
                <View key={r.key} testID={`kit-result-${r.key}`} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: C.oat, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <T style={{ fontSize: 14.5 }}>{r.test}</T><T style={{ fontFamily: F.sans600, fontSize: 14.5 }}>{`${r.p!.value} ${r.p!.unit} · ${short(r.p!.on)}`}</T>
                </View>
              ))}
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16 }}>
                {(t.results ?? []).map((r) => <Link key={r.key} testID={`kit-add-${r.key}`} label={t.results!.length > 1 ? `Add ${r.test} result` : "Add your result"} onPress={() => addResult(r.test)} />)}
                <Link testID={`kit-report-${t.id}`} label={t.results?.length ? "Snap the report" : "Add the report"} onPress={addReport} />
              </View>
              <Link testID={`kit-hide-${t.id}`} label="Not on my list" onPress={() => void save({ tests: { hidden: toggle(k.hidden, t.id) } })} />
            </View>
          );
        })}
      </View>
      {hidden.length ? (
        <Card style={{ gap: 4 }}>
          <Muted style={{ fontSize: 14 }}>{`Not on your list: ${hidden.map((t) => t.name).join(", ")}.`}</Muted>
          <Link testID="kit-unhide" label="Show them again" onPress={() => void save({ tests: { hidden: [] } })} />
        </Card>
      ) : null}
      <Muted style={{ fontSize: 13 }}>{WORKUP_SOURCE}</Muted>
    </>
  );
}

// ---------- clinic to OB ----------

const groupMeds = (meds: SoloMed[]) => {
  const m = new Map<string, { name: string; dose: string; times: string[]; endsOn: string | null }>();
  for (const x of meds) { const g = m.get(x.medication) ?? { name: x.medication, dose: x.dose, times: [], endsOn: x.endsOn }; g.times.push(x.time); if (x.endsOn && (!g.endsOn || x.endsOn > g.endsOn)) g.endsOn = x.endsOn; m.set(x.medication, g); }
  return [...m.values()];
};

export function obDue(k: StageKit["ob"]) {
  const due = k.conceivedOn && k.how ? dueDate(k.conceivedOn, k.how) : null;
  return { due, weeks: due ? weeksToday(due, today()) : null };
}

export function ObHandoffScreen({ api, initial, reload, notice }: { api: Api; initial: StageKit; reload: () => void; notice: (m: string) => void }) {
  const { kit, save, error } = useKit(api, initial, reload);
  const o = kit.ob;
  const { due, weeks } = obDue(o);
  const [meds, setMeds] = useState<SoloMed[] | null>(null);
  const [lastDays, setLastDays] = useState<Record<string, string>>({});
  const [medErr, setMedErr] = useState<string | null>(null);
  const [obName, setObName] = useState(o.obName);
  const [obDay, setObDay] = useState(""); const [obTime, setObTime] = useState("");
  const [obAdded, setObAdded] = useState(false);
  const loadMeds = useCallback(() => { api.soloMeds().then(setMeds).catch(() => setMeds([])); }, [api]);
  useEffect(() => { loadMeds(); }, [loadMeds]);
  const groups = groupMeds(meds ?? []);
  const recipient = obName.trim() || "My OB";

  const setLast = async (name: string) => {
    const day = lastDays[name]; if (!day) return;
    setMedErr(null);
    try { await api.setMedLastDay(name, day); loadMeds(); reload(); notice(`Reminders for ${name} end after ${niceDate(day)}.`); }
    catch (e) { setMedErr((e as Error).message); }
  };

  if (o.movedOn) return (
    <>
      <Title sub="Your record, your summary and your reminders stay here for as long as you want them.">You're with your OB now</Title>
      <Card testID="kit-moved-card" style={{ gap: 8 }}>
        {due ? <T style={{ fontSize: 15.5 }}>{`Estimated due date: ${niceDate(due)}`}</T> : null}
        <T style={{ fontSize: 15 }}>Pumpkin is keeping Today light: your meds until their last day, and your visits.</T>
        <Button testID="kit-unmove" kind="line" label="I'm not there yet" onPress={() => void save({ ob: { movedOn: null } })} />
      </Card>
      <Section title="Share a summary" testID="kit-share-section"><SendRecordCard api={api} recipient={recipient} defaults={["pregnancy", "visits", "results", "meds"]} testID="kit-share" intro={`A secure link for ${recipient}, with a PDF and a data file their system can take. It shows only what you choose and labels who entered each item.`} /></Section>
    </>
  );

  return (
    <>
      <Title sub="Most people move to an OB around 8 to 10 weeks. Here's what to take with you, kept in one place.">From your clinic to your OB</Title>
      {error ? <T style={{ color: C.red }}>{error}</T> : null}

      <Section title="Your due date" testID="kit-due-section">
        <Card style={{ gap: 10 }}>
          <DateField testID="kit-conceived" label="Your transfer or insemination date" value={o.conceivedOn ?? ""} onChange={(v) => void save({ ob: { conceivedOn: v } })} />
          <ChoiceList<Conception> testIDPrefix="kit-how-" options={CONCEPTION.map(([id, label]) => [id, label])} value={o.how} onChange={(v) => void save({ ob: { how: v } })} />
          {due ? (
            <View testID="kit-due" style={{ backgroundColor: C.softLav, borderRadius: 14, padding: 12, gap: 2 }}>
              <T style={{ fontFamily: F.sans600, fontSize: 16 }}>{`Estimated due date: ${niceDate(due)}`}</T>
              {weeks ? <T style={{ fontSize: 14.5 }}>{`${weeks.weeks} weeks ${weeks.days} days today`}</T> : null}
              <Muted style={{ fontSize: 13 }}>Counted from the date you entered. Ask your clinic to confirm it, so your OB uses the right date.</Muted>
            </View>
          ) : o.how === "other" ? <Muted style={{ fontSize: 13.5 }}>Your clinic can tell you your due date.</Muted> : null}
        </Card>
      </Section>

      <Section title={`Records to take · ${o.records.length} of ${OB_RECORDS.length}`} testID="kit-records">
        <CheckList testIDPrefix="kit-rec-" options={OB_RECORDS} selected={o.records} onToggle={(id) => void save({ ob: { records: toggle(o.records, id) } })} />
        <Muted style={{ fontSize: 13.5 }}>{RECORDS_HOW}</Muted>
      </Section>

      <Section title="Your meds" testID="kit-meds">
        <Muted style={{ fontSize: 14 }}>Your clinic decides when each one stops. Add the last day they give you, and reminders end after it. Keep taking each one until then.</Muted>
        {meds === null ? <ActivityIndicator color={C.espresso} /> : groups.length === 0 ? <Card><Muted style={{ fontSize: 14.5 }}>No meds in your record right now.</Muted></Card> : groups.map((g, i) => (
          <Card key={g.name} testID={`kit-med-${i}`} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="medication" /><View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15.5 }}>{`${g.name} ${g.dose}`}</T><Muted style={{ fontSize: 13.5 }}>{g.endsOn ? `Last day in Pumpkin: ${niceDate(g.endsOn)}` : "No last day yet"}</Muted></View></View>
            <DateField testID={`kit-last-${i}`} label="Your clinic's last day" value={lastDays[g.name] ?? ""} onChange={(v) => setLastDays((x) => ({ ...x, [g.name]: v }))} />
            {lastDays[g.name] ? <Button testID={`kit-last-save-${i}`} kind="line" label="Save last day" onPress={() => void setLast(g.name)} /> : null}
          </Card>
        ))}
        {medErr ? <T testID="kit-med-error" style={{ color: C.red }}>{medErr}</T> : null}
      </Section>

      <Section title="Your OB" testID="kit-ob">
        <Card style={{ gap: 10 }}>
          <Field testID="kit-ob-name" label="OB or practice name" value={obName} onChange={setObName} placeholder="Dr. Ana Reyes" />
          {obName.trim() !== o.obName ? <Button testID="kit-ob-save" kind="line" label="Save" onPress={() => void save({ ob: { obName } })} /> : null}
          <DateField testID="kit-ob-day" label="First appointment" value={obDay} onChange={setObDay} />
          {obDay ? <TimeField testID="kit-ob-time" label="Time" value={obTime} onChange={setObTime} /> : null}
          {obDay && obTime && !obAdded ? <Button testID="kit-ob-add" kind="line" label="Add to my visits" onPress={async () => { await api.addByHand("appointment", { title: `First OB appointment${obName.trim() ? ` with ${obName.trim()}` : ""}`, startsAt: `${obDay}T${obTime}` }); setObAdded(true); reload(); }} /> : null}
          {obAdded ? <T testID="kit-ob-added" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{`Added to your visits: ${niceDate(obDay)}.`}</T> : null}
        </Card>
      </Section>

      <Section title="Share a summary" testID="kit-share-section"><SendRecordCard api={api} recipient={recipient} defaults={["pregnancy", "visits", "results", "meds"]} testID="kit-share" intro={`A secure link for ${recipient}, with a PDF and a data file their system can take. It shows only what you choose and labels who entered each item.`} /></Section>

      <Section title="When you've moved">
        <Card style={{ gap: 8 }}>
          <T style={{ fontSize: 15 }}>Once your OB is taking over, Pumpkin can keep Today light. Your record stays.</T>
          <Button testID="kit-moved" kind="esp" label="I've moved to my OB" onPress={async () => { await save({ ob: { movedOn: today() } }); notice("Today is lighter now. Everything is still in your record."); }} />
        </Card>
      </Section>
    </>
  );
}


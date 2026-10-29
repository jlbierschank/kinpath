/**
 * "Make Pumpkin yours", "How Pumpkin talks to me", the community name, and the visit summary.
 * Every answer is optional and only she sees it. Identity and health answers ask for her OK first.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Share, Text, View } from "react-native";
import { CONDITIONS, FAMILY_PATHS, PARTNER_TITLES, PRONOUNS } from "@kinpath/core";
import type { About, Api, VisitSummary } from "./api";
import { Button, C, Card, CheckList, Chip, Chips, F, Icon, Muted, SheetPicker, T, Today, Toggle } from "./ui";
import { Field } from "./field";
import { DateField } from "./datefield";

const Section = ({ icon, title, sub, children, testID }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; sub?: string; children: ReactNode; testID?: string }) => (
  <Card testID={testID} style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name={icon} /><T style={{ fontFamily: F.display, fontSize: 21, lineHeight: 25, flex: 1 }}>{title}</T></View>
    {sub ? <Muted style={{ fontSize: 14.5, marginTop: -4 }}>{sub}</Muted> : null}
    {children}
  </Card>
);
const Label = ({ children }: { children: ReactNode }) => <T style={{ fontFamily: F.sans600, fontSize: 14 }}>{children}</T>;

/** Choices plus "her own words". */
function WordChips({ options, value, onChange, otherLabel, testID }: { options: readonly string[]; value: string; onChange: (v: string) => void; otherLabel: string; testID?: string }) {
  const custom = !!value && !options.includes(value);
  const [other, setOther] = useState(custom);
  return (
    <View style={{ gap: 8 }}>
      <Chips>
        {options.map((o) => <Chip key={o} testID={testID ? `${testID}-${o}` : undefined} label={o} selected={value === o && !other} onPress={() => { setOther(false); onChange(value === o ? "" : o); }} />)}
        <Chip label="Something else" selected={other} onPress={() => { setOther(true); if (!custom) onChange(""); }} />
      </Chips>
      {other ? <Field label={otherLabel} value={value} onChange={onChange} /> : null}
    </View>
  );
}

// ---------- Make Pumpkin yours: one question at a time ----------

type Q = { id: string; step: About["stepsLeft"][number]; last?: boolean; sensitive?: boolean };
const QUESTIONS: Q[] = [
  { id: "name", step: "name" }, { id: "pronouns", step: "name", last: true },
  { id: "consent", step: "path", sensitive: true },
  { id: "path", step: "path", sensitive: true }, { id: "gender", step: "path", sensitive: true, last: true },
  { id: "person", step: "person", sensitive: true }, { id: "personPronouns", step: "person", sensitive: true, last: true },
  { id: "conditions", step: "background", sensitive: true }, { id: "cycles", step: "background", sensitive: true }, { id: "loss", step: "background", sensitive: true }, { id: "allergies", step: "background", sensitive: true, last: true },
];

export function AboutScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [a, setA] = useState<About | null>(null);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState<number | null>(null);
  const moving = useRef<number | null>(null); // the question the last tap moved to
  const busyRef = useRef(false);
  const [askOk, setAskOk] = useState(true);
  const [name, setName] = useState({ preferredName: "", pronunciation: "", pronouns: "" });
  const [path, setPath] = useState<{ familyPath: string[]; gender: string }>({ familyPath: [], gender: "" });
  const [person, setPerson] = useState({ partnerName: "", partnerTitle: "", partnerPronouns: "" });
  const [bg, setBg] = useState<{ conditions: string[]; conditionsOther: string; pastCycles: string; pastLoss: string; allergies: string }>({ conditions: [], conditionsOther: "", pastCycles: "", pastLoss: "", allergies: "" });
  useEffect(() => { void api.about().then((x) => {
    setA(x);
    setName({ preferredName: x.preferredName ?? "", pronunciation: x.pronunciation ?? "", pronouns: x.pronouns ?? "" });
    setPath({ familyPath: x.familyPath, gender: x.gender ?? "" });
    setPerson({ partnerName: x.partnerName ?? "", partnerTitle: x.partnerTitle ?? "", partnerPronouns: x.partnerPronouns ?? "" });
    setBg({ conditions: x.conditions, conditionsOther: x.conditionsOther ?? "", pastCycles: x.pastCycles === null ? "" : String(x.pastCycles), pastLoss: x.pastLoss ?? "", allergies: x.allergies ?? "" });
    // Pick up where she left off.
    setAskOk(!x.consented);
    const list = QUESTIONS.filter((q) => q.id !== "consent" || !x.consented);
    const first = list.findIndex((q) => x.stepsLeft.includes(q.step));
    setI(first < 0 ? 0 : first);
  }).catch((e: Error) => setErr(e.message)); }, [api]);
  if (!a || i === null) return err ? <T style={{ color: C.red }}>{err}</T> : <ActivityIndicator color={C.espresso} />;

  // Decided once when the screen opens, so saving her OK doesn't shift the questions under her.
  const qs = QUESTIONS.filter((q) => q.id !== "consent" || askOk);
  const qi = Math.min(i, qs.length - 1);
  const q = qs[qi]!;
  const needsOk = q.sensitive && !a.consented && !ok;
  const patchFor = (step: Q["step"]): Partial<About> => step === "name" ? name
    : step === "path" ? { familyPath: path.familyPath, gender: path.gender }
    : step === "person" ? person
    : { conditions: bg.conditions, conditionsOther: bg.conditionsOther, pastCycles: bg.pastCycles === "" ? null : Number(bg.pastCycles), pastLoss: (bg.pastLoss || null) as About["pastLoss"], allergies: bg.allergies };
  const saveStep = async (step: Q["step"], sensitive: boolean) => setA(await api.saveAbout(patchFor(step), { step, consent: sensitive && ok ? true : undefined }));
  const next = async () => {
    // A double tap (or a tap before the screen redraws) moves one question, not two.
    if (moving.current !== null && moving.current !== qi) return;
    if (moving.current === qi && busyRef.current) return;
    busyRef.current = true; moving.current = qi + 1; setErr(null); setBusy(true);
    try {
      if (q.last) await saveStep(q.step, !!q.sensitive);
      if (qi + 1 >= qs.length) done("Thanks. Pumpkin will use what you shared.");
      else setI(qi + 1);
    } catch (e) { moving.current = qi; setErr((e as Error).message); } finally { setBusy(false); busyRef.current = false; }
  };
  const finishLater = async () => {
    setErr(null);
    // Keep what she answered in this group, unless it needs an OK she hasn't given.
    try { if (!needsOk && q.id !== "consent") await saveStep(q.step, !!q.sensitive); } catch { /* nothing lost but this group */ }
    done("Saved what you've answered. Come back anytime.");
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : v === "prefer_not" ? ["prefer_not"] : [...list.filter((x) => x !== "prefer_not"), v]);
  const Head = ({ title, sub }: { title: string; sub?: string }) => (
    <View style={{ gap: 6 }}><Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: C.espresso }}>{title}</Text>{sub ? <Muted style={{ fontSize: 15 }}>{sub}</Muted> : null}</View>
  );

  const body: Record<string, ReactNode> = {
    name: <>
      <Head title="What should we call you?" />
      <Field testID="about-preferred" label="Your name" value={name.preferredName} onChange={(v) => setName({ ...name, preferredName: v })} placeholder={a.firstName} />
      <Field label="How to say it (optional)" value={name.pronunciation} onChange={(v) => setName({ ...name, pronunciation: v })} placeholder="e.g. ah-LEX" />
    </>,
    pronouns: <>
      <Head title="Your pronouns" sub="Pumpkin uses them everywhere, including messages to your person." />
      <WordChips testID="pronouns" options={PRONOUNS} value={name.pronouns} onChange={(v) => setName({ ...name, pronouns: v })} otherLabel="Your pronouns" />
    </>,
    consent: <>
      <Head title="Before the next questions" sub="They're about your identity, your family and your health. Only you see your answers: not a clinic, not your support people, not the community, unless you choose to share. You can clear them anytime." />
      <Pressable testID="about-ok" accessibilityRole="checkbox" accessibilityState={{ checked: ok }} onPress={() => setOk((x) => !x)} style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.sage, borderRadius: 14, padding: 14, minHeight: 52 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.sageInk, backgroundColor: ok ? C.sageInk : "transparent", alignItems: "center", justifyContent: "center" }}>{ok ? <Icon name="check" color={C.sage} size={18} /> : null}</View>
        <T style={{ flex: 1, fontSize: 15, fontFamily: F.sans600, color: C.sageInk }}>It's OK for Pumpkin to keep these answers to tailor my app.</T>
      </Pressable>
    </>,
    path: <>
      <Head title="How are you building your family?" sub="Choose any that fit. Pumpkin uses this to show what's relevant to you." />
      <CheckList testIDPrefix="path-" options={Object.entries(FAMILY_PATHS)} selected={path.familyPath} onToggle={(id) => setPath({ ...path, familyPath: toggle(path.familyPath, id) })} />
    </>,
    gender: <>
      <Head title="Your gender, in your words" sub="Optional. Leave it blank if you'd rather not say." />
      <Field testID="about-gender" label="Your gender" value={path.gender} onChange={(v) => setPath({ ...path, gender: v })} />
    </>,
    person: <>
      <Head title="Is someone in this with you?" sub="A partner, a friend, whoever. Skip it if it's just you." />
      <Field testID="about-partner-name" label="Their name" value={person.partnerName} onChange={(v) => setPerson({ ...person, partnerName: v })} />
      <SheetPicker testID="title" label="What do you call them?" value={person.partnerTitle} options={PARTNER_TITLES} onChange={(v) => setPerson({ ...person, partnerTitle: v })} otherLabel="Your word for them" />
    </>,
    personPronouns: <>
      <Head title={person.partnerName ? `${person.partnerName}'s pronouns` : "Their pronouns"} sub="Optional." />
      <WordChips options={PRONOUNS} value={person.partnerPronouns} onChange={(v) => setPerson({ ...person, partnerPronouns: v })} otherLabel="Their pronouns" />
    </>,
    conditions: <>
      <Head title="Anything you've been told?" sub="Only you see this. Pumpkin uses it to suggest questions for your visits. It never diagnoses." />
      <CheckList testIDPrefix="cond-" options={Object.entries(CONDITIONS)} selected={bg.conditions} onToggle={(id) => setBg({ ...bg, conditions: bg.conditions.includes(id) ? bg.conditions.filter((x) => x !== id) : [...bg.conditions, id] })} />
      <Field label="Anything else" value={bg.conditionsOther} onChange={(v) => setBg({ ...bg, conditionsOther: v })} />
    </>,
    cycles: <>
      <Head title="Treatment cycles before this one" sub="A rough number is fine." />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18, alignSelf: "center" }}>
        <Pressable accessibilityLabel="One fewer" onPress={() => setBg({ ...bg, pastCycles: String(Math.max(0, Number(bg.pastCycles || 0) - 1)) })} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: C.espresso, alignItems: "center", justifyContent: "center" }}><T style={{ fontSize: 26 }}>−</T></Pressable>
        <Text testID="about-cycles" style={{ fontFamily: F.display, fontSize: 44, minWidth: 70, textAlign: "center", color: C.espresso }}>{bg.pastCycles === "" ? "–" : bg.pastCycles}</Text>
        <Pressable accessibilityLabel="One more" onPress={() => setBg({ ...bg, pastCycles: String(Math.min(50, Number(bg.pastCycles || 0) + 1)) })} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: C.espresso, alignItems: "center", justifyContent: "center" }}><T style={{ fontSize: 26 }}>+</T></Pressable>
      </View>
    </>,
    loss: <>
      <Head title="Have you had a pregnancy loss?" sub="If you tell us, Pumpkin can be gentler around hard dates." />
      <Chips>{[["yes", "Yes"], ["no", "No"], ["skip", "I'd rather not say"]].map(([v, l]) => <Chip key={v} label={l!} selected={bg.pastLoss === v} onPress={() => setBg({ ...bg, pastLoss: bg.pastLoss === v ? "" : v! })} />)}</Chips>
    </>,
    allergies: <>
      <Head title="Any allergies?" sub="Pumpkin puts them on your visit summary." />
      <Field testID="about-allergies" label="Allergies" value={bg.allergies} onChange={(v) => setBg({ ...bg, allergies: v })} placeholder="e.g. latex, penicillin" />
    </>,
  };

  return (
    <>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T testID="about-progress" style={{ fontSize: 13.5, color: C.stone }}>{`Make Pumpkin yours · ${qi + 1} of ${qs.length}`}</T>
          <Pressable testID="about-later" onPress={finishLater} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.lavInk, fontFamily: F.sans600, fontSize: 14 }}>Finish later</T></Pressable>
        </View>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: C.line }}><View style={{ height: 4, borderRadius: 2, width: `${((qi + 1) / qs.length) * 100}%`, backgroundColor: C.lavInk }} /></View>
      </View>
      <View testID={`about-q-${q.id}`} style={{ gap: 14 }}>{body[q.id]}</View>
      {err ? <T testID="about-error" style={{ color: C.red }}>{err}</T> : null}
      <View style={{ gap: 8 }}>
        <Button testID="about-next" kind="esp" label={busy ? "Saving…" : qi + 1 >= qs.length ? "Done" : "Next"} disabled={busy || !!needsOk} onPress={next} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {qi > 0 ? <Pressable testID="about-back" onPress={() => { moving.current = qi - 1; setI(qi - 1); }} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.stone, fontFamily: F.sans600 }}>Back</T></Pressable> : <View />}
          {q.id === "consent"
            ? <Pressable testID="about-skip-personal" onPress={() => done("No problem. You can answer these anytime in Settings.")} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.stone, fontFamily: F.sans600 }}>Skip these questions</T></Pressable>
            : <Pressable testID="about-skip" onPress={next} disabled={busy || !!needsOk} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.stone, fontFamily: F.sans600 }}>Skip</T></Pressable>}
        </View>
      </View>
      {a.consented && qi === qs.length - 1 ? <Pressable onPress={async () => { setA(await api.withdrawAbout()); setOk(false); done("Cleared. Your identity, family and health answers are gone."); }}><Muted style={{ textDecorationLine: "underline", fontSize: 14 }}>Clear my identity, family and health answers</Muted></Pressable> : null}
    </>
  );
}

// ---------- How Pumpkin talks to me ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function TalkScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [a, setA] = useState<About | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [date, setDate] = useState(""); const [everyYear, setEveryYear] = useState(true); const [label, setLabel] = useState(""); const [mode, setMode] = useState<"quiet" | "gentle">("quiet");
  useEffect(() => { api.about().then(setA).catch((e: Error) => setErr(e.message)); }, [api]);
  if (!a) return err ? <T style={{ color: C.red }}>{err}</T> : <ActivityIndicator color={C.espresso} />;
  const act = async (fn: () => Promise<About>, m: string) => { setErr(null); setMsg(null); try { setA(await fn()); setMsg(m); } catch (e) { setErr((e as Error).message); } };
  const set = (patch: Partial<About>) => act(() => api.saveAbout(patch, { step: "talk" }), "Saved.");
  const addDate = () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!m) { setErr("Pick a date."); return; }
    void act(() => api.addTenderDate({ year: everyYear ? null : Number(m[1]), month: Number(m[2]), day: Number(m[3]), label, mode }), "Added. Pumpkin will be quieter that day.").then(() => { setDate(""); setLabel(""); });
  };
  return (
    <>
      <Today size={34}>How Pumpkin talks to me</Today>
      {msg ? <T testID="talk-msg" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{msg}</T> : null}
      {err ? <T testID="talk-error" style={{ color: C.red }}>{err}</T> : null}
      <Section icon="message" title="Tone">
        <Chips>
          <Chip testID="tone-facts" label="Just the facts" selected={a.tone === "facts"} onPress={() => set({ tone: "facts" })} />
          <Chip testID="tone-reassure" label="A bit more reassurance" selected={a.tone === "reassure"} onPress={() => set({ tone: "reassure" })} />
        </Chips>
      </Section>
      <Section icon="lab" title="New numbers">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <T style={{ fontSize: 15, flex: 1 }}>Wait for me to tap before showing a new result</T>
          <Toggle testID="reveal-toggle" value={a.revealResults} onChange={(v) => set({ revealResults: v })} />
        </View>
      </Section>
      <Section icon="wallet" title="Costs">
        <Chips>
          <Chip label="Show what's due anytime" selected={a.costCheckins === "always"} onPress={() => set({ costCheckins: "always" })} />
          <Chip testID="costs-when-due" label="Only when a payment is due soon" selected={a.costCheckins === "when_due"} onPress={() => set({ costCheckins: "when_due" })} />
        </Chips>
      </Section>
      <Section testID="quiet-dates" icon="calendar" title="Days to go easy" sub="A loss, a would-have-been due date, a holiday. On a quiet day Pumpkin shows only what's needed. On a gentle day it just softens. The reason is private.">
        {a.tenderDates.map((t) => (
          <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.oat, borderRadius: 14, padding: 12 }}>
            <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans600, fontSize: 15 }}>{`${MONTHS[t.month - 1]} ${t.day}${t.year ? `, ${t.year}` : ", every year"}`}</T><Muted style={{ fontSize: 13.5 }}>{`${t.mode === "quiet" ? "Quiet" : "Gentle"}${t.label ? ` · ${t.label}` : ""}`}</Muted></View>
            <Pressable onPress={() => act(() => api.deleteTenderDate(t.id), "Removed.")} style={{ minHeight: 44, justifyContent: "center" }}><Muted style={{ textDecorationLine: "underline" }}>Remove</Muted></Pressable>
          </View>
        ))}
        <DateField testID="quiet-date" label="Date" value={date} onChange={setDate} />
        <Chips>
          <Chip testID="date-every-year" label="Every year" selected={everyYear} onPress={() => setEveryYear(true)} />
          <Chip testID="date-once" label="Just this once" selected={!everyYear} onPress={() => setEveryYear(false)} />
        </Chips>
        <Field testID="quiet-label" label="A note for you (optional, private)" value={label} onChange={setLabel} />
        <Chips>
          <Chip testID="mode-quiet" label="Quiet" selected={mode === "quiet"} onPress={() => setMode("quiet")} />
          <Chip testID="mode-gentle" label="Gentle" selected={mode === "gentle"} onPress={() => setMode("gentle")} />
        </Chips>
        <Button testID="quiet-add" kind="esp" label="Add this day" disabled={!date.trim()} onPress={addDate} />
      </Section>
      <Section icon="heart" title="Need a break?" sub="Pumpkin goes quiet. Medication reminders still come.">
        {a.onBreak || a.pauseUntil ? (
          <>
            <T testID="quiet-status" style={{ fontSize: 15 }}>{a.onBreak ? "You're on a break." : `Paused until ${new Date(a.pauseUntil!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}.`}</T>
            <Button kind="esp" label="I'm back" onPress={() => act(() => api.setQuiet({ pauseDays: null, onBreak: false }), "Welcome back.")} />
          </>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button testID="pause-3" kind="line" label="3 days" onPress={() => act(() => api.setQuiet({ pauseDays: 3 }), "Paused for 3 days.")} /></View>
              <View style={{ flex: 1 }}><Button kind="line" label="A week" onPress={() => act(() => api.setQuiet({ pauseDays: 7 }), "Paused for a week.")} /></View>
            </View>
            <Button testID="take-break" kind="line" label="Until I come back" onPress={() => act(() => api.setQuiet({ onBreak: true }), "Take the time you need.")} />
          </View>
        )}
      </Section>
      <Button kind="line" label="Done" onPress={() => done("Saved.")} />
    </>
  );
}

// ---------- community name ----------

const ALIAS_ICONS = ["heart", "people", "calendar", "pen", "doc", "eye", "tag", "shield"] as const;
const TINTS = (): Record<string, [string, string]> => ({ lav: [C.lav, C.lavInk], sage: [C.sage, C.sageInk], clay: [C.clay, C.clayInk], oat: [C.oat, C.espresso] });
export function AliasScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [a, setA] = useState<About | null>(null);
  const [alias, setAliasText] = useState(""); const [icon, setIcon] = useState("heart"); const [tint, setTint] = useState("lav"); const [shows, setShows] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.about().then((x) => { setA(x); setAliasText(x.alias ?? ""); setIcon(x.aliasIcon ?? "heart"); setTint(x.aliasTint ?? "lav"); setShows(x.aliasShows); }).catch((e: Error) => setErr(e.message)); }, [api]);
  if (!a) return err ? <T style={{ color: C.red }}>{err}</T> : <ActivityIndicator color={C.espresso} />;
  const [bg, fg] = TINTS()[tint]!;
  return (
    <>
      <Today size={34}>Your community name</Today>
      <Muted style={{ fontSize: 15 }}>In the community you'll appear only by this name. Other members never see your real name. Moderators can see who you are only to keep people safe.</Muted>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.paper, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: C.line }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Icon name={icon as never} color={fg} size={30} /></View>
        <View style={{ flex: 1 }}><T style={{ fontFamily: F.sans700, fontSize: 17 }}>{alias || "Your name here"}</T><Muted style={{ fontSize: 13.5 }}>{shows.length ? shows.map((s) => (s === "stage" ? "Shows your stage" : "Shows your path")).join(" · ") : "Shows nothing else"}</Muted></View>
      </View>
      <Card style={{ gap: 12 }}>
        <Field testID="alias" label="Name" value={alias} onChange={setAliasText} keyboard="email-address" hint="3 to 24 letters or numbers. Don't use your real name." />
        <T style={{ fontFamily: F.sans600, fontSize: 14 }}>Picture</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {ALIAS_ICONS.map((i) => <Pressable key={i} accessibilityLabel={i} onPress={() => setIcon(i)} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: icon === i ? bg : C.oat, borderWidth: icon === i ? 2 : 0, borderColor: C.espresso, alignItems: "center", justifyContent: "center" }}><Icon name={i} color={icon === i ? fg : C.espresso} /></Pressable>)}
        </View>
        <Chips>{Object.keys(TINTS()).map((t) => <Chip key={t} label={{ lav: "Lavender", sage: "Sage", clay: "Clay", oat: "Oat" }[t]!} selected={tint === t} onPress={() => setTint(t)} />)}</Chips>
        <T style={{ fontFamily: F.sans600, fontSize: 14 }}>Show with my name (optional)</T>
        <Chips>
          <Chip label="My stage" selected={shows.includes("stage")} onPress={() => setShows((s) => (s.includes("stage") ? s.filter((x) => x !== "stage") : [...s, "stage"]))} />
          <Chip label="My path" selected={shows.includes("path")} onPress={() => setShows((s) => (s.includes("path") ? s.filter((x) => x !== "path") : [...s, "path"]))} />
        </Chips>
        {err ? <T testID="alias-error" style={{ color: C.red }}>{err}</T> : null}
        <Button testID="alias-save" kind="esp" label="Save my community name" disabled={!alias.trim()} onPress={async () => { setErr(null); try { await api.setAlias({ alias, icon, tint, shows }); done("Your community name is saved."); } catch (e) { setErr((e as Error).message); } }} />
      </Card>
    </>
  );
}

// ---------- visit summary ----------

export function SummaryScreen({ api }: { api: Api }) {
  const [s, setS] = useState<VisitSummary | null>(null);
  useEffect(() => { void api.visitSummary().then(setS); }, [api]);
  if (!s) return <ActivityIndicator color={C.espresso} />;
  const lines = [
    `Name: ${s.name}${s.pronouns ? ` (${s.pronouns})` : ""}`,
    s.path.length ? `Building my family: ${s.path.join("; ")}` : "",
    s.person ? `My person: ${s.person}` : "",
    s.background.length ? `Background: ${s.background.join("; ")}` : "",
    s.pastCycles !== null ? `Treatment cycles before this one: ${s.pastCycles}` : "",
    s.pastLoss ? "I've had a pregnancy loss." : "",
    s.allergies ? `Allergies: ${s.allergies}` : "",
    s.meds.length ? `\nMedications now:\n${s.meds.map((m) => `- ${m}`).join("\n")}` : "",
    s.results.length ? `\nRecent results:\n${s.results.map((r) => `- ${r}`).join("\n")}` : "",
    s.questions.length ? `\nMy questions:\n${s.questions.map((q) => `- ${q}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const Block = ({ title, items }: { title: string; items: string[] }) => (items.length ? <View style={{ gap: 4 }}><T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>{title.toUpperCase()}</T>{items.map((x, i) => <T key={i} style={{ fontSize: 15, lineHeight: 21 }}>{x}</T>)}</View> : null);
  return (
    <>
      <Today size={34}>My visit summary</Today>
      <Muted style={{ fontSize: 15 }}>Bring this to an appointment or share it yourself. Pumpkin doesn't send it anywhere.</Muted>
      <Card testID="summary" style={{ gap: 14 }}>
        <Text style={{ fontFamily: F.display, fontSize: 24, color: C.espresso }}>{s.name}{s.pronouns ? <Text style={{ fontFamily: F.sans, fontSize: 16 }}>{`  ${s.pronouns}`}</Text> : null}</Text>
        <Block title="Building my family" items={s.path} />
        <Block title="My person" items={s.person ? [s.person] : []} />
        <Block title="Background" items={[...s.background, ...(s.pastCycles !== null ? [`Treatment cycles before this one: ${s.pastCycles}`] : []), ...(s.pastLoss ? ["I've had a pregnancy loss."] : []), ...(s.allergies ? [`Allergies: ${s.allergies}`] : [])]} />
        <Block title="Medications now" items={s.meds} />
        <Block title="Recent results" items={s.results} />
        <Block title="My questions" items={s.questions} />
      </Card>
      <Button testID="summary-share" kind="esp" label={Platform.OS === "web" ? "Print or save as PDF" : "Share or save"} onPress={() => {
        if (Platform.OS === "web") (globalThis as unknown as { print: () => void }).print();
        else void Share.share({ title: "My visit summary", message: lines });
      }} />
    </>
  );
}

// ---------- ideas for her next visit ----------

export function QuestionIdeas({ api, added }: { api: Api; added: () => void }) {
  const [ideas, setIdeas] = useState<string[]>([]);
  const load = useCallback(() => { api.questionIdeas().then(setIdeas).catch(() => {}); }, [api]);
  useEffect(load, [load]);
  if (!ideas.length) return null;
  return (
    <View testID="question-ideas" style={{ gap: 8 }}>
      <Muted style={{ fontSize: 13.5 }}>Ideas for you. Tap to add.</Muted>
      {ideas.slice(0, 3).map((q) => (
        <Pressable key={q} onPress={async () => { await api.addByHand("question", { text: q }); load(); added(); }} style={{ backgroundColor: C.oat, borderRadius: 14, padding: 12, flexDirection: "row", gap: 8, alignItems: "center", minHeight: 44 }}>
          <T style={{ fontFamily: F.sans700, color: C.lavInk }}>+</T><T style={{ flex: 1, fontSize: 14.5 }}>{q}</T>
        </Pressable>
      ))}
    </View>
  );
}

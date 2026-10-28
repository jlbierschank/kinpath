/**
 * "Make Pumpkin yours", "How Pumpkin talks to me", the community name, and the visit summary.
 * Every answer is optional and only she sees it. Identity and health answers ask for her OK first.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Share, Text, View } from "react-native";
import { CONDITIONS, FAMILY_PATHS, PARTNER_TITLES, PRONOUNS } from "@kinpath/core";
import type { About, Api, VisitSummary } from "./api";
import { Button, C, Card, Chip, Chips, F, Icon, Muted, T, Today, Toggle } from "./ui";
import { Field } from "./field";

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

// ---------- Make Pumpkin yours ----------

export function AboutScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [a, setA] = useState<About | null>(null);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(async () => setA(await api.about()), [api]);
  useEffect(() => { void load(); }, [load]);
  const [name, setName] = useState({ preferredName: "", pronunciation: "", pronouns: "" });
  const [path, setPath] = useState<{ familyPath: string[]; gender: string }>({ familyPath: [], gender: "" });
  const [person, setPerson] = useState({ partnerName: "", partnerTitle: "", partnerPronouns: "" });
  const [bg, setBg] = useState<{ conditions: string[]; conditionsOther: string; pastCycles: string; pastLoss: string; allergies: string }>({ conditions: [], conditionsOther: "", pastCycles: "", pastLoss: "", allergies: "" });
  useEffect(() => {
    if (!a) return;
    setName({ preferredName: a.preferredName ?? "", pronunciation: a.pronunciation ?? "", pronouns: a.pronouns ?? "" });
    setPath({ familyPath: a.familyPath, gender: a.gender ?? "" });
    setPerson({ partnerName: a.partnerName ?? "", partnerTitle: a.partnerTitle ?? "", partnerPronouns: a.partnerPronouns ?? "" });
    setBg({ conditions: a.conditions, conditionsOther: a.conditionsOther ?? "", pastCycles: a.pastCycles === null ? "" : String(a.pastCycles), pastLoss: a.pastLoss ?? "", allergies: a.allergies ?? "" });
  }, [a]);
  if (!a) return <ActivityIndicator color={C.espresso} />;
  const save = async (patch: Partial<About>, step: string, msg: string, sensitive = false) => {
    setErr(null); setSaved(null);
    try { setA(await api.saveAbout(patch, { step, consent: sensitive && ok ? true : undefined })); setSaved(msg); }
    catch (e) { setErr((e as Error).message); }
  };
  const needsOk = !a.consented && !ok;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : v === "prefer_not" ? ["prefer_not"] : [...list.filter((x) => x !== "prefer_not"), v]);
  const Actions = ({ step, onSave, testID, sensitive }: { step: string; onSave: () => void; testID: string; sensitive?: boolean }) => (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 2 }}><Button testID={`${testID}-save`} kind="esp" label="Save" disabled={!!sensitive && needsOk} onPress={onSave} /></View>
      {a.stepsLeft.includes(step as never) ? <View style={{ flex: 1 }}><Button kind="line" label="Skip" onPress={() => save({}, step, "Skipped. You can come back anytime.")} /></View> : null}
    </View>
  );
  return (
    <>
      <Today size={34}>Make Pumpkin yours</Today>
      <Muted style={{ fontSize: 15 }}>Every question is optional, and you can change any answer later. Pumpkin uses them to talk to you the way you'd like.</Muted>
      {saved ? <T testID="about-saved" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{saved}</T> : null}
      {err ? <T testID="about-error" style={{ color: C.red }}>{err}</T> : null}

      <Section testID="about-name" icon="pen" title="What to call you">
        <Field testID="about-preferred" label="The name you'd like us to use" value={name.preferredName} onChange={(v) => setName({ ...name, preferredName: v })} placeholder={a.firstName} />
        <Field label="How to say it (optional)" value={name.pronunciation} onChange={(v) => setName({ ...name, pronunciation: v })} placeholder="e.g. ah-LEX" />
        <Label>Your pronouns (optional)</Label>
        <WordChips testID="pronouns" options={PRONOUNS} value={name.pronouns} onChange={(v) => setName({ ...name, pronouns: v })} otherLabel="Your pronouns" />
        <Actions testID="about-name" step="name" onSave={() => save({ preferredName: name.preferredName, pronunciation: name.pronunciation, pronouns: name.pronouns }, "name", "Saved. Pumpkin will use your name.")} />
      </Section>

      {!a.consented ? (
        <View testID="about-consent" style={{ backgroundColor: C.sage, borderRadius: 22, padding: 18, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name="shield" color={C.sageInk} /><T style={{ fontFamily: F.display, fontSize: 20 }}>Before the next questions</T></View>
          <T style={{ fontSize: 15, lineHeight: 21 }}>They're about your identity, your family and your health. Only you see your answers: not a clinic, not your support people, not the community, unless you choose to share. You can clear them anytime.</T>
          <Pressable testID="about-ok" accessibilityRole="checkbox" accessibilityState={{ checked: ok }} onPress={() => setOk((x) => !x)} style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.paper, borderRadius: 14, padding: 12, minHeight: 48 }}>
            <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.espresso, backgroundColor: ok ? C.espresso : C.paper, alignItems: "center", justifyContent: "center" }}>{ok ? <Icon name="check" color={C.paper} size={18} /> : null}</View>
            <T style={{ flex: 1, fontSize: 15, fontFamily: F.sans600 }}>It's OK for Pumpkin to keep these answers to tailor my app.</T>
          </Pressable>
        </View>
      ) : null}

      <Section testID="about-path" icon="heart" title="How you're building your family" sub="Choose any that fit. Pumpkin uses this to show what's relevant to you.">
        <Chips>{Object.entries(FAMILY_PATHS).map(([id, label]) => <Chip key={id} testID={`path-${id}`} label={label} selected={path.familyPath.includes(id)} onPress={() => setPath({ ...path, familyPath: toggle(path.familyPath, id) })} />)}</Chips>
        <Field label="Your gender, in your words (optional)" value={path.gender} onChange={(v) => setPath({ ...path, gender: v })} />
        <Actions testID="about-path" step="path" sensitive onSave={() => save({ familyPath: path.familyPath, gender: path.gender }, "path", "Saved.", true)} />
      </Section>

      <Section testID="about-person" icon="people" title="Your person" sub="A partner, or whoever is in this with you. Skip it if it's just you.">
        <Field testID="about-partner-name" label="Their name" value={person.partnerName} onChange={(v) => setPerson({ ...person, partnerName: v })} />
        <Label>What do you call them?</Label>
        <WordChips testID="title" options={PARTNER_TITLES} value={person.partnerTitle} onChange={(v) => setPerson({ ...person, partnerTitle: v })} otherLabel="Your word for them" />
        <Label>Their pronouns (optional)</Label>
        <WordChips options={PRONOUNS} value={person.partnerPronouns} onChange={(v) => setPerson({ ...person, partnerPronouns: v })} otherLabel="Their pronouns" />
        <Actions testID="about-person" step="person" sensitive onSave={() => save(person, "person", "Saved. Pumpkin will use your words.", true)} />
      </Section>

      <Section testID="about-background" icon="doc" title="Your background" sub="Only you see this. Pumpkin uses it to suggest questions for your visits and to fill in your visit summary. It never diagnoses.">
        <Label>Anything you've been told (optional)</Label>
        <Chips>{Object.entries(CONDITIONS).map(([id, label]) => <Chip key={id} testID={`cond-${id}`} label={label} selected={bg.conditions.includes(id)} onPress={() => setBg({ ...bg, conditions: bg.conditions.includes(id) ? bg.conditions.filter((x) => x !== id) : [...bg.conditions, id] })} />)}</Chips>
        <Field label="Anything else" value={bg.conditionsOther} onChange={(v) => setBg({ ...bg, conditionsOther: v })} />
        <Field label="Treatment cycles before this one" value={bg.pastCycles} onChange={(v) => setBg({ ...bg, pastCycles: v.replace(/\D/g, "") })} keyboard="numeric" placeholder="0" />
        <Label>Have you had a pregnancy loss?</Label>
        <Muted style={{ fontSize: 13.5, marginTop: -6 }}>If you tell us, Pumpkin can be gentler around hard dates.</Muted>
        <Chips>{[["yes", "Yes"], ["no", "No"], ["skip", "I'd rather not say"]].map(([v, l]) => <Chip key={v} label={l!} selected={bg.pastLoss === v} onPress={() => setBg({ ...bg, pastLoss: bg.pastLoss === v ? "" : v! })} />)}</Chips>
        <Field label="Allergies" value={bg.allergies} onChange={(v) => setBg({ ...bg, allergies: v })} placeholder="e.g. latex, penicillin" />
        <Actions testID="about-background" step="background" sensitive onSave={() => save({ conditions: bg.conditions, conditionsOther: bg.conditionsOther, pastCycles: bg.pastCycles === "" ? null : Number(bg.pastCycles), pastLoss: (bg.pastLoss || null) as About["pastLoss"], allergies: bg.allergies }, "background", "Saved.", true)} />
      </Section>

      {a.consented ? <Pressable onPress={async () => { setA(await api.withdrawAbout()); setOk(false); setSaved("Cleared. Your identity, family and health answers are gone."); }}><Muted style={{ textDecorationLine: "underline", fontSize: 14 }}>Clear my identity, family and health answers</Muted></Pressable> : null}
      <Button kind="line" label="Done" onPress={() => done("Thanks. Pumpkin will use what you shared.")} />
    </>
  );
}

// ---------- How Pumpkin talks to me ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function TalkScreen({ api, done }: { api: Api; done: (msg: string) => void }) {
  const [a, setA] = useState<About | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [date, setDate] = useState(""); const [label, setLabel] = useState(""); const [mode, setMode] = useState<"quiet" | "gentle">("quiet");
  useEffect(() => { api.about().then(setA).catch((e: Error) => setErr(e.message)); }, [api]);
  if (!a) return err ? <T style={{ color: C.red }}>{err}</T> : <ActivityIndicator color={C.espresso} />;
  const act = async (fn: () => Promise<About>, m: string) => { setErr(null); setMsg(null); try { setA(await fn()); setMsg(m); } catch (e) { setErr((e as Error).message); } };
  const set = (patch: Partial<About>) => act(() => api.saveAbout(patch, { step: "talk" }), "Saved.");
  const addDate = () => {
    const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(date.trim());
    if (!m) { setErr("Use MM-DD for every year (like 05-10), or YYYY-MM-DD for one year."); return; }
    void act(() => api.addTenderDate({ year: m[1] ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]), label, mode }), "Added. Pumpkin will be quieter that day.").then(() => { setDate(""); setLabel(""); });
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
        <Field testID="quiet-date" label="Date" value={date} onChange={setDate} placeholder="05-10 (every year) or 2027-05-10" />
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

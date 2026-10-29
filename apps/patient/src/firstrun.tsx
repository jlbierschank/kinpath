/**
 * The first run for someone starting on her own: two short questions, one optional one, and something
 * useful for her stage, all before we ask for a phone number or email. Answers stay on this phone until
 * she saves; then they go into her record (the who and plan answers only if she says it's OK).
 *
 * Clinical wording on the "trying" and "getting started" screens is for the clinical reviewers to check
 * before launch (see docs/VOICE-APP.md and the onboarding plan).
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FAMILY_PATHS } from "@kinpath/core";
import type { Api, SoloStage } from "./api";
import { Button, C, Card, CheckList, ChoiceList, F, Icon, Muted, T } from "./ui";
import { DateField } from "./datefield";
import { loadPref, savePref } from "./session";

export type FirstRunAnswers = {
  stage: SoloStage;
  who: string[];
  plan: string[];
  keep: boolean;
  questions: string[];
  betaOn: string;
  waitForTap: boolean;
};
export const EMPTY_RUN: FirstRunAnswers = { stage: "trying", who: [], plan: [], keep: false, questions: [], betaOn: "", waitForTap: false };
const KEY = "first-run";
export const loadFirstRun = () => loadPref<{ step: number; a: FirstRunAnswers }>(KEY);
export const saveFirstRun = (step: number, a: FirstRunAnswers) => savePref(KEY, { step, a });
export const clearFirstRun = () => savePref(KEY, null);

/** Who's part of this. Function-based roles, never a relationship status. */
export const WHO: [string, string][] = [
  ["just_me", "Just me"],
  ["partner", "A partner"],
  ["known_donor", "A known donor"],
  ["bank_donor", "A donor from a bank or agency"],
  ["carrier", "A gestational carrier"],
  ["support", "A friend or family member who's helping"],
];
/** The plan so far, if she knows it. */
export const PLAN: [string, string][] = [
  ["own", "Using my own eggs or sperm"],
  ["donor_sperm", "Using donor sperm"],
  ["donor_eggs", "Using donor eggs"],
  ["donor_embryos", "Using donor embryos"],
  ["carrier", "With a gestational carrier"],
  ["preserving", "Freezing eggs or embryos for later"],
  ["unsure", "Not sure yet"],
];
/** What gets kept, in the record's own words (family paths), when she says it's OK. */
export function familyPathsFrom(a: FirstRunAnswers): (keyof typeof FAMILY_PATHS)[] {
  const out = new Set<keyof typeof FAMILY_PATHS>();
  if (a.who.includes("partner")) out.add("with_partner");
  if (a.plan.includes("donor_sperm")) out.add("donor_sperm");
  if (a.plan.includes("donor_eggs")) out.add("donor_eggs");
  if (a.plan.includes("donor_embryos")) out.add("donor_embryos");
  if (a.plan.includes("carrier") || a.who.includes("carrier")) out.add("gestational_carrier");
  if (a.plan.includes("preserving")) out.add("preserving");
  return [...out];
}

/** Questions she can take to her next visit, by stage. The stage's useful thing for "getting started" and "trying". */
const QUESTIONS: Partial<Record<SoloStage, string[]>> = {
  trying: [
    "Given how long I've been trying, or my plans, is it time to see a specialist?",
    "Which tests can you order now, before a referral?",
    "What does my insurance need before a fertility visit is covered?",
  ],
  just_starting: [
    "What tests will I need, and what does each one check?",
    "Which tests have to happen on certain days of my cycle?",
    "What are my options, and which would you suggest for me?",
    "What might treatment cost, and what could my insurance cover?",
    "Who do I call with questions, and how fast will I hear back?",
  ],
  between_cycles: [
    "Can we go over what happened in this cycle?",
    "What would you change next time?",
    "How long should I wait before starting again?",
  ],
};

const Head = ({ title, sub }: { title: string; sub?: string }) => (
  <View style={{ gap: 6 }}>
    <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: C.espresso }}>{title}</Text>
    {sub ? <Muted style={{ fontSize: 15 }}>{sub}</Muted> : null}
  </View>
);

/** Steps: 0 stage, 1 who, 2 plan, 3 the useful thing. Then the caller asks for a phone or email. */
export function FirstRun({ onSave, onBack }: { onSave: (a: FirstRunAnswers) => void; onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<FirstRunAnswers>(EMPTY_RUN);
  const [picked, setPicked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void loadFirstRun().then((r) => { if (r?.a) { setA(r.a); setStep(Math.min(3, r.step)); setPicked(true); } setLoaded(true); }); }, []);
  useEffect(() => { if (loaded && picked) void saveFirstRun(step, a); }, [loaded, picked, step, a]);
  if (!loaded) return null;
  const set = (p: Partial<FirstRunAnswers>) => setA((x) => ({ ...x, ...p }));
  const toggle = (list: string[], v: string, only?: string) => (list.includes(v) ? list.filter((x) => x !== v) : v === only ? [v] : [...list.filter((x) => x !== only), v]);
  const total = 4;
  const nav = (next: () => void, label = "Next", disabled = false, testID = "fr-next") => (
    <View style={{ gap: 8 }}>
      <Button testID={testID} kind="esp" label={label} disabled={disabled} onPress={next} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Pressable testID="fr-back" onPress={() => (step === 0 ? onBack() : setStep(step - 1))} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.stone, fontFamily: F.sans600 }}>Back</T></Pressable>
        {step === 1 || step === 2 ? <Pressable testID="fr-skip" onPress={() => setStep(step + 1)} style={{ minHeight: 44, justifyContent: "center" }}><T style={{ color: C.stone, fontFamily: F.sans600 }}>Skip</T></Pressable> : <View />}
      </View>
    </View>
  );
  const progress = (
    <View style={{ gap: 8 }}>
      <T testID="fr-progress" style={{ fontSize: 13.5, color: C.stone }}>{`Start on your own · ${step + 1} of ${total}`}</T>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: C.line }}><View style={{ height: 4, borderRadius: 2, width: `${((step + 1) / total) * 100}%`, backgroundColor: C.lavInk }} /></View>
    </View>
  );

  if (step === 0) return (
    <View style={{ gap: 16 }} testID="fr-stage">
      {progress}
      <Head title="Where are you right now?" sub="This shapes what Pumpkin shows you. You can change it anytime." />
      <ChoiceList testIDPrefix="stage-" options={STAGES} value={picked ? a.stage : null} onChange={(v) => { set({ stage: v }); setPicked(true); }} />
      {nav(() => setStep(1), "Next", !picked)}
    </View>
  );
  if (step === 1) return (
    <View style={{ gap: 16 }} testID="fr-who">
      {progress}
      <Head title="Who's part of this?" sub="Choose any that fit. Pumpkin uses your answer to show what's relevant, and never assumes." />
      <CheckList testIDPrefix="who-" options={WHO} selected={a.who} onToggle={(id) => set({ who: toggle(a.who, id, "just_me") })} />
      {nav(() => setStep(2))}
    </View>
  );
  if (step === 2) return (
    <View style={{ gap: 16 }} testID="fr-plan">
      {progress}
      <Head title="What's the plan so far?" sub="Optional. Pick any that fit, or skip if you don't know yet." />
      <CheckList testIDPrefix="plan-" options={PLAN} selected={a.plan} onToggle={(id) => set({ plan: toggle(a.plan, id, "unsure") })} />
      {a.who.length || a.plan.length ? (
        <Pressable testID="fr-keep" accessibilityRole="checkbox" accessibilityState={{ checked: a.keep }} onPress={() => set({ keep: !a.keep })} style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.sage, borderRadius: 14, padding: 14, minHeight: 52 }}>
          <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: C.sageInk, backgroundColor: a.keep ? C.sageInk : "transparent", alignItems: "center", justifyContent: "center" }}>{a.keep ? <Icon name="check" color={C.sage} size={16} /> : null}</View>
          <T style={{ flex: 1, fontSize: 14.5, fontFamily: F.sans600, color: C.sageInk }}>Keep these answers in my record. Only I see them, and I can clear them anytime.</T>
        </Pressable>
      ) : null}
      {nav(() => setStep(3))}
    </View>
  );
  return (
    <View style={{ gap: 16 }} testID="fr-value">
      {progress}
      <UsefulThing a={a} set={set} />
      <Card style={{ gap: 6 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Save this</T>
        <Muted style={{ fontSize: 14 }}>Add a phone number or email and we'll send a code. Nothing above leaves your phone until you do.</Muted>
      </Card>
      {nav(() => onSave(a), "Save with a code", false, "fr-save")}
    </View>
  );
}

export const STAGES: [SoloStage, string, string][] = [
  ["trying", "Trying on my own", "Before a clinic, or deciding when to see one"],
  ["just_starting", "Getting started with a clinic", "A first consult and tests"],
  ["freezing_eggs", "Freezing eggs", "Meds, visits and costs"],
  ["in_cycle", "In a cycle", "Meds, monitoring visits and results"],
  ["two_week_wait", "In the two-week wait", "After a transfer or IUI"],
  ["pregnant", "Pregnant after treatment", "Early scans, then your OB"],
  ["after_hard_result", "After a hard result", "Taking it one day at a time"],
  ["between_cycles", "Between cycles", "Planning what comes next"],
  ["storage", "Eggs or embryos in storage", "Storage, renewals and records"],
];

/** The one useful thing for her stage, before she gives any contact details. */
function UsefulThing({ a, set }: { a: FirstRunAnswers; set: (p: Partial<FirstRunAnswers>) => void }) {
  const qs = QUESTIONS[a.stage];
  // Questions default to all picked the first time she sees them.
  useEffect(() => { if (qs && !a.questions.length) set({ questions: qs }); }, [a.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const questionList = qs ? (
    <View style={{ gap: 8 }}>
      <T style={{ fontFamily: F.sans600, fontSize: 15 }}>Questions to bring</T>
      <Muted style={{ fontSize: 14 }}>Pick the ones you want. They'll be in your record, ready for the visit.</Muted>
      <CheckList testIDPrefix="fr-q-" options={qs.map((q, i) => [String(i), q])} selected={qs.map((q, i) => (a.questions.includes(q) ? String(i) : "")).filter(Boolean)}
        onToggle={(id) => { const q = qs[Number(id)]!; set({ questions: a.questions.includes(q) ? a.questions.filter((x) => x !== q) : [...a.questions, q] }); }} />
    </View>
  ) : null;
  const bullets = (items: string[]) => <View style={{ gap: 6 }}>{items.map((t) => <View key={t} style={{ flexDirection: "row", gap: 10 }}><T style={{ color: C.lavInk, fontFamily: F.sans700 }}>·</T><T style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>{t}</T></View>)}</View>;

  switch (a.stage) {
    case "trying": return (
      <>
        <Head title="When people usually see a specialist" />
        <Card style={{ gap: 10 }} testID="fr-guideline">
          {bullets([
            "Under 35: after 12 months of trying to get pregnant.",
            "35 or older: after 6 months.",
            "Planning with donor sperm, donor eggs or a carrier, or with a known condition: you can see one anytime. You don't need to wait.",
          ])}
          <Muted style={{ fontSize: 13 }}>From the American Society for Reproductive Medicine's 2023 definition. Your own doctor can help you decide what's right for you.</Muted>
        </Card>
        {questionList}
      </>
    );
    case "just_starting": return (
      <>
        <Head title="Your first-consult kit" sub="What a first visit usually covers, so nothing catches you off guard." />
        <Card style={{ gap: 10 }} testID="fr-consult">
          {bullets([
            "Your health and cycle history, and any past tests or treatment.",
            "The tests to plan. Some happen on certain days of your cycle, others any day.",
            "Your options, and what the doctor suggests for you.",
            "What it could cost, and what your insurance or benefit might cover.",
          ])}
          <Muted style={{ fontSize: 13 }}>Bring your insurance card, your cycle dates and any results you already have. It's a lot of information at once, so Pumpkin keeps the plan in one place after.</Muted>
        </Card>
        {questionList}
      </>
    );
    case "freezing_eggs": case "in_cycle": return (
      <>
        <Head title="Your meds calendar, set up for you" sub="Snap the calendar your clinic gives you. Pumpkin reads every dose, dose change and visit, and you check each one." />
        <Card style={{ gap: 10 }} testID="fr-calendar">
          <T style={{ fontFamily: F.sans700, fontSize: 13, letterSpacing: 0.6 }}>SAMPLE DATA</T>
          {[["Gonal-f 225 IU", "8:00 pm · days 1 to 4"], ["Gonal-f 150 IU", "8:00 pm · days 5 to 9"], ["Menopur 75 IU", "8:00 pm · days 1 to 9"], ["Cetrotide 0.25 mg", "8:00 am · days 6 to 9"], ["Trigger shot", "9:30 pm · day 10, exact time"]].map(([n, w]) => (
            <View key={n} style={{ flexDirection: "row", gap: 10 }}><View style={{ width: 4, borderRadius: 2, backgroundColor: C.lavInk }} /><View><T style={{ fontFamily: F.sans600, fontSize: 14.5 }}>{n}</T><Muted style={{ fontSize: 13.5 }}>{w}</Muted></View></View>
          ))}
          <Muted style={{ fontSize: 13 }}>Every dose gets a reminder you can log from the notification.</Muted>
        </Card>
      </>
    );
    case "two_week_wait": return (
      <>
        <Head title="Waiting is hard" sub="Pumpkin keeps the wait quiet. Two things you can set now:" />
        <Card style={{ gap: 12 }} testID="fr-wait">
          <DateField testID="fr-beta" label="The date of your blood test (optional)" value={a.betaOn} onChange={(v) => set({ betaOn: v })} />
          <T style={{ fontFamily: F.sans600, fontSize: 14 }}>When a result is added to Pumpkin</T>
          <ChoiceList testIDPrefix="fr-reveal-" options={[["show", "Show it to me right away"], ["tap", "Wait until I tap to see it"]]} value={a.waitForTap ? "tap" : "show"} onChange={(v) => set({ waitForTap: v === "tap" })} />
        </Card>
      </>
    );
    case "pregnant": return (
      <>
        <Head title="From your clinic to your OB" sub="Most people move to an OB around 8 to 10 weeks. Pumpkin gathers what to take with you." />
        <Card style={{ gap: 10 }} testID="fr-ob">
          {bullets(["Copies of your records and blood test results", "Your transfer or insemination date, so your due date is right", "Which meds to keep taking, and when your clinic says to stop", "Your OB's name and first appointment"])}
          <Muted style={{ fontSize: 13 }}>Ask your clinic to confirm your due date; dating after IVF or IUI can differ from the usual method.</Muted>
        </Card>
      </>
    );
    case "after_hard_result": return (
      <>
        <Head title="Pumpkin will be gentle" sub="Whatever happened, you don't have to decide anything today." />
        <Card style={{ gap: 8 }} testID="fr-hard">
          <T style={{ fontSize: 15, lineHeight: 21 }}>Pumpkin will keep things quiet: no pregnancy content, no money nudges, no setup cards. Your follow-up visit and the people you choose stay close.</T>
        </Card>
      </>
    );
    case "between_cycles": return (
      <>
        <Head title="Before your follow-up visit" sub="A few questions people find useful after a cycle." />
        {questionList}
      </>
    );
    default: return (
      <>
        <Head title="Your eggs or embryos, kept track of" sub="Where they're stored, what each year costs, and when to renew." />
        <Card style={{ gap: 10 }} testID="fr-storage">
          {bullets(["The clinic or storage facility, and how to reach them", "The yearly fee and its due date, with a reminder", "Donor details, if you used a donor, kept for the long term"])}
        </Card>
      </>
    );
  }
}

/** After she saves: put what she chose into her record. Who and plan only with her OK. */
export async function applyFirstRun(api: Api, a: FirstRunAnswers) {
  const paths = familyPathsFrom(a);
  if (a.keep && paths.length) await api.saveAbout({ familyPath: paths }, { consent: true }).catch(() => null);
  if (a.waitForTap) await api.saveAbout({ revealResults: true }).catch(() => null);
  for (const q of a.questions) await api.addByHand("question", { text: q }).catch(() => null);
  if (a.betaOn) await api.addByHand("appointment", { title: "Pregnancy blood test", startsAt: `${a.betaOn}T08:00` }).catch(() => null);
  await clearFirstRun();
}

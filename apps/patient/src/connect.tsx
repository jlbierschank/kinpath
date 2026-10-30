/**
 * Connect her own Pumpkin to her clinic, when the clinic is on Pumpkin. She finds it, picks what to
 * share, and asks; a nurse confirms it's her. She can change what's shared or stop anytime, and
 * stopping ends the clinic's access right away. Nothing is copied: her record stays hers.
 */
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { Api, ClinicLink, LinkShare } from "./api";
import { Button, C, Card, CheckList, F, Icon, Muted, T } from "./ui";
import { Field } from "./field";

const SHARE: [keyof LinkShare, string][] = [
  ["about", "My name, pronouns and how I like news"],
  ["meds", "My medications"],
  ["results", "My results"],
  ["visits", "My visits"],
  ["questions", "My questions for my next visit"],
  ["background", "My health background"],
];
const DEFAULT: LinkShare = { about: true, meds: true, results: true, visits: true, questions: true, background: false };
const picked = (s: LinkShare) => SHARE.map(([k]) => k).filter((k) => s[k]);

export function ClinicConnectCard({ api, clinicName }: { api: Api; clinicName: string | null }) {
  const [links, setLinks] = useState<ClinicLink[] | null>(null);
  const [q, setQ] = useState(clinicName ?? "");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [share, setShare] = useState<LinkShare>(DEFAULT);
  const [confirmStop, setConfirmStop] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.clinicLinks().then(setLinks).catch(() => setLinks([])); }, [api]);
  useEffect(load, [load]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => { api.joinableClinics(q).then(setFound).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [api, q]);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); load(); } catch (e) { setErr((e as Error).message); } };

  if (!links) return null;
  const live = links.find((l) => l.status === "requested" || l.status === "active");
  const lastDeclined = !live && links[0]?.status === "declined" ? links[0] : null;
  const toggle = (id: string) => { const k = id as keyof LinkShare; return (live ? void run(() => api.updateClinicLink(live.id, { share: { [k]: !live.share[k] } }), "Saved. Your clinic sees the change right away.") : setShare((s) => ({ ...s, [k]: !s[k] }))); };

  return (
    <Card testID="clinic-connect" style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="people" /><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Your clinic on Pumpkin</T></View>
      {live ? (
        <>
          <T testID="connect-status" style={{ fontSize: 15 }}>{live.status === "active" ? `Connected to ${live.clinicName}. Your care team sees what you tick below, and can't change anything.` : `Waiting for ${live.clinicName} to confirm it's you. Nothing is shared until they do.`}</T>
          <CheckList testIDPrefix="connect-share-" options={SHARE} selected={picked(live.share)} onToggle={toggle} />
          {confirmStop ? (
            <View style={{ backgroundColor: C.alertSoft, borderRadius: 14, padding: 12, gap: 8 }}>
              <T style={{ fontSize: 14.5 }}>{`Stop sharing with ${live.clinicName}? They won't see anything from your Pumpkin after this. Your record stays here.`}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button testID="connect-stop-yes" kind="red" label="Stop sharing" onPress={() => { setConfirmStop(false); void run(() => api.updateClinicLink(live.id, { stop: true }), "Stopped. Your clinic can't see your Pumpkin anymore."); }} /></View>
                <View style={{ flex: 1 }}><Button kind="line" label="Keep sharing" onPress={() => setConfirmStop(false)} /></View>
              </View>
            </View>
          ) : <Pressable testID="connect-stop" onPress={() => setConfirmStop(true)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><T style={{ color: C.red, fontFamily: F.sans600 }}>{live.status === "active" ? "Stop sharing" : "Cancel the request"}</T></Pressable>}
        </>
      ) : chosen ? (
        <>
          <T style={{ fontSize: 15 }}>{`Share with ${chosen.name}:`}</T>
          <CheckList testIDPrefix="connect-share-" options={SHARE} selected={picked(share)} onToggle={toggle} />
          <Muted style={{ fontSize: 13 }}>{`${chosen.name} sees the name and contact you signed up with, so a nurse can find your chart, plus what you tick. They can't change anything. You can stop anytime.`}</Muted>
          <Button testID="connect-ask" kind="esp" label={`Ask ${chosen.name} to connect`} disabled={!picked(share).length} onPress={() => void run(() => api.requestClinicLink(chosen.id, share), `Sent. ${chosen.name} will confirm it's you.`).then(() => setChosen(null))} />
          <Button kind="plain" label="Back" onPress={() => setChosen(null)} />
        </>
      ) : (
        <>
          <Muted style={{ fontSize: 14 }}>{lastDeclined ? `${lastDeclined.clinicName} didn't confirm your last request. Check with them, then try again.` : "If your clinic uses Pumpkin, connect so your care team can see what you track. You choose what they see."}</Muted>
          <Field testID="connect-search" label="Find your clinic" value={q} onChange={setQ} placeholder="Clinic name" />
          {found.map((c) => (
            <Pressable key={c.id} testID={`connect-pick-${c.id}`} accessibilityRole="button" onPress={() => setChosen(c)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, backgroundColor: C.oat, paddingHorizontal: 14 }}>
              <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{c.name}</T><T style={{ color: C.lavInk, fontFamily: F.sans600 }}>Connect</T>
            </Pressable>
          ))}
          {q.trim().length >= 2 && !found.length ? <Muted style={{ fontSize: 13 }}>Not on Pumpkin yet. You can ask them to join from Today.</Muted> : null}
        </>
      )}
      {msg ? <T testID="connect-msg" style={{ color: C.sageInk, fontFamily: F.sans600 }}>{msg}</T> : null}
      {err ? <T style={{ color: C.red }}>{err}</T> : null}
    </Card>
  );
}

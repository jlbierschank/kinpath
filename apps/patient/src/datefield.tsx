/**
 * Date and time fields that open the phone's own picker (scroll wheels on iPhone, a calendar on
 * Android and in browsers) and show friendly text: "Wed, Oct 29" and "8:00 pm".
 * Values stay in the record's formats: "YYYY-MM-DD" for dates and 24-hour "HH:MM" for times.
 */
import { createElement, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button, C, F, isDark, Muted, Pill, st, T } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toHm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromYmd = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, 12) : null; };
const fromHm = (s: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(s); if (!m) return null; const d = new Date(); d.setHours(+m[1]!, +m[2]!, 0, 0); return d; };

/** "Wed, Oct 29" (adds the year when it isn't this year). */
export function niceDate(ymd: string): string {
  const d = fromYmd(ymd);
  if (!d) return ymd;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
/** "8:00 pm". */
export function niceTime(hm: string): string {
  const d = fromHm(hm);
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase() : hm;
}

function Label({ label, check }: { label: string; check?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <T style={{ fontFamily: F.sans600, fontSize: 14 }}>{label}</T>
      {check ? <Pill tone="clay" label="Check this" /> : null}
    </View>
  );
}

function Picker({ mode, value, onChange, label, check, testID, hint, placeholder }: { mode: "date" | "time"; value: string; onChange: (v: string) => void; label: string; check?: boolean; testID?: string; hint?: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const border = check ? C.clayInk : C.espresso;
  const parsed = mode === "date" ? fromYmd(value) : fromHm(value);
  const shown = value ? (mode === "date" ? niceDate(value) : niceTime(value)) : "";

  if (Platform.OS === "web") {
    // The browser's own picker: a calendar on desktop, wheels on iPhone Safari.
    const input = createElement("input", {
      type: mode, value: parsed ? value.slice(0, mode === "date" ? 10 : 5) : "", "data-testid": testID, "aria-label": label,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      style: { boxSizing: "border-box", width: "100%", minHeight: 48, padding: "10px 12px", borderRadius: 14, border: `1.5px solid ${border}`, background: C.field, color: C.ink, fontFamily: F.sans, fontSize: 16 },
    });
    return <View style={{ gap: 4 }}><Label label={label} check={check} />{input}{shown ? <Muted style={{ fontSize: 13 }}>{shown}</Muted> : null}{hint ? <Muted style={{ fontSize: 13 }}>{hint}</Muted> : null}</View>;
  }

  const initial = parsed ?? (mode === "time" ? fromHm("20:00")! : new Date());
  return (
    <View style={{ gap: 4 }}>
      <Label label={label} check={check} />
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${shown || "not set"}`} onPress={() => setOpen((o) => !o)}
        style={[st.input, { minHeight: 48, justifyContent: "center", borderColor: border }]}>
        <T style={{ fontSize: 16, color: shown ? C.ink : C.stone }}>{shown || placeholder}</T>
      </Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <DateTimePicker value={initial} mode={mode} display={Platform.OS === "ios" ? "spinner" : "default"} themeVariant={isDark() ? "dark" : "light"}
            onChange={(event, d) => {
              if (Platform.OS !== "ios") setOpen(false);
              if (event.type === "set" && d) onChange(mode === "date" ? toYmd(d) : toHm(d));
            }} />
          {Platform.OS === "ios" ? <Button kind="line" label="Done" onPress={() => { if (!parsed) onChange(mode === "date" ? toYmd(initial) : toHm(initial)); setOpen(false); }} /> : null}
        </View>
      ) : null}
      {hint ? <Muted style={{ fontSize: 13 }}>{hint}</Muted> : null}
    </View>
  );
}

export function DateField(p: { value: string; onChange: (v: string) => void; label: string; check?: boolean; testID?: string; hint?: string }) {
  return <Picker mode="date" placeholder="Pick a date" {...p} />;
}
export function TimeField(p: { value: string; onChange: (v: string) => void; label: string; check?: boolean; testID?: string; hint?: string }) {
  return <Picker mode="time" placeholder="Pick a time" {...p} />;
}

/** One or more times a day ("8:00 pm", "8:00 am"), each with its own picker. */
export function TimesField({ value, onChange, label, check, testID }: { value: string[]; onChange: (v: string[]) => void; label: string; check?: boolean; testID?: string }) {
  const times = value.length ? value : [""];
  return (
    <View style={{ gap: 8 }}>
      {times.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <TimeField testID={i === 0 ? testID : `${testID}-${i}`} label={i === 0 ? label : `Time ${i + 1}`} value={t} check={check && !t}
              onChange={(v) => onChange(times.map((x, k) => (k === i ? v : x)).filter(Boolean))} />
          </View>
          {times.length > 1 ? <Pressable accessibilityLabel="Remove this time" onPress={() => onChange(times.filter((_, k) => k !== i))} style={{ minHeight: 48, minWidth: 44, alignItems: "center", justifyContent: "center" }}><T style={{ fontSize: 20, color: C.stone }}>×</T></Pressable> : null}
        </View>
      ))}
      <Pressable testID={testID ? `${testID}-add` : undefined} onPress={() => onChange([...times.filter(Boolean), times.length === 1 && times[0] ? "08:00" : "20:00"])} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
        <T style={{ fontFamily: F.sans600, color: C.lavInk }}>+ Add another time</T>
      </Pressable>
    </View>
  );
}

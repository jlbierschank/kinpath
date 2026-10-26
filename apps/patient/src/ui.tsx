/**
 * Kinpath design system for the phone app, matched to the clickable demo:
 * Newsreader italic for headlines, Instrument Sans for everything else, oat background,
 * paper cards with a solid 3px bottom edge (no blur), one marigold action per screen.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

export const C = {
  espresso: "#2E211C", espressoEdge: "#1A120E", ink: "#231A16", oat: "#F6F1E8", paper: "#FFFCF7",
  marigold: "#F0A83A", marigoldEdge: "#B9781C", lav: "#D8CFF0", lavInk: "#5A4A8C", lavDeep: "#3F3466",
  sage: "#DDE7D5", sageInk: "#3E5A33", clay: "#F5DDD0", clayInk: "#9A4A2A", red: "#B42318",
  stone: "#6B5F57", line: "#E6DED2", lineSoft: "#EFE8DC", tan: "#D9CBBE", well: "#45352E", softLav: "#F1ECFA",
};

export const F = {
  serif: "Newsreader_500Medium", serifItalic: "Newsreader_400Regular_Italic",
  sans: "InstrumentSans_400Regular", sans500: "InstrumentSans_500Medium", sans600: "InstrumentSans_600SemiBold", sans700: "InstrumentSans_700Bold",
};

export function T({ children, style, testID, numberOfLines }: { children: ReactNode; style?: TextStyle | TextStyle[]; testID?: string; numberOfLines?: number }) {
  return <Text testID={testID} numberOfLines={numberOfLines} style={[{ fontFamily: F.sans, color: C.ink, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}
/** The big italic "Today" headline. */
export function Today({ children, size = 40 }: { children: ReactNode; size?: number }) {
  return <Text accessibilityRole="header" style={{ fontFamily: F.serifItalic, fontSize: size, lineHeight: size * 1.05, letterSpacing: -0.8, color: C.espresso }}>{children}</Text>;
}
/** Section headline (h1 in the demo): Newsreader 500, upright. */
export function H1({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Text testID={testID} accessibilityRole="header" style={{ fontFamily: F.serif, fontSize: 30, lineHeight: 33, letterSpacing: -0.6, color: C.espresso }}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <T style={[{ color: C.stone, fontSize: 13.5 }, style ?? {}]}>{children}</T>;
}
export function Cap({ children }: { children: ReactNode }) {
  return <T style={{ fontFamily: F.sans600, fontSize: 12, color: C.stone }}>{children}</T>;
}

export function Card({ children, style, pad = true }: { children: ReactNode; style?: ViewStyle; pad?: boolean }) {
  return <View style={[st.card, pad && { padding: 16 }, style]}>{children}</View>;
}
export function Row({ title, sub, right, onPress, testID }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void; testID?: string }) {
  const body = (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.sans600, fontSize: 15 }}>{title}</T>
        {sub ? <T style={{ fontSize: 13, color: C.stone }}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <Pressable testID={testID} onPress={onPress}>{body}</Pressable> : body;
}

export function Button({ label, onPress, kind = "mari", disabled, testID }: { label: string; onPress: () => void; kind?: "mari" | "esp" | "line" | "plain" | "red"; disabled?: boolean; testID?: string }) {
  const look = {
    mari: { bg: C.marigold, fg: C.ink, edge: C.marigoldEdge, font: F.sans700 },
    esp: { bg: C.espresso, fg: C.paper, edge: C.espressoEdge, font: F.sans600 },
    red: { bg: C.red, fg: "#fff", edge: "#7E1810", font: F.sans700 },
    line: { bg: C.paper, fg: C.ink, edge: null, font: F.sans600 },
    plain: { bg: "transparent", fg: C.stone, edge: null, font: F.sans600 },
  }[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [st.btn, { backgroundColor: look.bg, opacity: disabled ? 0.5 : 1 },
        look.edge ? { borderBottomWidth: pressed ? 1 : 3, borderBottomColor: look.edge, marginTop: pressed ? 2 : 0 } : null,
        kind === "line" ? { borderWidth: 1, borderColor: C.espresso } : null]}>
      <Text style={{ fontFamily: look.font, fontSize: 15, color: look.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, onPress, selected, testID }: { label: string; onPress?: () => void; selected?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[st.chip, selected && { backgroundColor: C.espresso, borderColor: C.espresso }]}>
      <Text style={{ fontFamily: F.sans500, fontSize: 13.5, color: selected ? C.paper : C.ink }}>{label}</Text>
    </Pressable>
  );
}
export function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

export function Pill({ label, tone }: { label: string; tone: "sage" | "clay" | "lav" | "stone" | "red" }) {
  const [bg, fg] = { sage: [C.sage, C.sageInk], clay: [C.clay, C.clayInk], lav: [C.lav, C.lavDeep], stone: [C.lineSoft, C.stone], red: [C.red, "#fff"] }[tone];
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, alignSelf: "flex-start" }}><Text style={{ fontFamily: F.sans600, fontSize: 12, color: fg }}>{label}</Text></View>;
}

export function Moment({ children, tone = "sage" }: { children: ReactNode; tone?: "sage" | "lav" }) {
  return (
    <View style={{ backgroundColor: tone === "sage" ? C.sage : C.softLav, borderRadius: 16, padding: 14 }}>
      <Text style={{ fontFamily: F.sans600, fontSize: 14.5, color: tone === "sage" ? C.sageInk : C.lavDeep }}>{children}</Text>
    </View>
  );
}

export function Avatar({ text, bg = C.lav, fg = C.lavInk, size = 36 }: { text: string; bg?: string; fg?: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: F.sans700, fontSize: 12, color: fg }}>{text}</Text></View>;
}

/** The ask box: espresso border with a solid bottom edge, like the demo. */
export function AskBox({ value, onChange, onSubmit, placeholder, testID }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; testID?: string }) {
  return (
    <View style={st.ask}>
      <TextInput testID={testID} value={value} onChangeText={onChange} onSubmitEditing={onSubmit} placeholder={placeholder} placeholderTextColor={C.stone}
        returnKeyType="send" style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: C.ink, paddingVertical: 11 }} />
      <Pressable testID={testID ? `${testID}-send` : undefined} accessibilityLabel="Send" onPress={onSubmit} style={[st.sq, { backgroundColor: value.trim() ? C.marigold : C.lav }]}>
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M5 12h14M13 6l6 6-6 6" stroke={value.trim() ? C.ink : C.lavInk} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Pressable>
    </View>
  );
}

/** The dotted path through treatment. Done = sage, current = marigold, ahead = paper. */
export function JourneyPath({ current, labels }: { current: number; labels: string[] }) {
  const xs = [14, 57, 100, 143, 186, 229, 272, 315], ys = [38, 22, 34, 18, 32, 20, 30, 24];
  let d = `M${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) d += ` Q${(xs[i - 1]! + xs[i]!) / 2} ${ys[i - 1]! - 12} ${xs[i]} ${ys[i]}`;
  const anchor = current === xs.length - 1 ? "end" : current === 0 ? "start" : "middle";
  const lx = current === xs.length - 1 ? xs[current]! + 8 : current === 0 ? xs[0]! - 8 : xs[current]!;
  return (
    <View accessible accessibilityLabel={`You are at: ${labels[current]}`} style={{ height: 62 }}>
      <Svg width="100%" height={62} viewBox="0 0 330 62">
        <Path d={d} fill="none" stroke={C.tan} strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" />
        {xs.map((x, i) => (
          <Circle key={i} cx={x} cy={ys[i]} r={i === current ? 7 : 4.5}
            fill={i < current ? C.sageInk : i === current ? C.marigold : C.paper}
            stroke={i === current ? C.marigoldEdge : i < current ? C.sageInk : C.tan} strokeWidth={1.5} />
        ))}
        <SvgText x={lx} y={58} textAnchor={anchor} fontFamily={F.sans600} fontSize={11} fill={C.espresso}>{labels[current]}</SvgText>
      </Svg>
    </View>
  );
}

/** Timeline item with a round icon, used for "later today". */
export function TimelineItem({ when, what, action, onAction, tone = "lav", icon = "cal", first }: { when: string; what: string; action?: string; onAction?: () => void; tone?: "lav" | "sage" | "clay"; icon?: "cal" | "phone" | "drop"; first?: boolean }) {
  const [bg, fg] = { lav: [C.lav, C.lavInk], sage: [C.sage, C.sageInk], clay: [C.clay, C.clayInk] }[tone];
  const paths = { cal: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4", phone: "M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z", drop: "M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z" }[icon];
  return (
    <View style={[{ flexDirection: "row", gap: 12, paddingVertical: 10 }, !first && { borderTopWidth: 1, borderTopColor: C.line, borderStyle: "dashed" }]}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Svg width={15} height={15} viewBox="0 0 24 24"><Path d={paths} stroke={fg} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </View>
      <View style={{ flex: 1 }}>
        <T style={{ fontSize: 12, color: C.stone }}>{when}</T>
        <T style={{ fontFamily: F.sans600, fontSize: 14.5 }}>{what}</T>
        {action && onAction ? <Pressable onPress={onAction}><Text style={{ fontFamily: F.sans600, fontSize: 13.5, color: C.lavInk, paddingVertical: 4 }}>{action}</Text></Pressable> : null}
      </View>
    </View>
  );
}

export const st = StyleSheet.create({
  card: { backgroundColor: C.paper, borderRadius: 18, borderWidth: 1, borderColor: C.line, borderBottomWidth: 4 },
  dark: { backgroundColor: C.espresso, borderRadius: 20, padding: 18, gap: 10, borderBottomWidth: 4, borderBottomColor: C.espressoEdge },
  btn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", width: "100%" },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.lineSoft },
  ask: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.paper, borderWidth: 1.5, borderColor: C.espresso, borderBottomWidth: 4, borderRadius: 16, paddingLeft: 14, paddingRight: 4, paddingVertical: 4 },
  sq: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  medchip: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: C.well },
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 14, padding: 12, backgroundColor: "#fff", fontFamily: F.sans, fontSize: 15, minHeight: 80, textAlignVertical: "top", color: C.ink },
});

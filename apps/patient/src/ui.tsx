import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

export const C = {
  espresso: "#2E211C", ink: "#231A16", oat: "#F6F1E8", paper: "#FFFCF7", linen: "#E6DED2", stone: "#6B5F57",
  marigold: "#F0A83A", marigoldEdge: "#B9781C", lav: "#D8CFF0", lavInk: "#5A4A8C", sage: "#DDE7D5", sageInk: "#3E5A33",
  clay: "#F5DDD0", clayInk: "#9A4A2A", red: "#B42318",
};
const serif = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, serif" });

export function Title({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={s.title}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Pill({ label, tone }: { label: string; tone: "sage" | "clay" | "lav" | "red" }) {
  const map = { sage: [C.sage, C.sageInk], clay: [C.clay, C.clayInk], lav: [C.lav, C.lavInk], red: [C.red, "#fff"] } as const;
  return <Text style={[s.pill, { backgroundColor: map[tone][0], color: map[tone][1] }]}>{label}</Text>;
}
export function Button({ label, onPress, kind = "main", disabled, testID }: { label: string; onPress: () => void; kind?: "main" | "dark" | "line" | "red"; disabled?: boolean; testID?: string }) {
  const bg = { main: C.marigold, dark: C.espresso, line: C.paper, red: C.red }[kind];
  const fg = kind === "main" || kind === "line" ? C.ink : "#fff";
  const edge = { main: C.marigoldEdge, dark: "#1A120E", line: C.espresso, red: "#7E1810" }[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1, transform: [{ translateY: pressed ? 2 : 0 }] },
        kind === "line" ? { borderWidth: 1.5, borderColor: edge } : { shadowColor: edge, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 }]}>
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}
export function Moment({ children }: { children: ReactNode }) {
  return <View style={s.moment}><Text style={s.momentText}>{children}</Text></View>;
}

export const s = StyleSheet.create({
  title: { fontFamily: serif, fontStyle: "italic", fontSize: 34, color: C.espresso, marginBottom: 4 },
  muted: { color: C.stone, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: C.paper, borderRadius: 16, borderWidth: 1, borderColor: C.linen, padding: 14, marginBottom: 12,
    shadowColor: C.linen, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, fontWeight: "600", overflow: "hidden", alignSelf: "flex-start" },
  btn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", marginTop: 8 },
  btnText: { fontSize: 16, fontWeight: "700" },
  moment: { backgroundColor: C.sage, borderRadius: 16, padding: 14, marginBottom: 12 },
  momentText: { color: C.sageInk, fontWeight: "600", fontSize: 15 },
  h2: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, color: C.stone, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.linen, gap: 10 },
  input: { borderWidth: 1.5, borderColor: C.linen, borderRadius: 12, padding: 10, backgroundColor: "#fff", fontSize: 15, minHeight: 70, textAlignVertical: "top" },
});

/**
 * Pumpkin design system for the phone app (tokens from Pumpkin-Design-System/Tokens):
 * Bricolage Grotesque for headlines, Instrument Sans for everything else, oat background,
 * paper cards with a hairline, solid pressed edges only on buttons, one marigold action per screen.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, Switch, useColorScheme, Text, TextInput, View, type SwitchProps, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { ICONS, type IconName } from "./icons";
import { SvgPulse } from "./motion";
import * as SecureStore from "expo-secure-store";

/** Light and dark palettes. Same names, same jobs; dark values come from the design system's dark theme. */
const LIGHT = {
  espresso: "#2E211C", espressoEdge: "#1A120E", ink: "#231A16", oat: "#F6F1E8", paper: "#FFFCF7",
  marigold: "#F0A83A", marigoldEdge: "#B9781C", lav: "#D8CFF0", lavInk: "#3F3466", lavDeep: "#3F3466",
  sage: "#DDE7D5", sageInk: "#3E5A33", clay: "#F5DDD0", clayInk: "#9A4A2A", red: "#B42318",
  stone: "#5C4F47", alertSoft: "#FBE5E2", line: "#E6DED2", lineSoft: "#EFE8DC", tan: "#D9CBBE", well: "#45352E", softLav: "#F1ECFA",
  /** Text and icons on marigold, in both themes. */
  onMarigold: "#2E211C",
  /** Marigold labels and icons on espresso fills (a deeper amber in dark, where those fills turn cream). */
  marigoldOnEsp: "#F0A83A",
  /** Secondary text on espresso fills. */
  onEspMuted: "#E9DED3",
  lavShadow: "#B9ACDF", onRed: "#FFFFFF", redEdge: "#7E1810", field: "#FFFFFF",
  /** The brush pumpkin's center stroke and stem (they lighten on dark, as in the on-dark logo). */
  pumpkinCenter: "#B9781C", stem: "#3E5A33",
};
type Palette = typeof LIGHT;
const DARK: Palette = {
  espresso: "#F4EDE3", espressoEdge: "#C9BEB1", ink: "#F4EDE3", oat: "#231B17", paper: "#1B1512",
  marigold: "#F0A83A", marigoldEdge: "#B9781C", lav: "#2F2944", lavInk: "#CDC2F2", lavDeep: "#CDC2F2",
  sage: "#24301F", sageInk: "#B6CFA7", clay: "#3B2721", clayInk: "#F1B79D", red: "#FF8C7C",
  stone: "#B8AA9E", alertSoft: "#3E1D19", line: "#30271F", lineSoft: "#2A211C", tan: "#6B5D53", well: "#E8DFD3", softLav: "#26213A",
  onMarigold: "#2E211C", marigoldOnEsp: "#8F5A12", onEspMuted: "#4A3D35",
  lavShadow: "#3E3560", onRed: "#2A0F0B", redEdge: "#C25A4C", field: "#1B1512",
  pumpkinCenter: "#D9913A", stem: "#B6CFA7",
};

/** The live palette. Read it at render time; applyTheme swaps its values in place. */
export const C: Palette = { ...LIGHT };
export type Scheme = "light" | "dark";
export type Appearance = "system" | Scheme;
let current: Scheme | null = null; // null until first applied, so the page background is set on load
export const isDark = () => current === "dark";

/** Swap every color (and the shared styles) to light or dark. Safe to call on every render. */
export function applyTheme(scheme: Scheme) {
  if (scheme === current) return;
  current = scheme;
  Object.assign(C, scheme === "dark" ? DARK : LIGHT);
  Object.assign(st, makeStyles());
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.style.colorScheme = scheme;
    document.body.style.backgroundColor = C.oat;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", C.oat);
  }
}

const APPEARANCE_KEY = "kinpath.appearance";
async function loadAppearance(): Promise<Appearance> {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(APPEARANCE_KEY) : await SecureStore.getItemAsync(APPEARANCE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}
async function saveAppearance(a: Appearance) {
  try { if (Platform.OS === "web") globalThis.localStorage?.setItem(APPEARANCE_KEY, a); else await SecureStore.setItemAsync(APPEARANCE_KEY, a); } catch { /* kept for this session */ }
}

const ThemeCtx = createContext<{ appearance: Appearance; scheme: Scheme; setAppearance: (a: Appearance) => void }>({ appearance: "system", scheme: "light", setAppearance: () => {} });
/** Wraps the app: follows the phone's light or dark setting unless the person picked one in Settings. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const phone = useColorScheme();
  const [appearance, setA] = useState<Appearance>("system");
  useEffect(() => { void loadAppearance().then(setA); }, []);
  const scheme: Scheme = appearance === "system" ? (phone === "dark" ? "dark" : "light") : appearance;
  applyTheme(scheme);
  const value = useMemo(() => ({ appearance, scheme, setAppearance: (a: Appearance) => { setA(a); void saveAppearance(a); } }), [appearance, scheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
/** Re-renders the caller (and everything it draws) when the theme changes. */
export const useTheme = () => useContext(ThemeCtx);

/** Settings card: match the phone, or always light or dark. */
export function AppearanceCard() {
  const { appearance, setAppearance } = useTheme();
  const opts: [Appearance, string][] = [["system", "Match phone"], ["light", "Light"], ["dark", "Dark"]];
  return (
    <Card style={{ gap: 10 }}>
      <View><T style={{ fontFamily: F.sans600, fontSize: 15 }}>Appearance</T><Muted>Dark is easier on the eyes at night. Match phone follows your phone's setting.</Muted></View>
      <Chips>{opts.map(([v, label]) => <Chip key={v} testID={`appearance-${v}`} label={label} selected={appearance === v} onPress={() => setAppearance(v)} />)}</Chips>
    </Card>
  );
}

export const F = {
  serif: "BricolageGrotesque_600SemiBold", serifItalic: "BricolageGrotesque_600SemiBold", display: "BricolageGrotesque_600SemiBold", display700: "BricolageGrotesque_700Bold",
  sans: "InstrumentSans_400Regular", sans500: "InstrumentSans_500Medium", sans600: "InstrumentSans_600SemiBold", sans700: "InstrumentSans_700Bold",
};

export function T({ children, style, testID, numberOfLines }: { children: ReactNode; style?: TextStyle | TextStyle[]; testID?: string; numberOfLines?: number }) {
  return <Text testID={testID} numberOfLines={numberOfLines} style={[{ fontFamily: F.sans, color: C.ink, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}
/** The big screen headline ("Today"): Bricolage Grotesque 600, tight tracking. */
export function Today({ children, size = 40 }: { children: ReactNode; size?: number }) {
  return <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.03, color: C.espresso }}>{children}</Text>;
}
/** Section headline (h3 in the design system). */
export function H1({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Text testID={testID} accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: C.espresso }}>{children}</Text>;
}
/** A brush-line icon from the design system. Decorative: put words beside it. */
export function Icon({ name, size = 24, color = C.espresso }: { name: IconName; size?: number; color?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 32 32">{ICONS[name].map((d, i) => <Path key={i} d={d} fill={color} />)}</Svg>
    </View>
  );
}
export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <T style={[{ color: C.stone, fontSize: 13.5 }, style ?? {}]}>{children}</T>;
}
export function Cap({ children }: { children: ReactNode }) {
  return <T style={{ fontFamily: F.sans600, fontSize: 12, color: C.stone }}>{children}</T>;
}

export function Card({ children, style, pad = true, testID }: { children: ReactNode; style?: ViewStyle; pad?: boolean; testID?: string }) {
  return <View testID={testID} style={[st.card, pad && { padding: 16 }, style]}>{children}</View>;
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
    mari: { bg: C.marigold, fg: C.onMarigold, edge: C.marigoldEdge, font: F.sans700 },
    esp: { bg: C.espresso, fg: C.paper, edge: C.espressoEdge, font: F.sans600 },
    red: { bg: C.red, fg: C.onRed, edge: C.redEdge, font: F.sans700 },
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
  const [bg, fg] = { sage: [C.sage, C.sageInk], clay: [C.clay, C.clayInk], lav: [C.lav, C.lavDeep], stone: [C.lineSoft, C.stone], red: [C.red, C.onRed] }[tone];
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
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M5 12h14M13 6l6 6-6 6" stroke={value.trim() ? C.onMarigold : C.lavInk} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Pressable>
    </View>
  );
}

/** The dotted path through treatment. Done = sage, current = marigold, ahead = paper. */
export function JourneyPath({ current, labels, calm = false }: { current: number; labels: string[]; calm?: boolean }) {
  const xs = [14, 57, 100, 143, 186, 229, 272, 315], ys = [38, 22, 34, 18, 32, 20, 30, 24];
  let d = `M${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) d += ` Q${(xs[i - 1]! + xs[i]!) / 2} ${ys[i - 1]! - 12} ${xs[i]} ${ys[i]}`;
  const anchor = current === xs.length - 1 ? "end" : current === 0 ? "start" : "middle";
  const lx = current === xs.length - 1 ? xs[current]! + 8 : current === 0 ? xs[0]! - 8 : xs[current]!;
  return (
    <View accessible accessibilityLabel={`You are at: ${labels[current]}`} style={{ height: 62 }}>
      <Svg width="100%" height={62} viewBox="0 0 330 62">
        <Path d={d} fill="none" stroke={C.tan} strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" />
        <SvgPulse cx={xs[current]!} cy={ys[current]!} still={calm} />
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

function makeStyles() { return {
  card: { backgroundColor: C.paper, borderRadius: 22, borderWidth: 1, borderColor: C.line },
  dark: { backgroundColor: C.espresso, borderRadius: 20, padding: 18, gap: 10, borderBottomWidth: 4, borderBottomColor: C.espressoEdge },
  btn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", width: "100%" },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.lineSoft },
  ask: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.paper, borderWidth: 1.5, borderColor: C.espresso, borderBottomWidth: 4, borderRadius: 16, paddingLeft: 14, paddingRight: 4, paddingVertical: 4 },
  sq: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  medchip: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: C.well },
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 14, padding: 12, backgroundColor: C.field, fontFamily: F.sans, fontSize: 15, minHeight: 80, textAlignVertical: "top", color: C.ink },
} as const; }
/** Shared styles; rebuilt in place when the theme changes. */
export const st: ReturnType<typeof makeStyles> = { ...makeStyles() };

/** On/off switch in the app's colors. activeThumbColor is the web equivalent of thumbColor when on. */
export function Toggle({ value, onChange, disabled, testID }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  const web = { activeThumbColor: C.paper, activeTrackColor: C.espresso } as unknown as SwitchProps;
  return <Switch testID={testID} value={value} disabled={disabled} onValueChange={onChange} thumbColor={C.paper} trackColor={{ true: C.espresso, false: C.line }} ios_backgroundColor={C.line} {...web} />;
}

/** The Pumpkin logo (color mark plus lowercase wordmark), from the design system. Minimum width 96. */
const LOGO = require("../assets/logo-horizontal.png");
const LOGO_DARK = require("../assets/logo-horizontal-on-dark.png");
export function Logo({ width = 124 }: { width?: number }) {
  return <Image testID="logo" source={isDark() ? LOGO_DARK : LOGO} accessibilityRole="image" accessibilityLabel="Pumpkin" style={{ width: Math.max(96, width), height: Math.max(96, width) * 251 / 800 }} resizeMode="contain" />;
}

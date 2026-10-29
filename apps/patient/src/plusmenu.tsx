/**
 * The + menu: a rounded glass list that opens from the + button, like the iPhone's Messages menu.
 * Each row has a colored round icon and a plain name. Tap outside, press Escape, or pick one to close.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { C, F, Icon, isDark } from "./ui";
import type { IconName } from "./icons";
import { useReduceMotion } from "./motion";

export type PlusItem = { id: string; label: string; icon: IconName | "camera"; tint: [string, string]; onPress: () => void };

const CameraGlyph = ({ color }: { color: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24"><Path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" stroke={color} strokeWidth={1.9} fill="none" strokeLinejoin="round" /><Circle cx={12} cy={13} r={3.4} stroke={color} strokeWidth={1.9} fill="none" /><Rect x={16.6} y={9.3} width={1.4} height={1.4} rx={0.7} fill={color} /></Svg>
);

export function PlusMenu({ open, onClose, sections }: { open: boolean; onClose: () => void; sections: { title?: string; items: PlusItem[] }[] }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) { a.setValue(0); return; }
    if (reduce) a.setValue(1); else Animated.spring(a, { toValue: 1, useNativeDriver: Platform.OS !== "web", speed: 22, bounciness: 5 }).start();
    if (Platform.OS !== "web") return;
    const doc = (globalThis as unknown as { document?: { addEventListener: (t: string, f: (e: { key: string }) => void) => void; removeEventListener: (t: string, f: (e: { key: string }) => void) => void } }).document;
    const onKey = (e: { key: string }) => { if (e.key === "Escape") onClose(); };
    doc?.addEventListener("keydown", onKey);
    return () => doc?.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const dark = isDark();
  const { height } = useWindowDimensions();
  const glass = { backgroundColor: dark ? "rgba(36,28,23,0.86)" : "rgba(255,252,246,0.86)", backdropFilter: "blur(26px) saturate(170%)", WebkitBackdropFilter: "blur(26px) saturate(170%)" };
  const row = (it: PlusItem): ReactNode => (
    <Pressable key={it.id} testID={`menu-${it.id}`} accessibilityRole="menuitem" onPress={() => { onClose(); it.onPress(); }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: pressed ? (dark ? "rgba(255,255,255,0.06)" : "rgba(60,40,25,0.06)") : "transparent" })}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: it.tint[0], alignItems: "center", justifyContent: "center" }}>
        {it.icon === "camera" ? <CameraGlyph color={it.tint[1]} /> : <Icon name={it.icon} size={22} color={it.tint[1]} />}
      </View>
      <Text maxFontSizeMultiplier={1.6} style={{ fontFamily: F.sans500, fontSize: 17, color: C.ink, flex: 1 }}>{it.label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable testID="menu-backdrop" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: dark ? "rgba(0,0,0,0.35)" : "rgba(30,20,12,0.18)" }} />
      <Animated.View accessibilityRole="menu" testID="plus-menu"
        style={{ position: "absolute", top: insets.top + 64, right: 12, width: 290, maxWidth: "92%", borderRadius: 28, padding: 6, borderWidth: 1,
          borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(60,40,25,0.10)", ...glass,
          boxShadow: dark ? "0 18px 40px rgba(0,0,0,0.5)" : "0 18px 40px rgba(60,40,25,0.20)",
          opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], transformOrigin: "top right" } as never}>
        <ScrollView style={{ maxHeight: height - insets.top - 64 - Math.max(insets.bottom, 16) - 16 }} bounces={false}>
        {sections.map((s, i) => (
          <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: dark ? "rgba(255,255,255,0.08)" : "rgba(60,40,25,0.08)", paddingTop: i ? 4 : 0, marginTop: i ? 4 : 0 }}>
            {s.title ? <Text style={{ fontFamily: F.sans600, fontSize: 12.5, color: C.stone, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 }}>{s.title}</Text> : null}
            {s.items.map(row)}
          </View>
        ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

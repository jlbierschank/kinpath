/**
 * A bottom sheet for the web build, drawn over the screen it came from (the route is a transparent
 * modal on web). Close it by tapping outside, pressing Escape, dragging the grabber down, or Cancel.
 * On iPhone and Android the system draws sheets, so this isn't used there.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, PanResponder, Platform, Pressable, View } from "react-native";
import { C } from "./ui";
import { useReduceMotion } from "./motion";

export function WebSheet({ children, header, onClose }: { children: ReactNode; header?: ReactNode; onClose: () => void }) {
  const reduce = useReduceMotion();
  const y = useRef(new Animated.Value(reduce ? 0 : 600)).current;
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return; closing.current = true;
    if (reduce) return onClose();
    Animated.timing(y, { toValue: 700, duration: 180, useNativeDriver: false }).start(() => onClose());
  };
  useEffect(() => {
    if (!reduce) Animated.spring(y, { toValue: 0, useNativeDriver: false, bounciness: 2, speed: 16 }).start();
    if (Platform.OS !== "web") return;
    const doc = (globalThis as unknown as { document?: { addEventListener: (t: string, f: (e: { key: string }) => void) => void; removeEventListener: (t: string, f: (e: { key: string }) => void) => void } }).document;
    const onKey = (e: { key: string }) => { if (e.key === "Escape") close(); };
    doc?.addEventListener("keydown", onKey);
    return () => doc?.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
    onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => { if (g.dy > 110 || g.vy > 0.9) close(); else Animated.spring(y, { toValue: 0, useNativeDriver: false }).start(); },
  })).current;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable testID="sheet-backdrop" accessibilityLabel="Close" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(20,12,6,0.38)" }} />
      <Animated.View accessibilityViewIsModal style={{ transform: [{ translateY: y }], height: "92%", width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: C.oat, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" }}>
        <View {...drag.panHandlers} style={{ paddingTop: 8, paddingBottom: 2, alignItems: "center", cursor: "grab" } as never}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.line }} />
        </View>
        {header}
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </View>
  );
}

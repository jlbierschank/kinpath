/**
 * Swipe a row to act on it: right for the main action (log a dose, mark read), left for the
 * second one (snooze). Every swipe has a button too, so nobody has to discover the gesture.
 * Vertical scrolling still wins unless the finger clearly moves sideways.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Platform, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { F, T } from "./ui";

export type SwipeAction = { label: string; bg: string; fg: string; run: () => void | Promise<void> };
const THRESHOLD = 88;

/**
 * True on a computer with a mouse or trackpad, where nobody swipes. Those devices get visible buttons
 * and no swipe tips. Phones and tablets (touch) keep the gestures, which always have buttons too.
 */
export function usePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const mm = (globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void } }).matchMedia;
    const q = mm?.("(hover: hover) and (pointer: fine)");
    if (!q) return;
    const on = () => setFine(q.matches); on();
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return fine;
}

export const tick = () => { if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };

export function SwipeRow({ children, right, left, testID, radius = 16, surface, buttons = true }: { children: ReactNode; right?: SwipeAction; left?: SwipeAction; testID?: string; radius?: number; surface: string; buttons?: boolean }) {
  const pointer = usePointer();
  const acts = useRef({ right, left }); acts.current = { right, left };
  const x = useRef(new Animated.Value(0)).current;
  const [dir, setDir] = useState<"right" | "left" | null>(null);
  const busy = useRef(false);
  const settle = () => Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== "web", bounciness: 4 }).start(() => setDir(null));
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      const d = g.dx > 0 ? (acts.current.right ? g.dx : 0) : (acts.current.left ? g.dx : 0);
      setDir(d > 0 ? "right" : d < 0 ? "left" : null);
      x.setValue(Math.max(-160, Math.min(160, d)));
    },
    onPanResponderRelease: async (_, g) => {
      const act = g.dx > THRESHOLD ? acts.current.right : g.dx < -THRESHOLD ? acts.current.left : undefined;
      settle();
      if (act && !busy.current) { busy.current = true; tick(); try { await act.run(); } finally { busy.current = false; } }
    },
    onPanResponderTerminate: settle,
  })).current;
  const a = dir === "right" ? right : dir === "left" ? left : undefined;
  // With a mouse or trackpad: no dragging, just the actions as buttons (unless the row already has its own).
  if (pointer) {
    const acts = [right, left].filter((x, i, all): x is SwipeAction => !!x && all.findIndex((y) => y?.label === x.label) === i);
    return (
      <View testID={testID} style={{ borderRadius: radius, overflow: "hidden", backgroundColor: surface }}>
        {children}
        {buttons && acts.length ? (
          <View style={{ flexDirection: "row", gap: 16, justifyContent: "flex-end", paddingHorizontal: 14, paddingBottom: 8 }}>
            {acts.map((x) => <Pressable key={x.label} testID={`swipe-button-${x.label}`} accessibilityRole="button" onPress={() => void x.run()} style={{ minHeight: 36, justifyContent: "center" }}><T style={{ fontFamily: F.sans600, fontSize: 13.5, textDecorationLine: "underline" }}>{x.label}</T></Pressable>)}
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View testID={testID} style={{ borderRadius: radius, overflow: "hidden" }}>
      {a ? (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: a.bg, justifyContent: "center", alignItems: dir === "right" ? "flex-start" : "flex-end", paddingHorizontal: 18 }}>
          <T style={{ fontFamily: F.sans700, color: a.fg, fontSize: 14 }}>{a.label}</T>
        </View>
      ) : null}
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], backgroundColor: surface }}>{children}</Animated.View>
    </View>
  );
}


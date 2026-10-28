/**
 * Swipe a row to act on it: right for the main action (log a dose, mark read), left for the
 * second one (snooze). Every swipe has a button too, so nobody has to discover the gesture.
 * Vertical scrolling still wins unless the finger clearly moves sideways.
 */
import { useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Platform, View } from "react-native";
import * as Haptics from "expo-haptics";
import { F, T } from "./ui";

export type SwipeAction = { label: string; bg: string; fg: string; run: () => void | Promise<void> };
const THRESHOLD = 88;

export const tick = () => { if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };

export function SwipeRow({ children, right, left, testID, radius = 16, surface }: { children: ReactNode; right?: SwipeAction; left?: SwipeAction; testID?: string; radius?: number; surface: string }) {
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


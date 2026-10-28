/**
 * Small moments of motion, borrowed from thepumpkin.ai: brush strokes that draw themselves, a soft
 * rise for new things, one marigold pulse. Used sparingly, and never in hard moments: callers pass
 * `calm` on quiet or gentle days, during a pause, in the two-week wait and after a hard result, and
 * everything here stands still when the phone is set to reduce motion.
 *
 * Animations run on requestAnimationFrame and plain props, so they behave the same on iOS, Android
 * and the web build.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, View, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { C } from "./ui";

/** True when the phone asks for less motion. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** 0 → 1 over `ms` (after `delay`), eased. Jumps straight to 1 when `still`. Restarts when `key` changes. */
export function useProgress(ms: number, { delay = 0, still = false, loop = false, key }: { delay?: number; still?: boolean; loop?: boolean; key?: unknown } = {}): number {
  const [p, setP] = useState(still ? 1 : 0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (still) { setP(1); return; }
    setP(0);
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now + delay;
      const t = Math.max(0, now - start) / ms;
      if (loop) setP(t % 1);
      else setP(ease(Math.min(1, t)));
      if (loop || t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [ms, delay, still, loop, key]);
  return p;
}

// The brush pumpkin from thepumpkin.ai (BrushPumpkin.astro), stroke by stroke.
const PUMPKIN: { d: string; color: string; width: number; length: number }[] = [
  { d: "M250 150 C120 160 70 320 115 420 C150 500 230 515 258 505", color: "#F0A83A", width: 36, length: 520 },
  { d: "M270 150 C400 160 450 320 405 420 C370 500 290 515 262 505", color: "#F0A83A", width: 36, length: 520 },
  { d: "M256 152 C185 175 172 320 194 420 C210 475 244 500 258 498", color: "#F5BE66", width: 30, length: 400 },
  { d: "M264 152 C335 175 348 320 326 420 C310 475 276 500 262 498", color: "#F5BE66", width: 30, length: 400 },
  { d: "M260 148 C252 240 252 400 260 500", color: "#B9781C", width: 20, length: 360 },
  { d: "M260 148 C256 112 272 88 302 74", color: "#3E5A33", width: 16, length: 100 },
  { d: "M302 74 C330 62 350 76 340 96 C332 110 312 104 318 92", color: "#3E5A33", width: 7, length: 110 },
];

/** The brush pumpkin drawing itself, about 1.6 seconds, like the website's hero. */
export function DrawPumpkin({ size = 120, still = false }: { size?: number; still?: boolean }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(1600, { still });
  const n = PUMPKIN.length, span = 0.45; // each stroke takes 45% of the time, staggered
  return (
    <Svg width={size} height={size} viewBox="40 36 440 506" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {PUMPKIN.map((s, i) => {
        const startAt = (i / (n - 1)) * (1 - span);
        const local = Math.min(1, Math.max(0, (p - startAt) / span));
        return <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" fill="none"
          strokeDasharray={`${s.length} ${s.length}`} strokeDashoffset={s.length * (1 - local)} />;
      })}
    </Svg>
  );
}

/** A hand-drawn check that draws in once (half a second). */
export function DrawCheck({ size = 22, color = C.sageInk, still = false }: { size?: number; color?: string; still?: boolean }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(520, { still });
  const len = 26;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M4.5 12.8 C6.6 14.4 8.4 16.4 9.8 18.6 C12.6 12.6 15.8 8.6 19.8 5.2" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none"
        strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - p)} />
    </Svg>
  );
}

/** While Pumpkin reads something: three brush strokes sketching in, over and over. */
export function BrushSketch({ size = 28, color = C.lavInk, still = false }: { size?: number; color?: string; still?: boolean }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(1800, { still, loop: !still });
  const strokes = ["M5 18 C9 9 15 7 23 6", "M6 23 C11 16 17 14 24 14", "M8 27 C12 24 18 22 24 22"];
  return (
    <Svg width={size} height={size} viewBox="0 0 30 30" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {strokes.map((d, i) => {
        const local = still ? 1 : Math.min(1, Math.max(0, (p * 1.4 - i * 0.18) / 0.5));
        const fade = still ? 1 : p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1;
        return <Path key={i} d={d} stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={fade}
          strokeDasharray="22 22" strokeDashoffset={22 * (1 - local)} />;
      })}
    </Svg>
  );
}

/** Rises 8 points and fades in once, the same entrance the website uses for tabs. */
export function RiseIn({ children, still = false, delay = 0, style }: { children: ReactNode; still?: boolean; delay?: number; style?: ViewStyle }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(420, { still, delay });
  return <View style={[style, { opacity: p, transform: [{ translateY: 8 * (1 - p) }] }]}>{children}</View>;
}

/** One soft marigold ring that grows and fades behind its child, once. */
export function PulseOnce({ children, still = false, radius = 18 }: { children: ReactNode; still?: boolean; radius?: number }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(1100, { still, delay: 300 });
  const show = !still && p > 0 && p < 1;
  return (
    <View style={{ alignSelf: "flex-start" }}>
      {show ? (
        <View pointerEvents="none" style={{ position: "absolute", left: -radius, right: -radius, top: -radius, bottom: -radius, alignItems: "center", justifyContent: "center" }}>
          <View style={{ position: "absolute", left: radius - 6 * p, right: radius - 6 * p, top: radius - 6 * p, bottom: radius - 6 * p, borderRadius: 999, borderWidth: 2, borderColor: C.marigold, opacity: 0.55 * (1 - p) }} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** For SVG maps: the same pulse as a growing circle at (cx, cy). */
export function SvgPulse({ cx, cy, r = 7, still = false }: { cx: number; cy: number; r?: number; still?: boolean }) {
  const reduce = useReduceMotion(); still = still || reduce;
  const p = useProgress(1100, { still, delay: 300 });
  if (still || p <= 0 || p >= 1) return null;
  return <Circle cx={cx} cy={cy} r={r + 9 * p} fill="none" stroke={C.marigold} strokeWidth={2} opacity={0.6 * (1 - p)} />;
}

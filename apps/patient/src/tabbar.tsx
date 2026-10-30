/**
 * The tab bar on the web, shared by everyone's app: a rounded glass bar floating above the content,
 * a soft capsule behind the selected tab, labels kept, a red count where something's waiting, and her
 * initial for You. Turns solid when the device asks for less transparency. (iPhone and Android use the
 * system tab bar instead.)
 */
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, Icon, isDark } from "./ui";
import type { IconName } from "./icons";

export type TabSpec = { name: string; label: string; icon: IconName | "you"; testID: string; badge?: number };

function useSolidBar() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const mm = (globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void } }).matchMedia;
    const q = mm?.("(prefers-reduced-transparency: reduce)");
    if (!q) return;
    const on = () => setSolid(q.matches); on();
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return solid;
}

export function GlassTabBar({ tabs, current, go, initial }: { tabs: TabSpec[]; current: string; go: (name: string) => void; initial: string }) {
  const insets = useSafeAreaInsets();
  const solid = useSolidBar();
  const dark = isDark();
  const glass = solid ? { backgroundColor: C.paper } : {
    backgroundColor: dark ? "rgba(36,28,23,0.72)" : "rgba(255,252,246,0.72)",
    backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)",
  };
  return (
    // Floats over the content; screens leave room for it at the bottom.
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, 10) + 4, alignItems: "center", paddingHorizontal: 16 }}>
      <View testID="tab-bar" accessibilityRole="tablist"
        style={{ ...glass, flexDirection: "row", width: "100%", maxWidth: 440, borderRadius: 34, padding: 6, borderWidth: 1, borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(60,40,25,0.10)",
          boxShadow: dark ? "0 10px 30px rgba(0,0,0,0.45)" : "0 10px 30px rgba(60,40,25,0.16)" } as never}>
        {tabs.map((t) => {
          const on = current === t.name;
          const badge = t.badge ?? 0;
          const ink = on ? C.lavInk : C.espresso;
          return (
            <Pressable key={t.name} testID={t.testID} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={badge ? `${t.label}, ${badge} waiting` : t.label} onPress={() => go(t.name)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 54, borderRadius: 28, gap: 2, backgroundColor: on ? C.lav : "transparent" }}>
              <View>
                {t.icon === "you"
                  ? <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: on ? C.lavInk : C.espresso, alignItems: "center", justifyContent: "center" }}><Text style={{ color: on ? C.lav : C.oat, fontFamily: F.sans700, fontSize: 13 }}>{initial || "·"}</Text></View>
                  : <Icon name={t.icon} size={26} color={ink} />}
                {badge > 0 ? <View style={{ position: "absolute", top: -4, right: -11, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: C.onRed, fontFamily: F.sans700, fontSize: 11 }}>{badge}</Text></View> : null}
              </View>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: on ? F.sans700 : F.sans500, fontSize: 11.5, color: ink }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

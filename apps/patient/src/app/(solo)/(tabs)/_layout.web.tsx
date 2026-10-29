import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { TabTop, useSolo } from "../../../solo";
import { C, F, Icon, isDark } from "../../../ui";
import type { IconName } from "../../../icons";

const TABS: { name: string; label: string; icon: IconName | "you"; testID: string }[] = [
  { name: "today", label: "Today", icon: "calendar", testID: "solo-tab-today" },
  { name: "record", label: "Record", icon: "doc", testID: "solo-tab-record" },
  { name: "costs", label: "Costs", icon: "wallet", testID: "solo-tab-costs" },
  { name: "you", label: "You", icon: "you", testID: "solo-tab-more" },
];

/**
 * On the web, the iOS 26 tab bar: a rounded glass bar floating above the content, a soft capsule behind
 * the selected tab, labels kept, a red count on Today, and her initial for You. Turns solid when the
 * phone asks for less transparency.
 */
export default function TabsLayout() {
  const { today } = useSolo();
  const waiting = today?.toCheck ?? 0;
  const initial = (today?.about.displayName ?? today?.profile.firstName ?? "").trim().charAt(0).toUpperCase();
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><TabTop /></SafeAreaView>
      <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.oat } }}
        tabBar={({ state, navigateToTab }) => <Bar index={state.index} routes={state.routes.map((r) => r.name)} go={(name) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); }} waiting={waiting} initial={initial} />}>
        {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
      </Tabs>
    </View>
  );
}

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

function Bar({ index, routes, go, waiting, initial }: { index: number; routes: string[]; go: (name: string) => void; waiting: number; initial: string }) {
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
        {TABS.map((t) => {
          const on = routes[index] === t.name;
          const badge = t.name === "today" && waiting > 0;
          const ink = on ? C.lavInk : C.espresso;
          return (
            <Pressable key={t.name} testID={t.testID} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={badge ? `${t.label}, ${waiting} waiting` : t.label} onPress={() => go(t.name)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 54, borderRadius: 28, gap: 2, backgroundColor: on ? C.lav : "transparent" }}>
              <View>
                {t.icon === "you"
                  ? <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: on ? C.lavInk : C.espresso, alignItems: "center", justifyContent: "center" }}><Text style={{ color: on ? C.lav : C.oat, fontFamily: F.sans700, fontSize: 13 }}>{initial || "·"}</Text></View>
                  : <Icon name={t.icon} size={26} color={ink} />}
                {badge ? <View style={{ position: "absolute", top: -4, right: -11, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: C.onRed, fontFamily: F.sans700, fontSize: 11 }}>{waiting}</Text></View> : null}
              </View>
              <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: on ? F.sans700 : F.sans500, fontSize: 11.5, color: ink }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

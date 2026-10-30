import { View } from "react-native";
import { Tabs } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { TabTop, useSolo } from "../../../solo";
import { C, useTheme } from "../../../ui";
import { GlassTabBar, type TabSpec } from "../../../tabbar";

/** On the web: Pumpkin's floating glass tab bar (shared with the clinic app). */
export default function TabsLayout() {
  useTheme();
  const { today } = useSolo();
  const initial = (today?.about.displayName ?? today?.profile.firstName ?? "").trim().charAt(0).toUpperCase();
  const tabs: TabSpec[] = [
    { name: "today", label: "Today", icon: "calendar", testID: "solo-tab-today", badge: today?.toCheck ?? 0 },
    { name: "record", label: "Record", icon: "doc", testID: "solo-tab-record" },
    { name: "costs", label: "Costs", icon: "wallet", testID: "solo-tab-costs" },
    { name: "you", label: "You", icon: "you", testID: "solo-tab-more" },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><TabTop /></SafeAreaView>
      <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.oat } }}
        tabBar={({ state, navigateToTab }) => <GlassTabBar tabs={tabs} initial={initial} current={state.routes[state.index]!.name}
          go={(name) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); }} />}>
        {tabs.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
      </Tabs>
    </View>
  );
}

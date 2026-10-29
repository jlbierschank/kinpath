import { Pressable, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabTop, useSolo } from "../../../solo";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, F, Icon } from "../../../ui";
import type { IconName } from "../../../icons";

const TABS: { name: string; label: string; icon: IconName; testID: string }[] = [
  { name: "today", label: "Today", icon: "calendar", testID: "solo-tab-today" },
  { name: "record", label: "Record", icon: "doc", testID: "solo-tab-record" },
  { name: "costs", label: "Costs", icon: "wallet", testID: "solo-tab-costs" },
  { name: "you", label: "You", icon: "heart", testID: "solo-tab-more" },
];

/** On the web, a tab bar drawn to look and behave like the iPhone's: icons, labels, a red count. */
export default function TabsLayout() {
  const { today } = useSolo();
  const waiting = today?.toCheck ?? 0;
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
    <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><TabTop /></SafeAreaView>
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.oat } }} tabBar={({ state, navigateToTab }) => <Bar index={state.index} routes={state.routes.map((r) => r.name)} go={(name) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); }} waiting={waiting} />}>
      {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
    </Tabs>
    </View>
  );
}

function Bar({ index, routes, go, waiting }: { index: number; routes: string[]; go: (name: string) => void; waiting: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 6), paddingTop: 6 }}>
      <View style={{ flexDirection: "row", width: "100%", maxWidth: 520, alignSelf: "center", marginHorizontal: "auto" } as never}>
        {TABS.map((t) => {
          const on = routes[index] === t.name;
          const badge = t.name === "today" && waiting > 0;
          return (
            <Pressable key={t.name} testID={t.testID} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={badge ? `${t.label}, ${waiting} waiting` : t.label} onPress={() => go(t.name)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 50, gap: 2 }}>
              <View>
                <Icon name={t.icon} size={26} color={on ? C.espresso : C.stone} />
                {badge ? <View style={{ position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: C.onRed, fontFamily: F.sans700, fontSize: 11 }}>{waiting}</Text></View> : null}
              </View>
              <Text style={{ fontFamily: on ? F.sans700 : F.sans500, fontSize: 11, color: on ? C.espresso : C.stone }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

import { View } from "react-native";
import { Tabs } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SupportTabTop, useSupportTabs } from "../../../support";
import { C, useTheme } from "../../../ui";
import { GlassTabBar } from "../../../tabbar";

/** On the web: the same floating glass tab bar as on your own. */
export default function TabsLayout() {
  useTheme();
  const { tabs, initial } = useSupportTabs();
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><SupportTabTop /></SafeAreaView>
      <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.oat } }}
        tabBar={({ state, navigateToTab }) => <GlassTabBar tabs={tabs} initial={initial} current={state.routes[state.index]!.name}
          go={(name) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); }} />}>
        {tabs.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
      </Tabs>
    </View>
  );
}

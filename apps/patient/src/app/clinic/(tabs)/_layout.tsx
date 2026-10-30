import { View } from "react-native";
import { NativeTabs } from "expo-router/native-tabs";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClinicTabTop, useClinicTabs } from "../../../clinic";
import { C, useTheme } from "../../../ui";

const SF: Record<string, [string, string, string]> = {
  today: ["sun.max", "sun.max.fill", "today"],
  messages: ["bubble.left", "bubble.left.fill", "chat"],
  record: ["doc.text", "doc.text.fill", "description"],
  costs: ["creditcard", "creditcard.fill", "payments"],
  you: ["person.crop.circle", "person.crop.circle.fill", "person"],
};

/** The system tab bar on iPhone and Android, the same as on your own, with Messages for her care team. */
export default function TabsLayout() {
  useTheme();
  const { tabs } = useClinicTabs();
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><ClinicTabTop /></SafeAreaView>
      <NativeTabs>
        {tabs.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon sf={{ default: SF[t.name]![0], selected: SF[t.name]![1] } as never} md={SF[t.name]![2] as never} />
            <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
            {t.badge ? <NativeTabs.Trigger.Badge>{String(t.badge)}</NativeTabs.Trigger.Badge> : null}
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    </View>
  );
}

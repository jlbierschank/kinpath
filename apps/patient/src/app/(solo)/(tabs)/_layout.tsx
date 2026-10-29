import { NativeTabs } from "expo-router/native-tabs";
import { TabTop, useSolo } from "../../../solo";
import { SafeAreaView } from "react-native-safe-area-context";
import { View } from "react-native";
import { C } from "../../../ui";

/** The system tab bar on iPhone and Android: icons, labels, and a count of things waiting to check. */
export default function TabsLayout() {
  const { today } = useSolo();
  const waiting = today?.toCheck ?? 0;
  return (
    <View style={{ flex: 1, backgroundColor: C.oat }}>
    <SafeAreaView edges={["top"]} style={{ backgroundColor: C.oat }}><TabTop /></SafeAreaView>
    <NativeTabs>
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon sf={{ default: "sun.max", selected: "sun.max.fill" }} md="today" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        {waiting ? <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="record">
        <NativeTabs.Trigger.Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} md="description" />
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="costs">
        <NativeTabs.Trigger.Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} md="payments" />
        <NativeTabs.Trigger.Label>Costs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} md="person" />
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
    </View>
  );
}

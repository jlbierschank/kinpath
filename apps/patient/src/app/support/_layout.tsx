import { Platform } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useWho } from "../../../App";
import { SupportProvider } from "../../support";
import { C, useTheme } from "../../ui";

/** A support person: the same shell as everyone, with only what she shares. */
export default function SupportLayout() {
  useTheme();
  const { who, api, signOut } = useWho();
  if (!who || !api || !who.partner) return <Redirect href="/" />;
  return (
    <SupportProvider api={api} onSignOut={() => void signOut()} demo={who.demo}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.oat } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="screen" />
      </Stack>
    </SupportProvider>
  );
}

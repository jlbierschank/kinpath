import { Platform } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useWho } from "../../../App";
import { ClinicProvider } from "../../clinic";
import { C, useTheme } from "../../ui";

/** A clinic's patient: the same shell as Pumpkin on your own, with her clinic inside. */
export default function ClinicLayout() {
  useTheme();
  const { who, api, signOut } = useWho();
  if (!who || !api || who.partner || who.space === "personal") return <Redirect href="/" />;
  return (
    <ClinicProvider api={api} onSignOut={() => void signOut()} demo={who.demo}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.oat } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="screen" />
        <Stack.Screen name="urgent" options={{ presentation: Platform.OS === "web" ? "card" : "fullScreenModal", gestureEnabled: false }} />
      </Stack>
    </ClinicProvider>
  );
}

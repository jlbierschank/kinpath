import { Platform } from "react-native";
import { Redirect, Stack } from "expo-router";
import type { ComponentProps } from "react";
import { useWho } from "../../../App";
import { SoloProvider } from "../../solo";
import { C, useTheme } from "../../ui";

/** Adding things opens as a sheet: the system's on iPhone and Android, Pumpkin's own on the web. */
type Options = NonNullable<ComponentProps<typeof Stack.Screen>["options"]>;
const SHEET: Options = Platform.OS === "web"
  ? { presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }
  : { presentation: "formSheet", sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 22, contentStyle: { backgroundColor: C.oat } };

export default function SoloLayout() {
  useTheme();
  const { who, api, signOut } = useWho();
  if (!who || !api || who.partner || who.space !== "personal") return <Redirect href="/" />;
  return (
    <SoloProvider api={api} onSignOut={() => void signOut()}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.oat } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={SHEET} />
        <Stack.Screen name="say" options={SHEET} />
        <Stack.Screen name="type" options={SHEET} />
        <Stack.Screen name="by-hand/[kind]" options={SHEET} />
        <Stack.Screen name="urgent" options={{ presentation: Platform.OS === "web" ? "card" : "fullScreenModal", gestureEnabled: false }} />
      </Stack>
    </SoloProvider>
  );
}

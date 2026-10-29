import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import { C, ThemeProvider, useTheme } from "../ui";
import { WhoProvider, useWho } from "../../App";
import { PrivacyGuard } from "../privacy";

export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><WhoProvider><Root /></WhoProvider></ThemeProvider></SafeAreaProvider>;
}

function Root() {
  useTheme(); // re-render when light or dark changes
  const [fonts] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold });
  const { booting } = useWho();
  if (!fonts || booting) return <View style={{ flex: 1, backgroundColor: C.oat, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={C.espresso} /></View>;
  return (
    <PrivacyGuard>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.oat } }} />
    </PrivacyGuard>
  );
}

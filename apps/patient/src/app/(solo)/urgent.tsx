import { useLocalSearchParams } from "expo-router";
import { SoloScreen } from "../../solo";

export default function Route() {
  const { crisis } = useLocalSearchParams<{ crisis?: string }>();
  return <SoloScreen screen={{ name: "urgent", crisis: crisis === "1" }} />;
}

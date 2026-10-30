import { useLocalSearchParams } from "expo-router";
import { ClinicScreen } from "../../clinic";

export default function Route() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return <ClinicScreen screen={{ name: "urgent", kind: kind === "crisis" ? "crisis" : "urgent_symptom" }} />;
}

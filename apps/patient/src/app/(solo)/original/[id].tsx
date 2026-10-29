import { useLocalSearchParams } from "expo-router";
import { SoloScreen } from "../../../solo";

export default function Route() {
  const { id, text } = useLocalSearchParams<{ id: string; text?: string }>();
  return <SoloScreen screen={{ name: "original", captureId: id, text }} />;
}

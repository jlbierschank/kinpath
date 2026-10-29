import { useLocalSearchParams } from "expo-router";
import { SoloScreen } from "../../../solo";
import type { ItemKind } from "../../../api";

const KINDS: ItemKind[] = ["medication", "result", "appointment", "cost", "question"];
export default function Route() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  return <SoloScreen screen={{ name: "by-hand", kind: KINDS.includes(kind as ItemKind) ? (kind as ItemKind) : "appointment" }} />;
}

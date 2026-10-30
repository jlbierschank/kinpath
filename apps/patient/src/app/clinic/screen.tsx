import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { ClinicScreen, pushedScreen } from "../../clinic";

/** A screen pushed on top of the tabs (a walkthrough, a receipt, settings pages). */
export default function Route() {
  const { k } = useLocalSearchParams<{ k?: string }>();
  const s = pushedScreen(k);
  // Reloaded in a browser: the screen's details are gone, so start from Today.
  if (!s) return <Redirect href={"/clinic/today" as Href} />;
  return <ClinicScreen screen={s} />;
}

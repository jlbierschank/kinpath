import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { SupportScreen, pushedSupportScreen } from "../../support";

/** A screen pushed on top of the tabs (a walkthrough, a receipt, settings pages). */
export default function Route() {
  const { k } = useLocalSearchParams<{ k?: string }>();
  const s = pushedSupportScreen(k);
  // Reloaded in a browser: the screen's details are gone, so start from Today.
  if (!s) return <Redirect href={"/support/today" as Href} />;
  return <SupportScreen screen={s} />;
}

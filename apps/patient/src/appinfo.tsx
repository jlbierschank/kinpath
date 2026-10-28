/**
 * What kind of build the server is: the beta test build (made-up information only), a demo, or real.
 * Read once at start-up from /api/app-info. Until it answers, nothing test-only shows.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { API_URL } from "./api";
import { C, F, T } from "./ui";

export interface AppInfo { testMode: boolean; demo: boolean; openSignup: boolean }
let cached: AppInfo | null = null;
let pending: Promise<AppInfo> | null = null;
export function loadAppInfo(): Promise<AppInfo> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetch(`${API_URL}/api/app-info`).then((r) => r.json() as Promise<AppInfo>)
    .then((x) => (cached = { testMode: !!x.testMode, demo: !!x.demo, openSignup: !!x.openSignup }))
    .catch(() => ({ testMode: false, demo: false, openSignup: false }));
  return pending;
}
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(cached);
  useEffect(() => { if (!info) void loadAppInfo().then(setInfo); }, [info]);
  return info;
}
export const APP_VERSION = "beta-2026.11";

/** Shown at the top of every screen in the test build. */
export function TestBanner() {
  const info = useAppInfo();
  if (!info?.testMode) return null;
  return (
    <View testID="test-banner" accessibilityRole="alert" style={{ backgroundColor: C.lav, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12, marginTop: 6 }}>
      <T style={{ fontFamily: F.sans600, fontSize: 13.5, color: C.lavInk }}>Test version. Please use made-up information only, not your real health details.</T>
    </View>
  );
}

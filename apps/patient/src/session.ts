/**
 * Keeps the sign-in token on this phone (iOS Keychain / Android Keystore via expo-secure-store).
 * In the web preview, falls back to the browser's storage.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface Stored { token: string; userId: string; name: string; role: "patient" | "partner" }
const KEY = "kinpath.session";

export async function loadSession(): Promise<Stored | null> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch { return null; }
}
export async function saveSession(s: Stored) {
  const raw = JSON.stringify(s);
  try { if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, raw); else await SecureStore.setItemAsync(KEY, raw); } catch { /* still signed in for this session */ }
}
export async function clearSession() {
  try { if (Platform.OS === "web") globalThis.localStorage?.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY); } catch { /* nothing stored */ }
}
export const deviceName = () => (Platform.OS === "ios" ? "iPhone app" : Platform.OS === "android" ? "Android app" : "Web preview");

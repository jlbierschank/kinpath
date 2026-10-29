/**
 * Privacy on the phone itself:
 * - When Pumpkin goes to the background, a plain cover hides the screen, so the app switcher shows nothing private.
 * - If she turns on "Lock with Face ID", Pumpkin asks for Face ID (or her passcode) on opening and after 1 minute away.
 * Neither applies on the web, where the browser controls this.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { loadPref, savePref } from "./session";
import { Button, C, Logo, Muted, T } from "./ui";

const KEY = "kinpath.lock";
const AWAY_MS = 60_000;
const native = Platform.OS !== "web";

interface LockState { available: boolean; kind: string; on: boolean; setOn: (v: boolean) => Promise<boolean> }
const LockCtx = createContext<LockState>({ available: false, kind: "Face ID", on: false, setOn: async () => false });
export const useAppLock = () => useContext(LockCtx);

export function PrivacyGuard({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [kind, setKind] = useState("Face ID");
  const [on, setOnState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    if (!native) return;
    void (async () => {
      const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
      const enrolled = await LocalAuthentication.isEnrolledAsync().catch(() => false);
      const types: LocalAuthentication.AuthenticationType[] = await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => []);
      setAvailable(has && enrolled);
      setKind(types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? "Face ID" : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? "Touch ID" : "your passcode");
      const pref = (await loadPref<boolean>(KEY)) === true;
      setOnState(pref); if (pref) setLocked(true);
    })();
  }, []);

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Pumpkin", cancelLabel: "Cancel" }).catch(() => ({ success: false }));
    if (r.success) setLocked(false);
  }, []);
  useEffect(() => { if (locked) void unlock(); }, [locked, unlock]);

  useEffect(() => {
    if (!native) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        setCovered(false);
        if (on && leftAt.current && Date.now() - leftAt.current > AWAY_MS) setLocked(true);
        leftAt.current = null;
      } else {
        setCovered(true);
        if (leftAt.current === null) leftAt.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [on]);

  const setOn = useCallback(async (v: boolean) => {
    if (v) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: `Turn on ${kind} for Pumpkin` }).catch(() => ({ success: false }));
      if (!r.success) return false;
    }
    setOnState(v); await savePref(KEY, v); return true;
  }, [kind]);

  return (
    <LockCtx.Provider value={{ available, kind, on, setOn }}>
      <View style={{ flex: 1 }}>
        {children}
        {locked ? (
          <View testID="app-locked" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.oat, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
            <Logo width={150} />
            <T style={{ fontSize: 17, textAlign: "center" }}>Pumpkin is locked.</T>
            <Button kind="esp" label={`Unlock with ${kind}`} onPress={() => void unlock()} />
          </View>
        ) : covered ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.oat, alignItems: "center", justifyContent: "center" }}><Logo width={150} /></View>
        ) : null}
      </View>
    </LockCtx.Provider>
  );
}

/** The setting in You. Shown only where the phone supports it. */
export function AppLockSetting() {
  const { available, kind, on, setOn } = useAppLock();
  const [msg, setMsg] = useState<string | null>(null);
  if (!available) return null;
  return (
    <View style={{ gap: 4 }}>
      <Button testID="app-lock" kind="line" label={on ? `Turn off ${kind} lock` : `Lock Pumpkin with ${kind}`} onPress={async () => { const ok = await setOn(!on); setMsg(ok ? (on ? "Lock is off." : `Pumpkin will ask for ${kind} when you open it.`) : null); }} />
      {msg ? <Muted style={{ fontSize: 13 }}>{msg}</Muted> : null}
    </View>
  );
}

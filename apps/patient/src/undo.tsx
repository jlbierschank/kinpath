/**
 * Remove with Undo: the item disappears right away, a bar offers Undo for 6 seconds, and only then is
 * it deleted. Leaving the screen deletes it straight away (she already saw the bar).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { C, F, T } from "./ui";

type Pending = { id: string; label: string; commit: () => Promise<unknown> };
export function useUndo(after?: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Pending | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    const p = current.current; current.current = null; setPending(null);
    if (p) { await p.commit().catch(() => null); after?.(); }
  }, [after]);
  const remove = useCallback(async (p: Pending) => {
    if (current.current) await flush();
    current.current = p; setPending(p);
    timer.current = setTimeout(() => void flush(), 6000);
  }, [flush]);
  const undo = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; current.current = null; setPending(null); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); const p = current.current; if (p) void p.commit().catch(() => null); }, []);
  const bar = pending ? (
    <View testID="undo-bar" accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.fill, borderRadius: 16, paddingLeft: 16, paddingRight: 6, minHeight: 52 }}>
      <T style={{ flex: 1, color: C.onFill, fontSize: 15 }}>{`Removed ${pending.label}.`}</T>
      <Pressable testID="undo" accessibilityRole="button" onPress={undo} style={{ minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}>
        <T style={{ color: C.marigoldOnFill, fontFamily: F.sans700, fontSize: 15 }}>Undo</T>
      </Pressable>
    </View>
  ) : null;
  return { remove, hidden: (id: string) => pending?.id === id, bar };
}

/** A small action under an item (Remove, Stop): a full 44-point target, quiet until needed. */
export function ItemAction({ label, onPress, testID, danger }: { label: string; onPress: () => void; testID?: string; danger?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
      <T style={{ fontSize: 14, fontFamily: F.sans600, color: danger ? C.red : C.stone }}>{label}</T>
    </Pressable>
  );
}

/**
 * The medication name field, with suggestions as she types: common fertility meds by brand or generic
 * name, forgiving of spelling ("folistim" finds Follistim AQ). Names only. She can type anything.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { suggestMeds } from "@kinpath/core";
import { Field } from "./field";
import { C, F, Muted, T } from "./ui";

export function MedNameField({ label, value, onChange, check, testID }: { label: string; value: string; onChange: (v: string) => void; check?: boolean; testID?: string }) {
  const [typing, setTyping] = useState(false);
  const list = typing ? suggestMeds(value) : [];
  return (
    <View style={{ gap: 4 }}>
      <Field testID={testID} label={label} value={value} onChange={(v) => { setTyping(true); onChange(v); }} check={check} placeholder="Start typing, like Menopur" />
      {list.length ? (
        <View testID="med-suggestions" accessibilityRole="list" style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.paper, overflow: "hidden" }}>
          {list.map((m, i) => (
            <Pressable key={m.name} testID={`med-suggest-${i}`} accessibilityRole="button" accessibilityLabel={`Use ${m.name}`} onPress={() => { onChange(m.name); setTyping(false); }}
              style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 14, justifyContent: "center", borderTopWidth: i ? 1 : 0, borderTopColor: C.lineSoft, backgroundColor: pressed ? C.softLav : "transparent" })}>
              <T style={{ fontSize: 15.5, fontFamily: F.sans600 }}>{m.name}{m.also ? <T style={{ fontSize: 14, color: C.stone }}>{`  ${m.also}`}</T> : null}</T>
            </Pressable>
          ))}
        </View>
      ) : null}
      {list.length ? <Muted style={{ fontSize: 12.5 }}>Check the name against your pharmacy label.</Muted> : null}
    </View>
  );
}

import { TextInput, View } from "react-native";
import { C, Muted, Pill, st, T, F } from "./ui";

/** A labeled input (label always visible), with an optional "Check this" flag and hint. */
export function Field({ label, value, onChange, check, placeholder, keyboard, testID, multiline, hint }: { label: string; value: string; onChange: (v: string) => void; check?: boolean; placeholder?: string; keyboard?: "default" | "numeric" | "decimal-pad" | "email-address" | "phone-pad"; testID?: string; multiline?: boolean; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontFamily: F.sans600, fontSize: 14 }}>{label}</T>
        {check ? <Pill tone="clay" label="Check this" /> : null}
      </View>
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.stone} keyboardType={keyboard ?? "default"} multiline={multiline} autoCapitalize={keyboard === "email-address" ? "none" : "sentences"}
        style={[st.input, { minHeight: multiline ? 80 : 48, fontSize: 16, borderColor: check ? C.clayInk : C.espresso }]} />
      {hint ? <Muted style={{ fontSize: 13 }}>{hint}</Muted> : null}
    </View>
  );
}

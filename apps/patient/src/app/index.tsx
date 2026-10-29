import { Redirect } from "expo-router";
import { Gate, useWho } from "../../App";

/** Signed out, a clinic patient, or a support person: the gate. On your own: Today. */
export default function Index() {
  const { who } = useWho();
  if (who?.space === "personal" && !who.partner) return <Redirect href="/today" />;
  return <Gate />;
}

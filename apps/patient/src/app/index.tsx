import { Redirect } from "expo-router";
import { Gate, useWho } from "../../App";

/** Signed out or a support person: the gate. On your own: Today. A clinic's patient: her clinic's Today. */
export default function Index() {
  const { who } = useWho();
  if (who?.space === "personal" && !who.partner) return <Redirect href="/today" />;
  if (who && !who.partner) return <Redirect href="/clinic/today" />;
  return <Gate />;
}

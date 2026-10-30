import { Redirect } from "expo-router";
import { Gate, useWho } from "../../App";

/** Signed out: the gate. Everyone else goes to their Today: on your own, a clinic's patient, or a support person. */
export default function Index() {
  const { who } = useWho();
  if (who?.space === "personal" && !who.partner) return <Redirect href="/today" />;
  if (who && !who.partner) return <Redirect href="/clinic/today" />;
  if (who?.partner) return <Redirect href="/support/today" />;
  return <Gate />;
}

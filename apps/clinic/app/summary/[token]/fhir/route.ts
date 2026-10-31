import { openPersonalLink } from "@kinpath/db";
import { recordToFhirBundle } from "@kinpath/core";
import { getDb } from "@/lib/db";

/** The data file of a record she shared: FHIR R4, for systems that can take it in. Each download is recorded. */
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await openPersonalLink(await getDb(), token, "fhir");
  if (!s) return new Response("This link isn't available. It may have expired, or the patient stopped sharing it.", { status: 404 });
  const bundle = recordToFhirBundle({ ...s, patient: { name: s.patient }, pregnancy: s.sections.includes("pregnancy") ? s.pregnancy : undefined });
  const name = s.patient.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patient";
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/fhir+json", "content-disposition": `attachment; filename="${name}-record.fhir.json"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

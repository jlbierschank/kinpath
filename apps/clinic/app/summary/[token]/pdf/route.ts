import { openPersonalLink } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { recordPdf } from "@/lib/record-pdf";

/** The PDF of a record she shared. Same key as the page: the link. Each download is recorded. */
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await openPersonalLink(await getDb(), token, "pdf");
  if (!s) return new Response("This link isn't available. It may have expired, or the patient stopped sharing it.", { status: 404 });
  const name = s.patient.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patient";
  return new Response(Buffer.from(await recordPdf(s)), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}-record-summary.pdf"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

import { tick } from "@/lib/core/routines";

/**
 * The scheduler's heartbeat. Vercel calls this on the schedule in vercel.json, sending the
 * project's CRON_SECRET as a bearer token. It hands every routine that has come due to its agent.
 * Calling it more often than needed does nothing, and a missed call is made up by the next one
 * (the app also looks for due routines whenever it is in use; see tickSoon).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Without a secret set, production refuses every caller; a development server answers anyone on the machine.
  if (secret ? req.headers.get("authorization") !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  return Response.json(await tick());
}

import { connect, constants } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { q } from "../db";
import { ApiError } from "./util";

/**
 * Push notifications to the owner's iPhone and iPad through Apple's push service (APNs), sent
 * straight from the server whenever a rail module appears or changes. The app registers each
 * device it runs on (`POST /api/v1/devices`).
 *
 * Needs four settings, from an APNs key made at developer.apple.com (Keys, "Apple Push
 * Notifications service"): APNS_KEY (the .p8 file's contents), APNS_KEY_ID, APNS_TEAM_ID, and
 * optionally APNS_TOPIC (the app's bundle id). Without them nothing is sent and nothing fails.
 */

const ENVS = ["sandbox", "production"] as const;
type PushEnv = (typeof ENVS)[number];
const HOST: Record<PushEnv, string> = { sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" };

export function pushConfigured() {
  return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

export async function registerDevice(token: unknown, env: unknown) {
  if (typeof token !== "string" || !/^[0-9a-f]{32,200}$/i.test(token)) throw new ApiError(400, "token is the device token from Apple, in hex.");
  const e = (env ?? "production") as PushEnv;
  if (!ENVS.includes(e)) throw new ApiError(400, 'env must be "sandbox" or "production".');
  await q(
    `INSERT INTO push_devices (token, env) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET env = EXCLUDED.env, last_seen = now()`,
    [token.toLowerCase(), e],
  );
  return { ok: true, configured: pushConfigured() };
}

export async function removeDevice(token: string) {
  await q("DELETE FROM push_devices WHERE token = $1", [token.toLowerCase()]);
  return { ok: true };
}

// Apple accepts a token for up to an hour and refuses one renewed more often than every 20 minutes.
let jwt: { value: string; at: number } | null = null;
async function bearer() {
  if (jwt && Date.now() - jwt.at < 40 * 60_000) return jwt.value;
  // A key pasted into one line keeps its line breaks as "\n".
  const pem = process.env.APNS_KEY!.replace(/\\n/g, "\n").trim();
  const key = await importPKCS8(pem, "ES256");
  const value = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: process.env.APNS_KEY_ID! }).setIssuer(process.env.APNS_TEAM_ID!).setIssuedAt().sign(key);
  jwt = { value, at: Date.now() };
  return value;
}

type Alert = { id: string; title: string; subtitle?: string | null; label?: string | null; badge: number };

/** One notification per registered device. Devices Apple says are gone are forgotten. */
async function send(a: Alert) {
  if (!pushConfigured()) return;
  const devices = await q<{ token: string; env: PushEnv }>("SELECT token, env FROM push_devices");
  if (!devices.length) return;
  const auth = await bearer();
  const topic = process.env.APNS_TOPIC || "com.robotchipmunk.subspace";
  const payload = JSON.stringify({
    aps: {
      alert: { title: a.title, ...(a.label ? { subtitle: a.label } : {}), ...(a.subtitle ? { body: a.subtitle } : {}) },
      sound: "default",
      badge: a.badge,
      "thread-id": "rail",
    },
    rail: a.id,
  });
  for (const env of ENVS) {
    const mine = devices.filter((d) => d.env === env);
    if (!mine.length) continue;
    const session = connect(HOST[env]);
    session.on("error", (e) => console.error("push: connection failed", e.message));
    try {
      await Promise.all(
        mine.map(
          (d) =>
            new Promise<void>((resolve) => {
              const req = session.request({
                ":method": "POST",
                ":path": `/3/device/${d.token}`,
                authorization: `bearer ${auth}`,
                "apns-topic": topic,
                "apns-push-type": "alert",
                "apns-priority": "10",
                // A module that changes replaces its earlier notification instead of adding another.
                "apns-collapse-id": `rail-${a.id}`.slice(0, 64),
              });
              let status = 0;
              let body = "";
              req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
              req.on("response", (h) => (status = Number(h[":status"])));
              req.on("data", (c) => (body += c));
              req.on("close", async () => {
                if (status !== 200) {
                  let reason = "no answer";
                  try {
                    reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
                  } catch {}
                  console.error(`push: ${env} device …${d.token.slice(-6)} refused (${status} ${reason})`);
                  if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") await removeDevice(d.token).catch(() => {});
                }
                resolve();
              });
              req.on("error", () => resolve());
              req.end(payload);
            }),
        ),
      );
    } finally {
      session.close();
    }
  }
}

/** Sends after the response has gone when inside a request; otherwise straight away, detached. */
export function pushRail(a: Alert) {
  if (!pushConfigured()) return;
  const run = () => send(a).catch((e) => console.error("push: failed", (e as Error).message));
  import("next/server").then(({ after }) => after(run)).catch(run);
}

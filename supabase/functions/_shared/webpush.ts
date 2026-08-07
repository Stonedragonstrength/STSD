/**
 * Sending a web-push notification, and clearing up after one.
 *
 * Extracted from send-push when the coach gained a device of their own: two
 * functions now push to two different kinds of recipient, and the part that is
 * genuinely shared is small and easy to get subtly wrong — particularly the
 * pruning rule, where treating the wrong status code as "gone" silently
 * unsubscribes somebody who was only briefly unreachable.
 *
 * What is NOT here, deliberately: who may be sent to. send-push filters by the
 * athlete's notification preferences and quiet hours; notify-coach sends to the
 * one coach the caller belongs to. Those are the interesting decisions and they
 * stay in the functions that own them.
 */
import webpush from "npm:web-push@3.6.7";

export type PushSub = { id: string; subscription: unknown };

/** Minimal shape of the service-role client, so this file needs no generics. */
type Db = {
  from: (t: string) => {
    delete: () => { in: (col: string, vals: string[]) => Promise<unknown> };
  };
};

/** VAPID keys from function secrets, or null when the project has none set. */
export function vapidDetails() {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return null;
  return {
    pub,
    priv,
    subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@stonedragonstrengthtraining.com",
  };
}

/** The payload sw.js expects. Bounded, because a push service will reject an
 *  oversized body outright and the whole notification is then lost. */
export function pushPayload(title: unknown, body: unknown, url: unknown) {
  return JSON.stringify({
    title: String(title).slice(0, 120),
    body: String(body ?? "").slice(0, 400),
    url: typeof url === "string" ? url : "./",
  });
}

/**
 * Push to every subscription, then delete the ones the push service says no
 * longer exist.
 *
 * 404/410 means the endpoint is retired — the browser was uninstalled, or the
 * subscription rotated — and the row is dead weight that would be retried
 * forever. Every OTHER failure is logged and the row is LEFT ALONE: a timeout
 * or a 5xx from the push service is transient, and pruning on it would quietly
 * unsubscribe people whose only mistake was being offline.
 */
export async function sendToSubscriptions(sb: Db, subs: PushSub[], payload: string) {
  const v = vapidDetails();
  if (!v || !subs.length) return { sent: 0, pruned: 0 };
  webpush.setVapidDetails(v.subject, v.pub, v.priv);

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription as never, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
      else console.error("[webpush] send failed:", code, e);
    }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);
  return { sent, pruned: dead.length };
}

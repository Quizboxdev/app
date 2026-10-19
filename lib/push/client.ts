import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Browser side of web push: ask permission, subscribe this device with the server's public key, and tell the database. Every step can fail on some phones, so each returns a plain result.
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!VAPID_PUBLIC_KEY;
}
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const raw = atob(padded), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushStatus = { allowed: boolean; devices: number };
export async function getPushStatus(): Promise<PushStatus> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_push_status");
  if (error) return { allowed: false, devices: 0 };
  return data as PushStatus;
}
export async function thisDeviceSubscribed(): Promise<boolean> {
  try { const reg = await navigator.serviceWorker.getRegistration("/"); return !!(await reg?.pushManager.getSubscription()); } catch { return false; }
}

export type EnableResult = "ok" | "denied" | "unsupported" | "error";
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";
    const { error } = await getSupabaseBrowserClient().rpc("qb_push_subscribe", { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: navigator.userAgent.slice(0, 300) });
    return error ? "error" : "ok";
  } catch { return "error"; }
}
export async function disablePush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/"), sub = await reg?.pushManager.getSubscription();
    if (sub) { await getSupabaseBrowserClient().rpc("qb_push_unsubscribe", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
    return true;
  } catch { return false; }
}

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Social channels (migration 20261076100000). The database checks every link and decides who may change the list; this file only asks and shows.
export type SocialKind = "tiktok" | "instagram" | "facebook" | "youtube" | "linkedin" | "snapchat" | "whatsapp" | "whatsapp_channel" | "telegram" | "x" | "email" | "website";
export type PublicChannel = { id: string; kind: SocialKind; label: string; handle: string | null; url: string };
export type AdminChannel = PublicChannel & { target: string; active: boolean; sort_order: number; updated_at: string };
export type ChannelInput = { id?: string; kind: SocialKind; label: string; handle: string; target: string; active: boolean };

// What staff pick from, with the wording that helps them fill it in.
export const SOCIAL_KINDS: { kind: SocialKind; name: string; targetLabel: string; placeholder: string; verb: string }[] = [
  { kind: "whatsapp", name: "WhatsApp number", targetLabel: "WhatsApp number with country code", placeholder: "+233 24 123 4567", verb: "Message" },
  { kind: "whatsapp_channel", name: "WhatsApp channel or group", targetLabel: "Channel or invite link", placeholder: "https://whatsapp.com/channel/…", verb: "Join" },
  { kind: "telegram", name: "Telegram", targetLabel: "Telegram link", placeholder: "https://t.me/yourchannel", verb: "Join" },
  { kind: "tiktok", name: "TikTok", targetLabel: "Profile link", placeholder: "https://www.tiktok.com/@yourname", verb: "Follow" },
  { kind: "instagram", name: "Instagram", targetLabel: "Profile link", placeholder: "https://www.instagram.com/yourname/", verb: "Follow" },
  { kind: "facebook", name: "Facebook", targetLabel: "Page link", placeholder: "https://www.facebook.com/yourpage/", verb: "Like" },
  { kind: "youtube", name: "YouTube", targetLabel: "Channel link", placeholder: "https://www.youtube.com/@yourchannel", verb: "Subscribe" },
  { kind: "linkedin", name: "LinkedIn", targetLabel: "Company link", placeholder: "https://www.linkedin.com/company/…", verb: "Follow" },
  { kind: "snapchat", name: "Snapchat", targetLabel: "Add-friend link", placeholder: "https://www.snapchat.com/add/yourname", verb: "Add" },
  { kind: "x", name: "X (Twitter)", targetLabel: "Profile link", placeholder: "https://x.com/yourname", verb: "Follow" },
  { kind: "email", name: "Email", targetLabel: "Email address", placeholder: "hello@quizbox.io", verb: "Email" },
  { kind: "website", name: "Website", targetLabel: "Web address (https)", placeholder: "https://example.org", verb: "Visit" },
];
export const kindInfo = (kind: string) => SOCIAL_KINDS.find((k) => k.kind === kind);

const MESSAGES: Record<string, string> = {
  SUPER_ADMIN_REQUIRED: "Only a super administrator can change the channels.",
  QB_SOCIAL_INVALID: "Check the details. A WhatsApp number needs 8 to 15 digits, a link must start with https://, and names cannot contain < or >.",
  QB_SOCIAL_WRONG_SITE: "That link is not on this platform's own website. Check the address.",
  QB_SOCIAL_TOO_MANY: "You can keep up to 30 channels. Delete one first.",
  QB_NOT_FOUND: "We could not find that channel. Refresh the page.",
  QB_FORBIDDEN: "You do not have permission to do that.",
};
const message = (e: { message?: string }) => MESSAGES[/(QB_[A-Z_]+|SUPER_ADMIN_REQUIRED)/.exec(e.message ?? "")?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(message(error)); return data as T; });

// Public: the channels to show, loaded once per visit. An empty answer (flag off, no connection) means "use the built-in list".
let cached: Promise<PublicChannel[]> | null = null;
export const loadSocialChannels = (): Promise<PublicChannel[]> => (cached ??= rpc<PublicChannel[]>("qb_social_channels").then((r) => (Array.isArray(r) ? r : [])).catch(() => { cached = null; return []; }));

// Staff
export const adminListChannels = () => rpc<{ flag: boolean; rows: AdminChannel[] }>("qb_social_admin_list");
export const adminSaveChannel = (c: ChannelInput) => rpc<{ id: string }>("qb_social_admin_save", { p: { id: c.id ?? null, kind: c.kind, label: c.label, handle: c.handle, target: c.target, active: c.active } });
export const adminDeleteChannel = (id: string) => rpc("qb_social_admin_delete", { p_id: id });
export const adminReorderChannels = (ids: string[]) => rpc("qb_social_admin_reorder", { p_ids: ids });
export const adminSetChannelsFlag = (on: boolean) => rpc("qb_setting_set", { p_key: "flags.social_channels", p_value: on });

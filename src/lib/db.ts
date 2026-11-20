import { supabase } from "@/integrations/supabase/client";
// Loosely typed handle for the many tables used across the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;
export { supabase };

export type Profile = {
  id: string; username: string; display_name: string; avatar_url: string | null;
  banner_url: string | null; bio: string | null; status: string | null; banned: boolean;
  special_link: string | null; created_at: string; last_seen?: string | null;
};
export type Conversation = {
  id: string; name: string | null; is_group: boolean; is_private: boolean;
  avatar_url: string | null; created_by: string; created_at: string; last_message_at: string;
};
export type Message = {
  id: string; conversation_id: string; sender_id: string; kind: string; content: string | null;
  attachment_url: string | null; attachment_name: string | null; poll_options: string[] | null;
  edited_at: string | null; created_at: string;
};

export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@jhp-users.app`;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const urlCache = new Map<string, { url: string; exp: number }>();
export async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const c = urlCache.get(path);
  if (c && c.exp > Date.now()) return c.url;
  const { data } = await supabase.storage.from("media").createSignedUrl(path, 60 * 60 * 24);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 1000 * 60 * 60 * 23 });
  return data.signedUrl;
}

export async function uploadFile(userId: string, file: Blob, name: string): Promise<string> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: (file as File).type || undefined,
  });
  if (error) throw error;
  return path;
}

export function kindForFile(f: File): string {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  return "file";
}

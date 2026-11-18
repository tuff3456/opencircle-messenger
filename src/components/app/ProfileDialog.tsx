import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar, useSigned } from "./Media";
import { useApp } from "./AppContext";

type Review = { id: string; author_id: string; rating: number; content: string; created_at: string; author?: Profile };

export function ProfileDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { user, isAdmin } = useAuth();
  const app = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [friend, setFriend] = useState<{ id: string; status: string; requester_id: string } | null>(null);
  const banner = useSigned(p?.banner_url);

  const load = useCallback(async () => {
    if (!userId || !user) return;
    const [{ data: prof }, { data: revs }, { data: fr }] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("reviews").select("*").eq("target_id", userId).order("created_at", { ascending: false }),
      db.from("friendships").select("*").or(`and(requester_id.eq.${user.id},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.id})`),
    ]);
    setP(prof);
    const ids = [...new Set((revs ?? []).map((r: Review) => r.author_id))];
    const { data: authors } = ids.length ? await db.from("profiles").select("*").in("id", ids) : { data: [] };
    setReviews((revs ?? []).map((r: Review) => ({ ...r, author: authors?.find((a: Profile) => a.id === r.author_id) })));
    setFriend(fr?.[0] ?? null);
  }, [userId, user]);
  useEffect(() => { load(); }, [load]);

  if (!userId) return null;
  const isMe = userId === user?.id;

  async function addReview() {
    if (!text.trim()) return;
    const { error } = await db.from("reviews").insert({ target_id: userId, author_id: user!.id, rating, content: text.trim() });
    if (error) return toast.error(error.message);
    setText(""); load();
  }
  async function requestDelete(r: Review) {
    const reason = prompt("Why should this review be deleted?") ?? "";
    const { error } = await db.from("review_delete_requests").insert({ review_id: r.id, requester_id: user!.id, reason });
    if (error) toast.error(error.message); else toast.success("Delete request sent to admins.");
  }
  async function friendAction() {
    if (!friend) {
      await db.from("friendships").insert({ requester_id: user!.id, addressee_id: userId });
    } else if (friend.status === "pending" && friend.requester_id !== user!.id) {
      await db.from("friendships").update({ status: "accepted" }).eq("id", friend.id);
    } else {
      await db.from("friendships").delete().eq("id", friend.id);
    }
    load();
  }
  const friendLabel = !friend ? "Add friend" : friend.status === "accepted" ? "Remove friend"
    : friend.requester_id === user?.id ? "Cancel request" : "Accept request";
  const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-0 overflow-hidden max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Profile</DialogTitle>
        <div className="h-32 bg-hero bg-cover bg-center" style={banner ? { backgroundImage: `url(${banner})` } : undefined} />
        {p && (
          <div className="px-6 pb-6 -mt-12">
            <Avatar path={p.avatar_url} name={p.display_name} className="size-24 text-3xl ring-4 ring-card" />
            <div className="mt-3">
              <h2 className="text-2xl font-bold">{p.display_name}</h2>
              <p className="text-muted-foreground">@{p.username}{p.banned && <span className="ml-2 text-destructive">• banned</span>}</p>
              {p.status && <p className="mt-2 text-sm">💬 {p.status}</p>}
              {p.bio && <p className="mt-3 text-sm whitespace-pre-wrap rounded-lg bg-muted p-3">{p.bio}</p>}
            </div>
            {!isMe && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => { app.dmUser(userId); onClose(); }}>Message</Button>
                <Button variant="secondary" onClick={() => { app.dmUser(userId, true); onClose(); }}>Call</Button>
                <Button variant="outline" onClick={friendAction}>{friendLabel}</Button>
              </div>
            )}
            <div className="mt-6">
              <h3 className="font-semibold text-lg">Reviews {avg && <span className="text-primary text-sm">★ {avg} ({reviews.length})</span>}</h3>
              {!isMe && (
                <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
                  <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setRating(n)} className={`text-xl ${n <= rating ? "text-primary" : "text-muted-foreground"}`}>★</button>
                  ))}</div>
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a review…" rows={2} />
                  <Button size="sm" onClick={addReview}>Post review</Button>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {reviews.map((r) => (
                  <div key={r.id} className="rounded-lg bg-muted p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{r.author?.display_name ?? "Someone"} <span className="text-primary">{"★".repeat(r.rating)}</span></span>
                      <div className="flex gap-1">
                        {(r.author_id === user?.id || isAdmin) ? (
                          <Button size="sm" variant="ghost" onClick={async () => { await db.from("reviews").delete().eq("id", r.id); load(); }}>Delete</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => requestDelete(r)}>Delete Request</Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{r.content}</p>
                  </div>
                ))}
                {!reviews.length && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

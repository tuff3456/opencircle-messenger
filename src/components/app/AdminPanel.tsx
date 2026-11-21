import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, type Conversation, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./Media";
import { useApp } from "./AppContext";
import { AdminPasswordDialog, type PasswordTarget } from './AdminPasswordDialog';
import { VOICES } from '@/lib/voice';
import { OnlineStatus } from './Presence';

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const app = useApp();
  const [users, setUsers] = useState<Profile[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [calls, setCalls] = useState<{ id: string; conversation_id: string; created_at: string }[]>([]);
  const [reqs, setReqs] = useState<{ id: string; reason: string; review: { id: string; content: string; target_id: string; author_id: string } | null }[]>([]);
  const [anns, setAnns] = useState<{ id: string; content: string; created_at: string }[]>([]);
  const [q, setQ] = useState("");
  const [annText, setAnnText] = useState("");
  const [pollOpts, setPollOpts] = useState("");
  const [stats, setStats] = useState({ users: 0, messages: 0, groups: 0 });
  const [passwordRequests, setPasswordRequests] = useState<{ id: string; user_id: string; reason: string }[]>([]);
  const [passwordTarget, setPasswordTarget] = useState<PasswordTarget | null>(null);

  const load = useCallback(async () => {
    const [u, r, c, cl, rq, an, mc] = await Promise.all([
      db.from("profiles").select("*").order("created_at", { ascending: false }),
      db.from("user_roles").select("user_id").eq("role", "admin"),
      db.from("conversations").select("*").order("last_message_at", { ascending: false }),
      db.from("calls").select("*").is("ended_at", null),
      db.from("review_delete_requests").select("id, reason, review:reviews(id, content, target_id, author_id)").eq("status", "pending"),
      db.from("announcements").select("*").order("created_at", { ascending: false }),
      db.from("messages").select("id", { count: "exact", head: true }),
    ]);
    setUsers(u.data ?? []); setAdmins((r.data ?? []).map((x: { user_id: string }) => x.user_id));
    setConvs(c.data ?? []); setCalls(cl.data ?? []); setReqs(rq.data ?? []); setAnns(an.data ?? []);
    setStats({ users: u.data?.length ?? 0, messages: mc.count ?? 0, groups: (c.data ?? []).filter((x: Conversation) => x.is_group).length });
    const { data: passwords } = await db.from('password_requests').select('*').eq('status', 'pending').order('created_at');
    setPasswordRequests(passwords ?? []);
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const name = (id: string) => users.find((u) => u.id === id)?.display_name ?? "?";
  const upd = async (id: string, fields: Partial<Profile>) => {
    const { error } = await db.from("profiles").update(fields).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Updated"); load(); }
  };
  const filtered = users.filter((u) => !q || u.username.includes(q.toLowerCase()) || u.display_name.toLowerCase().includes(q.toLowerCase()));

  return (
    <><Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>🛡️ Admin panel</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-center">
          {Object.entries(stats).map(([k, v]) => <div key={k} className="rounded-lg bg-muted p-3"><p className="text-2xl font-bold text-primary">{v}</p><p className="text-xs capitalize text-muted-foreground">{k}</p></div>)}
        </div>
        <Tabs defaultValue="users">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="chats">All chats</TabsTrigger>
            <TabsTrigger value="calls">Live calls ({calls.length})</TabsTrigger>
            <TabsTrigger value="ann">Announcements & polls</TabsTrigger>
            <TabsTrigger value="req">Delete requests ({reqs.length})</TabsTrigger>
            <TabsTrigger value="passwords">Password applications ({passwordRequests.length})</TabsTrigger>
            <TabsTrigger value="troll">Troll options</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="space-y-2">
            <Input placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtered.map((u) => (
              <div key={u.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Avatar path={u.avatar_url} name={u.display_name} className="size-9" onClick={() => app.openProfile(u.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{u.display_name} {admins.includes(u.id) && "🛡️"} {u.banned && <span className="text-destructive text-sm">BANNED</span>}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={u.banned ? "secondary" : "destructive"} onClick={() => upd(u.id, { banned: !u.banned })}>{u.banned ? "Unban" : "Ban"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => { const n = prompt("New display name", u.display_name); if (n) upd(u.id, { display_name: n }); }}>Rename</Button>
                  <Button size="sm" variant="secondary" onClick={() => { const n = prompt("Website link for their button (leave empty to remove)", u.special_link ?? ""); if (n !== null) upd(u.id, { special_link: n.trim() || null }); }}>{u.special_link ? "Edit link button" : "Give link button"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => upd(u.id, { bio: "", status: "", avatar_url: null, banner_url: null })}>Reset profile</Button>
                  {u.id !== user?.id && (admins.includes(u.id) ? (
                    <Button size="sm" variant="outline" onClick={async () => { await db.from("user_roles").delete().eq("user_id", u.id).eq("role", "admin"); load(); }}>Remove admin</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={async () => { await db.from("user_roles").insert({ user_id: u.id, role: "admin" }); load(); }}>Make admin</Button>
                  ))}
                  {u.id !== user?.id && <Button size="sm" variant="outline" onClick={() => { onClose(); app.dmUser(u.id); }}>DM</Button>}
                  {u.id !== user?.id && <Button size="sm" variant="outline" onClick={() => setPasswordTarget({ id: u.id, name: u.display_name })}>Change password</Button>}
                </div>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="chats" className="space-y-2">
            {convs.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <div className="flex-1"><p className="font-semibold">{c.is_group ? c.name : "DM"} {c.is_private ? "🔒" : "🌍"}</p>
                  <p className="text-xs text-muted-foreground">by {name(c.created_by)} · {new Date(c.last_message_at).toLocaleString()}</p></div>
                <Button size="sm" onClick={() => { onClose(); app.openConversation(c.id); }}>Open</Button>
                <Button size="sm" variant="destructive" onClick={async () => { if (confirm("Delete this chat?")) { await db.from("conversations").delete().eq("id", c.id); load(); } }}>Delete</Button>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="calls" className="space-y-2">
            {calls.map((c) => {
              const cv = convs.find((x) => x.id === c.conversation_id);
              return (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <p className="flex-1">{cv?.is_group ? cv.name : "DM call"} {cv?.is_private && "🔒"} · since {new Date(c.created_at).toLocaleTimeString()}</p>
                  <Button size="sm" onClick={() => { onClose(); app.openConversation(c.conversation_id); app.joinCall(c.conversation_id); }}>Join</Button>
                  <Button size="sm" variant="outline" onClick={async () => { await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", c.id); load(); }}>Mark ended</Button>
                </div>
              );
            })}
            {!calls.length && <p className="text-muted-foreground text-sm">No live calls.</p>}
          </TabsContent>
          <TabsContent value="ann" className="space-y-2">
            <Textarea placeholder="Announcement or poll question for everyone" value={annText} onChange={(e) => setAnnText(e.target.value)} />
            <Input placeholder="Poll options separated by commas (optional)" value={pollOpts} onChange={(e) => setPollOpts(e.target.value)} />
            <Button onClick={async () => {
              if (!annText.trim() || !user) return;
              const opts = pollOpts.split(",").map((s) => s.trim()).filter(Boolean);
              const { error } = await db.from("announcements").insert({ author_id: user.id, content: annText.trim(), poll_options: opts.length >= 2 ? opts : null });
              if (error) toast.error(error.message); else { setAnnText(""); setPollOpts(""); toast.success("Sent to everyone"); load(); }
            }}>Send to all users</Button>
            {anns.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-muted p-2 text-sm">
                <p className="flex-1">{a.content}</p>
                <Button size="sm" variant="ghost" onClick={async () => { await db.from("announcements").delete().eq("id", a.id); load(); }}>Delete</Button>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="req" className="space-y-2">
            {reqs.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3 text-sm space-y-2">
                <p><b>Review</b> by {name(r.review?.author_id ?? "")} on {name(r.review?.target_id ?? "")}: “{r.review?.content}”</p>
                <p className="text-muted-foreground">Reason: {r.reason || "—"}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={async () => { if (r.review) await db.from("reviews").delete().eq("id", r.review.id); load(); }}>Delete review</Button>
                  <Button size="sm" variant="outline" onClick={async () => { await db.from("review_delete_requests").update({ status: "rejected" }).eq("id", r.id); load(); }}>Keep review</Button>
                </div>
              </div>
            ))}
            {!reqs.length && <p className="text-muted-foreground text-sm">No pending requests.</p>}
          </TabsContent>
          <TabsContent value="passwords" className="space-y-3">
            {passwordRequests.map((request) => <div key={request.id} className="border border-border rounded-lg p-3 space-y-2"><p className="font-semibold">{name(request.user_id)}</p><p className="text-sm text-muted-foreground">{request.reason}</p><Button size="sm" onClick={() => setPasswordTarget({ id: request.user_id, name: name(request.user_id), requestId: request.id })}>Review application</Button></div>)}
            {!passwordRequests.length && <p className="text-sm text-muted-foreground">No pending password applications.</p>}
          </TabsContent>
          <TabsContent value="troll" className="space-y-3">
            <Input placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtered.filter((u) => u.id !== user?.id).map((u) => <div key={u.id} className="border border-border rounded-lg p-3 space-y-2"><div className="flex items-center gap-2"><p className="font-semibold">{u.display_name}</p><OnlineStatus userId={u.id} /></div>
              <div className="flex flex-wrap gap-2">{VOICES.map((voice) => <Button key={voice.id} size="sm" variant="outline" onClick={async () => {
                if (!user) return;
                const { error } = await db.from('prank_events').insert({ user_id: u.id, author_id: user.id, effect: `voice:${voice.id}` });
                if (error) toast.error(error.message); else toast.success(`Sent ${voice.label} voice to ${u.display_name}'s active call`);
              }}>{voice.label}</Button>)}</div>
            </div>)}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog><AdminPasswordDialog target={passwordTarget} onClose={() => setPasswordTarget(null)} onDone={() => void load()} /></>
  );
}

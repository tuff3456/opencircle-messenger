import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db, supabase, uploadFile, kindForFile, type Conversation, type Message, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar, AttachmentView } from "./Media";
import { useApp } from "./AppContext";
import { UserPicker } from "./UserPicker";

type Vote = { message_id: string; user_id: string; option_index: number };

export function convTitle(c: Conversation, members: Profile[], me: string) {
  if (c.is_group) return c.name || "Group";
  const other = members.find((m) => m.id !== me);
  return other?.display_name ?? "Direct message";
}

export function ChatView({ conv, onBack, onDeleted }: { conv: Conversation; onBack: () => void; onDeleted: () => void }) {
  const { user, isAdmin, profile } = useAuth();
  const app = useApp();
  const me = user!.id;
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [activeCall, setActiveCall] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isMember = members.some((m) => m.id === me);
  const canManage = conv.created_by === me || isAdmin;

  const loadMembers = useCallback(async () => {
    const { data } = await db.from("conversation_members").select("user_id, profiles(*)").eq("conversation_id", conv.id);
    setMembers((data ?? []).map((r: { profiles: Profile }) => r.profiles).filter(Boolean));
  }, [conv.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await db.from("messages").select("*").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(500);
      if (live) setMsgs(data ?? []);
      const ids = (data ?? []).filter((m: Message) => m.kind === "poll").map((m: Message) => m.id);
      if (ids.length) { const { data: v } = await db.from("poll_votes").select("*").in("message_id", ids); if (live) setVotes(v ?? []); }
      const { data: c } = await db.from("calls").select("id").eq("conversation_id", conv.id).is("ended_at", null).limit(1);
      if (live) setActiveCall(!!c?.length);
    })();
    loadMembers();
    const ch = supabase.channel(`chat-${conv.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conv.id}` }, (p) => {
        if (p.eventType === "INSERT") setMsgs((m) => (m.some((x) => x.id === (p.new as Message).id) ? m : [...m, p.new as Message]));
        if (p.eventType === "UPDATE") setMsgs((m) => m.map((x) => (x.id === (p.new as Message).id ? (p.new as Message) : x)));
        if (p.eventType === "DELETE") setMsgs((m) => m.filter((x) => x.id !== (p.old as Message).id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, async () => {
        const { data: v } = await db.from("poll_votes").select("*"); setVotes(v ?? []);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `conversation_id=eq.${conv.id}` }, (p) => {
        const row = p.new as { ended_at: string | null };
        setActiveCall(!!row && !row.ended_at);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conv.id}` }, loadMembers)
      .subscribe();
    return () => { live = false; supabase.removeChannel(ch); };
  }, [conv.id, loadMembers]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const [extraProfiles, setExtra] = useState<Record<string, Profile>>({});
  useEffect(() => {
    const missing = [...new Set(msgs.map((m) => m.sender_id))].filter((id) => !byId[id] && !extraProfiles[id]);
    if (missing.length) db.from("profiles").select("*").in("id", missing).then(({ data }: { data: Profile[] }) =>
      setExtra((e) => ({ ...e, ...Object.fromEntries((data ?? []).map((p) => [p.id, p])) })));
  }, [msgs, byId, extraProfiles]);
  const who = (id: string) => byId[id] ?? extraProfiles[id];

  async function sendMsg(fields: Partial<Message>) {
    if (profile?.banned) return toast.error("You are banned.");
    const { error } = await db.from("messages").insert({ conversation_id: conv.id, sender_id: me, ...fields });
    if (error) toast.error(error.message);
  }
  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text; setText("");
    await sendMsg({ kind: "text", content: t });
  }
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const path = await uploadFile(me, f, f.name);
        await sendMsg({ kind: kindForFile(f), attachment_url: path, attachment_name: f.name });
      }
    } catch (e) { toast.error((e as Error).message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function toggleRecord() {
    if (recording) { recording.stop(); setRecording(null); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setUploading(true);
        try {
          const path = await uploadFile(me, blob, "voice.webm");
          await sendMsg({ kind: "voice", attachment_url: path, attachment_name: "Voice message" });
        } catch (e) { toast.error((e as Error).message); }
        setUploading(false);
      };
      rec.start(); setRecording(rec);
    } catch { toast.error("Microphone blocked. Allow mic access in Chrome."); }
  }
  async function vote(m: Message, idx: number) {
    await db.from("poll_votes").upsert({ message_id: m.id, user_id: me, option_index: idx });
    const { data: v } = await db.from("poll_votes").select("*").eq("message_id", m.id);
    setVotes((all) => [...all.filter((x) => x.message_id !== m.id), ...(v ?? [])]);
  }
  async function saveEdit(id: string) {
    await db.from("messages").update({ content: editText, edited_at: new Date().toISOString() }).eq("id", id);
    setEditing(null);
  }

  const title = convTitle(conv, members, me);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 bg-panel">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>←</Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {conv.is_group ? `${members.length} members · ${conv.is_private ? "Private" : "Public"}` : "Direct message"}
            {!isMember && isAdmin && " · viewing as admin"}
          </p>
        </div>
        {conv.is_group && <Button variant="outline" size="sm" onClick={() => setShowMembers(true)}>Members</Button>}
        {!conv.is_group && members.find((m) => m.id !== me) && (
          <Button variant="outline" size="sm" onClick={() => app.openProfile(members.find((m) => m.id !== me)!.id)}>Profile</Button>
        )}
        <Button size="sm" onClick={() => app.joinCall(conv.id)}>{activeCall ? "Join call" : "Call"}</Button>
      </header>
      {activeCall && (
        <button onClick={() => app.joinCall(conv.id)} className="bg-success/20 text-success px-4 py-2 text-sm font-semibold text-left">
          🟢 A call is happening now — tap to join
        </button>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.map((m) => {
          const mine = m.sender_id === me;
          const s = who(m.sender_id);
          const canEdit = (mine || isAdmin) && (m.kind === "text" || m.kind === "poll");
          return (
            <div key={m.id} className={`group flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              <Avatar path={s?.avatar_url} name={s?.display_name ?? "?"} className="size-9" onClick={() => s && app.openProfile(s.id)} />
              <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => s && app.openProfile(s.id)}>
                  {s?.display_name ?? "…"} · {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </button>
                <div className={`mt-1 rounded-2xl px-3 py-2 ${mine ? "bg-bubble-me text-bubble-me-foreground" : "bg-bubble"}`}>
                  {editing === m.id ? (
                    <div className="flex gap-2"><Input value={editText} onChange={(e) => setEditText(e.target.value)} className="h-8" />
                      <Button size="sm" onClick={() => saveEdit(m.id)}>Save</Button></div>
                  ) : m.kind === "poll" ? (
                    <div className="min-w-56 space-y-2">
                      <p className="font-semibold">📊 {m.content}</p>
                      {(m.poll_options ?? []).map((o, i) => {
                        const vs = votes.filter((v) => v.message_id === m.id);
                        const n = vs.filter((v) => v.option_index === i).length;
                        const pct = vs.length ? Math.round((n / vs.length) * 100) : 0;
                        const mineV = vs.some((v) => v.user_id === me && v.option_index === i);
                        return (
                          <button key={i} onClick={() => vote(m, i)} className={`relative w-full overflow-hidden rounded-md border px-2 py-1 text-left text-sm ${mineV ? "border-current font-semibold" : "border-border"}`}>
                            <span className="absolute inset-y-0 left-0 bg-current opacity-15" style={{ width: `${pct}%` }} />
                            <span className="relative">{o} — {n} ({pct}%)</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      {m.attachment_url && <AttachmentView kind={m.kind} path={m.attachment_url} name={m.attachment_name} />}
                      {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    </>
                  )}
                  {m.edited_at && <span className="text-[10px] opacity-60">(edited)</span>}
                </div>
                {(mine || isAdmin) && (
                  <div className="mt-1 hidden gap-2 text-xs text-muted-foreground group-hover:flex">
                    {canEdit && <button onClick={() => { setEditing(m.id); setEditText(m.content ?? ""); }}>Edit</button>}
                    <button onClick={() => db.from("messages").delete().eq("id", m.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!msgs.length && <p className="text-center text-muted-foreground mt-10">No messages yet. Say hi 👋</p>}
        <div ref={endRef} />
      </div>
      {isMember || isAdmin ? (
        <form onSubmit={sendText} className="flex items-center gap-2 border-t border-border p-3 bg-panel">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          <Button type="button" variant="ghost" size="icon" title="Send photo, video or file" onClick={() => fileRef.current?.click()} disabled={uploading}>📎</Button>
          <Button type="button" variant={recording ? "destructive" : "ghost"} size="icon" title="Voice message" onClick={toggleRecord}>{recording ? "⏹" : "🎤"}</Button>
          <Button type="button" variant="ghost" size="icon" title="Poll" onClick={() => setShowPoll(true)}>📊</Button>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={recording ? "Recording… tap ⏹ to send" : uploading ? "Uploading…" : "Message"} className="flex-1" />
          <Button type="submit">Send</Button>
        </form>
      ) : (
        <div className="border-t border-border p-3 text-center">
          <Button onClick={async () => { const { error } = await db.from("conversation_members").insert({ conversation_id: conv.id, user_id: me }); if (error) toast.error(error.message); else loadMembers(); }}>Join group</Button>
        </div>
      )}

      <PollDialog open={showPoll} onClose={() => setShowPoll(false)} onCreate={(q, opts) => sendMsg({ kind: "poll", content: q, poll_options: opts })} />

      <Dialog open={showMembers} onOpenChange={setShowMembers}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {canManage && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <GroupSettings conv={conv} />
              <p className="text-sm font-semibold">Add people</p>
              <UserPicker exclude={members.map((m) => m.id)} onPick={async (p) => {
                const { error } = await db.from("conversation_members").insert({ conversation_id: conv.id, user_id: p.id });
                if (error) toast.error(error.message); else loadMembers();
              }} />
            </div>
          )}
          {!canManage && isMember && (
            <UserPicker exclude={members.map((m) => m.id)} onPick={async (p) => {
              await db.from("conversation_members").insert({ conversation_id: conv.id, user_id: p.id }); loadMembers();
            }} />
          )}
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <Avatar path={m.avatar_url} name={m.display_name} className="size-9" onClick={() => app.openProfile(m.id)} />
                <button className="flex-1 text-left" onClick={() => app.openProfile(m.id)}>
                  <p className="font-semibold">{m.display_name}{m.id === conv.created_by && " 👑"}</p>
                  <p className="text-xs text-muted-foreground">@{m.username}</p>
                </button>
                {m.id !== me && <Button size="sm" variant="secondary" onClick={() => { setShowMembers(false); app.dmUser(m.id); }}>DM</Button>}
                {canManage && m.id !== me && (
                  <Button size="sm" variant="destructive" onClick={async () => {
                    await db.from("conversation_members").delete().eq("conversation_id", conv.id).eq("user_id", m.id); loadMembers();
                  }}>Kick</Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            {isMember && <Button variant="outline" onClick={async () => {
              await db.from("conversation_members").delete().eq("conversation_id", conv.id).eq("user_id", me); setShowMembers(false); onDeleted();
            }}>Leave group</Button>}
            {canManage && <Button variant="destructive" onClick={async () => {
              if (!confirm("Delete this group for everyone?")) return;
              await db.from("conversations").delete().eq("id", conv.id); setShowMembers(false); onDeleted();
            }}>Delete group</Button>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupSettings({ conv }: { conv: Conversation }) {
  const [name, setName] = useState(conv.name ?? "");
  const [priv, setPriv] = useState(conv.is_private);
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={() => db.from("conversations").update({ name }).eq("id", conv.id).then(() => toast.success("Renamed"))}>Rename</Button></div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={priv} onCheckedChange={async (v) => { setPriv(v); await db.from("conversations").update({ is_private: v }).eq("id", conv.id); }} />
        Private (only invited people can see and join)
      </label>
    </div>
  );
}

export function PollDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (q: string, opts: string[]) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create a poll</DialogTitle></DialogHeader>
        <Input placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} />
        {opts.map((o, i) => <Input key={i} placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />)}
        <div className="flex gap-2">
          {opts.length < 8 && <Button variant="outline" onClick={() => setOpts([...opts, ""])}>Add option</Button>}
          <Button onClick={() => {
            const clean = opts.map((o) => o.trim()).filter(Boolean);
            if (!q.trim() || clean.length < 2) return toast.error("Add a question and at least 2 options.");
            onCreate(q.trim(), clean); setQ(""); setOpts(["", ""]); onClose();
          }}>Post poll</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

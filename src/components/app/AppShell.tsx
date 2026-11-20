import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db, supabase, type Conversation, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./Media";
import { AppContext } from "./AppContext";
import { ChatView, convTitle } from "./ChatView";
import { CallView } from "./CallView";
import { ProfileDialog } from "./ProfileDialog";
import { SettingsDialog, NewGroupDialog } from "./Settings";
import { AdminPanel } from "./AdminPanel";
import { UserPicker } from "./UserPicker";
import { PresenceProvider, OnlineStatus } from "./Presence";
import { readPreferences, playNotification } from "@/lib/preferences";

type ConvRow = Conversation & { members: Profile[] };
type Tab = "chats" | "people" | "groups" | "news";

export function AppShell() {
  const { user, profile, isAdmin, refresh } = useAuth();
  const me = user?.id ?? '';
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const activeRef = useRef<string | null>(null);
  useEffect(() => { activeRef.current = active?.id ?? null; }, [active]);
  const notify = (title: string, body: string) => {
    const prefs = readPreferences(); if (!prefs.notifications) return;
    void playNotification(prefs);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") { const notice = new Notification(title, { body }); notice.onclick = () => { window.focus(); notice.close(); }; }
  };
  const [callConv, setCallConv] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chats");
  const [settings, setSettings] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [adminGate, setAdminGate] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [code, setCode] = useState("");

  const loadConvs = useCallback(async () => {
    const { data: mine } = await db.from("conversation_members").select("conversation_id").eq("user_id", me);
    const ids = (mine ?? []).map((r: { conversation_id: string }) => r.conversation_id);
    if (!ids.length) return setConvs([]);
    const { data: cs } = await db.from("conversations").select("*").in("id", ids).order("last_message_at", { ascending: false });
    const { data: mem } = await db.from("conversation_members").select("conversation_id, profiles(*)").in("conversation_id", ids);
    setConvs((cs ?? []).map((c: Conversation) => ({ ...c, members: (mem ?? []).filter((m: { conversation_id: string }) => m.conversation_id === c.id).map((m: { profiles: Profile }) => m.profiles).filter(Boolean) })));
  }, [me]);

  useEffect(() => {
    loadConvs();
    const ch = supabase.channel(`shell-${me}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${me}` }, loadConvs)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadConvs)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
        const m = p.new as { sender_id: string; conversation_id: string; content: string };
        loadConvs();
        if (m.sender_id !== me && (document.hidden || m.conversation_id !== activeRef.current)) {
          notify('New message', m.content || 'New attachment');
          if (readPreferences().notifications) toast('New message', { description: m.content || 'New attachment', action: { label: 'Open', onClick: () => { void openConversation(m.conversation_id); } } });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, (p) => {
        const c = p.new as { started_by: string; conversation_id: string };
        if (c.started_by === me) return;
        notify("Incoming call", "Someone is calling you");
        if (!readPreferences().notifications) return;
        toast("📞 Incoming call", { duration: 20000, action: { label: "Join", onClick: () => { openConversation(c.conversation_id); setCallConv(c.conversation_id); } } });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (p) => {
        notify("Announcement", (p.new as { content: string }).content);
        if (!readPreferences().notifications) return;
        toast("📢 Announcement", { description: (p.new as { content: string }).content, duration: 15000 });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, loadConvs]);

  const openConversation = useCallback(async (id: string) => {
    const { data } = await db.from("conversations").select("*").eq("id", id).maybeSingle();
    if (data) { setActive(data); setTab("chats"); }
  }, []);
  const dmUser = useCallback(async (userId: string, call?: boolean) => {
    const { data, error } = await db.rpc("get_or_create_dm", { _other: userId });
    if (error) return void toast.error(error.message);
    await loadConvs(); await openConversation(data);
    if (call) setCallConv(data);
  }, [loadConvs, openConversation]);

  async function tryAdmin() {
    const { data } = await db.rpc("claim_admin", { _code: code });
    setCode("");
    if (data) { await refresh(); setAdminGate(false); setAdminOpen(true); }
    else toast.error("Access denied. Wrong code, or you're not an admin.");
  }

  if (profile?.banned) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div><h1 className="text-3xl font-bold">You've been banned</h1>
          <p className="text-muted-foreground mt-2">An admin has banned this account.</p>
          <Button className="mt-4" variant="outline" onClick={() => supabase.auth.signOut()}>Sign out</Button></div>
      </div>
    );
  }

  const activeTitle = active ? convTitle(active, convs.find((c) => c.id === active.id)?.members ?? [], me) : "";

  return (
    <PresenceProvider><AppContext.Provider value={{ openProfile: setProfileId, openConversation, dmUser, joinCall: (id) => setCallConv(id) }}>
      <div className="flex h-screen overflow-hidden">
        <aside className={`${active ? "hidden md:flex" : "flex"} w-full md:w-80 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground`}>
          <div className="px-4 pt-4 pb-2">
            <h1 className="text-xl font-bold leading-tight">Javiers History Project</h1>
          </div>
          <div className="grid grid-cols-4 gap-1 px-3 pb-2">
            {(["chats", "people", "groups", "news"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}>{t}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {tab === "chats" && (
              <>
                <div className="flex gap-2 px-1 py-2">
                  <Button size="sm" className="flex-1" onClick={() => setNewGroup(true)}>+ New group</Button>
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => setTab("people")}>+ New DM</Button>
                </div>
                {convs.map((c) => {
                  const other = c.members.find((m) => m.id !== me);
                  return (
                    <button key={c.id} onClick={() => setActive(c)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${active?.id === c.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}>
                      {c.is_group ? <div className="size-10 rounded-full bg-primary/20 text-primary grid place-items-center font-bold">#</div>
                        : <Avatar path={other?.avatar_url} name={other?.display_name ?? "?"} />}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{convTitle(c, c.members, me)}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.is_group ? `${c.members.length} members ${c.is_private ? "· 🔒" : "· 🌍"}` : `@${other?.username ?? ""}`}</p>
                        {!c.is_group && <OnlineStatus userId={other?.id} />}
                      </div>
                    </button>
                  );
                })}
                {!convs.length && <p className="p-4 text-sm text-muted-foreground">No chats yet. Find people in the People tab.</p>}
              </>
            )}
            {tab === "people" && <PeopleTab onPick={(id) => setProfileId(id)} />}
            {tab === "groups" && <GroupsTab onOpen={openConversation} />}
            {tab === "news" && <NewsTab />}
          </div>
          <div className="border-t border-sidebar-border p-3 space-y-2">
            {profile?.special_link && (
              <Button className="w-full" onClick={() => window.open(profile.special_link!, "_blank", "noopener")}>🔗 Open link from admin</Button>
            )}
            <div className="flex items-center gap-2">
              <Avatar path={profile?.avatar_url} name={profile?.display_name ?? "?"} className="size-9" onClick={() => setProfileId(me)} />
              <button className="min-w-0 flex-1 text-left" onClick={() => setSettings(true)}>
                <p className="truncate text-sm font-semibold">{profile?.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">Edit profile</p>
              </button>
              <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            </div>
            <button onClick={() => (isAdmin ? setAdminGate(true) : setAdminGate(true))} className="text-[11px] text-muted-foreground hover:text-primary">Admin login</button>
          </div>
        </aside>
        <main className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0`}>
          {active ? <ChatView key={active.id} conv={active} onBack={() => setActive(null)} onDeleted={() => { setActive(null); loadConvs(); }} />
            : <div className="m-auto text-center p-6"><h2 className="text-3xl font-bold">Pick a conversation</h2><p className="text-muted-foreground mt-2">Or start a new DM or group.</p></div>}
        </main>
      </div>
      {callConv && <CallView conversationId={callConv} title={activeTitle || "Call"} onLeave={() => setCallConv(null)} />}
      <ProfileDialog userId={profileId} onClose={() => setProfileId(null)} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      <NewGroupDialog open={newGroup} onClose={() => setNewGroup(false)} onCreated={async (id) => { await loadConvs(); openConversation(id); }} />
      <Dialog open={adminGate} onOpenChange={setAdminGate}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Admin login</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); tryAdmin(); }} className="space-y-3">
            <Input type="password" inputMode="numeric" placeholder="Admin code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            <Button type="submit" className="w-full">Open admin menu</Button>
          </form>
        </DialogContent>
      </Dialog>
      {isAdmin && <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />}
    </AppContext.Provider></PresenceProvider>
  );
}

function PeopleTab({ onPick }: { onPick: (id: string) => void }) {
  const { user } = useAuth();
  const [sugg, setSugg] = useState<(Profile & { mutuals: number })[]>([]);
  const [friends, setFriends] = useState<{ id: string; status: string; requester_id: string; other: Profile }[]>([]);
  const load = useCallback(async () => {
    const { data } = await db.rpc("people_you_may_know"); setSugg(data ?? []);
    const { data: fr } = await db.from("friendships").select("*").or(`requester_id.eq.${user!.id},addressee_id.eq.${user!.id}`);
    const ids = (fr ?? []).map((f: { requester_id: string; addressee_id: string }) => (f.requester_id === user!.id ? f.addressee_id : f.requester_id));
    const { data: ps } = ids.length ? await db.from("profiles").select("*").in("id", ids) : { data: [] };
    setFriends((fr ?? []).map((f: { id: string; status: string; requester_id: string; addressee_id: string }) => ({ ...f, other: ps.find((p: Profile) => p.id === (f.requester_id === user!.id ? f.addressee_id : f.requester_id)) })).filter((f: { other?: Profile }) => f.other));
  }, [user]);
  useEffect(() => { load(); }, [load]);
  const incoming = friends.filter((f) => f.status === "pending" && f.requester_id !== user!.id);
  const accepted = friends.filter((f) => f.status === "accepted");
  const Row = ({ p, extra, right }: { p: Profile; extra?: string | undefined; right?: React.ReactNode }) => (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/60">
      <Avatar path={p.avatar_url} name={p.display_name} className="size-9" onClick={() => onPick(p.id)} />
      <button className="min-w-0 flex-1 text-left" onClick={() => onPick(p.id)}>
        <p className="truncate text-sm font-semibold">{p.display_name}</p>
        <p className="truncate text-xs text-muted-foreground">@{p.username}{extra && ` · ${extra}`}</p><OnlineStatus userId={p.id} />
      </button>{right}
    </div>
  );
  return (
    <div className="space-y-4 py-2 px-1">
      <UserPicker onPick={(p) => onPick(p.id)} />
      {incoming.length > 0 && <section><h3 className="px-2 text-xs font-bold uppercase tracking-wider text-primary">Friend requests</h3>
        {incoming.map((f) => <Row key={f.id} p={f.other} right={<Button size="sm" onClick={async () => { await db.from("friendships").update({ status: "accepted" }).eq("id", f.id); load(); }}>Accept</Button>} />)}</section>}
      <section><h3 className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">People you may know</h3>
        {sugg.map((p) => <Row key={p.id} p={p} extra={p.mutuals ? `${p.mutuals} mutual` : undefined}
          right={<Button size="sm" variant="secondary" onClick={async () => { await db.from("friendships").insert({ requester_id: user!.id, addressee_id: p.id }); toast.success("Request sent"); load(); }}>Add</Button>} />)}
        {!sugg.length && <p className="px-2 text-sm text-muted-foreground">No suggestions yet.</p>}</section>
      <section><h3 className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Friends ({accepted.length})</h3>
        {accepted.map((f) => <Row key={f.id} p={f.other} />)}</section>
    </div>
  );
}

function GroupsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [groups, setGroups] = useState<Conversation[]>([]);
  useEffect(() => { db.from("conversations").select("*").eq("is_group", true).eq("is_private", false).order("last_message_at", { ascending: false }).then(({ data }: { data: Conversation[] }) => setGroups(data ?? [])); }, []);
  return (
    <div className="py-2 space-y-1">
      <h3 className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Public groups</h3>
      {groups.map((g) => (
        <button key={g.id} onClick={() => onOpen(g.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent/60">
          <div className="size-10 rounded-full bg-primary/20 text-primary grid place-items-center font-bold">#</div>
          <p className="truncate font-semibold">{g.name}</p>
        </button>
      ))}
      {!groups.length && <p className="px-2 text-sm text-muted-foreground">No public groups yet.</p>}
    </div>
  );
}

function NewsTab() {
  const { user } = useAuth();
  const [anns, setAnns] = useState<{ id: string; content: string; created_at: string; poll_options: string[] | null }[]>([]);
  const [votes, setVotes] = useState<{ announcement_id: string; user_id: string; option_index: number }[]>([]);
  const load = useCallback(async () => {
    const { data } = await db.from("announcements").select("*").order("created_at", { ascending: false }).limit(50);
    setAnns(data ?? []);
    const { data: v } = await db.from("announcement_votes").select("*"); setVotes(v ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="py-2 space-y-2">
      {anns.map((a) => {
        const vs = votes.filter((v) => v.announcement_id === a.id);
        return (
          <div key={a.id} className="rounded-lg bg-sidebar-accent p-3 text-sm">
            <p className="text-xs text-primary font-semibold">📢 {new Date(a.created_at).toLocaleString()}</p>
            <p className="mt-1 whitespace-pre-wrap">{a.content}</p>
            {a.poll_options && <div className="mt-2 space-y-1">{a.poll_options.map((o, i) => {
              const n = vs.filter((v) => v.option_index === i).length;
              const mine = vs.some((v) => v.user_id === user!.id && v.option_index === i);
              return <button key={i} onClick={async () => { await db.from("announcement_votes").upsert({ announcement_id: a.id, user_id: user!.id, option_index: i }); load(); }}
                className={`w-full rounded-md border px-2 py-1 text-left ${mine ? "border-primary text-primary font-semibold" : "border-border"}`}>{o} — {n}</button>;
            })}</div>}
          </div>
        );
      })}
      {!anns.length && <p className="px-2 text-sm text-muted-foreground">No announcements yet.</p>}
    </div>
  );
}

import { UserPicker as UserPickerLazy } from "./UserPicker";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { db, uploadFile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar, useSigned } from "./Media";
import { ImagePositioner } from "./ImagePositioner";
import { AccountOptions } from "./AccountOptions";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user, refresh } = useAuth();
  const [display, setDisplay] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const banner = useSigned(profile?.banner_url);
  const [crop, setCrop] = useState<{ file: File; field: "avatar_url" | "banner_url" } | null>(null);
  useEffect(() => { if (profile) { setDisplay(profile.display_name); setBio(profile.bio ?? ""); setStatus(profile.status ?? ""); } }, [profile, open]);
  if (!profile || !user) return null;

  async function upload(field: "avatar_url" | "banner_url", f?: File) {
    if (!f || !user) return;
    try { const path = await uploadFile(user.id, f, f.name);
      const { error } = await db.from("profiles").update({ [field]: path }).eq("id", user.id);
      if (error) throw error;
      await refresh(); setCrop(null); toast.success("Image saved");
    } catch (error) { toast.error((error as Error).message); }
  }
  async function reposition(field: "avatar_url" | "banner_url") {
    const { signedUrl } = await import('@/lib/db');
    const url = await signedUrl(profile?.[field]); if (!url) return;
    try { const response = await fetch(url); const blob = await response.blob(); setCrop({ field, file: new File([blob], 'image.jpg', { type: blob.type }) }); }
    catch { toast.error('Could not open image.'); }
  }
  async function save() {
    if (!user || !profile) return;
    const { error } = await db.from("profiles").update({ display_name: display.trim() || profile.username, bio, status }).eq("id", user.id);
    if (error) toast.error(error.message); else { toast.success("Profile saved"); refresh(); onClose(); }
  }
  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Your profile</DialogTitle></DialogHeader>
        <div className="h-24 rounded-lg bg-hero bg-cover bg-center" style={banner ? { backgroundImage: `url(${banner})` } : undefined} />
        <div className="flex items-center gap-3">
          <Avatar path={profile.avatar_url} name={profile.display_name} className="size-16 text-2xl" />
          <div className="flex flex-col gap-1 text-sm">
            <label className="cursor-pointer text-primary hover:underline">Change profile photo<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) setCrop({ file, field: "avatar_url" }); e.target.value = ""; }} /></label>
            <label className="cursor-pointer text-primary hover:underline">Change banner<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) setCrop({ file, field: "banner_url" }); e.target.value = ""; }} /></label>
          </div>
        </div>
        <div className="flex gap-2">{profile.avatar_url && <Button size="sm" variant="outline" onClick={() => reposition("avatar_url")}>Position photo</Button>}{profile.banner_url && <Button size="sm" variant="outline" onClick={() => reposition("banner_url")}>Position banner</Button>}</div>
        <p className="text-sm text-muted-foreground">Username: @{profile.username}</p>
        <div className="space-y-1"><Label>Display name</Label><Input value={display} onChange={(e) => setDisplay(e.target.value)} /></div>
        <div className="space-y-1"><Label>Status</Label><Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Studying the Romans 🏛️" /></div>
        <div className="space-y-1"><Label>Bio</Label><Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} /></div>
        <Button onClick={save}>Save profile</Button>
        <AccountOptions />
      </DialogContent>
    </Dialog>
    <ImagePositioner file={crop?.file ?? null} banner={crop?.field === "banner_url"} onClose={() => setCrop(null)} onSave={async (file) => { if (crop) await upload(crop.field, file); }} />
    </>
  );
}

export function NewGroupDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(true);
  const [picked, setPicked] = useState<{ id: string; display_name: string }[]>([]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New group</DialogTitle></DialogHeader>
        <Input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <Button variant={priv ? "default" : "outline"} size="sm" onClick={() => setPriv(true)}>🔒 Private</Button>
          <Button variant={!priv ? "default" : "outline"} size="sm" onClick={() => setPriv(false)}>🌍 Public</Button>
        </div>
        <p className="text-xs text-muted-foreground">{priv ? "Only people you add can see it." : "Anyone can find and join it."}</p>
        <div className="flex flex-wrap gap-1">{picked.map((p) => (
          <button key={p.id} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="rounded-full bg-accent px-2 py-0.5 text-sm">{p.display_name} ✕</button>
        ))}</div>
        <UserPickerLazy exclude={picked.map((p) => p.id)} onPick={(p) => setPicked([...picked, p])} />
        <Button onClick={async () => {
          if (!name.trim()) { toast.error("Name your group."); return; }
          const { data, error } = await db.rpc("create_group", { _name: name.trim(), _private: priv, _members: picked.map((p) => p.id) });
          if (error) { toast.error(error.message); return; }
          setName(""); setPicked([]); onClose(); onCreated(data);
        }}>Create group</Button>
      </DialogContent>
    </Dialog>
  );
}

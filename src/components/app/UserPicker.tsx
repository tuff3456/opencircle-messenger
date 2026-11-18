import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { db, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./Media";

export function UserPicker({ onPick, exclude = [], placeholder = "Search by username…" }: { onPick: (p: Profile) => void; exclude?: string[]; placeholder?: string }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Profile[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      const s = q.trim().toLowerCase().replace(/[%,()]/g, "");
      if (!s) return setRes([]);
      const { data } = await db.from("profiles").select("*").or(`username.ilike.%${s}%,display_name.ilike.%${s}%`).limit(8);
      setRes((data ?? []).filter((p: Profile) => p.id !== user?.id && !exclude.includes(p.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, user?.id, exclude.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {res.map((p) => (
        <button key={p.id} type="button" onClick={() => { onPick(p); setQ(""); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent text-left">
          <Avatar path={p.avatar_url} name={p.display_name} className="size-8" />
          <span className="font-semibold">{p.display_name}</span><span className="text-xs text-muted-foreground">@{p.username}</span>
        </button>
      ))}
    </div>
  );
}

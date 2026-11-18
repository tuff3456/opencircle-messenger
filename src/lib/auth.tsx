import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { db, supabase, type Profile } from "./db";

type AuthCtx = {
  user: User | null; profile: Profile | null; isAdmin: boolean; loading: boolean;
  refresh: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>({ user: null, profile: null, isAdmin: false, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (u: User | null) => {
    setUser(u);
    if (!u) { setProfile(null); setIsAdmin(false); setLoading(false); return; }
    const [{ data: p }, { data: r }] = await Promise.all([
      db.from("profiles").select("*").eq("id", u.id).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", u.id),
    ]);
    setProfile(p);
    setIsAdmin(!!r?.some((x: { role: string }) => x.role === "admin"));
    setLoading(false);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        setTimeout(() => load(session?.user ?? null), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`me-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (p) => setProfile(p.new as Profile))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  return (
    <Ctx.Provider value={{ user, profile, isAdmin, loading, refresh: () => load(user) }}>
      {children}
    </Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);

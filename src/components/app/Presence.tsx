import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { isOnline } from '@/lib/preferences';
const PresenceContext = createContext<Set<string>>(new Set());
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    let live = true;
    const refresh = async () => { await db.rpc('touch_presence'); const { data } = await db.from('profiles').select('id,last_seen'); if (live) setOnline(new Set((data ?? []).filter((p: { last_seen: string | null }) => isOnline(p.last_seen)).map((p: { id: string }) => p.id))); };
    void refresh(); const timer = setInterval(refresh, 25_000);
    return () => { live = false; clearInterval(timer); };
  }, [user?.id]);
  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}
export function OnlineStatus({ userId }: { userId?: string }) {
  const online = useContext(PresenceContext).has(userId ?? '');
  return <span className={`inline-flex items-center gap-1 text-xs ${online ? 'text-success' : 'text-muted-foreground'}`}><span className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`} />{online ? 'Online' : 'Offline'}</span>;
}
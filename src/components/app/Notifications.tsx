import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, MessageCircle, Phone, Megaphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { db, supabase } from '@/lib/db';
import { readPreferences, playNotification } from '@/lib/preferences';
import { useAuth } from '@/lib/auth';

type Notice = { id: string; title: string; body: string; kind: 'message' | 'call' | 'announcement'; conversation_id: string | null; read_at: string | null; created_at: string };
export function Notifications({ activeId, onOpen, onSettings }: { activeId: string | null; onOpen: (conversationId: string | null) => void; onSettings: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  const activeRef = useRef(activeId);
  const actionRef = useRef(onOpen);
  useEffect(() => { activeRef.current = activeId; actionRef.current = onOpen; }, [activeId, onOpen]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const load = async () => {
      const { data, error: err } = await db.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
      if (live) { setError(err ? 'Could not load notifications.' : ''); if (data) setItems(data); }
    };
    void load();
    const ch = supabase.channel(`notices-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, payload => {
        void load();
        if (payload.eventType !== 'INSERT') return;
        const row = payload.new as Notice;
        if (row.kind === 'message' && row.conversation_id === activeRef.current && !document.hidden) {
          void db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', row.id); return;
        }
        const prefs = readPreferences(); if (!prefs.notifications) return;
        void playNotification(prefs);
        toast(row.title, { description: row.body, action: { label: 'Open', onClick: () => actionRef.current(row.conversation_id) } });
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try { const notice = new Notification(row.title, { body: row.body }); notice.onclick = () => { window.focus(); actionRef.current(row.conversation_id); notice.close(); }; } catch { /* Inbox remains available when browser alerts are blocked. */ }
        }
      }).subscribe();
    return () => { live = false; void supabase.removeChannel(ch); };
  }, [user?.id]);
  const unread = items.filter(item => !item.read_at).length;
  async function mark(id?: string) {
    if (!user) return;
    let query = db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id);
    query = id ? query.eq('id', id) : query.is('read_at', null);
    const { error: err } = await query;
    if (err) return void toast.error(err.message);
    setItems(rows => rows.map(row => !id || row.id === id ? { ...row, read_at: new Date().toISOString() } : row));
  }
  return <>
    <Button variant="ghost" size="icon" className="relative shrink-0" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} title="Notifications" onClick={() => setOpen(true)}><Bell className="size-4" />{unread > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-primary text-primary-foreground min-w-4 px-1 text-[10px]">{unread > 99 ? '99+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifications</DialogTitle></DialogHeader>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!unread} onClick={() => void mark()}><CheckCheck className="size-4" />Mark all read</Button><Button size="sm" variant="outline" onClick={() => { setOpen(false); onSettings(); }}>Alert settings</Button></div>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {!items.length && !error && <p className="py-6 text-sm text-muted-foreground text-center">No notifications yet.</p>}
      <div className="divide-y divide-border">{items.map(item => {
        const Icon = item.kind === 'call' ? Phone : item.kind === 'message' ? MessageCircle : Megaphone;
        return <div key={item.id} className={`flex items-start gap-3 py-3 ${item.read_at ? 'text-muted-foreground' : ''}`}>
          <Icon className="size-4 shrink-0 mt-1" /><Button variant="ghost" className="flex-1 min-w-0 h-auto items-start flex-col text-left whitespace-normal" onClick={() => { void mark(item.id); setOpen(false); onOpen(item.conversation_id); }}><span className="font-semibold">{item.title}{!item.read_at && <span className="ml-2 text-primary">•</span>}</span><span className="text-sm font-normal break-words max-w-full">{item.body}</span><time className="text-xs font-normal mt-1">{new Date(item.created_at).toLocaleString()}</time></Button>
          <Button size="icon" variant="ghost" title="Delete notification" aria-label="Delete notification" onClick={async () => { const { error: err } = await db.from('notifications').delete().eq('id', item.id); if (err) toast.error(err.message); else setItems(rows => rows.filter(row => row.id !== item.id)); }}><Trash2 className="size-4" /></Button>
        </div>;
      })}</div>
    </DialogContent></Dialog>
  </>;
}
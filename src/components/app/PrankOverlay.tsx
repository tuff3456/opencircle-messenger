import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/db';
import { useAuth } from '@/lib/auth';
export function PrankOverlay() {
  const { user } = useAuth(); const [effect, setEffect] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`prank-${user.id}-${Math.random().toString(36).slice(2)}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'prank_events', filter: `user_id=eq.${user.id}` }, ({ new: event }) => { setEffect(event.effect); toast('An admin sent you a prank'); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id]);
  useEffect(() => {
    document.body.dataset.prank = effect ?? '';
    if (!effect) return;
    const timer = setTimeout(() => setEffect(null), 8000);
    return () => { clearTimeout(timer); document.body.dataset.prank = ''; };
  }, [effect]);
  return effect ? <div className="fixed inset-0 z-[100] pointer-events-none">{effect === 'confetti' && <div className="prank-confetti" aria-hidden="true">🎉 ✨ 🎊 🎉 ✨ 🎊</div>}<Button className="pointer-events-auto absolute right-4 top-4" onClick={() => setEffect(null)}>Dismiss prank</Button></div> : null;
}
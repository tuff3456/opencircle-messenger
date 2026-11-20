import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { db, supabase, uploadFile } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { defaultPreferences, playNotification, readPreferences, savePreferences, type Preferences } from '@/lib/preferences';

export function AccountOptions() {
  const { user } = useAuth();
  const [current, setCurrent] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<{ id: string; status: string }[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const load = async () => { if (user) { const { data } = await db.from('password_requests').select('id,status').eq('user_id', user.id).order('created_at', { ascending: false }); setRequests(data ?? []); } };
  useEffect(() => { setPrefs(readPreferences()); void load(); }, [user?.id]);
  const change = (value: Partial<Preferences>) => { const next = { ...prefs, ...value }; setPrefs(next); savePreferences(next); };
  return <div className="space-y-6 border-t border-border pt-4">
    <section className="space-y-3"><h3 className="font-semibold">Password</h3>
      <Input aria-label="Current password" placeholder="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input aria-label="New password" placeholder="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Input aria-label="Confirm new password" placeholder="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button disabled={busy} onClick={async () => {
        if (!current || password.length < 8 || password !== confirm) return void toast.error('Enter your current password and matching new passwords of at least 8 characters.');
        setBusy(true); const { error } = await supabase.auth.updateUser({ password, current_password: current }); setBusy(false);
        if (error) toast.error(error.message); else { setCurrent(''); setPassword(''); setConfirm(''); toast.success('Password changed'); }
      }}>Change password</Button>
      <Input aria-label="Password application reason" placeholder="Reason for requesting admin help" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button variant="outline" disabled={busy || requests.some((r) => r.status === 'pending')} onClick={async () => {
        if (!user || !reason.trim()) return void toast.error('Enter a reason.');
        setBusy(true); const { error } = await db.from('password_requests').insert({ user_id: user.id, reason: reason.trim() }); setBusy(false);
        if (error) toast.error(error.message); else { setReason(''); await load(); toast.success('Application sent to admins'); }
      }}>Apply for password change</Button>
      {requests[0] && <p className="text-sm text-muted-foreground">Latest application: {requests[0].status}</p>}
    </section>
    <section className="space-y-3"><h3 className="font-semibold">Notifications</h3>
      <label className="flex items-center justify-between text-sm">Message and call alerts<Switch checked={prefs.notifications} onCheckedChange={(notifications) => change({ notifications })} /></label>
      <Button variant="outline" onClick={async () => { if (!('Notification' in window)) return void toast.error('Browser notifications are unavailable here.'); const permission = await Notification.requestPermission(); toast(permission === 'granted' ? 'Browser notifications enabled' : 'Browser notifications not enabled'); }}>Enable browser notifications</Button>
      <div className="flex flex-wrap gap-2">{['chime', 'bell', 'pop', 'silent', ...(prefs.customSound ? ['custom'] : [])].map((sound) => <Button key={sound} size="sm" variant={prefs.sound === sound ? 'default' : 'outline'} onClick={() => change({ sound })}>{sound}</Button>)}</div>
      <label className="block space-y-2 text-sm">Volume<Slider aria-label="Notification volume" value={[prefs.volume]} min={0} max={1} step={0.01} onValueChange={([volume]) => change({ volume: volume ?? 0.4 })} /></label>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void playNotification(prefs)}>Preview sound</Button>
      <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-3 py-2 text-sm">Upload sound<input type="file" accept="audio/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file || !user) return; if (!file.type.startsWith('audio/')) return void toast.error('Pick an audio file.'); try { const path = await uploadFile(user.id, file, file.name); change({ customSound: path, sound: 'custom' }); toast.success('Notification sound saved'); } catch (error) { toast.error((error as Error).message); } }} /></label></div>
    </section>
    <section className="space-y-3"><h3 className="font-semibold">Website style</h3><div className="flex flex-wrap gap-2">{[{ id: 'original', name: 'Original' }, { id: 'light', name: 'Daylight' }, { id: 'forest', name: 'Forest' }, { id: 'contrast', name: 'High contrast' }].map((theme) => <Button key={theme.id} variant={prefs.theme === theme.id ? 'default' : 'outline'} onClick={() => change({ theme: theme.id })}>{theme.name}</Button>)}</div></section>
  </div>;
}
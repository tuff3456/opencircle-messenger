import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { db, uploadFile, type Conversation } from '@/lib/db';
import { canEditAppearance } from '@/lib/chat-permissions';
import { useAuth } from '@/lib/auth';
import { useSigned } from './Media';

export function ChatAppearance({ conv, member, onSaved }: { conv: Conversation; member: boolean; onSaved: (conv: Conversation) => void }) {
  const { user, isAdmin } = useAuth();
  const [name, setName] = useState(conv.name ?? '');
  const [busy, setBusy] = useState(false);
  const cover = useSigned(conv.avatar_url);
  const background = useSigned(conv.background_url);
  useEffect(() => { setName(conv.name ?? ''); }, [conv.name]);
  const me = user?.id ?? '';
  const manage = isAdmin || (conv.is_group && conv.created_by === me);
  const allowed = (field: 'name' | 'cover' | 'background') => canEditAppearance(conv, me, member, isAdmin, field);
  async function save(fields: Partial<Conversation>) {
    setBusy(true);
    try {
      const { data, error } = await db.from('conversations').update(fields).eq('id', conv.id).select('*').single();
      if (error) throw error;
      onSaved(data); toast.success('Chat settings saved');
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function image(field: 'avatar_url' | 'background_url', file?: File) {
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) return void toast.error('Choose an image.');
    setBusy(true);
    try { const path = await uploadFile(user.id, file, file.name); await save({ [field]: path }); }
    catch (e) { toast.error((e as Error).message); setBusy(false); }
  }
  return <div className="space-y-5">
    <section className="space-y-2">
      <label className="text-sm font-semibold" htmlFor="chat-name">Chat name</label>
      <div className="flex gap-2"><Input id="chat-name" value={name} disabled={!allowed('name') || busy} onChange={e => setName(e.target.value)} /><Button disabled={!allowed('name') || busy || !name.trim()} onClick={() => void save({ name: name.trim() })}>Save name</Button></div>
    </section>
    {(['cover', 'background'] as const).map(field => {
      const pathField = field === 'cover' ? 'avatar_url' : 'background_url';
      const url = field === 'cover' ? cover : background;
      return <section key={field} className="space-y-2">
        <h3 className="text-sm font-semibold capitalize">Chat {field}</h3>
        {url && <img src={url} alt={`Chat ${field}`} className="h-28 w-full object-cover rounded-md" />}
        <div className="flex gap-2">
          <Button variant="outline" disabled={!allowed(field) || busy} onClick={() => document.getElementById(`chat-${field}-upload`)?.click()}><ImagePlus className="size-4" /> Change {field}</Button>
          <input id={`chat-${field}-upload`} aria-label={`Upload chat ${field}`} type="file" accept="image/*" hidden disabled={!allowed(field) || busy} onChange={e => { void image(pathField, e.target.files?.[0]); e.target.value = ''; }} />
          {conv[pathField] && <Button variant="ghost" size="icon" aria-label={`Remove chat ${field}`} title={`Remove ${field}`} disabled={!allowed(field) || busy} onClick={() => void save({ [pathField]: null })}><Trash2 className="size-4" /></Button>}
        </div>
      </section>;
    })}
    {manage && conv.is_group && <section className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Member permissions</h3>
      {([{ key: 'members_edit_name', label: 'Members can change the name' }, { key: 'members_edit_cover', label: 'Members can change the cover' }, { key: 'members_edit_background', label: 'Members can change the background' }] as const).map(({ key, label }) => <label key={key} className="flex items-center justify-between gap-4 text-sm">{label}<Switch aria-label={label} checked={Boolean(conv[key])} disabled={busy} onCheckedChange={value => void save({ [key]: value })} /></label>)}
      <label className="flex items-center justify-between gap-4 text-sm">Private group<Switch aria-label="Private group" checked={conv.is_private} disabled={busy} onCheckedChange={value => void save({ is_private: value })} /></label>
    </section>}
  </div>;
}
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolvePasswordRequest } from '@/lib/accounts.functions';
export type PasswordTarget = { id: string; name: string; requestId?: string };
export function AdminPasswordDialog({ target, onClose, onDone }: { target: PasswordTarget | null; onClose: () => void; onDone: () => void }) {
  const reset = useServerFn(resolvePasswordRequest); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (reject: boolean) => {
    if (!target) return;
    if (!reject && (password.length < 8 || password !== confirm)) return void toast.error('Enter matching passwords of at least 8 characters.');
    setBusy(true);
    try { await reset({ data: { targetId: target.id, ...(target.requestId ? { requestId: target.requestId } : {}), ...(reject ? { reject: true } : { password, reject: false }) } }); setPassword(''); setConfirm(''); toast.success(reject ? 'Application rejected' : 'Password changed — share it privately with the account owner'); onClose(); onDone(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  };
  return <Dialog open={!!target} onOpenChange={(open) => { if (!open) { setPassword(''); setConfirm(''); onClose(); } }}><DialogContent><DialogHeader><DialogTitle>Change password: {target?.name}</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Confirm the account owner's identity before resetting their password.</p>
    <Input aria-label="Admin new password" type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <Input aria-label="Admin confirm password" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit(false)}>Set password</Button>{target?.requestId && <Button disabled={busy} variant="outline" onClick={() => void submit(true)}>Reject application</Button>}</div>
  </DialogContent></Dialog>;
}
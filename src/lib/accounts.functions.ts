import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { canResetPassword } from './preferences';

export const resolvePasswordRequest = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid().optional(), targetId: z.string().uuid(), password: z.string().min(8).optional(), reject: z.boolean().default(false) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin, error } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
    if (error || !canResetPassword(!!admin, context.userId, data.targetId)) throw new Error('Only an admin can reset another account. Use your profile settings for your own password.');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    if (data.requestId) {
      const { data: request } = await supabaseAdmin.from('password_requests').select('*').eq('id', data.requestId).eq('user_id', data.targetId).eq('status', 'pending').maybeSingle();
      if (!request) throw new Error('This application is no longer pending.');
    }
    if (!data.reject) {
      if (!data.password) throw new Error('Enter a new password.');
      const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(data.targetId, { password: data.password });
      if (resetError) throw new Error(resetError.message);
    }
    if (data.requestId) {
      const { error: updateError } = await supabaseAdmin.from('password_requests').update({ status: data.reject ? 'rejected' : 'approved' }).eq('id', data.requestId);
      if (updateError) throw new Error(updateError.message);
    }
    return { success: true };
  });
import { describe, expect, it } from 'vitest';
import { canResetPassword, isOnline } from '@/lib/preferences';
describe('Communication account rules', () => {
  it('only admins can reset another account', () => {
    expect(canResetPassword(false, 'member', 'other')).toBe(false);
    expect(canResetPassword(true, 'admin', 'other')).toBe(true);
  });
  it('admin self-service uses the current-password flow', () => {
    expect(canResetPassword(true, 'admin', 'admin')).toBe(false);
  });
  it('shows active users online and stale users offline', () => {
    const now = Date.parse('2026-11-20T02:00:00Z');
    expect(isOnline('2026-11-20T01:59:35Z', now)).toBe(true);
    expect(isOnline('2026-11-20T01:58:00Z', now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});
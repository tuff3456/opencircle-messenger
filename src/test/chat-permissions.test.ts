import { describe, expect, it } from 'vitest';
import { canEditAppearance } from '@/lib/chat-permissions';
import type { Conversation } from '@/lib/db';
import { convTitle } from '@/components/app/ChatView';
const group: Conversation = { id: 'chat', name: 'Group', is_group: true, is_private: true, avatar_url: null, created_by: 'owner', created_at: '', last_message_at: '', members_edit_name: false, members_edit_cover: false, members_edit_background: false };
describe('Chat appearance permissions', () => {
  it('uses the shared custom name for a DM', () => {
    expect(convTitle({ ...group, is_group: false, name: 'Shared DM name' }, [], 'other')).toBe('Shared DM name');
  });
  it('lets the creator edit all three details regardless of member permissions', () => {
    for (const field of ['name', 'cover', 'background'] as const) expect(canEditAppearance(group, 'owner', true, false, field)).toBe(true);
  });
  it('keeps name, cover, and background locked separately until the creator allows each', () => {
    for (const [field, key] of [['name', 'members_edit_name'], ['cover', 'members_edit_cover'], ['background', 'members_edit_background']] as const) {
      expect(canEditAppearance(group, 'member', true, false, field)).toBe(false);
      expect(canEditAppearance({ ...group, [key]: true }, 'member', true, false, field)).toBe(true);
      expect(canEditAppearance({ ...group, [key]: true }, 'outsider', false, false, field)).toBe(false);
    }
  });
  it('lets both DM participants edit the name, cover and background', () => {
    for (const person of ['owner', 'other']) for (const field of ['name', 'cover', 'background'] as const) expect(canEditAppearance({ ...group, is_group: false }, person, true, false, field)).toBe(true);
    expect(canEditAppearance({ ...group, is_group: false }, 'outsider', false, false, 'name')).toBe(false);
  });
});
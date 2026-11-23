import type { Conversation } from './db';

export type AppearanceField = 'name' | 'cover' | 'background';
export function canEditAppearance(conv: Conversation, userId: string, member: boolean, admin: boolean, field: AppearanceField): boolean {
  if (admin || (conv.is_group && conv.created_by === userId)) return true;
  if (!member) return false;
  if (!conv.is_group) return true;
  return Boolean(conv[field === 'name' ? 'members_edit_name' : field === 'cover' ? 'members_edit_cover' : 'members_edit_background']);
}
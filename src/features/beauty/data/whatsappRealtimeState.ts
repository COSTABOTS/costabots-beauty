import type { WhatsAppConversation } from './whatsappService';

export function sortWhatsAppConversations(items: WhatsAppConversation[]) {
  return [...items].sort((left, right) =>
    (right.last_message_at ?? '').localeCompare(left.last_message_at ?? ''));
}

export function upsertWhatsAppConversation(
  items: WhatsAppConversation[],
  incoming: WhatsAppConversation,
) {
  if (!incoming.active) return items.filter((item) => item.id !== incoming.id);
  const next = items.some((item) => item.id === incoming.id)
    ? items.map((item) => item.id === incoming.id ? incoming : item)
    : [...items, incoming];
  return sortWhatsAppConversations(next);
}

export function totalUnreadConversations(items: WhatsAppConversation[]) {
  return items.reduce((total, item) => total + Math.max(0, item.unread_count || 0), 0);
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadWhatsAppConversations, type WhatsAppConversation } from './whatsappService';
import { sortWhatsAppConversations, totalUnreadConversations, upsertWhatsAppConversation } from './whatsappRealtimeState';

const POLL_INTERVAL_MS = 45_000;

export function useWhatsAppConversations(businessId: string, enabled: boolean) {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const requestId = useRef(0);

  const reload = useCallback(async (showLoading = false) => {
    if (!enabled) return;
    const currentRequest = ++requestId.current;
    if (showLoading) setLoading(true);
    try {
      const next = await loadWhatsAppConversations(businessId);
      if (currentRequest !== requestId.current) return;
      setConversations(sortWhatsAppConversations(next));
      setError('');
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : 'No hemos podido cargar las conversaciones.');
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [businessId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setConversations([]);
      setLoading(false);
      return;
    }
    void reload(true);
    const channel = supabase.channel(`beauty-conversations:${businessId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'beauty_conversations', filter: `business_id=eq.${businessId}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id?: string }).id;
          if (deletedId) setConversations((current) => current.filter((item) => item.id !== deletedId));
          return;
        }
        const incoming = payload.new as WhatsAppConversation;
        if (incoming.business_id === businessId) {
          setConversations((current) => upsertWhatsAppConversation(current, incoming));
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void reload();
      });
    const interval = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      requestId.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [businessId, enabled, reload]);

  return {
    conversations,
    error,
    loading,
    reload,
    unreadCount: useMemo(() => totalUnreadConversations(conversations), [conversations]),
  };
}

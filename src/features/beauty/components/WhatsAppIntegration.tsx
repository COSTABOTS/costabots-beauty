import { ArrowLeft, CheckCircle2, MessageCircle, RefreshCw, Send, ShieldCheck, Smartphone, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import type { Customer } from '../types';
import {
  disconnectWhatsApp,
  loadWhatsAppConnection,
  loadWhatsAppMessages,
  markConversationRead,
  provisionWhatsApp,
  refreshWhatsAppStatus,
  releaseConversation,
  requestWhatsAppQr,
  sendWhatsAppMessage,
  takeConversation,
  type WhatsAppConnection,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from '../data/whatsappService';
import { FeatureStateBadge, PageHeader } from './ui';

const statusLabels: Record<WhatsAppConnection['status'], string> = {
  not_provisioned: 'No conectado',
  provisioning: 'Preparando',
  awaiting_qr: 'Esperando QR',
  connecting: 'Conectando',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
};

const emptyConnection: WhatsAppConnection = {
  status: 'not_provisioned', phoneNumber: null, displayName: null, connectedAt: null, error: null,
};

function conversationDisplayName(conversation: WhatsAppConversation, customerName?: string | null) {
  if (customerName?.trim()) return customerName.trim();
  if (conversation.contact_name?.trim()) return conversation.contact_name.trim();
  const phone = conversation.remote_phone_normalized?.replace(/\D/g, '') ?? '';
  if (phone) return `••• ${phone.slice(-4)}`;
  return 'Contacto de WhatsApp';
}

export function WhatsAppSettings({
  businessId,
  canManage,
  enabled,
}: {
  businessId: string;
  canManage: boolean;
  enabled: boolean;
}) {
  const [connection, setConnection] = useState(emptyConnection);
  const [loading, setLoading] = useState(enabled);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try { setConnection(await loadWhatsAppConnection(businessId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No hemos podido consultar WhatsApp.'); }
    finally { setLoading(false); }
  }, [businessId, enabled]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<WhatsAppConnection>) {
    setWorking(true); setError('');
    try { setConnection(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No hemos podido completar la operación.'); }
    finally { setWorking(false); }
  }

  async function generateQr() {
    setWorking(true); setError('');
    try {
      const result = await requestWhatsAppQr(businessId);
      setQr(result.qr);
      setConnection((current) => ({ ...current, status: 'awaiting_qr' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No hemos podido generar el QR.');
    } finally { setWorking(false); }
  }

  if (!enabled) return <section className="configuration-section whatsapp-settings">
    <div className="whatsapp-section-title"><MessageCircle /><span><h2>WhatsApp</h2><FeatureStateBadge state="soon" /></span></div>
    <p>La base segura está preparada, pero la integración permanece desactivada en este entorno.</p>
  </section>;

  return <section className="configuration-section whatsapp-settings">
    <div className="whatsapp-section-title"><MessageCircle /><span><h2>WhatsApp</h2><small className={`wa-status wa-status--${connection.status}`}>{statusLabels[connection.status]}</small></span></div>
    <p>Conecta exclusivamente un número comercial o dedicado al negocio. La Agenda funciona aunque WhatsApp no esté conectado.</p>
    {loading ? <p className="inline-data-message">Consultando conexión…</p> : <>
      {connection.phoneNumber && <div className="whatsapp-connected-number"><CheckCircle2 /><span><strong>{connection.displayName || 'WhatsApp del negocio'}</strong><small>+{connection.phoneNumber}</small></span></div>}
      {connection.error && <p className="form-error">{connection.error.message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!connection.id && <button className="form-submit" disabled={!canManage || working} onClick={() => void run(() => provisionWhatsApp(businessId))} type="button">{working ? 'Preparando…' : 'Preparar conexión'}</button>}
      {connection.id && connection.status !== 'connected' && <>
        <label className="whatsapp-consent"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>Confirmo que este número se utiliza para el negocio y que tengo autorización para conectarlo.</span></label>
        <div className="whatsapp-setting-actions">
          <button disabled={!canManage || !confirmed || working} onClick={() => void generateQr()} type="button">{qr ? 'Generar otro código' : 'Generar código QR'}</button>
          <button disabled={working} onClick={() => void run(() => refreshWhatsAppStatus(businessId))} type="button"><RefreshCw />Actualizar estado</button>
        </div>
      </>}
      {qr && <div className="whatsapp-qr">
        {qr.startsWith('data:image') || qr.startsWith('http') ? <img alt="Código QR temporal para vincular WhatsApp" src={qr} /> : <code>{qr}</code>}
        <span><strong>En tu teléfono</strong><small>WhatsApp → Dispositivos vinculados → Vincular dispositivo</small></span>
      </div>}
      {connection.status === 'connected' && <div className="whatsapp-setting-actions">
        <button disabled={working} onClick={() => void run(() => refreshWhatsAppStatus(businessId))} type="button"><RefreshCw />Actualizar estado</button>
        <button className="danger-inline" disabled={!canManage || working} onClick={() => {
          if (window.confirm('¿Desconectar WhatsApp? Las conversaciones y mensajes se conservarán.')) void run(() => disconnectWhatsApp(businessId));
        }} type="button"><Unplug />Desconectar</button>
      </div>}
    </>}
  </section>;
}

export function SupabaseWhatsAppInbox({
  businessId,
  conversations,
  conversationsError,
  conversationsLoading,
  customers,
  enabled,
  onBack,
  reloadConversations,
}: {
  businessId: string;
  conversations: WhatsAppConversation[];
  conversationsError: string;
  conversationsLoading: boolean;
  customers: Customer[];
  enabled: boolean;
  onBack?: () => void;
  reloadConversations: (showLoading?: boolean) => Promise<void>;
}) {
  const [connection, setConnection] = useState(emptyConnection);
  const [selected, setSelected] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [error, setError] = useState('');
  const [messageLimit, setMessageLimit] = useState(50);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const messageRequestId = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected?.id]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setError('');
    try {
      const [nextConnection] = await Promise.all([
        loadWhatsAppConnection(businessId),
        reloadConversations(true),
      ]);
      setConnection(nextConnection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No hemos podido cargar Mensajes.');
    }
  }, [businessId, enabled, reloadConversations]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    setSelected((current) => current
      ? conversations.find((item) => item.id === current.id) ?? null
      : null);
  }, [conversations]);

  const reloadMessages = useCallback(async (conversationId: string, limit: number) => {
    const requestId = ++messageRequestId.current;
    const items = await loadWhatsAppMessages(conversationId, limit);
    if (requestId === messageRequestId.current && selectedIdRef.current === conversationId) setMessages(items);
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const canMarkRead = document.visibilityState === 'visible';
    void Promise.all([
      reloadMessages(selected.id, messageLimit),
      canMarkRead ? markConversationRead(selected.id).then(() => reloadConversations()) : Promise.resolve(),
    ])
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'No hemos podido abrir la conversación.'));
  }, [messageLimit, reloadConversations, reloadMessages, selected?.id]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel(`beauty-messages:${businessId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'beauty_messages', filter: `business_id=eq.${businessId}`,
      }, (payload) => {
        const row = (payload.new ?? payload.old) as Partial<WhatsAppMessage>;
        const openConversationId = selectedIdRef.current;
        if (!openConversationId || row.conversation_id !== openConversationId) return;
        void reloadMessages(openConversationId, messageLimit).catch(() => undefined);
        if (payload.eventType === 'INSERT' && row.direction === 'inbound' && document.visibilityState === 'visible') {
          void markConversationRead(openConversationId).then(() => reloadConversations()).catch(() => undefined);
        }
      })
      .subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && selectedIdRef.current) {
          void reloadMessages(selectedIdRef.current, messageLimit).catch(() => undefined);
        }
      });
    const onVisibility = () => {
      const openConversationId = selectedIdRef.current;
      if (document.visibilityState === 'visible' && openConversationId) {
        void Promise.all([
          reloadMessages(openConversationId, messageLimit),
          markConversationRead(openConversationId).then(() => reloadConversations()),
        ]).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      messageRequestId.current += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [businessId, enabled, messageLimit, reloadConversations, reloadMessages]);

  const visible = useMemo(() => conversations.filter((item) => filter === 'all' || item.needs_attention), [conversations, filter]);
  const customer = selected?.customer_id ? customers.find((item) => item.id === selected.customer_id) : null;

  async function mutate(action: () => Promise<unknown>) {
    setWorking(true); setError('');
    try { await action(); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No hemos podido completar la operación.'); }
    finally { setWorking(false); }
  }

  if (!enabled) return <div className="beauty-page"><PageHeader eyebrow="WhatsApp" title="Mensajes" action={<FeatureStateBadge state="soon" />} /><div className="empty-state"><ShieldCheck /><h2>WhatsApp todavía no está activo</h2><p>La integración segura debe habilitarse expresamente en un entorno Supabase.</p></div></div>;
  if (selected) return <div className="beauty-page whatsapp-conversation-page">
    <PageHeader eyebrow={selected.mode === 'manual' ? 'Atención manual' : 'Automatización preparada'} title={conversationDisplayName(selected, customer?.name)} action={<button className="icon-button-soft" onClick={() => setSelected(null)} type="button"><ArrowLeft /></button>} />
    {connection.status !== 'connected' && <div className="whatsapp-disconnected"><Unplug /><span><strong>WhatsApp desconectado</strong><small>El historial sigue disponible, pero no puedes enviar mensajes.</small></span></div>}
    {error && <p className="form-error">{error}</p>}
    <div className="whatsapp-handoff">
      {selected.mode === 'ai'
        ? <button disabled={working} onClick={() => void mutate(() => takeConversation(selected.id))} type="button">Tomar conversación</button>
        : <button disabled={working} onClick={() => {
          if (window.confirm('La IA todavía no está activa. La conversación quedará preparada para automatización.')) void mutate(() => releaseConversation(selected.id));
        }} type="button">Devolver a la IA</button>}
      <small>{selected.mode === 'ai' ? 'No se enviarán respuestas automáticas hasta conectar la IA.' : 'Los mensajes los atiende ahora una persona.'}</small>
    </div>
    <div className="whatsapp-message-history">
      {messages.length >= messageLimit && <button className="load-older" onClick={() => setMessageLimit((value) => value + 50)} type="button">Cargar anteriores</button>}
      {messages.map((message) => <article className={`whatsapp-bubble whatsapp-bubble--${message.direction}`} key={message.id}><p>{message.text_content || 'Contenido no compatible'}</p><small>{new Date(message.sent_at).toLocaleString('es-ES')} · {message.status}</small></article>)}
      {!messages.length && <p className="inline-data-message">Esta conversación todavía no tiene mensajes visibles.</p>}
    </div>
    <form className="whatsapp-composer" onSubmit={(event) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) return;
      void mutate(() => sendWhatsAppMessage(businessId, selected.id, text)).then(() => { setDraft(''); return reloadMessages(selected.id, messageLimit); });
    }}>
      <textarea disabled={selected.mode !== 'manual' || connection.status !== 'connected' || working} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder={selected.mode === 'manual' ? 'Escribe un mensaje…' : 'Toma la conversación para responder'} value={draft} />
      <button aria-label="Enviar mensaje" disabled={!draft.trim() || selected.mode !== 'manual' || connection.status !== 'connected' || working} type="submit"><Send /></button>
    </form>
  </div>;

  return <div className="beauty-page whatsapp-inbox-page">
    <PageHeader eyebrow="WhatsApp" title="Mensajes" action={<div className="heading-actions"><button aria-label="Actualizar" className="icon-button-soft" onClick={() => void reload()} type="button"><RefreshCw /></button>{onBack && <button aria-label="Volver" className="icon-button-soft" onClick={onBack} type="button"><ArrowLeft /></button>}</div>} />
    <div className="conversation-tabs"><button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')} type="button">Todas</button><button className={filter === 'attention' ? 'is-active' : ''} onClick={() => setFilter('attention')} type="button">Necesitan atención</button></div>
    {conversationsLoading && <p className="inline-data-message">Cargando conversaciones…</p>}
    {(error || conversationsError) && <div className="empty-state"><ShieldCheck /><h2>No se ha podido cargar</h2><p>{error || conversationsError}</p><button onClick={() => void reload()} type="button">Reintentar</button></div>}
    {!conversationsLoading && !error && !conversationsError && !visible.length && <div className="empty-state"><Smartphone /><h2>Aún no hay conversaciones</h2><p>Cuando llegue un mensaje por WhatsApp aparecerá aquí.</p></div>}
    <div className="conversation-list">{visible.map((conversation) => {
      const linkedCustomer = conversation.customer_id
        ? customers.find((item) => item.id === conversation.customer_id)
        : null;
      return <button key={conversation.id} onClick={() => { setMessageLimit(50); setSelected(conversation); }} type="button"><span className="conversation-avatar"><MessageCircle /></span><span><strong>{conversationDisplayName(conversation, linkedCustomer?.name)}</strong><small>{conversation.last_message_preview || 'Sin vista previa'}</small></span><span className="conversation-meta"><small>{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}</small>{conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}<em>{conversation.needs_attention ? 'Necesita atención' : conversation.mode === 'manual' ? 'Atención manual' : 'IA atendiendo'}</em></span></button>;
    })}</div>
  </div>;
}

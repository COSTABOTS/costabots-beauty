import { Check, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BeautyService, StaffMember } from '../types';
import type { ImportServiceItem, ImportServicesResult } from '../data/types';
import {
  normalizeServiceName,
  recommendedTemplate,
  serviceDurationOptions,
  serviceTemplateLabels,
  serviceTemplates,
  type ServiceTemplateKey,
} from '../data/serviceTemplates';

type EditableSuggestion = ImportServiceItem & { selected: boolean };

function suggestionsFor(template: ServiceTemplateKey): EditableSuggestion[] {
  return serviceTemplates[template].map((item) => ({
    clientId: item.id,
    name: item.name,
    durationMinutes: item.durationMinutes,
    price: item.price,
    duplicateAction: 'omit',
    selected: true,
  }));
}

export function ServiceTemplateImporter({
  businessType,
  currency,
  existingServices,
  onClose,
  onImport,
  staff,
}: {
  businessType: 'nail_salon' | 'hair_salon' | 'beauty_center' | 'other';
  currency: string;
  existingServices: BeautyService[];
  onClose: () => void;
  onImport: (services: ImportServiceItem[]) => Promise<ImportServicesResult>;
  staff: StaffMember[];
}) {
  const recommended = recommendedTemplate(businessType);
  const [template, setTemplate] = useState<ServiceTemplateKey | null>(businessType === 'other' ? null : recommended);
  const [rows, setRows] = useState<EditableSuggestion[]>(() => businessType === 'other' ? [] : suggestionsFor(recommended));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportServicesResult | null>(null);
  const existingNames = useMemo(
    () => new Set(existingServices.filter((item) => item.active !== false).map((item) => normalizeServiceName(item.name))),
    [existingServices],
  );
  const selected = rows.filter((row) => row.selected);
  const activeStaff = staff.filter((item) => item.active !== false);
  const setRow = (clientId: string, patch: Partial<EditableSuggestion>) => setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, ...patch } : row));
  const loadTemplate = (key: ServiceTemplateKey) => {
    setTemplate(key);
    setRows(suggestionsFor(key));
    setResult(null);
    setError('');
  };
  const validate = () => {
    if (!selected.length) return 'Selecciona al menos un servicio.';
    if (selected.some((row) => !row.name.trim())) return 'Todos los servicios necesitan un nombre.';
    if (selected.some((row) => !serviceDurationOptions.includes(row.durationMinutes))) return 'Selecciona una duración válida.';
    if (selected.some((row) => !Number.isFinite(row.price) || row.price < 0)) return 'Revisa los precios sugeridos.';
    if (selected.some((row) => existingNames.has(normalizeServiceName(row.name)) && row.duplicateAction === 'new')) return 'Edita el nombre de los duplicados que quieras importar como nuevos.';
    return '';
  };
  return <div className="template-importer" role="dialog" aria-modal="true" aria-label="Usar plantilla de servicios">
    <header><span><small>Servicios iniciales</small><h2>Usar una plantilla</h2></span><button aria-label="Cerrar plantillas" onClick={onClose} type="button"><X /></button></header>
    <p className="template-intro">Los precios y duraciones son sugerencias editables. Revisa todo antes de importar.</p>
    {businessType === 'other' && <p className="template-other-note">Tu tipo de negocio no carga servicios automáticamente. Elige una plantilla como punto de partida o vuelve para crear uno manualmente.</p>}
    <div className="template-picker">{(Object.keys(serviceTemplates) as ServiceTemplateKey[]).map((key) => <button className={template === key ? 'is-active' : ''} key={key} onClick={() => loadTemplate(key)} type="button"><span>{serviceTemplateLabels[key]}</span>{key === recommended && businessType !== 'other' && <small>Recomendada</small>}</button>)}</div>
    <div className="template-summary"><strong>{selected.length} de {rows.length} seleccionados</strong><span><button disabled={!rows.length} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: true })))} type="button">Seleccionar todos</button><button disabled={!rows.length} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))} type="button">Desmarcar todos</button><button disabled={!template} onClick={() => { if (template) loadTemplate(template); }} type="button"><RotateCcw size={14} />Restaurar</button></span></div>
    {rows.length === 0 && <div className="empty-state empty-state--compact"><Sparkles /><h2>Elige una plantilla para empezar</h2><p>También puedes volver y crear el primer servicio manualmente.</p></div>}
    <div className="template-rows">{rows.map((row) => {
      const duplicate = existingNames.has(normalizeServiceName(row.name));
      return <article className={!row.selected ? 'is-unselected' : ''} key={row.clientId}>
        <label className="template-select"><input checked={row.selected} onChange={(event) => setRow(row.clientId, { selected: event.target.checked })} type="checkbox" /><span>Incluir</span></label>
        <label className="template-name"><span>Nombre</span><input disabled={!row.selected} maxLength={160} onChange={(event) => setRow(row.clientId, { name: event.target.value })} value={row.name} /></label>
        <div className="template-values"><label><span>Duración</span><select disabled={!row.selected} onChange={(event) => setRow(row.clientId, { durationMinutes: Number(event.target.value) })} value={row.durationMinutes}>{serviceDurationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></label><label><span>Precio sugerido · {currency}</span><input disabled={!row.selected} min={0} max={999999.99} onChange={(event) => setRow(row.clientId, { price: Number(event.target.value) })} step=".01" type="number" value={row.price} /></label></div>
        {duplicate && row.selected && <label className="duplicate-choice"><span>Servicio duplicado</span><select onChange={(event) => setRow(row.clientId, { duplicateAction: event.target.value as ImportServiceItem['duplicateAction'] })} value={row.duplicateAction}><option value="omit">Omitir duplicado</option><option value="replace">Sustituir datos del existente</option><option value="new">Importar como nuevo con nombre editado</option></select></label>}
      </article>;
    })}</div>
    <button className="template-add-row" onClick={() => setRows((current) => [...current, { clientId: `manual-${Date.now()}`, name: '', durationMinutes: 60, price: 0, duplicateAction: 'omit', selected: true }])} type="button"><Plus size={16} />Añadir fila manual</button>
    {activeStaff.length === 1 && <p className="template-assignment-note"><Sparkles size={16} />Los servicios se asignarán automáticamente a {activeStaff[0].name}.</p>}
    {activeStaff.length > 1 && <p className="template-assignment-note">Hay varias personas activas. Los servicios se importarán sin asignarlos automáticamente.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <p className="form-success"><Check size={16} />Creados: {result.created} · Omitidos: {result.omitted} · Actualizados: {result.replaced}</p>}
    <footer><button onClick={onClose} type="button">Cancelar</button><button disabled={saving || selected.length === 0} onClick={() => { const message = validate(); setError(message); if (message) return; setSaving(true); setResult(null); void onImport(selected.map(({ selected: _selected, ...service }) => service)).then(setResult).catch((cause) => setError(cause instanceof Error ? cause.message : 'No hemos podido importar los servicios.')).finally(() => setSaving(false)); }} type="button">{saving ? 'Importando…' : `Importar servicios (${selected.length})`}</button></footer>
  </div>;
}

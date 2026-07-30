export type ServiceTemplateKey = 'nail_salon' | 'hair_salon' | 'beauty_center';

export type ServiceTemplateSuggestion = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  category: string;
};

export const serviceTemplateLabels: Record<ServiceTemplateKey, string> = {
  nail_salon: 'Salón de uñas',
  hair_salon: 'Peluquería',
  beauty_center: 'Centro de estética',
};

export const serviceTemplates: Record<ServiceTemplateKey, ServiceTemplateSuggestion[]> = {
  nail_salon: [
    { id: 'nail-basic', name: 'Manicura básica', durationMinutes: 30, price: 18, category: 'nails' },
    { id: 'nail-semi', name: 'Manicura semipermanente', durationMinutes: 60, price: 28, category: 'nails' },
    { id: 'nail-remove-semi', name: 'Retirada de semipermanente', durationMinutes: 30, price: 10, category: 'nails' },
    { id: 'nail-gel', name: 'Uñas de gel', durationMinutes: 120, price: 45, category: 'nails' },
    { id: 'nail-gel-fill', name: 'Relleno de gel', durationMinutes: 90, price: 35, category: 'nails' },
    { id: 'nail-acrylic', name: 'Uñas acrílicas', durationMinutes: 120, price: 48, category: 'nails' },
    { id: 'nail-acrylic-fill', name: 'Relleno de acrílico', durationMinutes: 90, price: 38, category: 'nails' },
    { id: 'pedi-basic', name: 'Pedicura básica', durationMinutes: 45, price: 25, category: 'nails' },
    { id: 'pedi-semi', name: 'Pedicura semipermanente', durationMinutes: 60, price: 35, category: 'nails' },
    { id: 'nail-art', name: 'Decoración sencilla', durationMinutes: 15, price: 5, category: 'nails' },
  ],
  hair_salon: [
    { id: 'hair-woman', name: 'Corte mujer', durationMinutes: 45, price: 28, category: 'hair' },
    { id: 'hair-man', name: 'Corte hombre', durationMinutes: 30, price: 18, category: 'hair' },
    { id: 'hair-child', name: 'Corte infantil', durationMinutes: 30, price: 15, category: 'hair' },
    { id: 'hair-wash-style', name: 'Lavado y peinado', durationMinutes: 45, price: 25, category: 'hair' },
    { id: 'hair-dry', name: 'Secado', durationMinutes: 30, price: 16, category: 'hair' },
    { id: 'hair-root-color', name: 'Color raíz', durationMinutes: 90, price: 42, category: 'hair' },
    { id: 'hair-full-color', name: 'Color completo', durationMinutes: 120, price: 58, category: 'hair' },
    { id: 'hair-highlights', name: 'Mechas', durationMinutes: 150, price: 75, category: 'hair' },
    { id: 'hair-balayage', name: 'Balayage', durationMinutes: 180, price: 95, category: 'hair' },
    { id: 'hair-treatment', name: 'Tratamiento capilar', durationMinutes: 45, price: 30, category: 'hair' },
    { id: 'hair-updo', name: 'Recogido', durationMinutes: 60, price: 45, category: 'hair' },
  ],
  beauty_center: [
    { id: 'beauty-clean', name: 'Limpieza facial', durationMinutes: 60, price: 45, category: 'facial' },
    { id: 'beauty-facial', name: 'Tratamiento facial', durationMinutes: 75, price: 60, category: 'facial' },
    { id: 'beauty-brow-wax', name: 'Depilación de cejas', durationMinutes: 15, price: 10, category: 'brows' },
    { id: 'beauty-brow-design', name: 'Diseño de cejas', durationMinutes: 30, price: 20, category: 'brows' },
    { id: 'beauty-lash-lift', name: 'Lifting de pestañas', durationMinutes: 60, price: 45, category: 'lashes' },
    { id: 'beauty-lash-extension', name: 'Extensiones de pestañas', durationMinutes: 120, price: 75, category: 'lashes' },
    { id: 'beauty-massage', name: 'Masaje relajante', durationMinutes: 60, price: 50, category: 'body' },
    { id: 'beauty-face-wax', name: 'Depilación facial', durationMinutes: 30, price: 20, category: 'waxing' },
    { id: 'beauty-body-wax', name: 'Depilación corporal', durationMinutes: 60, price: 45, category: 'waxing' },
    { id: 'beauty-body', name: 'Tratamiento corporal', durationMinutes: 75, price: 65, category: 'body' },
  ],
};

export const serviceDurationOptions = [15, 30, 45, 60, 75, 90, 120, 150, 180];

export function recommendedTemplate(
  businessType: 'nail_salon' | 'hair_salon' | 'beauty_center' | 'other',
): ServiceTemplateKey {
  return businessType === 'other' ? 'nail_salon' : businessType;
}

export function normalizeServiceName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
}

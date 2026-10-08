export const beautyBusinessTypes = [
  'nail_salon',
  'hair_salon',
  'barber_shop',
  'beauty_center',
  'other',
] as const;

export type BeautyBusinessType = (typeof beautyBusinessTypes)[number];

export const beautyBusinessTypeLabels: Record<BeautyBusinessType, string> = {
  nail_salon: 'Salón de uñas',
  hair_salon: 'Peluquería',
  barber_shop: 'Barbería',
  beauty_center: 'Centro de estética',
  other: 'Otro',
};

export function isBeautyBusinessType(value: unknown): value is BeautyBusinessType {
  return typeof value === 'string' && beautyBusinessTypes.includes(value as BeautyBusinessType);
}

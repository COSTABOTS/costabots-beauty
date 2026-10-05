import type { BeautyBusinessType } from './businessProfile';

export type BusinessThemePreset = 'nails' | 'hair' | 'barber' | 'beauty' | 'neutral';

const themeByBusinessType: Record<BeautyBusinessType, BusinessThemePreset> = {
  nail_salon: 'nails',
  hair_salon: 'hair',
  barber_shop: 'barber',
  beauty_center: 'beauty',
  other: 'neutral',
};

export function resolveBusinessTheme(businessType: BeautyBusinessType | string): BusinessThemePreset {
  return themeByBusinessType[businessType as BeautyBusinessType] ?? 'neutral';
}

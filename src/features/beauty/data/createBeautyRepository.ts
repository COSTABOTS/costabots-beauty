import { beautyEnvironment } from '../../../config/environment';
import type { BeautyRepository } from './BeautyRepository';
import { mockBeautyRepository } from './mockBeautyRepository';
import { supabaseBeautyRepository } from './supabaseBeautyRepository';

export function createBeautyRepository(): BeautyRepository {
  return beautyEnvironment.dataMode === 'supabase'
    ? supabaseBeautyRepository
    : mockBeautyRepository;
}

export const beautyRepository = createBeautyRepository();

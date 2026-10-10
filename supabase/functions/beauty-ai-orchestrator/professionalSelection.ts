import type { OfferedProfessional, StaffPreference } from './bookingTypes.ts';

export type ProfessionalGate = {
  status: 'choosing_service' | 'choosing_professional' | 'choosing_date';
  staff_id: string | null;
  staff_preference: StaffPreference;
  offered_professionals: OfferedProfessional[];
};

// The server-sourced compatibility list is the only input. This keeps the
// conversational layer from inventing staff and makes the persisted state
// distinguish unasked, selected and explicitly indifferent preferences.
export function professionalGate(professionals: OfferedProfessional[]): ProfessionalGate {
  if (professionals.length === 1) {
    return {
      status: 'choosing_date',
      staff_id: professionals[0].staff_id,
      staff_preference: 'selected',
      offered_professionals: professionals,
    };
  }
  if (professionals.length > 1) {
    return {
      status: 'choosing_professional',
      staff_id: null,
      staff_preference: 'unasked',
      offered_professionals: professionals,
    };
  }
  return {
    status: 'choosing_service',
    staff_id: null,
    staff_preference: 'unasked',
    offered_professionals: [],
  };
}

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
export function professionalGate(professionals: OfferedProfessional[], selectedStaffId: string | null = null): ProfessionalGate {
  // A named professional is accepted only when its identifier came from the
  // server-side compatible list. This lets a compound service+professional
  // turn skip the redundant question without making Gemini authoritative.
  if (selectedStaffId && professionals.some((professional) => professional.staff_id === selectedStaffId)) {
    return {
      status: 'choosing_date',
      staff_id: selectedStaffId,
      staff_preference: 'selected',
      offered_professionals: professionals,
    };
  }
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

export function professionalClarificationGate(professionals: OfferedProfessional[]): ProfessionalGate {
  return {
    status: 'choosing_professional',
    staff_id: null,
    staff_preference: 'unasked',
    offered_professionals: professionals,
  };
}

import type { BeautyService } from '../types';
import type { StaffSchedule, StaffServiceAssignment, WeeklyScheduleSegmentInput } from '../data/types';

export type ServiceSelectionChange = {
  serviceId: string;
  durationMinutes: number | null;
  price: number | null;
  active: boolean;
};

/**
 * Produces only the writes necessary to move a professional from its persisted
 * assignments to the selection currently visible in the editor.  Durations and
 * prices are deliberately taken from the target's own assignment: copying a
 * selection must never silently overwrite its commercial customisations.
 */
export type StaffServiceDraft = { active: boolean; durationMinutes: number; price: number };

export function staffServiceChanges(
  staffId: string,
  services: BeautyService[],
  assignments: StaffServiceAssignment[],
  draft: Map<string, StaffServiceDraft>,
): ServiceSelectionChange[] {
  return services.flatMap((service) => {
    const assignment = assignments.find((item) => item.staffId === staffId && item.serviceId === service.id);
    const next = draft.get(service.id) ?? { active: false, durationMinutes: service.durationMinutes, price: service.price };
    const current = {
      active: assignment?.active ?? false,
      durationMinutes: assignment?.durationMinutes ?? service.durationMinutes,
      price: assignment?.price ?? service.price,
    };
    if (current.active === next.active && current.durationMinutes === next.durationMinutes && current.price === next.price) return [];
    return [{
      serviceId: service.id,
      active: next.active,
      durationMinutes: next.durationMinutes !== service.durationMinutes ? next.durationMinutes : null,
      price: next.price !== service.price ? next.price : null,
    }];
  });
}

export function activeServiceIds(staffId: string, assignments: StaffServiceAssignment[]) {
  return new Set(assignments.filter((item) => item.staffId === staffId && item.active).map((item) => item.serviceId));
}

/** Copies only the selection, retaining the target's duration and price draft. */
export function copyServiceSelectionToDraft(
  targetDraft: Map<string, StaffServiceDraft>,
  sourceStaffId: string,
  assignments: StaffServiceAssignment[],
) {
  const sourceActive = activeServiceIds(sourceStaffId, assignments);
  return new Map([...targetDraft].map(([serviceId, value]) => [serviceId, { ...value, active: sourceActive.has(serviceId) }]));
}

export function copiedScheduleDraft(staffId: string, schedules: StaffSchedule[]): WeeklyScheduleSegmentInput[] {
  return schedules.filter((item) => item.staffId === staffId && item.active).map((item) => ({
    dayOfWeek: item.dayOfWeek,
    start: item.start,
    end: item.end,
  }));
}

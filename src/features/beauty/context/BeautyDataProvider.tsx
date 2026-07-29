import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { beautyEnvironment } from '../../../config/environment';
import { beautyRepository } from '../data/createBeautyRepository';
import type {
  AvailabilityCommand,
  AvailabilitySlot,
  BeautyOperationalData,
  CreateAppointmentCommand,
  CreateTimeBlockCommand,
  DateRange,
  OperationalCounts,
  UpdateAppointmentStatusCommand,
} from '../data/types';
import { useBeautyBusiness } from './BeautyBusinessProvider';

type BeautyDataState =
  | { status: 'loading'; data: null; message: null }
  | { status: 'ready'; data: BeautyOperationalData; message: null }
  | { status: 'error'; data: null; message: string };

type BeautyDataContextValue = BeautyDataState & {
  mode: 'mock' | 'supabase';
  retry: () => void;
  loadAppointmentHistory: (appointmentId: string) => Promise<void>;
  counts: OperationalCounts | null;
  updateAppointmentStatus: (command: UpdateAppointmentStatusCommand) => Promise<void>;
  createTimeBlock: (command: CreateTimeBlockCommand) => Promise<void>;
  getAvailability: (command: AvailabilityCommand) => Promise<AvailabilitySlot[]>;
  createAppointment: (command: CreateAppointmentCommand) => Promise<string>;
};

const BeautyDataContext = createContext<BeautyDataContextValue | null>(null);

export const beautyDataRange: DateRange = {
  from: '2026-07-25',
  to: '2026-08-01',
};

export function BeautyDataProvider({ children }: PropsWithChildren) {
  const membership = useBeautyBusiness();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BeautyDataState>({ status: 'loading', data: null, message: null });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, message: null });
    void beautyRepository.getOperationalData(membership.business.id, beautyDataRange)
      .then((data) => {
        if (active) setState({ status: 'ready', data, message: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          data: null,
          message: error instanceof Error ? error.message : 'No hemos podido cargar los datos del negocio.',
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, membership.business.id]);

  const loadAppointmentHistory = useCallback(async (appointmentId: string) => {
    if (state.status !== 'ready') return;
    const current = state.data.appointments.find((appointment) => appointment.id === appointmentId);
    if (!current || current.historyLoaded || current.historyError) return;
    try {
      const history = await beautyRepository.getAppointmentEvents(
        membership.business.id,
        appointmentId,
        state.data.business.timezone,
      );
      setState((latest) => latest.status === 'ready' ? {
        ...latest,
        data: {
          ...latest.data,
          appointments: latest.data.appointments.map((appointment) => appointment.id === appointmentId
            ? { ...appointment, history, historyLoaded: true }
            : appointment),
        },
      } : latest);
    } catch {
      setState((latest) => latest.status === 'ready' ? {
        ...latest,
        data: {
          ...latest.data,
          appointments: latest.data.appointments.map((appointment) => appointment.id === appointmentId
            ? { ...appointment, historyError: true }
            : appointment),
        },
      } : latest);
    }
  }, [membership.business.id, state]);

  const counts = state.status === 'ready' ? {
    staff: state.data.staff.length,
    services: state.data.services.length,
    customers: state.data.customers.length,
    appointments: state.data.appointments.length,
  } : null;

  const refreshAfterWrite = useCallback(async () => {
    const data = await beautyRepository.getOperationalData(membership.business.id, beautyDataRange);
    setState({ status: 'ready', data, message: null });
  }, [membership.business.id]);

  const updateAppointmentStatus = useCallback(async (command: UpdateAppointmentStatusCommand) => {
    await beautyRepository.updateAppointmentStatus(membership.business.id, command);
    await refreshAfterWrite();
  }, [membership.business.id, refreshAfterWrite]);

  const createTimeBlock = useCallback(async (command: CreateTimeBlockCommand) => {
    if (state.status !== 'ready') return;
    await beautyRepository.createTimeBlock(membership.business.id, state.data.business.timezone, command);
    await refreshAfterWrite();
  }, [membership.business.id, refreshAfterWrite, state]);

  const getAvailability = useCallback((command: AvailabilityCommand) => (
    beautyRepository.getAvailability(membership.business.id, command)
  ), [membership.business.id]);

  const createAppointment = useCallback(async (command: CreateAppointmentCommand) => {
    const appointmentId = await beautyRepository.createAppointment(membership.business.id, command);
    await refreshAfterWrite();
    return appointmentId;
  }, [membership.business.id, refreshAfterWrite]);

  const value = useMemo<BeautyDataContextValue>(() => ({
    ...state,
    mode: beautyEnvironment.dataMode,
    retry: () => setAttempt((value) => value + 1),
    loadAppointmentHistory,
    counts,
    updateAppointmentStatus,
    createTimeBlock,
    getAvailability,
    createAppointment,
  }), [counts, createAppointment, createTimeBlock, getAvailability, loadAppointmentHistory, state, updateAppointmentStatus]);

  return <BeautyDataContext.Provider value={value}>{children}</BeautyDataContext.Provider>;
}

export function useBeautyData() {
  const value = useContext(BeautyDataContext);
  if (!value) throw new Error('useBeautyData debe utilizarse dentro de BeautyDataProvider.');
  return value;
}

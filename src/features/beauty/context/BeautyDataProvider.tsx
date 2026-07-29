import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { beautyEnvironment } from '../../../config/environment';
import { beautyRepository } from '../data/createBeautyRepository';
import type {
  AvailabilityCommand,
  AvailabilitySlot,
  BeautyOperationalData,
  BusinessProfileInput,
  CreateAppointmentCommand,
  CreateCustomerCommand,
  CreateServiceCommand,
  CreateStaffCommand,
  CreateTimeBlockCommand,
  CustomerHistory,
  DateRange,
  DeactivateCustomerCommand,
  DeactivateServiceCommand,
  DeactivateStaffCommand,
  OperationalCounts,
  ReplaceWeeklyScheduleCommand,
  SetStaffServiceCommand,
  UpdateAppointmentStatusCommand,
  UpdateAppointmentCommand,
  CancelAppointmentCommand,
  UpdateTimeBlockCommand,
  DeactivateTimeBlockCommand,
  UpdateCustomerCommand,
  UpdateServiceCommand,
  UpdateStaffCommand,
} from '../data/types';
import { useBeautyBusiness } from './BeautyBusinessProvider';
import { dateInTimeZone, dayRange, rangeContains, weekRange } from '../data/dateRange';

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
  updateAppointment: (command: UpdateAppointmentCommand) => Promise<string>;
  cancelAppointment: (command: CancelAppointmentCommand) => Promise<string>;
  updateTimeBlock: (command: UpdateTimeBlockCommand) => Promise<string>;
  deactivateTimeBlock: (command: DeactivateTimeBlockCommand) => Promise<string>;
  getCustomerHistory: (customerId: string) => Promise<CustomerHistory>;
  createCustomer: (command: CreateCustomerCommand) => Promise<string>;
  updateCustomer: (command: UpdateCustomerCommand) => Promise<string>;
  deactivateCustomer: (command: DeactivateCustomerCommand) => Promise<string>;
  createStaff: (command: CreateStaffCommand) => Promise<string>;
  updateStaff: (command: UpdateStaffCommand) => Promise<string>;
  deactivateStaff: (command: DeactivateStaffCommand) => Promise<string>;
  createService: (command: CreateServiceCommand) => Promise<string>;
  updateService: (command: UpdateServiceCommand) => Promise<string>;
  deactivateService: (command: DeactivateServiceCommand) => Promise<string>;
  setStaffService: (command: SetStaffServiceCommand) => Promise<string>;
  replaceWeeklySchedule: (command: ReplaceWeeklyScheduleCommand) => Promise<void>;
  updateBusinessProfile: (command: BusinessProfileInput) => Promise<string>;
  agendaRange: DateRange | null;
  agendaStatus: 'idle' | 'loading' | 'ready' | 'error';
  agendaMessage: string | null;
  loadAgendaRange: (range: DateRange) => Promise<void>;
  retryAgenda: () => void;
};

const BeautyDataContext = createContext<BeautyDataContextValue | null>(null);

export function BeautyDataProvider({ children }: PropsWithChildren) {
  const membership = useBeautyBusiness();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BeautyDataState>({ status: 'loading', data: null, message: null });
  const [agendaRange, setAgendaRange] = useState<DateRange | null>(null);
  const [agendaStatus, setAgendaStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [agendaMessage, setAgendaMessage] = useState<string | null>(null);
  const agendaRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, message: null });
    void beautyRepository.getBusiness(membership.business.id)
      .then(async (business) => {
        const range = weekRange(dateInTimeZone(business.timezone));
        const data = await beautyRepository.getOperationalData(membership.business.id, range);
        if (active) {
          setAgendaRange(range);
          setAgendaStatus('ready');
          setState({ status: 'ready', data, message: null });
        }
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

  const loadAgendaRange = useCallback(async (range: DateRange) => {
    if (state.status !== 'ready') return;
    const requestId = ++agendaRequestId.current;
    const timezone = state.data.business.timezone;
    const today = dateInTimeZone(timezone);
    setAgendaRange(range);
    setAgendaStatus('loading');
    setAgendaMessage(null);
    try {
      const [visible, todayData] = await Promise.all([
        beautyRepository.getAgendaRange(membership.business.id, range, timezone),
        rangeContains(range, today)
          ? Promise.resolve(null)
          : beautyRepository.getAgendaRange(membership.business.id, dayRange(today), timezone),
      ]);
      if (requestId !== agendaRequestId.current) return;
      const appointments = [...visible.appointments, ...(todayData?.appointments ?? [])];
      const appointmentServices = [...visible.appointmentServices, ...(todayData?.appointmentServices ?? [])];
      const timeBlocks = [...visible.timeBlocks, ...(todayData?.timeBlocks ?? [])];
      setState((latest) => latest.status === 'ready' ? {
        ...latest,
        data: {
          ...latest.data,
          appointments: [...new Map(appointments.map((item) => [item.id, item])).values()],
          appointmentServices: [...new Map(appointmentServices.map((item) => [item.id, item])).values()],
          timeBlocks: [...new Map(timeBlocks.map((item) => [item.id, item])).values()],
        },
      } : latest);
      setAgendaStatus('ready');
    } catch (error) {
      if (requestId !== agendaRequestId.current) return;
      setAgendaStatus('error');
      setAgendaMessage(error instanceof Error ? error.message : 'No hemos podido cargar este periodo.');
    }
  }, [membership.business.id, state]);

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

  const refreshAgendaAfterWrite = useCallback(async () => {
    if (state.status !== 'ready') return;
    const today = dateInTimeZone(state.data.business.timezone);
    await loadAgendaRange(agendaRange ?? weekRange(today));
  }, [agendaRange, loadAgendaRange, state]);

  const refreshAllAfterWrite = useCallback(async () => {
    if (state.status !== 'ready') return;
    const timezone = state.data.business.timezone;
    const today = dateInTimeZone(timezone);
    const range = agendaRange ?? weekRange(today);
    const [data, todayData] = await Promise.all([
      beautyRepository.getOperationalData(membership.business.id, range),
      rangeContains(range, today)
        ? Promise.resolve(null)
        : beautyRepository.getAgendaRange(membership.business.id, dayRange(today), timezone),
    ]);
    if (todayData) {
      data.appointments = [...new Map([...data.appointments, ...todayData.appointments].map((item) => [item.id, item])).values()];
      data.appointmentServices = [...new Map([...data.appointmentServices, ...todayData.appointmentServices].map((item) => [item.id, item])).values()];
      data.timeBlocks = [...new Map([...data.timeBlocks, ...todayData.timeBlocks].map((item) => [item.id, item])).values()];
    }
    setState({ status: 'ready', data, message: null });
  }, [agendaRange, membership.business.id, state]);

  const updateAppointmentStatus = useCallback(async (command: UpdateAppointmentStatusCommand) => {
    await beautyRepository.updateAppointmentStatus(membership.business.id, command);
    await refreshAgendaAfterWrite();
  }, [membership.business.id, refreshAgendaAfterWrite]);

  const createTimeBlock = useCallback(async (command: CreateTimeBlockCommand) => {
    if (state.status !== 'ready') return;
    await beautyRepository.createTimeBlock(membership.business.id, state.data.business.timezone, command);
    await refreshAgendaAfterWrite();
  }, [membership.business.id, refreshAgendaAfterWrite, state]);

  const getAvailability = useCallback((command: AvailabilityCommand) => (
    beautyRepository.getAvailability(membership.business.id, command)
  ), [membership.business.id]);

  const createAppointment = useCallback(async (command: CreateAppointmentCommand) => {
    const appointmentId = await beautyRepository.createAppointment(membership.business.id, command);
    await refreshAgendaAfterWrite();
    return appointmentId;
  }, [membership.business.id, refreshAgendaAfterWrite]);
  const updateAppointment = useCallback(async (command: UpdateAppointmentCommand) => { const id=await beautyRepository.updateAppointment(membership.business.id,command); await refreshAgendaAfterWrite(); return id; },[membership.business.id,refreshAgendaAfterWrite]);
  const cancelAppointment = useCallback(async (command: CancelAppointmentCommand) => { const id=await beautyRepository.cancelAppointment(membership.business.id,command); await refreshAgendaAfterWrite(); return id; },[membership.business.id,refreshAgendaAfterWrite]);
  const updateTimeBlock = useCallback(async (command: UpdateTimeBlockCommand) => { if(state.status!=='ready') return ''; const id=await beautyRepository.updateTimeBlock(membership.business.id,state.data.business.timezone,command); await refreshAgendaAfterWrite(); return id; },[membership.business.id,refreshAgendaAfterWrite,state]);
  const deactivateTimeBlock = useCallback(async (command: DeactivateTimeBlockCommand) => { const id=await beautyRepository.deactivateTimeBlock(membership.business.id,command); await refreshAgendaAfterWrite(); return id; },[membership.business.id,refreshAgendaAfterWrite]);

  const getCustomerHistory = useCallback(async (customerId: string) => {
    if (state.status !== 'ready') return { appointments: [], appointmentServices: [] };
    return beautyRepository.getCustomerHistory(
      membership.business.id,
      customerId,
      state.data.business.timezone,
    );
  }, [membership.business.id, state]);

  const createCustomer = useCallback(async (command: CreateCustomerCommand) => {
    const customerId = await beautyRepository.createCustomer(membership.business.id, command);
    await refreshAllAfterWrite();
    return customerId;
  }, [membership.business.id, refreshAllAfterWrite]);

  const updateCustomer = useCallback(async (command: UpdateCustomerCommand) => {
    const customerId = await beautyRepository.updateCustomer(membership.business.id, command);
    await refreshAllAfterWrite();
    return customerId;
  }, [membership.business.id, refreshAllAfterWrite]);

  const deactivateCustomer = useCallback(async (command: DeactivateCustomerCommand) => {
    const customerId = await beautyRepository.deactivateCustomer(membership.business.id, command);
    await refreshAllAfterWrite();
    return customerId;
  }, [membership.business.id, refreshAllAfterWrite]);

  const createStaff = useCallback(async (command: CreateStaffCommand) => { const id = await beautyRepository.createStaff(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const updateStaff = useCallback(async (command: UpdateStaffCommand) => { const id = await beautyRepository.updateStaff(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const deactivateStaff = useCallback(async (command: DeactivateStaffCommand) => { const id = await beautyRepository.deactivateStaff(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const createService = useCallback(async (command: CreateServiceCommand) => { const id = await beautyRepository.createService(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const updateService = useCallback(async (command: UpdateServiceCommand) => { const id = await beautyRepository.updateService(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const deactivateService = useCallback(async (command: DeactivateServiceCommand) => { const id = await beautyRepository.deactivateService(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const setStaffService = useCallback(async (command: SetStaffServiceCommand) => { const id = await beautyRepository.setStaffService(membership.business.id, command); await refreshAllAfterWrite(); return id; }, [membership.business.id, refreshAllAfterWrite]);
  const replaceWeeklySchedule = useCallback(async (command: ReplaceWeeklyScheduleCommand) => { await beautyRepository.replaceWeeklySchedule(membership.business.id, command); await refreshAllAfterWrite(); }, [membership.business.id, refreshAllAfterWrite]);
  const updateBusinessProfile = useCallback(async (command: BusinessProfileInput) => {
    const id = await beautyRepository.updateBusinessProfile(membership.business.id, command);
    await refreshAllAfterWrite();
    return id;
  }, [membership.business.id, refreshAllAfterWrite]);

  const value = useMemo<BeautyDataContextValue>(() => ({
    ...state,
    mode: beautyEnvironment.dataMode,
    retry: () => setAttempt((value) => value + 1),
    loadAppointmentHistory,
    counts,
    updateAppointmentStatus,
    createTimeBlock,
    getAvailability,
    createAppointment, updateAppointment, cancelAppointment, updateTimeBlock, deactivateTimeBlock,
    getCustomerHistory,
    createCustomer,
    updateCustomer,
    deactivateCustomer,
    createStaff, updateStaff, deactivateStaff, createService, updateService, deactivateService, setStaffService, replaceWeeklySchedule, updateBusinessProfile,
    agendaRange,
    agendaStatus,
    agendaMessage,
    loadAgendaRange,
    retryAgenda: () => agendaRange ? void loadAgendaRange(agendaRange) : undefined,
  }), [agendaMessage, agendaRange, agendaStatus, cancelAppointment, counts, createAppointment, createCustomer, createService, createStaff, createTimeBlock, deactivateCustomer, deactivateService, deactivateStaff, deactivateTimeBlock, getAvailability, getCustomerHistory, loadAgendaRange, loadAppointmentHistory, replaceWeeklySchedule, setStaffService, state, updateAppointment, updateAppointmentStatus, updateBusinessProfile, updateCustomer, updateService, updateStaff, updateTimeBlock]);

  return <BeautyDataContext.Provider value={value}>{children}</BeautyDataContext.Provider>;
}

export function useBeautyData() {
  const value = useContext(BeautyDataContext);
  if (!value) throw new Error('useBeautyData debe utilizarse dentro de BeautyDataProvider.');
  return value;
}

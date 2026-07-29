-- Event vocabulary for the daily Agenda operations.
alter type public.beauty_appointment_event_type add value if not exists 'confirmed';
alter type public.beauty_appointment_event_type add value if not exists 'completed';
alter type public.beauty_appointment_event_type add value if not exists 'no_show';
alter type public.beauty_appointment_event_type add value if not exists 'staff_changed';
alter type public.beauty_appointment_event_type add value if not exists 'services_changed';
alter type public.beauty_appointment_event_type add value if not exists 'notes_updated';

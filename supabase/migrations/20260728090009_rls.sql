-- Tenant isolation. Table grants and RLS are both required.
-- Appointments and audit events are intentionally not directly writable:
-- trusted RPCs provide transactional and field-level authorization.

alter table public.beauty_businesses enable row level security;
alter table public.beauty_businesses force row level security;
alter table public.business_members enable row level security;
alter table public.business_members force row level security;
alter table public.staff_members enable row level security;
alter table public.staff_members force row level security;
alter table public.beauty_services enable row level security;
alter table public.beauty_services force row level security;
alter table public.staff_services enable row level security;
alter table public.staff_services force row level security;
alter table public.staff_schedules enable row level security;
alter table public.staff_schedules force row level security;
alter table public.time_blocks enable row level security;
alter table public.time_blocks force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.appointments enable row level security;
alter table public.appointments force row level security;
alter table public.appointment_services enable row level security;
alter table public.appointment_services force row level security;
alter table public.appointment_events enable row level security;
alter table public.appointment_events force row level security;

drop policy if exists beauty_businesses_select_member on public.beauty_businesses;
create policy beauty_businesses_select_member on public.beauty_businesses
  for select to authenticated
  using (public.is_business_member(id));

drop policy if exists beauty_businesses_update_owner on public.beauty_businesses;
create policy beauty_businesses_update_owner on public.beauty_businesses
  for update to authenticated
  using (public.has_business_role(id, array['owner']))
  with check (public.has_business_role(id, array['owner']));

drop policy if exists business_members_select_member on public.business_members;
create policy business_members_select_member on public.business_members
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists business_members_manage_owner on public.business_members;
create policy business_members_manage_owner on public.business_members
  for all to authenticated
  using (public.has_business_role(business_id, array['owner']))
  with check (public.has_business_role(business_id, array['owner']));

drop policy if exists staff_members_select_member on public.staff_members;
create policy staff_members_select_member on public.staff_members
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists staff_members_manage_owner_admin on public.staff_members;
create policy staff_members_manage_owner_admin on public.staff_members
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists beauty_services_select_member on public.beauty_services;
create policy beauty_services_select_member on public.beauty_services
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists beauty_services_manage_owner_admin on public.beauty_services;
create policy beauty_services_manage_owner_admin on public.beauty_services
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists staff_services_select_member on public.staff_services;
create policy staff_services_select_member on public.staff_services
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists staff_services_manage_owner_admin on public.staff_services;
create policy staff_services_manage_owner_admin on public.staff_services
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists staff_schedules_select_member on public.staff_schedules;
create policy staff_schedules_select_member on public.staff_schedules
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists staff_schedules_manage_owner_admin on public.staff_schedules;
create policy staff_schedules_manage_owner_admin on public.staff_schedules
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists time_blocks_select_member on public.time_blocks;
create policy time_blocks_select_member on public.time_blocks
  for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists time_blocks_manage_owner_admin on public.time_blocks;
create policy time_blocks_manage_owner_admin on public.time_blocks
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists time_blocks_insert_own_staff on public.time_blocks;
create policy time_blocks_insert_own_staff on public.time_blocks
  for insert to authenticated
  with check (
    staff_member_id = public.current_staff_member_id(business_id)
    and created_by = auth.uid()
    and block_type in ('break', 'personal', 'other')
  );

drop policy if exists time_blocks_update_own_staff on public.time_blocks;
create policy time_blocks_update_own_staff on public.time_blocks
  for update to authenticated
  using (
    staff_member_id = public.current_staff_member_id(business_id)
    and created_by = auth.uid()
  )
  with check (
    staff_member_id = public.current_staff_member_id(business_id)
    and created_by = auth.uid()
    and block_type in ('break', 'personal', 'other')
  );

drop policy if exists time_blocks_delete_own_staff on public.time_blocks;
create policy time_blocks_delete_own_staff on public.time_blocks
  for delete to authenticated
  using (
    staff_member_id = public.current_staff_member_id(business_id)
    and created_by = auth.uid()
  );

drop policy if exists customers_select_authorized on public.customers;
create policy customers_select_authorized on public.customers
  for select to authenticated
  using (
    public.has_business_role(business_id, array['owner', 'admin'])
    or exists (
      select 1
      from public.appointments a
      where a.business_id = customers.business_id
        and a.customer_id = customers.id
        and a.assigned_staff_member_id =
          public.current_staff_member_id(customers.business_id)
    )
  );

drop policy if exists customers_manage_owner_admin on public.customers;
create policy customers_manage_owner_admin on public.customers
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists appointments_select_authorized on public.appointments;
create policy appointments_select_authorized on public.appointments
  for select to authenticated
  using (public.can_access_beauty_appointment(business_id, id));

drop policy if exists appointment_services_select_authorized on public.appointment_services;
create policy appointment_services_select_authorized on public.appointment_services
  for select to authenticated
  using (public.can_access_beauty_appointment(business_id, appointment_id));

drop policy if exists appointment_events_select_authorized on public.appointment_events;
create policy appointment_events_select_authorized on public.appointment_events
  for select to authenticated
  using (public.can_access_beauty_appointment(business_id, appointment_id));

revoke all on table public.beauty_businesses, public.business_members,
  public.staff_members, public.beauty_services, public.staff_services,
  public.staff_schedules, public.time_blocks, public.customers,
  public.appointments, public.appointment_services,
  public.appointment_events from anon, authenticated;

grant select on table public.beauty_businesses, public.business_members,
  public.staff_members, public.beauty_services, public.staff_services,
  public.staff_schedules, public.time_blocks, public.customers,
  public.appointments, public.appointment_services,
  public.appointment_events to authenticated;

grant update on table public.beauty_businesses to authenticated;
grant insert, update, delete on table public.business_members,
  public.staff_members, public.beauty_services, public.staff_services,
  public.staff_schedules, public.time_blocks, public.customers
  to authenticated;

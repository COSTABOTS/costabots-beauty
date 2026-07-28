-- RLS helpers are SECURITY DEFINER to avoid recursive evaluation of
-- business_members policies. They derive identity only from auth.uid().

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_members bm
    join public.beauty_businesses bb on bb.id = bm.business_id
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.active
      and bb.active
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_members bm
    join public.beauty_businesses bb on bb.id = bm.business_id
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.active
      and bb.active
      and bm.role::text = any(allowed_roles)
  );
$$;

create or replace function public.current_staff_member_id(target_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select sm.id
  from public.staff_members sm
  join public.business_members bm
    on bm.business_id = sm.business_id
   and bm.user_id = sm.user_id
   and bm.active
  where sm.business_id = target_business_id
    and sm.user_id = auth.uid()
    and sm.active
  limit 1;
$$;

create or replace function public.can_access_beauty_appointment(
  target_business_id uuid,
  target_appointment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    public.has_business_role(target_business_id, array['owner', 'admin'])
    or exists (
      select 1
      from public.appointments a
      join public.staff_members sm
        on sm.id = a.assigned_staff_member_id
       and sm.business_id = a.business_id
      where a.id = target_appointment_id
        and a.business_id = target_business_id
        and sm.user_id = auth.uid()
        and sm.active
    );
$$;

revoke all on function public.is_business_member(uuid) from public;
revoke all on function public.has_business_role(uuid, text[]) from public;
revoke all on function public.current_staff_member_id(uuid) from public;
revoke all on function public.can_access_beauty_appointment(uuid, uuid) from public;

grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.has_business_role(uuid, text[]) to authenticated;
grant execute on function public.current_staff_member_id(uuid) to authenticated;
grant execute on function public.can_access_beauty_appointment(uuid, uuid) to authenticated;


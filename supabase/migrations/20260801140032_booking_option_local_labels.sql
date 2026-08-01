-- Labels are rendered in the business timezone while starts_at remains an
-- absolute timestamptz. Comparing the label with the UTC substring rejects
-- valid options for businesses outside UTC.
create or replace function public.beauty_booking_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_options) <> 'array' then false
    else jsonb_array_length(p_options) <= 50
    and not exists (
      select 1
      from jsonb_array_elements(p_options) option
      where jsonb_typeof(option) <> 'object'
        or not (option ?& array['starts_at', 'staff_id', 'label'])
        or option->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$'
        or option->>'staff_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or option->>'label' !~ '^(?:[01]\d|2[0-3]):[0-5]\d$'
        or (option ? 'staff_display_name' and (
          jsonb_typeof(option->'staff_display_name') <> 'string'
          or char_length(option->>'staff_display_name') not between 1 and 120
        ))
    )
    and (
      select count(*) from jsonb_array_elements(p_options)
    ) = (
      select count(distinct (option->>'starts_at', option->>'staff_id'))
      from jsonb_array_elements(p_options) option
    )
  end;
$$;

revoke execute on function public.beauty_booking_options_valid(jsonb)
  from public, anon, authenticated;

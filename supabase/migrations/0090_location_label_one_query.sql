CREATE OR REPLACE FUNCTION public.venue_display(v venues)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select btrim(v.name) || coalesce(' ' || nullif(btrim(v.unit), ''), '');
$function$;

CREATE OR REPLACE FUNCTION public.location_label(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(public.venue_display(v), nullif(btrim(p.venue_label), ''))
         || coalesce(', ' || nullif(btrim(p.unit_label), ''), '')
    from (select 1) one
    left join public.venues v on v.id = c.venue_id
    left join public.private_class_details p on p.class_id = c.id;
$function$;

drop function public.location_venue(classes);
drop function public.location_unit(classes);

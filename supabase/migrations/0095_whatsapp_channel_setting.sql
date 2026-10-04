alter table public.settings add constraint settings_whatsapp_enabled_boolean
  check (key <> 'whatsapp_enabled' or jsonb_typeof(value) = 'boolean');

insert into public.settings (key, value) values ('whatsapp_enabled', 'false');

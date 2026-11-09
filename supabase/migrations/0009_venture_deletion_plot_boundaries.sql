alter table public.ventures add column deleted_at timestamptz;
alter table public.ventures add column deleted_by uuid references public.app_users(id);
alter table public.plots add column north_ft numeric(12,2) check(north_ft is null or north_ft>0);
alter table public.plots add column south_ft numeric(12,2) check(south_ft is null or south_ft>0);
alter table public.plots add column east_ft numeric(12,2) check(east_ft is null or east_ft>0);
alter table public.plots add column west_ft numeric(12,2) check(west_ft is null or west_ft>0);
alter table public.plots add column source_metadata jsonb not null default '{}';

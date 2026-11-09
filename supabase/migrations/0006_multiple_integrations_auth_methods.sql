alter table public.integration_connections
  drop constraint integration_connections_organization_id_provider_key,
  drop constraint integration_connections_auth_type_check;

alter table public.integration_connections
  add column connection_type text not null default 'both'
    check (connection_type in ('api', 'webhook', 'both')),
  add column inbound_auth_type text not null default 'hmac'
    check (inbound_auth_type in ('hmac', 'bearer', 'basic', 'api_key', 'custom_header')),
  add column outbound_auth_header_name text not null default 'X-API-Key',
  add column inbound_auth_header_name text not null default 'X-API-Key',
  add constraint integration_connections_auth_type_check
    check (auth_type in ('hmac', 'bearer', 'basic', 'api_key', 'custom_header'));

create index integration_connections_org_provider_idx
  on public.integration_connections (organization_id, provider, created_at);

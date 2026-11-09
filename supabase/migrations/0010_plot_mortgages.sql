-- Mortgage references are document labels, never passwords or release tokens.
alter table plots add column is_mortgaged boolean not null default false;
alter table plots add column mortgage_reference text;
update plots set is_mortgaged=true, status='blocked',
 blocked_reason=coalesce(blocked_reason,'Mortgage marked in source layout')
 where source_metadata->>'mortgaged'='true';
alter table plots add constraint mortgage_requires_blocked check (not is_mortgaged or status='blocked');

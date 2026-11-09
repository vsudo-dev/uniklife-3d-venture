-- How site-visit locations are shown. The fence/arrival logic is identical in both modes
-- (venture centre + radius, evaluated on the server); this only selects the map display.
--   gis_fence   : built-in stationary GIS fence + tile-free route sketch (no Google account needed)
--   google_maps : same fence, drawn on Google Maps (needs GOOGLE_MAPS_API_KEY on the server)
alter table public.organizations
  add column site_visit_map_mode text not null default 'gis_fence'
    check (site_visit_map_mode in ('gis_fence', 'google_maps'));

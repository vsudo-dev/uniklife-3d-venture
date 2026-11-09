import Image from "next/image";
import { Card, CardHeader } from "@/components/ui";

const Fig = ({ src, alt, caption, w, h }: { src: string; alt: string; caption: string; w: number; h: number }) => (
  <figure>
    <Image src={src} width={w} height={h} alt={alt} unoptimized className="h-auto w-full rounded-lg border border-border bg-white" />
    <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
  </figure>
);

/** Plain-language guide: how to connect, where to check, and how a finished customer site visit appears. */
export function MapsKnowledge() {
  return (
    <div className="space-y-4" id="maps-knowledge-base">
      <Card>
        <CardHeader title="Guide: Google Maps for customer site visits" subtitle="What it is, how to connect it, where to check it, and what you will see." />
        <div className="space-y-5 p-5">
          <section>
            <h3 className="font-bold">1. How to connect</h3>
            <Fig src="/images/maps-guide/1-connect-google-maps.svg" w={960} h={420} alt="Five steps: Google Cloud project and billing, enable Maps JavaScript API, create and restrict a key, add GOOGLE_MAPS_API_KEY on the server, choose Google Maps in the app"
              caption="Create a restricted browser key, add it as GOOGLE_MAPS_API_KEY in Vercel, redeploy, then choose Google Maps on this page." />
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>In <a className="underline" target="_blank" rel="noreferrer" href="https://console.cloud.google.com/">Google Cloud Console</a>, create or select a project and turn on billing (Google’s monthly free credit usually covers light use).</li>
              <li>APIs &amp; Services → Library → enable <strong>Maps JavaScript API</strong>.</li>
              <li>Credentials → Create credentials → API key. <strong>Restrict it</strong>: Websites = your app’s address (for example <code>https://your-domain/*</code>), API = Maps JavaScript API only.</li>
              <li>In Vercel → Settings → Environment Variables add <code>GOOGLE_MAPS_API_KEY</code>, then redeploy.</li>
              <li>Come back here, press <strong>Test map</strong>, choose <strong>Google Maps</strong> and <strong>Save choice</strong>.</li>
            </ol>
          </section>
          <section>
            <h3 className="font-bold">2. Where to check</h3>
            <Fig src="/images/maps-guide/2-where-to-check.svg" w={960} h={440} alt="Menu path Uniklife AI Integration, Google Maps tab, two cards and a Test map button"
              caption="Uniklife AI Integration → Google Maps. “key found on server” means the variable is set; Test map proves Google accepts it." />
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              <li><strong>Key missing</strong> badge: the server variable is not set or the redeploy has not happened.</li>
              <li>Test map shows an error: the key is restricted to another website, the Maps JavaScript API is not enabled, or billing is off.</li>
              <li>Venture has no circle: open the venture → Edit and add latitude, longitude and the geofence radius.</li>
            </ul>
          </section>
          <section>
            <h3 className="font-bold">3. What happens when a customer site visit is done</h3>
            <Fig src="/images/maps-guide/3-site-visit-result.svg" w={960} h={460} alt="Map with fence circle, route, Start, Site and End markers, and a timeline of trip stages"
              caption="Example data. Each trip shows the fence, the GPS route and the stage times under Site visits → Trip tracking → Timeline." />
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>The salesperson starts the trip on their phone and agrees to share location while the page is open.</li>
              <li>When the phone enters the venture’s fence, arrival is recorded automatically; leaving it records departure.</li>
              <li>Managers open Trip tracking → Timeline: the map shows the fence, route, Start (S), Site and End (E), with times, time on site and distance.</li>
              <li>“Open route in Google Maps” opens the same trip in the Google Maps app.</li>
            </ol>
          </section>
          <section>
            <h3 className="font-bold">Google Maps or Stationary GIS fence?</h3>
            <div className="mt-2 overflow-auto"><table className="table"><thead><tr><th></th><th>Google Maps</th><th>Stationary GIS fence</th></tr></thead><tbody>
              <tr><td>Arrival / departure detection</td><td>Same fixed fence</td><td>Same fixed fence</td></tr>
              <tr><td>Map shown</td><td>Real Google map, roads and places</td><td>Simple sketch, no background map</td></tr>
              <tr><td>Needs</td><td>Google key + billing</td><td>Nothing extra</td></tr>
              <tr><td>If Google fails</td><td>Falls back to the sketch automatically</td><td>—</td></tr>
            </tbody></table></div>
            <p className="mt-2 text-xs text-muted">The fence is a circle (venture centre + radius). Irregular polygon boundaries are not supported yet. Location is shared only during a trip while the page is open, and the browser key is visible to signed-in staff, which is why it must be restricted.</p>
          </section>
        </div>
      </Card>
    </div>
  );
}

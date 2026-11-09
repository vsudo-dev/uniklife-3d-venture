import Image from "next/image";
import { Card, CardHeader } from "@/components/ui";

export function WhatsappKnowledge() {
  return (
    <div id="waba-knowledge-base" className="space-y-4">
      <Card>
        <CardHeader title="Connect WhatsApp in 3 steps" subtitle="Direct Meta connection. No middleman account needed." />
        <div className="space-y-5 p-5">
          <figure>
            <Image src="/images/waba-connection-guide.png" width={1200} height={620} alt="Six steps: prepare business, configure Meta app, set server settings, verify webhook, connect with Meta, confirm delivery; and how messages travel between UNIKLIFE, Meta Cloud API and the customer" className="h-auto w-full rounded-lg border border-border" />
            <figcaption className="mt-2 text-xs text-muted">The whole journey on one page. Meta screens may vary; keep app secrets and the token key on the server only.</figcaption>
          </figure>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="font-bold">1. Open your Meta app</h3>
              <p className="my-2 text-sm text-muted">Create or select your business app. Add WhatsApp and set up Facebook Login for Business / Embedded Signup.</p>
              <a className="inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast" href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Open Meta Apps →</a>
            </div>
            <div>
              <h3 className="font-bold">2. Connect the number</h3>
              <p className="my-2 text-sm text-muted">Your administrator adds the app settings. Then use Connect with Meta below, choose your business and verify the phone number.</p>
              <a className="text-sm font-semibold text-primary underline" href="#whatsapp-connect">Go to Connect with Meta →</a>
            </div>
            <div>
              <h3 className="font-bold">3. Verify and test</h3>
              <p className="my-2 text-sm text-muted">Paste this app’s callback URL and matching verify token into Meta. Subscribe to messages, then send an available approved template to an opted-in test recipient.</p>
              <a className="text-sm font-semibold text-primary underline" href="https://business.facebook.com/wa/manage/" target="_blank" rel="noreferrer">Open WhatsApp Manager →</a>
            </div>
          </div>
        </div>
      </Card>
      <details className="card p-5">
        <summary className="cursor-pointer font-bold">Show Meta screens and quick fixes</summary>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <figure>
            <Image src="/images/meta-setup/meta-whatsapp-dashboard.png" width={1366} height={673} alt="Example Meta for Developers app dashboard, with the WhatsApp Set up button indicated" className="h-auto w-full rounded-lg border border-border" />
            <figcaption className="mt-2 text-xs text-muted">Find WhatsApp → Set up. Example screenshot from <a className="underline" href="https://docs.kommunicate.io/docs/whatsapp-cloud-api" target="_blank" rel="noreferrer">Kommunicate documentation</a>. Meta’s current menus may differ.</figcaption>
            <p className="mt-2 text-sm"><strong>Connect button unavailable?</strong> Your administrator must finish the app settings. If it stays unavailable, allow Facebook’s SDK and popups, then reload.</p>
          </figure>
          <figure>
            <Image src="/images/meta-setup/meta-webhook-settings.png" width={1920} height={959} alt="Example Meta WhatsApp configuration screen showing Callback URL, Verify token, and Verify and save" className="h-auto w-full rounded-lg border border-border" />
            <figcaption className="mt-2 text-xs text-muted">Callback URL + Verify token → Verify and save. Example screenshot from <a className="underline" href="https://ozeki-sms-gateway.com/p_6841-whatsup-message-from-ms-sql.html" target="_blank" rel="noreferrer">Ozeki’s setup guide</a>. Enter your own values from this app; do not copy the example values.</figcaption>
            <p className="mt-2 text-sm"><strong>Verification fails?</strong> Use the exact HTTPS callback URL and matching verify token. <strong>No delivery updates?</strong> Subscribe to messages and confirm webhooks on.</p>
          </figure>
        </div>
      </details>
      <details className="card p-5">
        <summary className="cursor-pointer font-bold">Administrator: app settings and tokens</summary>
        <div className="mt-4 overflow-auto">
          <table className="table">
            <thead><tr><th>Setting</th><th>What it does / where to get it</th></tr></thead>
            <tbody>
              <tr><td><code>META_APP_ID</code></td><td>Identifies your app. Copy from Meta App settings → Basic.</td></tr>
              <tr><td><code>META_APP_SECRET</code></td><td>Proves requests came from Meta. Copy from the same Basic settings; keep private.</td></tr>
              <tr><td><code>META_EMBEDDED_SIGNUP_CONFIG_ID</code></td><td>Opens the correct signup flow. Copy from Facebook Login for Business → Configurations.</td></tr>
              <tr><td><code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code></td><td>Your own random verification phrase, at least 16 characters. The server and Meta must use the same value.</td></tr>
              <tr><td><code>WHATSAPP_TOKEN_KEY</code></td><td>At least 32 random characters. Encrypts saved account tokens. Preserve this key.</td></tr>
              <tr><td>Business access token</td><td>Returned after Connect with Meta; the app saves it encrypted. Do not paste it in chat.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">Set server variables and redeploy. Complete Meta’s required permissions, app review and business verification for your production use. Lead Ads has a separate callback and verify token.</p>
      </details>
      <p className="text-xs text-muted">An accepted send does not prove delivery; check activity below. Automated staff alerts require an approved two-field template and the worker. Manual WhatsApp Web opens a chat; it cannot provide unattended sending. Meta’s own charges may apply.</p>
    </div>
  );
}

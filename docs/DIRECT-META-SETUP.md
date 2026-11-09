# Direct Meta setup and release checklist

This release adds real Meta ingestion and worker code. It is not a declaration
that the external services are connected. There are no SaaS Universe credentials
in the direct Meta path. No external email, WhatsApp message or real Meta lead was
sent during automated tests.

## What the owner confirmed

- Connect directly to both Meta Lead Ads and WhatsApp.
- Use distinct EMP and AGT IDs; one person may have both profiles.
- Employee minimum: one confirmed plot per India calendar month. Once that
  minimum is exceeded, use 2% of the net sale value of **all** eligible plots
  that month. The percentage is not multiplied across eight uplines.
- Employee and agent policy editors allow eight levels, fixed INR per plot or
  percentage, optional non-overlapping sales bands, and all-sales/excess-only
  calculation. Agent rates start at zero because the owner has not supplied them.

At INR 10 lakh net per plot: one sale gives zero employee incentive; two give
INR 40,000; three INR 60,000; four INR 80,000; five INR 1,00,000; seven INR 1,40,000.
These are estimates before tax and payout approval. The new editors and monthly
report do not write payable ledger entries. Agent sale attribution, approved
agent plan selection and settlement routing need implementation before paying
agents through the separate AGT model. Existing commission ledgers are unchanged.

## Which connection does what?

| Connection | Direction | Does a generic CRM API need to be configured first? |
| --- | --- | --- |
| Meta Lead Ads | Facebook/Instagram Instant Form → enquiry | No |
| WhatsApp Cloud API | Approved messages out; replies/statuses in | No |
| Generic API tab | App events → configured external endpoint | Only if using a separate external system |
| Generic Webhook tab | Supported external-system updates → app | Only if using a separate external system |

Meta is not a general CRM database. It cannot automatically mirror employees,
plots, commissions or all customer fields. Sending qualification or purchase
signals to Meta requires a separate Conversions API mapping, consent/data handling
decisions and testing; that feature is not activated by this receiver.

## One-time owner setup

1. Open https://developers.facebook.com/apps/ and create/select the intended app.
   Add WhatsApp and configure Facebook Login for Business / Embedded Signup.
2. Select the Facebook Page and Instant Form used for Lead Ads. Obtain a suitable
   Page access token, with `leads_retrieval` and applicable Page permissions.
   Complete Meta's required Page access assignment, app review and business
   verification. Do this with the actual Meta business owner; no password or OTP
   should be pasted into chat.
3. In the app, open Uniklife AI Integration → Meta Lead Ads. Save the Page ID,
   form ID and destination venture. The screen shows the exact tenant-specific
   Page-token variable name and the Lead Ads callback URL.
4. Configure the Page webhook and subscribe to `leadgen`. Subscribe the app to
   the Page as well. A verified callback alone does not subscribe the Page.
5. Open WhatsApp in the integration workspace. Configure its separate callback,
   verify token and `messages` subscription. Use Connect with Meta, then test an
   available approved template with an opted-in recipient.

Public example screenshots are supplied in the app with attribution to
Kommunicate and Ozeki. They show where the fields/buttons are; the example app,
URLs and tokens in those screenshots are not values for this system. Meta menus
may differ from these older reference screens.

## Variables, credentials and deployment

Apply `0008_direct_meta_people_delivery.sql` before deploying pages that use it.
Keep the existing database and existing WhatsApp encryption key intact.

| Variable | Purpose / where it is set |
| --- | --- |
| `META_APP_ID` | App ID from Meta app settings |
| `META_APP_SECRET` | App secret; validates signed webhook deliveries |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Facebook Login for Business configuration |
| `META_LEAD_VERIFY_TOKEN` | New random verification phrase, at least 16 characters; match in the Page webhook setup |
| `META_PAGE_TOKEN_<ORGANIZATION_UUID_WITHOUT_HYPHENS_IN_UPPERCASE>` | Page token for that tenant; exact name shown in the app |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Separate WhatsApp callback verification phrase |
| `WHATSAPP_TOKEN_KEY` | Existing stable key, at least 32 random characters, encrypting saved business tokens |
| `WHATSAPP_ALERT_TEMPLATE` | Approved template name whose body has two text parameters: alert title and body |
| `WHATSAPP_ALERT_LANGUAGE` | Template language, default `en_US` |
| `APP_BASE_URL` | Correct public HTTPS application origin |
| `DATABASE_DRIVER=postgres` | Worker and web app use the same PostgreSQL database |
| `POSTGRES_URL` or `DATABASE_URL` | PostgreSQL runtime connection |
| `SYNC_WORKER_ENABLED=true` | Explicitly enables the always-on worker process |
| `SYNC_GENERIC_API_ENABLED=true` | Optional: also dispatch existing generic external API connections. Off by default for direct-Meta-only setup. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Enables Web Push sending |

The last production environment check found the two WhatsApp keys already set,
but no Meta app credentials, Page-token variables, SMTP password variables, VAPID
variables or worker flag. The new local code has not filled these with fake values.

## Always-on worker

Run `npm run sync:worker` on an always-on Node host with the above variables,
restart-on-failure and monitoring. Node >=20.11 is required. The web deployment
on Vercel receives webhooks; its existing daily cron does not meet a 15-second
cadence. A laptop that sleeps cannot provide 24/7 processing.

- Signed webhooks enqueue lead IDs immediately. Only registered Page/form pairs
  are accepted. Tokens and full webhook payloads are not stored in these logs.
- Each cycle imports up to 50 leased leads, deduplicates by Meta lead ID and
  atomically creates enquiries and staff notifications.
- Form polling runs every 15 seconds under normal conditions. It uses durable
  checkpoints, a two-minute overlap and opaque cursors with fixed scan windows.
- Every 15 minutes a recovery scan looks back 24 hours from the prior checkpoint.
  Longer outages resume from the saved checkpoint; no last-15-seconds-only gap.
- Rate/error backoff may delay checks. Import failures retry with a lease;
  missing phones are held for review, and repeatedly failed leads require review.
- Per-organization stored execution logs show source, status and counts. The
  browser refreshes the logs; it does not run the automatic worker.
- Email/WhatsApp deliveries with an uncertain provider outcome are held as
  `unknown` for review to avoid automatic duplicate sends.

Provider access/consent and hosting cannot be eliminated. We can supply the
connector code without a SaaS connector subscription; Meta may charge for ads
and messaging, and an always-on host may have its own cost.

## SMTP and notifications

Open Email & SMTP. Enter host, username, From name/address and port 587 STARTTLS
or 465 TLS. Store the password/app password as the exact tenant-specific
`SMTP_PASSWORD_<ORGANIZATION_UUID_WITHOUT_HYPHENS_IN_UPPERCASE>` shown in the app.
The verification button tests login and TLS without sending an email. Verify
the sender/domain with the provider, including SPF/DKIM where applicable.

Every intended recipient enables their channels under Notifications → Preferences.
WhatsApp alerts require a connected number, an approved two-parameter template
and a recipient phone number in international format. WhatsApp Web is manual,
not an unattended sending integration.

The web app displays new own-account alerts while open and checks every 15 seconds.
The user must press Enable ding sound before browsers will play it. OS push needs
device-specific browser permission, VAPID and a running worker. On iPhone/iPad,
supported Home Screen web apps (iOS/iPadOS 16.4+) can request push permission.
Phone number registration alone does not enable push; OS focus/mute policies can
suppress sound. A payment notification and a new-lead notification are distinct.

## Acceptance checks before claiming live readiness

- Meta test tool creates exactly one enquiry, even when the webhook is replayed.
- Stop/restart the worker: checkpoint catch-up imports missing leads without duplicates.
- Revoke a Page token: logs show failures/backoff, not a green connected claim.
- WhatsApp test gets a provider message ID and a subsequent delivery webhook.
- Opted-in intended staff receive their own alert through configured channels.
- A verified payment raises a payment alert; a lead alone does not imply payment.
- Test desktop, Android and a supported installed iPhone/iPad web app.
- Obtain separate agent rates and finish agent booking attribution/settlement
  routing before enabling new AGT payouts. Approve employee payout integration
  and cancellation/reversal handling before creating payable incentives.

References: Meta's published lead retrieval implementation checklist at
https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/leads/leads-retrieval-set-up-checker.md,
https://nodemailer.com/smtp and
https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/.

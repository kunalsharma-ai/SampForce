# Website Enquiry: connecting the company website (ADR 0095)

SampForce receives everything people send on the company website (enquiry and download forms, case study and resource
downloads, live chat leads, newsletter sign-ups and reviews) from the website's **Sampforce API**. This page is the
SampForce side of the website's own guide ("Sampforce API: every website lead and enquiry for the sales app",
section 29 of the website's go-live documents), and lists exactly what SampForce uses from it.

## Set-up

1. On the website: sign in to `/admin` as a Super Admin or IT Admin, open **System > Sampforce (sales)**, press
   **+ Make an API key**, keep the four default rights (`leads:read`, `contacts:read`, `reviews:read`,
   `leads:write`), optionally add the SampForce server's IP address, confirm with the authenticator code and copy the
   `sfk_` key at once (it is shown only once).
2. In the SampForce Console: **Providers > Website enquiries (company website)**. Enter
   - **API address**: `https://www.frequentresearch.com/api/v1/sampforce`
   - **API key**: the `sfk_` key
   - **Webhook signing secret**: a long random text (`openssl rand -hex 32`), the same one as on the website
   - **Receiving workspace**: the workspace's web address name, shown on its page under Clients

   Save, then press **Test connection**. Saving switches the Website enquiries feature on for that workspace.
3. On the website, for instant delivery: **System > Connections & keys > Sampforce**, set
   `SAMPFORCE_WEBHOOK_URL` to `https://<your SampForce API>/api/v1/hooks/website-enquiries` (shown in the Console with
   the full address) and `SAMPFORCE_WEBHOOK_SECRET` to the same secret. Press **Send a test**: the webhook status in
   the Console turns green.
4. Older leads come in with the first pull, which imports everything. **Send older leads** on the website works too.

Nothing goes in `sampforce.env` (ADR 0059). `WEBSITE_ENQUIRY_SYNC_MS` (default 600000, ten minutes) sets how often
the worker pulls.

## What SampForce uses

| Website API | SampForce use |
| --- | --- |
| `GET /ping` | Test connection: key name and rights |
| `GET /leads?updatedSince&cursor&limit=200` | Pull: every lead the first time, then only changes; oldest first, `nextCursor` while `hasMore` |
| `GET /contacts?source=newsletter&updatedSince&cursor` | Newsletter sign-ups (form senders are already leads) |
| `GET /reviews?updatedSince&cursor` | Reviews |
| `PATCH /leads/:id` | Write-back: `status`, `stage` (80), `owner` (120), `sampforceId` (80), `url` (https only), `note` (2000) |
| Webhook `lead.created`, `lead.updated` | Upsert the lead by its id |
| Webhook `newsletter.subscribed`, `review.created`, `careers.created` | Upsert the sign-up, review or job application |
| Webhook `ping` | Marks the webhook as working; nothing is stored |

Keys are sent as `Authorization: Bearer sfk_…` from the SampForce server only. Requests time out after 20 seconds
and never follow redirects.

## The webhook

`POST /api/v1/hooks/website-enquiries`, no session. The website signs each delivery:

```
X-Sampforce-Event: lead.created
X-Sampforce-Delivery: evt_…
X-Sampforce-Signature: t=1764235200,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the secret>
```

SampForce recomputes the signature over the raw body, compares it in constant time and refuses a timestamp more than
5 minutes away (`401 BAD_SIGNATURE`, recorded in the Console's webhook status). Until a secret and receiving workspace
are set it answers `503 PENDING_CONFIGURATION`, so the website retries (after 1 m, 5 m, 15 m, 1 h, 3 h, 6 h and 12 h)
and nothing is lost. A repeated delivery changes nothing: rows are upserted by the website's id, and an older copy
never overwrites a newer one.

## Statuses both ways

SampForce uses the website's six lead statuses (new, contacted, qualified, won, lost, spam). A change in SampForce is
sent back at once and retried on the same schedule; 400, 401, 403, 404 and 422 stop it, with the reason shown on the
enquiry. A write-back does not fire the website's webhook. A status changed on the website arrives with
`lead.updated` (or the next pull) and is adopted unless a SampForce change is still waiting to be sent.

## Testing

`apps/api/test/fixtures/website-fixture.ts` is a stand-in written from the website's guide (paging, `updatedSince`,
signed deliveries, PATCH, missing rights, a busy website). `apps/api/test/website-enquiries.e2e.test.ts` and
`apps/web/e2e/website-enquiries.spec.ts` run against it. It has not been run against the real website.

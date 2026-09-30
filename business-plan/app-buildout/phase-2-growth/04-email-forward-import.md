# Pack 04: Email-forward import (plans@wayfold.app)

Part of [Phase 2: growth](README.md). Written 2026-09-30. Builds on the Phase 1 paste-a-booking import
([06 section 5.3](../06-ai-agents-spec.md), [06 section 12.3](../06-ai-agents-spec.md)). The full specs
list "email or calendar inbox parsing (auto-import of confirmations)" as out of scope for launch
([01 section 7](../01-product-spec.md)), so the inbound pipeline below is new; it reuses the booking
import schema, redaction and confirm path.

| Item | Value |
|---|---|
| Build order | 4 (month 9) |
| Flags | `email_forward_import` (default off, staged rollout), kill switch `email.inbound` (new) |
| Needs from Phase 1 | Booking import (`booking_import`, redaction, confirm path), calendar import, Resend, R2, notifications, credits, consents, admin provider health |
| Soft link | Pack 05 (confirmed flights become tracked flights) |
| Tickets | P2-032 to P2-042 |
| Tier and products | All tiers. Deterministic parsing is free; AI fallback costs 1 credit (`explain` price). No new products |

## 1. Goal and why now

**Goal.** Forward any confirmation email (airline, hotel, train, car, restaurant, tour) to
`plans@wayfold.app` and get a reviewed draft in the right trip within a minute, with no copy and
paste. Nothing is saved until the person confirms.

**Why now.**

- Competitive reasons. TripIt built its brand on `plans@tripit.com`: forward a confirmation and the trip
  builds itself. TripIt users love that and flight alerts (pack 05). Phase 1 already gives switchers a
  calendar import and a paste box ("Coming from TripIt or Wanderlog?"); email forwarding removes the
  last bit of friction and is the single feature most likely to decide a TripIt user's trial week.
  TripIt Pro costs $49 a year (reported, verify; [business plan](../../01-business-plan.md)), and
  email parsing is part of its free tier, so a planner that cannot take a forwarded email looks
  incomplete to that user.
- It makes the AI import path cheap and habitual: structured data in airline and hotel emails is parsed
  deterministically at no cost, and only the messy remainder uses 1 credit.
- It feeds pack 05: a forwarded flight confirmation carries the flight number and dates that cached
  fares lack, so flight status tracking starts automatically.

## 2. User stories and acceptance criteria

| ID | Story | Acceptance |
|---|---|---|
| EML-1 | As a user, I find my forwarding address in the app. | Settings, Forward bookings shows `plans@wayfold.app`, a Copy button, my verified sender addresses, and a personal address `plans+<token>@wayfold.app` for mail that arrives from a mailbox I have not verified. Copy explains Gmail, Outlook and Apple Mail steps, including an optional auto-forward filter for a sender such as an airline. |
| EML-2 | As a user, I verify the addresses I forward from. | Adding an address sends a one-time code link; a verified address can belong to one account only. Mail from an unverified, unknown sender is dropped without a reply (no backscatter), and counted for admin health. |
| EML-3 | As a user, I review what was found. | A forwarded email becomes a draft in "Bookings to review" (Trips home card, Activity item, optional push "We found a booking in your email"). Each draft lists flights, stays, rentals and activities with the source line "From your email on 3 Oct, checked" and the sender domain. [Add all] and per item edit. Nothing is saved until I confirm. |
| EML-4 | As a user, my booking lands in the right trip. | Match by date overlap (trip range plus or minus 3 days) and destination (airport or city). One clear match is preselected; several matches or none show a picker with "Create a new trip". |
| EML-5 | As a user, duplicates and changes are handled. | The same confirmation number, flight number and date updates the existing item instead of duplicating; a changed time shows "Changed: departs 09:10, was 08:40"; a cancellation email offers to mark the item cancelled, never deletes it. |
| EML-6 | As a user, I am not charged for easy emails. | Structured data (schema.org JSON-LD or microdata in the HTML, and ICS attachments) is parsed in code for 0 credits on every tier. If only the AI path can read the email it costs 1 credit, shown before the draft opens; "unrecognized" results are not charged. Out of credits: the draft waits with "Get the details for 1 credit" (credit pack sheet, no paywall modal). |
| EML-7 | As a user, I trust what happens to my email. | The first forward shows a short consent card (what is read, what goes to Anthropic after redaction, how long the raw mail is kept); AI fallback needs the `ai_processing` consent; raw MIME is deleted 30 days after the draft is resolved; I can delete any forwarded email now, and account deletion removes all of it. |
| EML-8 | As a TripIt switcher, I am guided. | The "Coming from TripIt or Wanderlog?" onboarding adds "Forward a confirmation email" as a third option beside the calendar file and the paste box. |
| EML-9 | As the business, I am safe from abuse. | SPF, DKIM and DMARC results are required; size and attachment limits; per user and global rate limits; no link in an email is ever fetched (and Airbnb, Vrbo and Booking.com pages never); attachments are scanned; email text is data, never instructions. |

## 3. Database additions

Migration `0105_inbound_email`. New tables; conventions as in [03 section 2](../03-database-schema.md).
The booking draft reuses the output schema of `booking_import` (06 section 5.3: `flights`, `stays`,
`activities`, `unrecognized`), extended in prompt version `booking_import.v2` with an optional `status`
(`confirmed`, `changed`, `cancelled`) per item.

```sql
CREATE TYPE inbound_email_status AS ENUM (
  'received', 'rejected_sender', 'rejected_auth', 'rejected_size', 'rejected_limit',
  'parsing', 'needs_credits', 'needs_review', 'imported', 'dismissed', 'unrecognized', 'failed');

CREATE TABLE user_email_addresses (                           -- addresses a user forwards from
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email                citext NOT NULL,
  verification_hash    bytea,                                 -- sha256 of the emailed code; null once verified
  verification_expires_at timestamptz,
  verified_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_email_addresses_user_email UNIQUE (user_id, email)
);
CREATE UNIQUE INDEX uq_user_email_addresses_verified ON user_email_addresses (email) WHERE verified_at IS NOT NULL;   -- one account per verified address

CREATE TABLE forwarding_addresses (                           -- the personal plus-address
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  token        text NOT NULL,                                 -- 10 characters, base32; grants "add a draft for this user" and nothing else
  rotated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_forwarding_addresses_token UNIQUE (token)
);

CREATE TABLE inbound_emails (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid REFERENCES users (id) ON DELETE CASCADE,        -- null when the sender was rejected
  message_id         text NOT NULL,                                       -- RFC 5322 Message-ID, for idempotency
  from_address       citext NOT NULL,
  from_domain        text NOT NULL,
  to_address         text NOT NULL,                                       -- plans@ or plans+token@
  subject_redacted   text,                                                -- redacted, max 200 characters
  received_at        timestamptz NOT NULL DEFAULT now(),
  status             inbound_email_status NOT NULL DEFAULT 'received',
  spf                text, dkim text, dmarc text,                         -- verdicts from the receiving provider
  size_bytes         integer NOT NULL,
  attachment_count   smallint NOT NULL DEFAULT 0,
  raw_key            text,                                                -- R2 object key of the raw MIME (encrypted at rest, lifecycle 30 days)
  parse_source       text,                                                -- 'structured', 'ics', 'ai'
  prompt_version     text,
  draft              jsonb,                                               -- redacted-restored draft in the booking_import schema
  trip_id            uuid REFERENCES trips (id) ON DELETE SET NULL,       -- chosen or suggested trip
  credits_charged    integer NOT NULL DEFAULT 0,
  reservation_id     uuid,
  error_code         text,
  resolved_at        timestamptz,
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT uq_inbound_emails_message UNIQUE (message_id, to_address),
  CONSTRAINT ck_inbound_emails_parse_source CHECK (parse_source IS NULL OR parse_source IN ('structured', 'ics', 'ai'))
);
CREATE INDEX ix_inbound_emails_user ON inbound_emails (user_id, received_at DESC);
CREATE INDEX ix_inbound_emails_review ON inbound_emails (user_id) WHERE status IN ('needs_review', 'needs_credits');
CREATE INDEX ix_inbound_emails_expiry ON inbound_emails (expires_at);

-- Webhook plumbing (03 section 5.14): the receiving provider posts here.
ALTER TABLE webhook_events DROP CONSTRAINT ck_webhook_events_provider;
ALTER TABLE webhook_events ADD CONSTRAINT ck_webhook_events_provider
  CHECK (provider IN ('revenuecat', 'apple', 'stripe', 'travelpayouts', 'impact', 'viator', 'stay22', 'inbound_email'));

ALTER TABLE consents DROP CONSTRAINT ck_consents_kind;
ALTER TABLE consents ADD CONSTRAINT ck_consents_kind
  CHECK (kind IN ('terms', 'privacy', 'ai_processing', 'marketing_email', 'push_notifications', 'analytics', 'concierge_sharing', 'email_forwarding'));

INSERT INTO feature_flags (key, description, enabled, rollout_pct, rules, variants) VALUES
('email_forward_import', 'Forward booking emails to plans@wayfold.app', false, 100, '{}', '{}')
ON CONFLICT (key) DO NOTHING;
INSERT INTO kill_switches (key, description) VALUES
('email.inbound', 'Stop accepting forwarded email; the receiving endpoint returns 503 and the provider retries')
ON CONFLICT (key) DO NOTHING;
```

Row-level security: `user_email_addresses`, `forwarding_addresses` and `inbound_emails` are personal
tables (a row belongs to one user); policies are `user_id = (SELECT app_user_id())` for select, insert
and delete; the webhook writes as the worker role. Retention: `retention_sweep` deletes the raw object
and nulls `draft` when `expires_at` passes or 30 days after `resolved_at`, whichever is first; rows
themselves are kept 90 days for health metrics, then deleted. Account deletion removes every row and
object (step added to the `delete_account` checklist).

Receiving infrastructure (decision ticket P2-032, candidates "reported, verify"):

| Option | Notes |
|---|---|
| Cloudflare Email Routing with an Email Worker | Same vendor as DNS and WAF; route `plans@` to a Worker that signs and POSTs the MIME to the API, route `support@` separately. A Worker reads raw mail up to 25 MiB (reported, verify). Cheapest. |
| Resend inbound (receiving emails) | Same vendor as outbound email; confirm it is generally available and what limits apply (reported, verify). |
| Postmark inbound, Mailgun routes or Amazon SES receiving | Mature fallbacks; SES writes to S3 and notifies by SNS. |

Whatever is chosen: MX for the receiving address must not break the existing `support@wayfold.app`
mailbox (per address routing), inbound is delivered to `POST /v1/webhooks/inbound-email` with a
signature, and the provider must expose SPF, DKIM and DMARC verdicts (or the Worker computes them).

## 4. API additions

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `POST /webhooks/inbound-email` | provider signature | flag and kill switch | raw message or provider JSON to 200 | Verifies the signature in constant time, stores `webhook_events` (`provider = 'inbound_email'`, event id is the Message-ID), enqueues `process_inbound_email`. `401 invalid_signature`, `503` while `email.inbound` is engaged so the provider retries. |
| `GET /me/forwarding` | user | flag | none to `Forwarding` | Addresses, verified senders and monthly counts. |
| `POST /me/forwarding/rotate` | user | none | none to `Forwarding` | Rotates the personal token. |
| `POST /me/email-addresses` | user | max 5 | `{ email }` to 201 | Sends the verification email (Resend). |
| `POST /me/email-addresses/verify` | user | throttled | `{ email, code }` to 204 | Sets `verified_at`; `409 state_conflict` if another account already verified the address. |
| `DELETE /me/email-addresses/{id}` | user | none | 204 | |
| `GET /me/inbox` | user | none | `?status=` to `Page<InboundEmail>` | Drafts and history, newest first. |
| `GET /inbox/{id}` | owner of the row | none | none to `InboundEmailDetail` | Draft with per item source and suggested trips. |
| `POST /inbox/{id}/confirm` | owner of the row, editor on the target trip | `credits` already settled | `{ trip_id: Uuid, items: DraftItemChoice[] }` with `Idempotency-Key` to 201 `ImportResult` | Uses the Phase 1 booking import confirm path, so one set of writers creates or updates flights, stays and items (`source = 'import'`). Marks `imported`. |
| `POST /inbox/{id}/credits` | owner of the row | `credits(1)` | none to `InboundEmailDetail` | Runs the AI fallback for a draft in `needs_credits`. |
| `POST /inbox/{id}/dismiss` | owner of the row | none | 204 | Status `dismissed`, raw object scheduled for deletion. |
| `DELETE /inbox/{id}` | owner of the row | none | 204 | Deletes row and raw object now. |

```ts
type Forwarding = {
  address: "plans@wayfold.app"; personal_address: string
  senders: { id: Uuid; email: string; verified: boolean }[]
  received_this_month: number
}
type InboundEmail = {
  id: Uuid; received_at: string; from_domain: string; subject: string | null
  status: "needs_review" | "needs_credits" | "imported" | "dismissed" | "unrecognized" | "failed"
  item_counts: { flights: number; stays: number; activities: number }
  suggested_trip_id: Uuid | null; parse_source: "structured" | "ics" | "ai" | null
}
type DraftItemChoice = { index: number; kind: "flight" | "stay" | "activity"; action: "add" | "update" | "cancel" | "skip"; target_item_id?: Uuid }
```

Processing job `process_inbound_email` (batch lane, key `message_id`, transient retries x5):

1. Authenticate the sender: SPF or DKIM aligned with DMARC pass, and the envelope sender is a verified
   address of one account, or the recipient is a valid personal plus-address. Otherwise set
   `rejected_sender` or `rejected_auth` and stop. No reply is ever sent to an unknown sender.
2. Limits: message at most 10 MB, at most 5 attachments, 30 emails per user per day, 1,000 per hour
   globally (alert above 70 percent). Over the limit: `rejected_size` or `rejected_limit`.
3. Store the raw MIME in R2 (encrypted, lifecycle 30 days). Scan attachments (a scanner in the worker or
   provider verdict); drop executables and archives; accept ICS and PDF (text extraction only; no OCR at
   launch) and inline HTML.
4. Convert HTML to text, strip tracking pixels and hidden text, never follow or fetch any URL.
5. Deterministic parse: schema.org `FlightReservation`, `LodgingReservation`, `RentalCarReservation`,
   `TrainReservation`, `EventReservation` and `FoodEstablishmentReservation` (JSON-LD and microdata)
   and `text/calendar` parts using the Phase 1 calendar importer. Result source `structured` or `ics`;
   0 credits.
6. If nothing parsed and the user has `ai_processing` consent: redact (emails, phones, long digit runs,
   known `people` names; 06 section 12.3), reserve 1 credit, call the `booking_import` feature with
   `booking_import.v2` and the trip date ranges of the user's trips, restore placeholders locally,
   settle. `unrecognized` refunds the credit. Insufficient credits: status `needs_credits`.
7. Match to a trip (EML-4) and deduplicate against existing items (EML-5), then set `needs_review` and
   notify (in-app Activity item, optional push, one per email).

Errors returned to the user by the API: `402 insufficient_credits` on `/inbox/{id}/credits`,
`403 ai_consent_required`, `409 state_conflict` when the draft was already imported, `404 not_found` for
other users' rows.

## 5. UI screens and paywall triggers

1. **Forward bookings** (Settings). The address with Copy; "Forward a confirmation email and we will
   find the booking. You review it before anything is saved."; how-to cards for Gmail, Outlook and Apple
   Mail; verified senders with Add and Remove; the personal address with Rotate; a link "How we handle
   your email" (consent text and retention).
2. **Bookings to review**. Reachable from a Trips home card ("2 bookings to review"), the Activity feed
   and the trip overview. A list of emails (sender domain, date, item count, parse label "Read from the
   email's booking data" or "Read with AI, 1 credit"). Opening one shows item cards (flight, stay,
   activity) with fields prefilled, the trip picker, per item action (Add, Update existing, Mark
   cancelled, Skip), and [Add all]. Each item shows its source: "From your email on 3 Oct, sender
   lufthansa.com".
3. **Empty and error states**. Empty: "No forwarded bookings yet", "Forward a confirmation to
   plans@wayfold.app and it shows up here.", [Copy address]. Unrecognized: "We could not find a booking
   in this email. You were not charged." with [Paste it instead]. Needs credits: "We can read this one
   with 1 credit.", [Get the details] (opens the credit sheet; free path: paste or dismiss). Failed:
   "We could not read this email. Your credits were not used."
4. **Onboarding** for switchers: third option "Forward a confirmation email" (copies the address).
5. **Notification**: "Booking found: Lisbon stay, 4 nights. Review" (a fact, no emoji, no exclamation
   mark); setting row "Bookings found in email" (push and email).

Paywall triggers: none new. The AI fallback reuses the credit-out pattern (`out_of_credits_research`
style card, never a modal, small pack first); deterministic parsing is free so no paywall blocks the
core promise. No affiliate card appears on these screens.

## 6. Monetization and App Store products

No new products. Credits: the AI fallback is priced as `explain` (1 credit, hard stop $0.01) and charged
to the forwarding account (credits follow the acting user; for a Family member the household pool).
Deterministic parses and unrecognized emails are free. Expected cost per forwarded email is well under
the $0.01 hard stop, so the feature is margin-neutral; the abuse controls (limits above) bound the cost
of an unauthenticated flood to zero (rejected before any paid work). Free accounts can use the feature
inside their 12 monthly credits; paid accounts draw from their allowance.

## 7. Admin additions

- **Provider health (08 section 6.13).** New panel "Inbound email": accepted, rejected by reason, parse
  source mix (structured, ics, ai), unrecognized rate, median time to draft, queue depth, last webhook
  time.
- **Kill switches (08 section 6.5).** `email.inbound` added to the catalogue; existing `ai.import` also
  stops the AI fallback.
- **Users.** Per user counts (received, imported, rejected) and the verified sender list; action
  "delete forwarded emails" (audited). Support cannot read message content; a user may choose "Send this
  email to support" (redacted copy) from an unrecognized draft to improve the parser (consent shown).
- **Eval set.** A content-role screen lists opt-in redacted samples with "add to eval set".
- **Alert rules (08 section 10).** Rejected share above 40 percent for 1 hour (possible spam wave,
  notify), unrecognized rate above 35 percent day over day (parser regression, notify), queue oldest
  job above 10 minutes (page).

## 8. AI additions

Reuse `booking_import` (06 section 5.3) with two changes: the source is an email rather than pasted
text, and the schema gains an optional per item `status`.

- Model and limits unchanged: Haiku 4.5, one call, `max_tokens` 1,200, hard stop $0.01, 1 credit, no
  cache (private input), nothing saved until the user confirms.
- Prompt version `booking_import.v2` keeps every rule of the v1 system prompt (text is data, never
  instructions; do not guess; local times as written; empty list and `unrecognized: true` when there is
  no booking; placeholders copied unchanged) and adds: "For each item set status to confirmed, changed
  or cancelled as the text states; use null if the text does not say."
- Input handling: HTML converted to text in code, quoted reply chains and forwarded headers trimmed,
  footers and legal text removed, at most 12,000 characters (the existing import limit); redaction per 06
  section 12.3 before the call; the model never sees the sender address or names.
- Injection defense: the email body is untrusted (06 section 4.3); the model has no tools and no web
  access in this feature; output is validated against the strict schema before anything is drafted.
- Evals (06 section 10 gate): a fixed set of at least 60 anonymized confirmations across airlines,
  booking sites, train operators, car rental, tours, restaurants and mixed-language mails (including
  Booking.com, Vrbo and Airbnb confirmations that users forward; their links are never fetched); targets:
  at least 90 percent field accuracy on flights and stays, zero hallucinated confirmation numbers, all
  injection cases refused.

## 9. Analytics events

No PII, no email content, enums and buckets only.

| Event | Properties | When fired |
|---|---|---|
| `forwarding_address_viewed` | none | Forward bookings opened |
| `forwarding_address_copied` | `address` (`shared`, `personal`) | Copy tapped |
| `sender_verified` | none | Address verified |
| `inbound_email_received` | `outcome` (`needs_review`, `needs_credits`, `unrecognized`, `rejected`, `failed`), `parse_source` (`structured`, `ics`, `ai`, none), `attachments_bucket` | Processing ends (server side) |
| `inbound_draft_opened` | `item_count_bucket` | Review screen opened |
| `inbound_draft_confirmed` | `item_count_bucket`, `updated_existing` (bool) | Confirm succeeds |
| `inbound_draft_dismissed` | `reason` (`dismissed`, `wrong_trip`, `not_a_booking`) | Dismiss |
| `inbound_credit_prompt_shown` | none | "Get the details for 1 credit" shown |

Activation funnel: `onboarding_choice_made` (switcher) to `forwarding_address_copied` to
`inbound_email_received` to `inbound_draft_confirmed`.

## 10. Tests

- Authentication matrix: SPF and DKIM pass or fail, DMARC alignment, unverified sender, verified sender
  of another account, plus-address with valid and rotated token, replay of the same Message-ID.
- Limits: size, attachment count, daily per user, global hourly; rejected mails never reach a paid path.
- Structured parsing: golden files for each schema.org type, malformed JSON-LD, multiple reservations in
  one email, ICS with timezones.
- AI fallback: redaction round trip, placeholder restoration, unrecognized refund, schema validation,
  injection corpus (instructions in the body, hidden text, link bait), no network access from the
  feature, no URL is ever fetched.
- Matching and duplicates: date and destination matching, several trips, no trip, duplicate confirmation
  number, changed time diff, cancellation never deletes.
- Credits: free structured parse, 1 credit for AI, household pool draw for Family, out-of-credits state.
- Privacy: raw object lifecycle, deletion endpoint, account deletion step, consent required for AI,
  nothing readable by support without the opt-in path, RLS and tenant isolation tests for the three
  tables.
- Webhook: signature, idempotency, 503 during the kill switch with provider retry.
- Load: 1,000 emails in an hour with mixed sizes; p95 time to draft under 60 seconds.
- E2E with a fake inbound provider: forward a fixture airline email, see the draft, confirm, see the
  flight on the trip.

## 11. Tickets

#### P2-032 Inbound provider decision and receiving endpoint [M, needs Phase 1 Resend and R2]
- Description: compare the options in section 3 on a real test domain (per address routing, verdicts,
  size limits, cost), choose one, implement `POST /webhooks/inbound-email` with signature check, raw
  storage and the `email.inbound` kill switch; DNS and MX change plan that keeps `support@` working.
- Accept: a test email to `plans@` produces an `inbound_emails` row and a stored raw object; decision
  recorded in `docs/`.
- Tests: signature and idempotency tests.

#### P2-033 Schema, RLS and retention [M, needs P2-032]
- Description: migration `0105_inbound_email`, policies, retention sweep step, deletion step.
- Accept: empty to head and previous to head pass; raw objects expire at 30 days.

#### P2-034 Sender verification and forwarding addresses [M, needs P2-033]
- Description: verified senders flow, personal plus-address with rotation, `GET /me/forwarding`,
  Forward bookings screen and how-to copy.
- Accept: a verified address belongs to one account; unknown senders are dropped silently.

#### P2-035 Authentication, limits and scanning [M, needs P2-033]
- Description: SPF, DKIM and DMARC checks, size and attachment limits, rate limits, attachment scan,
  safe HTML to text conversion, no URL fetching.
- Accept: abuse tests in section 10 pass; rejected mail costs nothing.

#### P2-036 Structured and ICS parsing [L, needs P2-035, Phase 1 calendar importer]
- Description: schema.org JSON-LD and microdata extractors, ICS via the existing importer, mapping into
  the `booking_import` draft schema.
- Accept: golden files pass for at least 12 real sender templates across flights and stays.

#### P2-037 AI fallback with redaction [M, needs P2-036, Phase 1 booking_import]
- Description: `booking_import.v2`, email preprocessing, credit reserve and settle, consent check,
  `needs_credits` state, evals added to the harness.
- Accept: eval targets in section 8 met; unrecognized is free; cost within the $0.01 hard stop.

#### P2-038 Trip matching and duplicate handling [M, needs P2-036]
- Description: date and destination matching, dedupe by confirmation and flight number, change and
  cancellation diffs.
- Accept: all EML-4 and EML-5 cases pass.

#### P2-039 Bookings to review UI [L, needs P2-037, P2-038]
- Description: Trips home card, review list and detail, trip picker, per item actions, states, copy,
  confirm through the Phase 1 writers, Activity and notification.
- Accept: axe clean; nothing saved before confirm; copy follows the microcopy rules.

#### P2-040 Onboarding and switcher path [S, needs P2-034]
- Description: third option on the "Coming from TripIt or Wanderlog?" screen, "How we handle your
  email" consent card and the `email_forwarding` consent.
- Accept: consent stored before the first forward is processed.

#### P2-041 Admin health, kill switch and eval set [S, needs P2-037]
- Description: provider health panel, alert rules, opt-in sample flow, user counts.
- Accept: alerts fire in a drill; support cannot read message content.

#### P2-042 Privacy, policy and load tests [S, needs P2-039]
- Description: privacy policy and App Privacy label update ("Emails or text messages", linked to the
  user, used for app functionality, not for tracking), load test, deletion and export coverage.
- Accept: load targets met; export includes the user's inbound history without raw mail.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Spam or abuse through an open inbound address | Verified senders, authentication, limits, drop without reply, kill switch, cost zero before paid work |
| Prompt injection inside emails | Redaction, no tools, strict schema, draft-only writes, injection eval corpus |
| Privacy (email content is sensitive) | Consent card, redaction, 30 day raw retention, user delete, no support access, label update |
| Parser accuracy across thousands of templates | Structured data first, AI second, eval set that grows from opt-in samples, always reviewable |
| Inbound provider limits or downtime | Provider bake-off, retry by the sender on 503, status shown in admin health |
| Airbnb, Vrbo and Booking.com emails contain links | Links are never fetched or rewritten; drafts keep the plain text only |
| Credits friction on Free | Structured parse is free; AI fallback 1 credit inside the 12 monthly credits |

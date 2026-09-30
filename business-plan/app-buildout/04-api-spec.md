# 04. API specification

Part of the [Wayfold build specification](README.md). The README decisions (tiers, credit action codes, table names, non-negotiable rules) are final and this file follows them. The database is in [03-database-schema.md](03-database-schema.md), the agents behind the AI endpoints in [06-ai-agents-spec.md](06-ai-agents-spec.md), purchases and paywall logic in [07-monetization-spec.md](07-monetization-spec.md), and the admin console in [08-admin-control-center.md](08-admin-control-center.md).

Written 2026-09-30. This file defines every HTTP endpoint the web and iOS clients and the partner systems call. It is written so the route modules can be built one per section, in FastAPI, and the TypeScript client generated from the result.

## 1. Conventions

### 1.1 Base URL, format and versioning

| Item | Rule |
|---|---|
| API base | `https://api.wayfold.app/v1` in production, `https://api.staging.wayfold.app/v1` in staging, `http://localhost:8000/v1` in development. All paths below are relative to it unless they start with `/go` or `/.well-known`. |
| Redirect host | `https://go.wayfold.app/go/{click_id}` (same service, separate hostname so cookies and CSP never mix with the API). |
| Format | JSON (`application/json; charset=utf-8`) in and out. Dates are `YYYY-MM-DD`, times `HH:MM:SS`, timestamps RFC 3339 in UTC (`2026-09-30T14:05:00Z`). Only the SSE and redirect endpoints return something else. |
| Names | `snake_case` for fields, `kebab-case` for path segments, plural nouns for collections. |
| Ids | Every public id is a UUIDv7 string. Integer ids from the existing Trip Planner never appear. Ids are opaque: clients never parse them. |
| Money | `{ "amount_minor": 13900, "currency": "USD" }`: integer minor units plus ISO 4217. Fares and lodging prices also carry `observed_at`. Never a float. |
| Nulls | Absent optional fields are returned as `null`, never omitted, so generated types are stable. In PATCH bodies, an omitted field means "leave unchanged" and an explicit `null` clears a nullable field. |
| Versioning | The major version is in the path. Additive changes (new fields, endpoints, enum values) are not breaking: clients must ignore unknown fields and treat unknown enum values as "other". A breaking change ships as `/v2` alongside `/v1` for at least 12 months. Old iOS builds are supported through `X-Client-Version` (1.7) and a minimum-version gate on `GET /me`. |
| Compression and caching | gzip and brotli. Reads that return `ETag` support `If-None-Match` and answer `304`. Responses carry `Cache-Control: private, no-store` unless an endpoint says otherwise. |

### 1.2 Authentication

- Sign-in happens in Supabase Auth (Sign in with Apple, Google, email code). The client sends the Supabase access token on every call: `Authorization: Bearer <jwt>`. The web build may instead send the HttpOnly session cookie; cookie requests must also send `X-Wayfold-Client: web` and a same-origin `Origin` (CSRF guard carried over from `X-Trip-Planner: 1`).
- One FastAPI dependency, `CurrentUser`, verifies signature (JWKS, cached 10 minutes), `iss`, `aud`, `exp` and `sub`, resolves `auth_identities(provider, subject)` to a `users` row, and rejects any status other than `active` with `403 account_inactive` (status `pending_deletion` gets `403 account_pending_deletion`, and only `POST /me/deletion/cancel` and `GET /me` work). A first-time valid JWT with no identity row is handled by `POST /me/bootstrap`, the only endpoint that accepts a JWT without a users row.
- Agent workers do not use user tokens. The worker calls internal functions directly, not HTTP. The legacy `/api/agent/v1` bridge is removed.
- Partner callers (webhooks) authenticate with signatures or shared secrets (section 6). Admin callers use the admin API (section 5.31).
- Guest mode is local-first; a guest has no token and calls no endpoint until they tap "Save your trip". `POST /me/claim` merges guest data after sign-in (5.1).

### 1.3 Authorization: roles and 404 for non-members

| Role | Code | Summary |
|---|---|---|
| Owner | `owner` | Everything on the trip, including delete, transfer, invites and share links. Exactly one per trip. |
| Editor | `editor` | Edit itinerary, lodging, flights, notes, checklist; vote; start AI actions from their own credits; invite viewers if the owner allows. |
| Viewer | `viewer` | Read, comment, vote in polls and lodging votes. No edits, no AI, no invites. |

Trip-scoped routes declare a minimum role through `require_trip(trip_id, min_role)`. A caller who is not a member gets `404 not_found`, never `403`, for every id in the path, so ids cannot be probed. A member whose role is too low gets `403 insufficient_role`. Routes that take a child id (for example `/lodging/{id}`) join up to the trip and apply the same rule. A CI test walks `app.routes` and fails if any route with an id parameter does not use the dependency. Request bodies never accept `owner`, `role` (except on invite and member-role routes), `tier` or `user_id`.

Trip capabilities (what the trip can do) come from the better of the owner's tier and any active `trip_passes` row for that trip. Credits are charged to the acting user. Both are explained to the client through `capabilities` (2.3) and `GET /me/entitlements` (5.25).

### 1.4 Errors: RFC 9457 problem+json

Every non-2xx response has `Content-Type: application/problem+json` and this shape:

```ts
type Problem = {
  type: string              // "https://api.wayfold.app/problems/<code>"
  title: string             // short, stable English summary
  status: number
  code: string              // machine code from the catalogue (section 3)
  detail: string            // human sentence, safe to show; no em dashes
  instance: string          // "/v1/trips/0191..."
  request_id: string        // same as X-Request-Id
  errors?: { field: string; code: string; message: string }[]   // validation only
  retry_after_seconds?: number
  current?: unknown         // 409 version_conflict: the latest resource
  paywall?: PaywallHint     // 402 and 403 gate errors: see 5.26
  credits?: { needed: number; balance: number }                  // insufficient_credits
}
```

Clients switch on `code`, never on `title` or `detail`. Stack traces and SQL never appear. FastAPI's default 422 body is replaced by a handler that maps to `validation_failed` with `errors`.

### 1.5 Pagination

Collections that can grow use cursor pagination. Small bounded collections (a trip's days, a trip's members) return a plain array.

```
GET /v1/trips?limit=50&cursor=eyJ0IjoiMDE5MS4uLiJ9
-> 200 { "items": [ ... ], "next_cursor": "eyJ0Ijoi..." | null, "has_more": true }
```

`limit` defaults to 50, maximum 200. Cursors are opaque, signed, expire after 24 hours, and encode the sort key plus id. Default order is newest first by `created_at` unless an endpoint says otherwise. Sync-style lists also accept `updated_since=<timestamp>` and return deleted rows as tombstones (`{ "id": "...", "deleted_at": "..." }`) so polling clients can drop them.

### 1.6 Idempotency keys

`Idempotency-Key: <uuid>` (client generated) is **required** on every POST that spends credits or money, and optional but honored on all other POSTs. The required list: `/trips/{id}/ai/*`, `/trips/{id}/agent-runs`, `/trips/{id}/flights/live-search`, `/trips/{id}/lodging/rental-search`, `/trips/{id}/concierge-requests`, `/trips/{id}/room-block-requests`, `/credits/packs/claim`, `/purchases/sync`, `/trips/{id}/expenses`, `/trips/{id}/settlements`, `/print-orders`, `/trips/{id}/agent-runs/{id}/cancel` (no cost, but it refunds).

- Keys are stored for 24 hours with the request hash, the status and the response body (table `ai_usage.idempotency_key` for credit spends, and a generic `idempotency_keys` row for the rest: key, user id, method, path, request hash, response). The same key with the same body replays the original response and adds `Idempotent-Replay: true`. The same key with a different body gets `422 idempotency_key_reused`. The same key while the first request is still running gets `409 idempotency_in_progress` with `Retry-After: 1`.
- A missing key on a required route gets `400 idempotency_key_required`.
- Credit reservation and ledger writes key off the same value, so a retried agent start can never charge twice.

### 1.7 Optimistic concurrency

Every editable resource has an integer `version` starting at 1, incremented on each successful write, and returns a strong `ETag: "<version>"`. Two equivalent ways to send it:

- `If-Match: "<version>"` header on `PATCH`, `PUT` and `DELETE` (preferred).
- `version` in the body of a PATCH.

If both are absent, the write is rejected with `428 precondition_required` for resources marked "versioned" below (itinerary items, lodging options, notes, trip, expenses, polls, checklist items). On mismatch the response is `409 version_conflict` with the latest resource in `current`, and the client shows its conflict sheet ("Sam changed this. Keep yours or use theirs."). Last-writer-wins applies only to the offline queue, per field, where the client re-sends with the new version. Lists return `ETag` over the collection state and support `If-None-Match` for cheap polling (every 15 to 30 seconds on a shared trip, plus on foreground).

### 1.8 Rate limits and headers

Limits are stored in Postgres (a counter table with expiring rows) until about 10k MAU. Every response carries the IETF draft headers:

```
RateLimit-Limit: 120
RateLimit-Remaining: 117
RateLimit-Reset: 38          # seconds until the window resets
RateLimit-Policy: 120;w=60
```

A rejected call returns `429 rate_limited` with `Retry-After` (seconds). Starting limits:

| Surface | Limit |
|---|---|
| Write API (POST, PUT, PATCH, DELETE) | 120 per minute per user, 600 per minute per IP |
| Read API | 600 per minute per user |
| Email code and sign-in exchange | handled at Supabase (5 per email per hour, 20 per IP per hour); `POST /me/bootstrap` 30 per IP per 10 minutes |
| Invites | 30 created per user per day, 20 pending per trip |
| AI actions | 30 per hour per user, one agent run at a time per account, plus credits and provider-spend ceilings |
| `POST /outbound` | 60 per hour per user, repeats within 30 seconds deduplicated |
| Share link views | 60 per minute per IP and 600 per hour per token |
| Export and deletion request | 1 per day each |
| Webhooks | not rate limited; signature failures 20 per minute per IP then blocked at Cloudflare |

### 1.9 Other headers and behaviors

| Header | Direction | Meaning |
|---|---|---|
| `X-Request-Id` | both | Client may send one (uuid); server always returns one and logs it with every line. |
| `X-Client-Version` | request | `ios/1.2.0` or `web/2026.10.3`. The server answers `426 client_upgrade_required` only when below `min_client_version` from `GET /me`. |
| `Accept-Language` | request | Locale for error `detail` and AI output. |
| `X-Wayfold-Client` | request | `web`, `ios`. Required with cookie auth. |
| `Idempotency-Key`, `If-Match`, `If-None-Match` | request | See 1.6 and 1.7. |
| `Deprecation`, `Sunset` | response | Set on endpoints being retired. |
| `Server-Timing` | response | `db;dur=12, ai;dur=840` for debugging. |

Kill switches (table `kill_switches`) can disable a feature at runtime. A disabled feature returns `503 feature_disabled` with `retry_after_seconds` when known. Cached data endpoints keep working when AI or live providers are switched off.

### 1.10 Async work

Anything longer than about 2 seconds (agent runs, exports, deletions, print orders, live searches that fan out to providers) returns `202 Accepted` with a resource to poll and, for agent runs, an SSE stream. A `Location` header points to the status resource. Jobs are Procrastinate tasks; workers never call the API over HTTP.

### 1.11 CORS and security headers

Allowed origins: the web app, `capacitor://localhost`, `https://localhost`. Allowed headers include `Authorization`, `Content-Type`, `Idempotency-Key`, `If-Match`, `If-None-Match`, `X-Wayfold-Client`, `X-Client-Version`, `X-Request-Id`. Exposed headers: `ETag`, `RateLimit-*`, `Retry-After`, `Idempotent-Replay`, `X-Request-Id`, `Location`. HSTS, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer` on all responses.

### 1.12 Tenant isolation and logging

Every request runs in a transaction with `SET LOCAL app.user_id` so row-level security catches a forgotten check. Each request logs one structured line: request id, user id, route template, status, latency, credits charged. No request bodies are logged. Notes, private comments and pasted text never go to Sentry.

## 2. Shared types

Used by the endpoint tables. Written as TypeScript-like blocks; FastAPI models mirror them.

### 2.1 Primitives

```ts
type Uuid = string                          // UUIDv7
type Money = { amount_minor: number; currency: string }
type Iata = string                          // "LIS"
type Role = "owner" | "editor" | "viewer"
type Tier = "free" | "plus" | "family" | "pro"
type Product = Tier | "trip_pass" | "group_trip_pass"
type CreditAction = "explain" | "live_search" | "draft_day" | "draft_trip" | "research" | "agent_run"
type Page<T> = { items: T[]; next_cursor: string | null; has_more: boolean }
type Attribution = { id: Uuid; display_name: string | null }   // null display_name means "Former member"
```

### 2.2 Credit and gate envelopes

Every credit-spending success body includes:

```ts
type CreditReceipt = {
  action: CreditAction
  reserved: number            // credits held at start
  charged: number | null      // null until settled; 1 when served from shared cache
  from_cache: boolean
  balance_after: number       // total spendable credits now
  ledger_id: Uuid
}
```

```ts
type PaywallHint = {
  reason: "trip_limit" | "sharing" | "live_routes" | "credits" | "agent_taster_used"
        | "routines" | "family_members" | "traveler_limit" | "group_tools"
  offer_url: string           // GET /v1/paywall/offer?reason=...&trip_id=...
  free_path: string           // what the user can still do for free, plain sentence
}
```

### 2.3 Trip and capabilities

```ts
type Capabilities = {
  effective_tier: Tier | "trip_pass" | "group_trip_pass"
  source: "owner_tier" | "trip_pass"
  can_invite: boolean               // owner has Plus or better, or an active pass
  max_collaborators: number         // Plus 25, Trip Pass 6, Group Trip Pass 12, Family 25
  live_routes_max: number           // Free 0 (cached only), Plus 3, Family 5, Pro 6, Trip Pass 2
  live_routes_used: number
  live_checks_left: number | null   // Trip Pass: 60 cap
  can_use_group_tools: boolean      // polls, expenses, settlements: Group Trip Pass or Family or Pro
  can_request_room_block: boolean
  agent_enabled: boolean            // owner setting and consent
  limited: boolean                  // tier lapsed: members downgraded to viewers, banner shown
  pass_expires_at: string | null
}

type Trip = {
  id: Uuid; version: number
  name: string; status: "planning" | "booked" | "done" | "archived"
  start_date: string | null; end_date: string | null
  home_currency: string; notes: string
  destinations: Destination[]
  travelers: Person[]                          // people linked through trip_people
  cover: { image_url: string; destination_name: string; attribution: string | null } | null
  flight_dates: { start: string; end: string | null; flights: ChosenFlightRef[] } | null
  my_role: Role
  capabilities: Capabilities
  ai_enabled: boolean                          // owner toggle
  member_count: number
  owner: Attribution
  created_at: string; updated_at: string; deleted_at: string | null
}
```

`Trip` keeps the shape of today's `TripOut` (destinations, travelers, cover, flight dates) and adds `version`, `my_role`, `capabilities`, `ai_enabled` and `owner`.

## 3. Error code catalogue

| HTTP | `code` | When | Client behavior |
|---|---|---|---|
| 400 | `bad_request` | Malformed JSON or query | Fix request |
| 400 | `idempotency_key_required` | Missing header on a required route | Generate and retry |
| 401 | `unauthenticated` | No or invalid token | Refresh once, then sign-in |
| 401 | `token_expired` | JWT past `exp` | Refresh and retry |
| 402 | `insufficient_credits` | Balance below action price | Show credit sheet with `credits` and `paywall` |
| 402 | `payment_required` | Feature needs a paid tier or pass | Show paywall from `paywall` |
| 403 | `insufficient_role` | Member role too low | Hide control |
| 403 | `entitlement_required` | Tier or capability missing (`paywall` set) | Paywall moment |
| 403 | `limit_reached` | Quota hit (active trips, routes, alerts, collaborators) | Paywall or explain |
| 403 | `account_inactive` | Suspended user | Show support contact |
| 403 | `account_pending_deletion` | In 30 day grace | Offer cancel |
| 403 | `ai_consent_required` | No `ai_processing` consent | Show consent screen |
| 403 | `ai_disabled_for_trip` | Owner turned AI off | Explain |
| 404 | `not_found` | Missing or not a member | Generic not found |
| 405 | `method_not_allowed` | Wrong method | Bug |
| 409 | `version_conflict` | Stale `If-Match` or body version | Show conflict sheet using `current` |
| 409 | `idempotency_in_progress` | Duplicate in flight | Retry after 1 s |
| 409 | `run_already_active` | One agent run at a time | Open the active run |
| 409 | `already_member` | Invite for an existing member | Open trip |
| 409 | `state_conflict` | Invalid transition (cancel a finished run) | Refresh |
| 410 | `invite_expired` | Invite past expiry, revoked or used up | Ask for a new invite |
| 410 | `share_link_revoked` | Share link revoked or expired | Show gone page |
| 412 | `precondition_failed` | `If-Match` not parseable | Bug |
| 413 | `payload_too_large` | Body over limit (1 MB JSON, 10 MB upload) | Shrink |
| 422 | `validation_failed` | Field errors in `errors` | Show field messages |
| 422 | `idempotency_key_reused` | Key reused with different body | Use a new key |
| 422 | `blocked_domain` | Link to a domain we never fetch | Explain, save link without preview |
| 422 | `unsupported_currency` | Currency not in `fx_rates` | Pick another |
| 426 | `client_upgrade_required` | Below minimum client | Show update screen |
| 428 | `precondition_required` | Versioned write without `If-Match` | Bug |
| 429 | `rate_limited` | Limit hit | Back off per `Retry-After` |
| 429 | `provider_budget_exhausted` | Daily or monthly provider-spend ceiling | Explain, show cached data |
| 500 | `internal_error` | Unhandled | Retry, report `request_id` |
| 502 | `provider_error` | Upstream (Anthropic, SerpApi, Travelpayouts) failed; credits released | Retry later |
| 503 | `feature_disabled` | Kill switch | Show notice |
| 503 | `provider_unavailable` | Upstream down | Show cached data |
| 504 | `provider_timeout` | Upstream timed out; credits released | Retry |

Webhook endpoints use a smaller set: `401 invalid_signature`, `400 bad_payload`, `200` for duplicates and unhandled event types, `500` only for retryable failures so the sender retries.

## 4. Gates and costs at a glance

Gate codes used in the endpoint tables. A call that fails a gate returns the error shown, with `paywall` set.

| Gate | Passes when | Failure |
|---|---|---|
| none | Any signed-in user | n/a |
| `member(role)` | Caller is a member at or above `role` | 404 or `insufficient_role` |
| `can_invite` | Trip capabilities say `can_invite` (owner Plus or better, or a pass) | 403 `entitlement_required`, reason `sharing` |
| `active_trips` | Free owner has fewer than 2 active trips (Plus fair use 25) | 403 `limit_reached`, reason `trip_limit` |
| `live_route` | `live_routes_used < live_routes_max` and within 120 days of departure | 403 `limit_reached`, reason `live_routes` |
| `group_tools` | Trip has Group Trip Pass, Family or Pro owner | 403 `entitlement_required`, reason `group_tools` |
| `ai` | `ai_processing` consent, trip `ai_enabled`, kill switch open | `ai_consent_required`, `ai_disabled_for_trip`, `feature_disabled` |
| `credits(n)` | Spendable credits at least `n` and provider ceiling has headroom | 402 `insufficient_credits` or 429 `provider_budget_exhausted` |
| `taster` | Free user has not used the lifetime deep run | 402 `payment_required`, reason `agent_taster_used` |
| `pro` | Caller's tier is `pro` | 403 `entitlement_required`, reason `routines` |
| `admin(role)` | Caller is an `admin_users` row with the role | 404 (routes are hidden) |

Credit prices (README, final): `explain` 1, `live_search` 1, `draft_day` 1, `draft_trip` 4, `research` 8 (1 from shared cache), `agent_run` 40 (8 from shared cache). Hard stops are enforced in the worker, not the API. Credit-spending endpoints reserve before work, settle after, and release on `provider_error`, `provider_timeout` or cancellation before a result.

## 5. Endpoints by module

Table columns: **Endpoint** (method and path), **Auth** (minimum role, all require a bearer token unless stated), **Gate and cost**, **Request and response**, **Errors and side effects**. "Standard errors" means 401, 404 (non-member), 422, 429, 500. Bodies are shown in the schema block under each table. A trailing `?` marks an optional field.

### 5.1 Auth and session bootstrap

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `POST /me/bootstrap` | JWT, no users row needed | none | `BootstrapIn` to `Me` (201 new, 200 existing) | Creates `users`, `auth_identities`, the "Me" `people` row, a `free` `entitlements` row, the first monthly `credit_grants` row (12 credits). Records Apple relay email flag. Emits `user_signed_up`. |
| `GET /me` | user | none | `Me` | Returns server clock, `min_client_version`, feature flags evaluated for the user, and pending deletion state. Polled on foreground. |
| `POST /me/claim` | user | none | `{ guest_token, merge?: boolean }` to `ClaimResult` | Validates the signed guest token (App Attest assertion inside). Imports the guest's local trip (one) and people. If identity already owns data and `merge` is absent: `409 state_conflict` with counts in `detail`. |
| `POST /me/sign-out` | user | none | none to 204 | Revokes the current device's refresh token and unregisters its push token. |
| `POST /me/sign-out-everywhere` | user, recent auth | none | none to 204 | Revokes all devices and sessions, marks `devices.revoked_at`. Audit event. |
| `GET /me/devices` | user | none | none to `Device[]` | Lists signed-in devices. |
| `PUT /me/devices/{device_id}` | user | none | `DeviceIn` to `Device` | Registers or updates a device (upsert by `installation_id`). Stores APNs token, platform, app version, locale, notification prefs. |
| `DELETE /me/devices/{device_id}` | user | none | 204 | Revokes that device's session. |
| `PUT /me/push-token` | user | none | `{ device_id, apns_token, environment: "sandbox" \| "production" }` to 204 | Sets the token on the device. Invalid tokens are cleared when APNs answers 410. |
| `GET /health` | none | none | `{ status: "ok", version }` | Liveness. `GET /health/ready` checks Postgres and the queue. No auth, no rate limit headers. |

```ts
type BootstrapIn = {
  display_name?: string; locale?: string; timezone?: string
  home_airports?: Iata[]; home_currency?: string
  age_confirmed: boolean                     // 13+ (16+ EU and UK locales)
  device?: DeviceIn
  guest_token?: string                       // claim in one step
}
type Me = {
  id: Uuid; email: string | null; email_is_relay: boolean
  display_name: string | null; locale: string; timezone: string
  home_currency: string; home_airports: Iata[]
  status: "active" | "pending_deletion"
  tier: Tier; me_person_id: Uuid
  household: { id: Uuid; role: "admin" | "member" } | null
  consents: { kind: string; version: string; accepted_at: string }[]
  flags: Record<string, boolean>
  min_client_version: string
  server_time: string
}
type DeviceIn = {
  installation_id: string; platform: "ios" | "web"; app_version: string
  os_version?: string; locale?: string; apns_token?: string
  notifications?: { price_alerts: boolean; trip_changes: boolean; reminders: boolean }
}
type Device = DeviceIn & { id: Uuid; current: boolean; last_seen_at: string; revoked_at: string | null }
type ClaimResult = { trip_id: Uuid | null; people_imported: number; items_imported: number }
```

### 5.2 Account: profile, consents, export, deletion

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `PATCH /me/profile` | user | none | `ProfileUpdate` to `Me` | Updates display name, locale, timezone, home currency and airports. Also updates the "Me" person's name and home airports. |
| `GET /me/settings` | user | none | none to `UserSettings` | Per-user settings (replaces the global `AppSetting`). |
| `PUT /me/settings` | user | none | `UserSettings` to `UserSettings` | Full replace. |
| `GET /me/consents` | user | none | none to `Consent[]` | Current accepted versions and withdrawals. |
| `PUT /me/consents/{kind}` | user | none | `{ version: string, granted: boolean }` to `Consent` | Kinds: `terms`, `privacy`, `ai_processing`, `marketing_email`, `analytics`. Appends a `consents` row (history kept). Withdrawing `ai_processing` makes every AI endpoint return `ai_consent_required`; running agent runs are cancelled. Marketing opt-out also honors one-click unsubscribe. |
| `POST /me/export` | user, re-auth within 10 minutes | 1 per day | none to 202 `DataExport` | Inserts `data_exports`, enqueues the export job. Zip of JSON plus a CSV or PDF per trip, emailed as a signed link valid 7 days. `429 rate_limited` on a second request within a day. |
| `GET /me/export` | user | none | none to `DataExport[]` | Status list: `queued`, `building`, `ready`, `expired`, `failed`. |
| `GET /me/export/{export_id}/download` | user | none | 302 to a signed R2 URL (5 minutes) | `410` if expired. |
| `POST /me/deletion` | user, re-auth within 10 minutes | 1 per day | `{ confirm: "DELETE", transfers?: { trip_id: Uuid, new_owner_id: Uuid }[], delete_trip_ids?: Uuid[] }` to 202 `DeletionRequest` | Inserts `deletion_requests`. At once: sessions and refresh tokens revoked, Apple token revoked, push tokens cleared, pending invites cancelled, status `pending_deletion`. Sole-owner trips with other members and no choice: 30 day wait for a member to accept a transfer, then deleted. Hard purge at 30 days. Does not cancel store subscriptions (response includes `manage_subscription_url`). |
| `POST /me/deletion/cancel` | user | within grace | none to `Me` | Restores `active`. Sessions stay revoked; the user signs in again. |
| `GET /me/deletion` | user | none | none to `DeletionRequest \| null` | Progress checklist and purge date. |
| `DELETE /me/ai-history` | user | none | none to 204 | Deletes stored prompt and response content for the user's runs (metadata kept for billing). |

```ts
type ProfileUpdate = Partial<{
  display_name: string; locale: string; timezone: string
  home_currency: string; home_airports: Iata[]
}>
type UserSettings = {
  units: "metric" | "imperial"; time_format: "12h" | "24h"; week_starts_on: 0 | 1 | 6
  hide_booking_links: boolean                 // "Hide booking links" switch
  default_trip_ai_enabled: boolean
  notifications: { price_alerts: boolean; trip_changes: boolean; reminders: boolean; digest: boolean }
}
type Consent = { kind: string; version: string; granted: boolean; accepted_at: string }
type DataExport = { id: Uuid; status: string; requested_at: string; ready_at: string | null; expires_at: string | null }
type DeletionRequest = {
  id: Uuid; status: "pending" | "purging" | "done" | "cancelled"
  purge_at: string; checklist: { step: string; done: boolean }[]
  manage_subscription_url: string
}
```

### 5.3 Households (Family)

A household belongs to a Family subscriber and shares the tier, the pooled 150 credits and 5 live routes across up to 6 members. Trips stay per-trip membership; the household only shares entitlements and the credit pool.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /households/current` | user | none | none to `Household \| null` | Household the caller belongs to, with members and pooled credit balance. |
| `POST /households` | user with tier `family` | Family | `{ name: string }` to 201 `Household` | Creates `households` and an admin `household_members` row. One household per Family subscription. |
| `PATCH /households/{id}` | household admin | none | `{ name? }` to `Household` | Rename. |
| `POST /households/{id}/invites` | household admin | seats left under 6 | `{ email?: string }` to 201 `HouseholdInvite` | Universal link `https://wayfold.app/h/<token>`, 7 day expiry, single use. Email sent through Resend when `email` is set. |
| `POST /household-invites/{token}/accept` | user | none | none to `Household` | Joins; entitlements recomputed (member gets Family tier, draws from the pool). Fails with `410 invite_expired`, `403 limit_reached` (6 seats), `409 already_member`. A user with their own paid sub is told their sub keeps running and stays separate. |
| `DELETE /households/{id}/members/{user_id}` | household admin, or the member themself | none | 204 | Removes member; their entitlements recomputed at once. The admin cannot be removed while others remain. |
| `DELETE /households/{id}` | household admin | none | 204 | Dissolves; members fall back to their own tier. |

```ts
type Household = {
  id: Uuid; name: string
  members: { user_id: Uuid; display_name: string | null; role: "admin" | "member"; joined_at: string }[]
  seats_total: 6; seats_used: number
  pooled_credits: { balance: number; monthly_grant: 150 }
}
type HouseholdInvite = { id: Uuid; url: string; expires_at: string }
```

### 5.4 Trips

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips` | user | none | `?status=&include=joined,owned&limit&cursor&updated_since` to `Page<TripSummary>` | Trips where the caller is a member, excluding soft-deleted. `ETag` supported. |
| `POST /trips` | user | `active_trips` | `TripCreate` to 201 `Trip` | Creates `trips`, the owner `trip_members` row, `trip_destinations`, and `trip_people` links. Free owner with 2 active trips gets 403 `limit_reached` (reason `trip_limit`, `free_path`: "Archive a trip or join trips other people plan"). Joined trips never count. |
| `GET /trips/{trip_id}` | viewer | none | none to `Trip` | `ETag` is the trip version. |
| `PATCH /trips/{trip_id}` | editor (status and `ai_enabled`: owner) | versioned | `TripUpdate` to `Trip` | Replaces destinations and travelers when sent. Changing dates re-derives `itinerary_days`; items on removed days become unscheduled, never deleted. Sets cover from the first destination image. |
| `DELETE /trips/{trip_id}` | owner | none | none to 204 | Soft delete (`deleted_at`), 30 days in trash. Cancels active agent runs and routines, revokes invites and share links. |
| `POST /trips/{trip_id}/restore` | owner | within 30 days | none to `Trip` | Undeletes. |
| `POST /trips/{trip_id}/transfer` | owner | target is a member | `{ new_owner_id: Uuid }` to `Trip` | New owner becomes `owner`, previous owner becomes `editor`. Capabilities re-evaluated against the new owner's tier; a lapsed tier yields `limited: true`. Notifies both. |
| `POST /trips/{trip_id}/leave` | member (not owner) | none | none to 204 | Removes the caller; contributions stay attributed to "Former member". Owner must transfer first (`409 state_conflict`). |
| `POST /trips/{trip_id}/refresh-info` | editor | none | none to 202 | Re-fetches destination summaries and images (Wikipedia, Geoapify). No credits, counted against a per-trip daily limit. |
| `GET /trips/{trip_id}/activity` | viewer | none | `?limit&cursor` to `Page<ActivityEvent>` | Reverse-chronological change feed ("Sam added Hotel Avenida"). |

```ts
type TripCreate = {
  name: string                                   // 1 to 120 chars
  start_date?: string | null; end_date?: string | null     // both or neither
  home_currency?: string                         // defaults to profile
  notes?: string                                 // max 10000
  destinations?: DestinationIn[]                 // max 12
  traveler_ids?: Uuid[]                          // people; defaults to the "Me" person
  template?: "blank" | "city_break" | "road_trip" | "beach_week" | null
}
type TripUpdate = Partial<Omit<TripCreate, "template">> & {
  status?: "planning" | "booked" | "done" | "archived"
  ai_enabled?: boolean
  version?: number                               // or If-Match
}
type DestinationIn = {
  id?: Uuid | null; name: string; region?: string | null; country?: string | null
  country_code?: string | null; kind?: string | null
  lat: number; lon: number; timezone?: string | null; bbox?: [number, number, number, number] | null
  geoapify_place_id?: string | null
}
type TripSummary = Pick<Trip, "id" | "version" | "name" | "status" | "start_date" | "end_date"
  | "cover" | "my_role" | "member_count" | "updated_at"> & { destinations_label: string; limited: boolean }
type ActivityEvent = { id: Uuid; at: string; actor: Attribution; verb: string; entity: string; entity_id: Uuid; summary: string }
```

### 5.5 Destinations

Destinations are nested in `Trip` and edited through `PATCH /trips/{id}`; these routes are for single-item edits and for typeahead.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /geo/destinations` | user | none | `?q=&limit=8` to `DestinationSuggestion[]` | Typeahead over Geoapify geocoding (cached in `places_cache`). Per-user quota. |
| `GET /trips/{trip_id}/destinations` | viewer | none | none to `Destination[]` | Ordered. |
| `POST /trips/{trip_id}/destinations` | editor | max 12 | `DestinationIn` to 201 `Destination` | Appends; enqueues summary and image fetch (`info_status: "pending"`). |
| `PATCH /trips/{trip_id}/destinations/{destination_id}` | editor | none | `Partial<DestinationIn>` to `Destination` | |
| `DELETE /trips/{trip_id}/destinations/{destination_id}` | editor | none | 204 | Days pointing at it get `destination_id: null`. |
| `PUT /trips/{trip_id}/destinations/order` | editor | none | `{ ids: Uuid[] }` to `Destination[]` | Must contain every id exactly once. |
| `GET /airports` | user | none | `?q=&limit=10` to `Airport[]` | From `airports`. Cached 24 hours (`Cache-Control: private, max-age=86400`). |
| `GET /airports/nearby` | user | none | `?lat&lon&radius_km=150` to `NearbyAirport[]` | Used only when the user taps "near me"; coordinates are not stored. |

```ts
type Destination = DestinationIn & {
  id: Uuid; position: number; summary: string | null; wiki_url: string | null
  image_url: string | null; info_status: "pending" | "ready" | "not_found" | "failed" | "skipped"
}
type DestinationSuggestion = Omit<DestinationIn, "id"> & { label: string }
type Airport = { iata: Iata; name: string; city: string; country_code: string; lat: number; lon: number }
type NearbyAirport = Airport & { distance_km: number }
```

### 5.6 Members, invites and share links

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/members` | viewer | none | none to `Member[]` | Includes pending invites for owners. |
| `PATCH /trips/{trip_id}/members/{user_id}` | owner | `can_invite` for new editors | `{ role: "editor" \| "viewer" }` to `Member` | Cannot set `owner` (use transfer). Limited trips cannot raise a role. |
| `DELETE /trips/{trip_id}/members/{user_id}` | owner | none | none to 204 | Access ends immediately. Linked person detached ("Former member" option). |
| `PUT /trips/{trip_id}/members/me/traveler` | member | none | `{ person_id: Uuid }` to `Member` | Answers "Which traveler are you?"; sets `people.linked_user_id`. A person links to one user per trip. |
| `POST /trips/{trip_id}/invites` | owner (editors: viewer invites only if `editors_can_invite`) | `can_invite`, collaborator cap, 30 per day, 20 pending | `InviteCreate` to 201 `Invite` | Random 128 bit token, stored hashed. The raw token appears only in this response and the emailed link. Email sent when `email` set. Over cap: 403 `limit_reached` reason `traveler_limit` or `sharing` with a paywall hint. |
| `GET /trips/{trip_id}/invites` | owner | none | none to `Invite[]` | No tokens. |
| `DELETE /trips/{trip_id}/invites/{invite_id}` | owner | none | 204 | Revokes. |
| `GET /invites/{token}` | none (rate limited) | none | none to `InvitePreview` | Public preview for the landing page: trip name, cover, inviter display name, role. No dates or places. `410 invite_expired` for bad tokens (same response for unknown and expired). |
| `POST /invites/{token}/accept` | user | none | `{ person_id?: Uuid }` to 200 `Trip` | Redeems server side; the email need not match (Apple relay). Adds `trip_members`; single-use invites are consumed; link invites decrement `uses_left`. Free accounts join free and do not count toward their 2 active trips. `409 already_member` returns the trip id. |
| `GET /trips/{trip_id}/share-links` | owner | none | none to `ShareLink[]` | |
| `POST /trips/{trip_id}/share-links` | owner | `can_invite` | `ShareLinkCreate` to 201 `ShareLink` | Read-only public link `https://wayfold.app/s/<token>`. Default expiry 90 days. Redaction flags hide hotel address, prices and notes by default. |
| `PATCH /trips/{trip_id}/share-links/{link_id}` | owner | none | `Partial<ShareLinkCreate>` to `ShareLink` | |
| `DELETE /trips/{trip_id}/share-links/{link_id}` | owner | none | 204 | Revokes; later views return `410 share_link_revoked`. |
| `GET /shared/{token}` | none (per-IP and per-token limit) | none | none to `SharedTrip` | Public read of the redacted presentation data (5.17). `Cache-Control: public, max-age=60`. Never includes affiliate click ids; the "Book the plan" slide links come from `POST /shared/{token}/outbound` (5.28). |

```ts
type Member = {
  user_id: Uuid; display_name: string | null; role: Role
  person_id: Uuid | null; joined_at: string; invited_by: Attribution | null
}
type InviteCreate = {
  role: "editor" | "viewer"
  email?: string                      // single use, emailed
  max_uses?: number                   // link invites, 1 to 6, default 1
  expires_in_days?: number            // 1 to 14, default 7
}
type Invite = {
  id: Uuid; role: "editor" | "viewer"; email: string | null
  url?: string                        // only in the create response
  uses_left: number; expires_at: string; created_at: string; status: "pending" | "used" | "expired" | "revoked"
}
type InvitePreview = { trip_name: string; cover_url: string | null; inviter_name: string; role: "editor" | "viewer" }
type ShareLinkCreate = {
  expires_in_days?: number | null     // null means no expiry
  redact: { hotel_address: boolean; prices: boolean; notes: boolean; people: boolean }   // all true by default
  show_book_slide: boolean            // "Book the plan" last slide, default true
}
type ShareLink = ShareLinkCreate & { id: Uuid; url: string; created_at: string; expires_at: string | null; view_count: number; revoked_at: string | null }
type SharedTrip = { trip_name: string; presentation: Presentation; cta: { label: "Get the app to edit"; url: string }; book_slide: AffiliateOffer[] | null }
```

### 5.7 People

A person is a traveler profile owned by a user. It is planning data, not an account. Names of people who are not members never go to AI providers ("Traveler 1" is used instead).

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /people` | user | none | none to `Person[]` | The caller's own people plus linked people visible through shared trips (co-members only). |
| `POST /people` | user | max 30 per user | `PersonIn` to 201 `Person` | `owner_user_id` is the caller. |
| `PUT /people/{person_id}` | owner of the person | none | `PersonIn` to `Person` | Linked people can only be edited by their own user for name and airports. |
| `DELETE /people/{person_id}` | owner of the person | none | 204 | `409 state_conflict` if the person is the only traveler on a trip the caller does not own; otherwise removed from `trip_people`, historic votes keep "Former traveler". |
| `PUT /trips/{trip_id}/travelers` | editor | none | `{ person_ids: Uuid[] }` to `Person[]` | Replaces `trip_people` for the trip (max 12; Group Trip Pass raises to 12, Trip Pass and Plus accept up to 12 travelers but only 6 collaborators). |

```ts
type PersonIn = { name: string /* 1..60 */; color: string /* #rrggbb */; home_airports: Iata[] /* max 6 */ }
type Person = PersonIn & { id: Uuid; linked_user_id: Uuid | null; is_me: boolean }
```

### 5.8 Flights

Flight data follows the existing route and quote model. A route is a search definition; fare observations are quotes seen by a source. Cached fares (Travelpayouts Data API) are available to every tier; live fares (SerpApi behind a provider interface, flag `live_fares`) need a live route slot and cost 1 credit per user-triggered live check. The scheduled daily live check of a tracked route does not cost credits; it draws on the route slot and the provider-spend ceiling. Sorting is by price only; providers never influence order.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/routes` | viewer | none | none to `Route[]` | |
| `POST /trips/{trip_id}/routes` | editor | Free: 1 cached route per trip (`limit_reached`, reason `live_routes` only when `mode: "live"`) | `RouteIn` to 201 `Route` | `mode: "cached"` (default) uses Travelpayouts only. `mode: "live"` needs a free live slot and departure within 120 days, else 403 `limit_reached`. Enqueues a first cached refresh. |
| `PUT /routes/{route_id}` | editor | versioned | `RouteIn` to `Route` | Switching `mode` to `live` re-checks the gate. Changing search fields clears nothing; old observations stay. |
| `DELETE /routes/{route_id}` | editor | none | 204 | Frees the live slot. Observations kept 13 months for history. |
| `POST /trips/{trip_id}/flights/refresh` | editor | none (cached only) | `{ route_ids?: Uuid[] }` to 202 `Job` | Refreshes cached fares for these routes (max 20). Does not call live providers. Per-trip limit 10 an hour. |
| `POST /trips/{trip_id}/flights/live-search` | editor | `live_route` (route in `live` mode), `credits(1)`, `ai` not needed | `{ route_id: Uuid }` with `Idempotency-Key` to 202 `LiveSearchJob` | Reserves 1 credit (`live_search`), enqueues a SerpApi call, writes `provider_calls` and `fare_observations`. Settles on success; releases on `provider_error`. For Trip Pass trips, also decrements `live_checks_left` (60 cap). Returns `from_cache: true` and charges 0 when a fresh observation (under 6 hours) already exists in the shared cache. 402, 429 `provider_budget_exhausted`, 403 `limit_reached`. |
| `GET /live-search/{job_id}` | the caller | none | none to `LiveSearchJob` | Poll until `done` or `failed`. |
| `GET /trips/{trip_id}/flights/best` | viewer | none | `?route_id=&limit=20&include_hidden=false&sort=price` to `Fare[]` | Sorted by price ascending then observed time. `sort` accepts `price`, `duration`, `stops` only. |
| `GET /trips/{trip_id}/flights/summary` | viewer | none | none to `RouteSummary[]` | Cheapest fare, last check time, fare count and chosen fare per route. `ETag`. |
| `GET /routes/{route_id}/fares` | viewer | none | `?limit&cursor&source=&since=` to `Page<Fare>` | All observations. |
| `PATCH /fares/{fare_id}` | editor | none | `{ hidden?: boolean, suspect?: boolean }` to `Fare` | Hides or flags a fare for this trip (`trip_fare_links`), never deletes shared data. |
| `GET /routes/{route_id}/price-history` | viewer | none | none to `PriceHistory` | Daily minimum by source, typical low and high, price level. |
| `GET /routes/{route_id}/date-grid` | viewer | none | none to `DateGridCell[]` | Cheapest fare per departure and return pair. |
| `PUT /routes/{route_id}/choice` | editor | none | `{ fare_id: Uuid }` to `Trip` | Writes `chosen_flights`. Trip dates derive from chosen flights when dates are unset. Checklist items "Flights booked", "Airport transfer" and "Travel insurance" become visible (5.16). Emits `flight_chosen`. |
| `DELETE /routes/{route_id}/choice` | editor | none | none to `Trip` | |
| `POST /routes/{route_id}/choice/booked` | editor | none | `{ booked: boolean }` to `Trip` | Marks the chosen flight as booked by the user (used by the checklist and the after-trip prompt). |
| `GET /trips/{trip_id}/price-alerts` | viewer | none | none to `PriceAlert[]` | |
| `POST /routes/{route_id}/price-alerts` | editor | Free: 1 alert total (cached fares only); Plus and up: 10 per trip | `PriceAlertIn` to 201 `PriceAlert` | Writes `price_alerts`. Free alerts run on cached fares only and never trigger live calls. `403 limit_reached` with a paywall hint otherwise. |
| `PATCH /price-alerts/{alert_id}` | editor | none | `Partial<PriceAlertIn>` to `PriceAlert` | |
| `DELETE /price-alerts/{alert_id}` | editor | none | 204 | |

```ts
type RouteIn = {
  label?: string | null
  origin_codes: Iata[]; destination_codes: Iata[]          // 1..4 each
  trip_type: "round_trip" | "one_way" | "open_jaw"
  depart_from: string; depart_to: string
  return_from?: string | null; return_to?: string | null
  min_nights?: number | null; max_nights?: number | null   // 1..60
  adults: number; children: number                           // 1..9, 0..8
  cabin: "economy" | "premium_economy" | "business" | "first"
  max_stops?: 0 | 1 | 2 | null
  mode: "cached" | "live"
  active: boolean
  version?: number
}
type Route = Omit<RouteIn, "version"> & {
  id: Uuid; trip_id: Uuid; version: number
  chosen_fare_id: Uuid | null; last_checked_at: string | null
  next_live_check_at: string | null                         // live mode only
  created_at: string; updated_at: string
}
type Fare = {
  id: Uuid; route_id: Uuid
  source: "travelpayouts" | "serpapi" | "agent" | "manual"
  confidence: "cached" | "live" | "agent_seen"               // agent fares were seen on a page during the run
  origin: Iata; destination: Iata; depart_date: string; return_date: string | null
  price: Money; price_home: Money | null; passengers: number
  airlines: string[]; stops_out: number | null; stops_back: number | null
  duration_out_min: number | null; duration_back_min: number | null
  depart_at_local: string | null; flight_numbers: string[] | null
  book_offer: AffiliateOffer | null                          // partner "Book on <provider>" (5.28)
  airline_search_url: string | null                          // non-affiliate route
  source_url: string | null; observed_at: string; age_label: string   // "cached 6 h ago"
  suspect: boolean; hidden: boolean
}
type RouteSummary = {
  route_id: Uuid; cheapest: Fare | null; last_checked_at: string | null
  fare_count: number; chosen: Fare | null; chosen_latest: Fare | null
}
type PriceHistory = {
  currency: string
  points: { day: string; source: string; price: Money }[]
  google: { at: string; price: Money }[]
  typical_low: Money | null; typical_high: Money | null; price_level: "low" | "typical" | "high" | null
}
type DateGridCell = { fare_id: Uuid; depart_date: string; return_date: string | null; price: Money; source: string; observed_at: string }
type PriceAlertIn = { target_price: Money; notify: { push: boolean; email: boolean }; active: boolean }
type PriceAlert = PriceAlertIn & { id: Uuid; route_id: Uuid; last_triggered_at: string | null; last_seen_price: Money | null }
type LiveSearchJob = {
  id: Uuid; route_id: Uuid; status: "queued" | "running" | "done" | "failed"
  fares_added: number; credits: CreditReceipt; error_code: string | null
}
type Job = { id: Uuid; status: "queued" | "running" | "done" | "failed"; location: string }
```

### 5.9 Lodging

Lodging covers options the user saves or pastes, votes, comparison, and rental search. Rule: the server never fetches Airbnb, Vrbo or Booking.com pages, and never rewrites a pasted link. `url` is stored exactly as pasted.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/lodging` | viewer | none | `?status=&sort=created&limit&cursor&updated_since` to `Page<Lodging>` | `sort` accepts `created`, `price`, `rating`, `votes`. The response states the sort in `sorted_by`. |
| `POST /trips/{trip_id}/lodging` | editor | none | `LodgingIn` to 201 `Lodging` | Writes `lodging_options`. Stores `site` from the host of `url`. `added_via`: `paste`, `bookmarklet`, `search`, `manual`. Activity feed entry. |
| `GET /lodging/{option_id}` | viewer | none | none to `Lodging` | |
| `PATCH /lodging/{option_id}` | editor | versioned | `Partial<LodgingIn>` to `Lodging` | `status` moving to `booked` also offers to add the stay to the itinerary days (client prompt; no server side effect). |
| `DELETE /lodging/{option_id}` | editor | none | 204 | Removes votes. |
| `PUT /lodging/{option_id}/votes/me` | viewer | none | `{ vote: "love" \| "ok" \| "no" \| null }` to `Lodging` | Writes `lodging_votes` for the caller's user (and linked person). `null` clears. Viewers may vote. |
| `GET /trips/{trip_id}/lodging/compare` | viewer | none | `?ids=a,b,c` (2 to 4) to `LodgingCompare` | Side by side table: price per night and total in trip home currency, rating, bedrooms, beds, baths, distance to destination center and to chosen itinerary anchors, votes, pros and cons. Sorted by the order of `ids`, never by commission. |
| `POST /lodging/parse-link` | user | none | `{ url: string, check_in?, check_out?, guests? }` to `LinkParse` | Parses only the URL text: host, stay dates and guests in query parameters, listing id. No network request to the host. Blocked-host rule: for `airbnb.*`, `vrbo.*`, `booking.*` and the Expedia Group brands the response has `fetch_allowed: false`; `title`, `photos` and `description` are always empty for them and the client asks the user to type or use the bookmarklet. Any request that sets a `fetch` flag on these hosts gets `422 blocked_domain`. For other hosts it never fetches either in the hosted API; link previews are disabled server side and come only from the user's own clipboard or bookmarklet payload. |
| `POST /trips/{trip_id}/lodging/rental-search` | editor | `credits(1)` (`live_search`), shared cache free for 6 hours | `RentalSearchIn` with `Idempotency-Key` to `RentalSearchResult` | Searches licensed sources only (SerpApi Google Vacation Rentals through the provider interface, Stay22 and partner search). Reserves 1 credit; repeats of the same search within 6 hours return `cached: true` and charge 0. Sorted by `price` or `rating` only, with the sort statement in `sorted_by`. Writes `provider_calls`. |
| `POST /trips/{trip_id}/lodging/from-offer` | editor | none | `{ offer_ref: string }` to 201 `Lodging` | Saves an offer from a search result (`offer_ref` is an opaque server token valid 24 hours). Sets `added_via: "search"` and stores the partner book offer separately from the user's `url`. |
| `GET /lodging/{option_id}/book-offers` | viewer | none | none to `AffiliateOffer[]` | Labeled partner "Book via partner" button and "Compare on other sites" search links built from URL text and trip dates, without fetching. Empty for Airbnb (plain links only) and when `hide_booking_links` is set returns plain "Open on partner site" links. |

```ts
type LodgingIn = {
  title: string; url?: string | null
  check_in?: string | null; check_out?: string | null; guests?: number | null
  price_total?: Money | null; price_per_night?: Money | null
  photos?: string[]                          // max 30, user-supplied or from search results
  location_name?: string | null; lat?: number | null; lon?: number | null
  bedrooms?: number | null; beds?: number | null; baths?: number | null
  rating?: number | null; review_count?: number | null
  notes?: string; pros?: string; cons?: string
  status?: "candidate" | "shortlist" | "booked" | "rejected"
  favorite?: boolean
  added_via?: "paste" | "bookmarklet" | "search" | "manual"
  version?: number
}
type Lodging = Omit<LodgingIn, "version" | "price_total" | "price_per_night"> & {
  id: Uuid; trip_id: Uuid; version: number; site: string | null; nights: number | null
  price_total: Money | null; price_per_night: Money | null; price_home_total: Money | null
  votes: { user_id: Uuid; person_id: Uuid | null; vote: "love" | "ok" | "no" }[]
  vote_summary: { love: number; ok: number; no: number }
  added_by: Attribution; created_at: string; updated_at: string
}
type LodgingCompare = { columns: Uuid[]; rows: { key: string; label: string; values: (string | number | null)[] }[]; home_currency: string }
type LinkParse = {
  url: string; site: string | null; fetch_allowed: false
  check_in: string | null; check_out: string | null; guests: number | null
  listing_id: string | null; title: null; photos: []; note: string   // "We never change your links."
}
type RentalSearchIn = { check_in: string; check_out: string; adults: number; children: number; place?: string; max_price?: Money; sort?: "price" | "rating" }
type RentalOffer = {
  offer_ref: string; title: string; site: string | null; kind: string | null; photos: string[]
  price_total: Money | null; price_per_night: Money | null; rating: number | null; review_count: number | null
  lat: number | null; lon: number | null; sleeps: number | null; bedrooms: number | null; beds: number | null; baths: number | null
  details: string[]; observed_at: string
  book_offer: AffiliateOffer | null; save_first: true          // save to shortlist is the first action in the UI
}
type RentalSearchResult = { offers: RentalOffer[]; cached: boolean; sorted_by: string; credits: CreditReceipt }
```

### 5.10 Itinerary

The itinerary is `itinerary_days` (one per trip date, created from the trip dates) and `itinerary_items` (an activity, meal, transport, stay or note entry, scheduled or in the unscheduled pool). This replaces the existing `/activities` routes.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/days` | viewer | none | `?updated_since` to `Day[]` | Every date in the trip range, with counts and first and last items. Days outside the range that hold items are included with `in_trip: false`. `ETag`. |
| `PUT /trips/{trip_id}/days/{day}` | editor | versioned | `DayUpdate` to `Day` | `day` is `YYYY-MM-DD`. Creates the row if needed. |
| `GET /trips/{trip_id}/items` | viewer | none | `?day=&unscheduled=true&category=&limit&cursor&updated_since` to `Page<Item>` | Ordered by day, then `position`. |
| `POST /trips/{trip_id}/items` | editor | none | `ItemIn` to 201 `Item` | Appends to the end of the day (or the pool). If `place` is given, saves it to `saved_places` when not present. Fails `422 validation_failed` if `end_time` precedes `start_time`. |
| `GET /items/{item_id}` | viewer | none | none to `Item` | |
| `PATCH /items/{item_id}` | editor | versioned | `ItemUpdate` to `Item` | Moving `day` is allowed here for a simple change; use `/move` to also set position. |
| `DELETE /items/{item_id}` | editor | versioned | 204 | |
| `POST /trips/{trip_id}/days/{day}/reorder` | editor | none | `{ ids: Uuid[], version_map?: Record<Uuid, number> }` to `Item[]` | Sets `position` by order for every item on that day. `ids` must be exactly the current items of the day else `409 version_conflict` with the current order in `current`. |
| `POST /items/{item_id}/move` | editor | versioned | `{ day: string \| null, before_id?: Uuid \| null, start_time?: string \| null }` to `Item[]` | Moves between days or to the pool (`day: null`) and places before `before_id` (end if null). Returns every item whose position changed on both days. |
| `POST /trips/{trip_id}/items/bulk` | editor | max 50 | `{ items: ItemIn[] }` to 201 `Item[]` | Used when accepting an AI draft. One transaction. |
| `GET /trips/{trip_id}/items/{item_id}/book-offers` | viewer | none | none to `AffiliateOffer[]` | "Tickets" offers for bookable items (Viator match by name and coordinates). Empty for parks and viewpoints. |
| `GET /trips/{trip_id}/days/{day}/suggestions` | viewer | none | none to `ThingToDo[]` | Viator "things to do" near the day's plan, sorted by rating then distance, labeled as suggestions. Empty when there is no real match. No credits. |

```ts
type ItemIn = {
  title: string                                          // 1..200
  day?: string | null; start_time?: string | null; end_time?: string | null
  category: "sight" | "food" | "transport" | "stay" | "activity" | "shopping" | "nightlife" | "other"
  status?: "idea" | "planned" | "booked" | "done"
  location_name?: string | null; address?: string | null; lat?: number | null; lon?: number | null
  url?: string | null; notes?: string                    // max 4000
  cost?: Money | null
  place?: { provider: "geoapify"; id: string; data?: Record<string, unknown> } | null
  version?: number
}
type ItemUpdate = Partial<ItemIn> & { version?: number }
type Item = Omit<ItemIn, "place" | "version"> & {
  id: Uuid; trip_id: Uuid; position: number; version: number
  place_provider: string | null; place_id: string | null; place_data: Record<string, unknown> | null
  bookable: boolean; added_by: Attribution; created_at: string; updated_at: string
}
type DayUpdate = { title?: string; notes?: string; destination_id?: Uuid | null; version?: number }
type Day = {
  day: string; title: string; notes: string; destination_id: Uuid | null; destination_name: string | null
  timezone: string | null; in_trip: boolean; item_count: number; version: number
  first: { title: string; start_time: string | null } | null; last: { title: string; start_time: string | null } | null
}
type ThingToDo = { product_ref: string; title: string; rating: number | null; price_from: Money | null; price_observed_at: string | null; distance_m: number; source: "viator"; book_offer: AffiliateOffer; label: "Suggestion" }
```

### 5.11 Places

Geoapify is the place source; results are cached in `places_cache` per provider terms. Results are ranked by relevance and distance only. Saving a place never calls a paid provider.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /places/search` | user | per-user quota (200 an hour) | `?q=&lat=&lon=&radius_m=&category=&destination_id=&trip_id=&limit=20` to `PlaceSearchResult` | Text or category search around a point or the destination boundary (`geoapify_place_id`). Response includes the required attribution string and `cached`. `429` on quota. |
| `GET /places/{place_id}` | user | none | none to `PlaceDetails` | `place_id` is our id (`geoapify:<id>`). Adds Wikipedia summary when `wikidata` or `wikipedia` tags exist. Cached per terms. |
| `GET /places/{place_id}/book-offers` | user | none | none to `AffiliateOffer[]` | "Tickets" or "Book a table" chips on the detail view only, when a real match exists. |
| `GET /trips/{trip_id}/saved-places` | viewer | none | `?limit&cursor` to `Page<SavedPlace>` | |
| `POST /trips/{trip_id}/saved-places` | editor | none | `{ place_id: string, note?: string }` to 201 `SavedPlace` | Writes `saved_places` (idempotent on trip and place). |
| `DELETE /trips/{trip_id}/saved-places/{saved_id}` | editor | none | 204 | |

```ts
type Place = {
  id: string; provider: "geoapify"; name: string; local_name: string | null
  category: string; kinds: string[]; address: string | null; lat: number; lon: number
  distance_m: number | null; website: string | null; opening_hours: string | null; phone: string | null
  wikidata: string | null; wikipedia: string | null; has_details: boolean
}
type PlaceSearchResult = { places: Place[]; cached: boolean; sorted_by: "relevance" | "distance"; attribution: "Powered by Geoapify, © OpenStreetMap contributors" }
type PlaceDetails = Place & { wiki: { title: string; extract: string; url: string | null; image_url: string | null } | null }
type SavedPlace = { id: Uuid; place: Place; note: string | null; added_by: Attribution; created_at: string }
```

### 5.12 AI: one-shot actions

One-shot actions run inline or as a short job. All need the `ai` gate (consent, trip toggle, kill switch) and reserve credits first. They use Claude Haiku 4.5 for `explain` and Claude Sonnet 5.5 for the rest. Output carries source URLs for every fact found on the web. The AI never gives insurance, visa or legal advice and links to official sources instead, and never mentions a partner.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `POST /trips/{trip_id}/ai/explain` | editor | `ai`, `credits(1)` (`explain`) | `{ question: string, context?: { item_id?: Uuid, lodging_id?: Uuid, place_id?: string } }` with `Idempotency-Key` to `ExplainResult` | Haiku short answer (under 120 words) with optional sources. Reserves 1 credit. Private notes are excluded from context. |
| `POST /trips/{trip_id}/ai/draft-day` | editor | `ai`, `credits(1)` (`draft_day`) | `{ day: string, preferences?: string, replace?: boolean }` with `Idempotency-Key` to `DraftDayResult` | Returns a draft list of `ItemIn`, not saved. Applying it is `POST /trips/{trip_id}/items/bulk`. Hard stop $0.03. |
| `POST /trips/{trip_id}/ai/draft-trip` | editor | `ai`, `credits(4)` (`draft_trip`) | `{ style?: string, pace?: "relaxed" \| "balanced" \| "packed", interests?: string[], budget?: Money }` with `Idempotency-Key` to 202 `DraftJob` | Whole-trip draft (days and items, plus a "why" per day). Runs as a job; poll `GET /ai/jobs/{id}`. Hard stop $0.10. |
| `POST /trips/{trip_id}/ai/research` | editor | `ai`, `credits(8)`, or `credits(1)` if served from `shared_research_cache` (`research`) | `{ question: string, scope?: "destination" \| "dates" \| "lodging" }` with `Idempotency-Key` to 202 `ResearchJob` | Sonnet with 5 searches and 8 fetches at most, hard stop $0.16. Cache hit returns instantly with `from_cache: true` and charges 1. The shared cache stores only public facts keyed by destination, topic and date bucket, never personal context. |
| `GET /ai/jobs/{job_id}` | the requester | none | none to `AiJob` | Status, result when done, credit receipt. Results are kept 30 days. |
| `POST /ai/jobs/{job_id}/cancel` | the requester | none | none to `AiJob` | Releases unspent reservation if no result was produced. |

```ts
type ExplainResult = { answer: string; sources: Source[]; credits: CreditReceipt }
type Source = { url: string; title: string | null; fetched_at: string }
type DraftDayResult = { day: string; items: ItemIn[]; rationale: string; credits: CreditReceipt }
type AiJob<T = unknown> = {
  id: Uuid; kind: "draft_trip" | "research"; status: "queued" | "running" | "done" | "failed" | "cancelled"
  result: T | null; error_code: string | null; credits: CreditReceipt
}
type DraftJob = AiJob<{ days: { day: string; title: string; items: ItemIn[]; rationale: string }[] }>
type ResearchJob = AiJob<{ answer: string; findings: { text: string; source: Source }[]; from_cache: boolean }>
```

### 5.13 AI: agent runs, routines and taster

Agent runs are the fare hunt and deep research agents from the existing app, now metered API calls in our worker. A run is a row in `runs`; its events are `run_events`. One run at a time per account, 20 turns, 10 searches, 10 fetches, hard stop $0.80. Admission needs $0.80 of monthly provider headroom even if the daily budget is spent. Every fare an agent saves must have been seen on a page during the run, and every note links its source URL (evidence rules carry over from `agent_ingest`).

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `POST /trips/{trip_id}/agent-runs` | editor | `ai`, `credits(40)` (8 from shared cache), or `taster` (free user, once per lifetime), one active run per account | `AgentRunStart` with `Idempotency-Key` to 202 `AgentRun` | Reserves credits, inserts `runs` (status `queued`), enqueues the job, sets `Location` to the run and returns `events_url`. Taster: marks the user's lifetime taster used when the run starts; released only if the run fails before its first tool call. `409 run_already_active` (body has the active run id), 402 `insufficient_credits`, 402 `payment_required` with reason `agent_taster_used`, 429 `provider_budget_exhausted`, 403 `ai_consent_required`. |
| `GET /trips/{trip_id}/agent-runs` | viewer | none | `?status=&kind=&limit&cursor` to `Page<AgentRun>` | All runs on the trip, including others' (members see run summaries; prompts and raw logs only the starter and the owner). |
| `GET /agent-runs/{run_id}` | viewer on the trip | none | none to `AgentRunDetail` | Summary, counts, cost estimate (starter only), credit receipt. |
| `GET /agent-runs/{run_id}/events` | viewer on the trip | none | `?after_seq=0&limit=200` to `RunEvent[]` | Polling fallback for clients that cannot hold SSE. |
| `GET /agent-runs/{run_id}/stream` | viewer on the trip | none | SSE (see below) | `Content-Type: text/event-stream`. Replays from `Last-Event-ID`. Heartbeat comment every 15 seconds. Ends after `run.finished`. Does not count against rate limits once open (one stream per run per user, 3 per user). |
| `GET /agent-runs/{run_id}/outputs` | viewer on the trip | none | none to `RunOutputs` | Saved fares, notes (each with a source URL) and rejections (what was dropped and why). |
| `POST /agent-runs/{run_id}/cancel` | starter or owner | none | `Idempotency-Key` to `AgentRun` | Sets `cancel_requested`; the worker stops at the next checkpoint. Credits are settled for work done (charged = reserved times share used, minimum 10 percent for a run that called tools, 0 if cancelled in the queue). `409 state_conflict` when already finished. |
| `DELETE /agent-runs/{run_id}` | starter or owner | finished runs only | 204 | Deletes stored prompt and log content; the `ai_usage` row stays. |
| `GET /trips/{trip_id}/routines` | viewer | `pro` to see details, others get `[]` | none to `Routine[]` | |
| `POST /trips/{trip_id}/routines` | editor | `pro` | `RoutineCreate` to 201 `Routine` | Scheduled agent routines are a Pro feature. Non-Pro gets 403 `entitlement_required`, reason `routines`. Schedule minimum is daily. The scheduler enqueues due routines; each firing charges the routine's creator 40 credits. A firing with too few credits is skipped and the owner is notified. |
| `GET /routines/{routine_id}` | viewer | `pro` | none to `Routine` | |
| `PATCH /routines/{routine_id}` | creator or owner | versioned | `RoutineUpdate` to `Routine` | |
| `DELETE /routines/{routine_id}` | creator or owner | none | 204 | Cancels queued firings. |
| `POST /routines/{routine_id}/run` | editor | `pro`, `credits(40)` | `Idempotency-Key` to 202 `AgentRun` | Runs now, with `trigger: "manual"`. |
| `GET /me/agent-taster` | user | none | none to `{ used: boolean, used_at: string | null, run_id: Uuid | null }` | Drives the "Try a deep run free" card. |

```ts
type AgentRunStart = {
  kind: "fare_hunt" | "deep_research"
  route_ids?: Uuid[]                          // fare_hunt: max 5, each route must be in the trip
  topic?: string                              // deep_research, max 300 chars
  instructions?: string                       // max 2000 chars, treated as untrusted user text
}
type AgentRun = {
  id: Uuid; trip_id: Uuid; kind: "fare_hunt" | "deep_research"; routine_id: Uuid | null
  trigger: "manual" | "schedule" | "catch_up"
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  started_by: Attribution; params: Record<string, unknown>
  queued_at: string; started_at: string | null; finished_at: string | null
  summary: string | null; error_code: string | null
  accepted_count: number; rejected_count: number
  turns_used: number | null; searches_used: number | null; fetches_used: number | null
  from_cache: boolean; is_taster: boolean
  credits: CreditReceipt
  cancel_requested: boolean
  events_url: string                          // /v1/agent-runs/{id}/stream
}
type AgentRunDetail = AgentRun & { cost_usd_micros?: number /* starter and admins only */ }
type RunEvent = {
  seq: number; ts: string
  type: "run.started" | "turn" | "tool.search" | "tool.fetch" | "fare.saved" | "note.saved"
      | "fare.rejected" | "budget" | "warning" | "run.finished"
  tool_name: string | null; summary: string; payload: Record<string, unknown> | null
}
type RunOutputs = { fares: Fare[]; notes: Note[]; rejections: { kind: string; reason: string; detail: string }[] }
type RoutineCreate = {
  name: string; kind: "fare_hunt" | "deep_research"; schedule_cron: string; timezone: string
  enabled?: boolean; catch_up?: boolean
  config: { route_ids?: Uuid[]; topic?: string; instructions?: string }
}
type RoutineUpdate = Partial<RoutineCreate> & { version?: number }
type Routine = RoutineCreate & {
  id: Uuid; trip_id: Uuid; version: number; next_run_at: string | null
  last_run: AgentRun | null; created_by: Attribution
}
```

**SSE stream format.** Each event is one SSE message with an id equal to `seq`:

```
id: 14
event: fare.saved
data: {"seq":14,"ts":"2026-09-30T14:07:11Z","type":"fare.saved","tool_name":"submit_flight_quotes","summary":"Saved LIS round trip $412 on TAP, seen on tap.example","payload":{"fare_id":"0191..."}}

: heartbeat

id: 27
event: run.finished
data: {"seq":27,"type":"run.finished","summary":"2 fares and 1 note saved","payload":{"status":"succeeded","credits":{"reserved":40,"charged":31,"balance_after":29}}}
```

Clients reconnect with `Last-Event-ID`. `run.finished` is always the last event and carries the settled credit receipt. The stream authenticates with the normal bearer header (the iOS client uses a fetch-based reader, not `EventSource`); a short-lived `?stream_token=` (60 seconds, from `POST /agent-runs/{id}/stream-token`) is accepted for browsers that cannot set headers.

### 5.14 Notes and evidence

Notes are either user notes or agent findings. An agent note must carry at least one `source_url`; fares seen by an agent are evidence on the `Fare`.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/notes` | viewer | none | `?kind=&pinned=&limit&cursor&updated_since` to `Page<Note>` | Private notes of other users are omitted. |
| `POST /trips/{trip_id}/notes` | editor | none | `NoteIn` to 201 `Note` | `kind: "user"` only; agent notes are written by the worker. |
| `PATCH /notes/{note_id}` | author or owner | versioned | `Partial<NoteIn>` to `Note` | Agent notes can be pinned or hidden, not edited. |
| `DELETE /notes/{note_id}` | author or owner | none | 204 | |
| `GET /notes/{note_id}/evidence` | viewer | none | none to `Evidence` | Source URLs, titles, fetched times and the run that found them. |

```ts
type NoteIn = { title?: string; body: string /* max 10000 */; pinned?: boolean; private?: boolean; day?: string | null; item_id?: Uuid | null; version?: number }
type Note = NoteIn & {
  id: Uuid; trip_id: Uuid; version: number; kind: "user" | "agent"; author: Attribution | null
  run_id: Uuid | null; sources: Source[]; created_at: string; updated_at: string
}
type Evidence = { note_id: Uuid; run_id: Uuid | null; sources: Source[]; excerpt: string | null }
```

### 5.15 Presentation data

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/presentation` | viewer | none | `?redact=` to `Presentation` | Everything the full-screen walkthrough needs in one payload: cover, destinations, days with items, chosen flights, booked stays, weather, and the pre-trip checklist summary. `ETag`. |
| `GET /trips/{trip_id}/presentation/pdf` | viewer | none | none to 202 `Job` then 302 to a signed file | Print-ready PDF. Partner buttons are omitted by default (`?links=true` keeps them live with the commission sentence printed). |
| `GET /trips/{trip_id}/calendar.ics` | viewer | none | none to `text/calendar` | Subscribable feed, authenticated by a per-trip secret token in the query string (`?token=`, rotated by `POST /trips/{id}/calendar-token`). |

```ts
type Presentation = {
  trip: Pick<Trip, "id" | "name" | "start_date" | "end_date" | "cover" | "destinations">
  days: { day: string; title: string; notes: string; destination_name: string | null; items: Item[] }[]
  flights: Fare[]; stays: Lodging[]
  weather: { day: string; high_c: number; low_c: number; summary: string }[] | null
  checklist: { done: number; total: number }
  book_slide_enabled: boolean                 // owner setting; never shown during playback
  generated_at: string
}
```

### 5.16 Checklist ("Before you go")

The checklist is derived from trip data by a rules module and stored as `checklist_items` only for state (done, dismissed, meta). At least half the items are unmonetized.

| Endpoint | Auth | Gate and cost | Request and response | Errors and side effects |
|---|---|---|---|---|
| `GET /trips/{trip_id}/checklist` | viewer | none | none to `ChecklistItem[]` | Appears when the trip has a chosen flight or a saved stay, or 45 days before departure. Each item says why it is shown. Affiliate items carry `offer` with the disclosure line. Emits `checklist_item_shown` once per item per session. |
| `PATCH /trips/{trip_id}/checklist/{kind}` | editor | versioned | `{ status: "open" \| "done" \| "dismissed", version?: number }` to `ChecklistItem` | Persists per trip. One nudge per item per week at most. |
| `POST /trips/{trip_id}/checklist/custom` | editor | none | `{ title: string }` to 201 `ChecklistItem` | User items (`kind: "custom"`). |
| `DELETE /trips/{trip_id}/checklist/{item_id}` | editor | custom items only | 204 | |
| `GET /trips/{trip_id}/after-trip` | editor | trip end date passed | none to `AfterTrip` | "Was your flight delayed or cancelled?" prompt state. A partner link (compensation) is returned only after `PATCH` with `{ delayed: true }`. |
| `PATCH /trips/{trip_id}/after-trip` | editor | none | `{ delayed?: boolean, dismissed?: boolean }` to `AfterTrip` | |

```ts
type ChecklistKind = "flights_booked" | "stay_booked" | "tickets" | "transfer_or_car" | "esim" | "insurance"
  | "passport_visa" | "luggage_storage" | "bank_and_cash" | "home" | "packing" | "custom"
type ChecklistItem = {
  id: Uuid; kind: ChecklistKind; title: string; why: string       // "You land in Lisbon at 21:40"
  status: "open" | "done" | "dismissed"; group: string; version: number
  cost_hint: string | null; official_link: string | null          // passport_visa links to the government source first
  offer: AffiliateOffer | null                                    // null for unmonetized items and when insurance is not enabled
  done_at: string | null; dismissed_at: string | null
}
type AfterTrip = { show: boolean; delayed: boolean | null; offer: AffiliateOffer | null; note: string }
```

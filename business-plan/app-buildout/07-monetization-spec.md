# 07: Monetization specification

Part of the [Wayfold build specification](README.md). Tier codes, prices, credit grants, credit action codes, ceilings and table names come from the README and are final. Where this file needs a value the README does not give (for example a cap or a timer), it is marked "default" and lives in `feature_flags` so it can change without a release. Rates, cookie windows and program rules for affiliate partners are "reported, verify": read each on the network's own terms page after sign-up.

Written 2026-09-30.

## 1. Revenue lanes and principles

| Lane | Who pays | Channel | Section |
|---|---|---|---|
| Subscriptions (Plus, Family, Pro) | The user | App Store in-app purchase through RevenueCat | 2 to 7 |
| Trip passes (Trip Pass, Group Trip Pass) | The trip owner | App Store in-app purchase, non-renewing subscription | 2 to 7 |
| Credit packs | The user | App Store consumable | 5 |
| Affiliate commissions | The partner | Our redirect `/go/{click_id}` | 8 |
| Concierge commissions | The host travel agency | Advisor fulfillment | 9 |
| Group payments | No fee at launch | Stripe | 10 |
| Later lanes | Partners, advisors, buyers | Stripe on the web | 11 |

Principles that every rule below follows:

1. The server decides. The app displays entitlement and balance; every API route checks the server's rows, never a client claim.
2. One payer per capability. A trip's capabilities are the best of its owner's tier and any pass on that trip; invitees join free. Credits are charged to the person who starts the action (a Family member draws from the household pool).
3. No dark patterns. The free path is always visible; no fake urgency; price, renewal date and cancel path are stated on every paywall.
4. Never hold data hostage. Downgrade or lapse never hides, locks or deletes a trip; read and export always work.
5. Digital features are sold only through In-App Purchase on iOS. Real-world costs (trip payments, print books, concierge bookings, affiliate bookings) never use In-App Purchase and never unlock app features.
6. Never rank by commission, never sell user data, no banner ads, no lifetime plans.

## 2. Product catalogue

### 2.1 App Store products

Subscription group `wayfold_membership` holds every auto-renewing product. Levels within the group, highest first: Pro (level 1), Family (level 2), Plus (level 3). One group means nobody holds two memberships at once. Apple Family Sharing is off on every product. Prices are US tier prices; use Apple's automatic regional pricing first, then tune India, Brazil, Mexico and Turkey by hand after launch.

| Product ID | Type | Price (US) | Duration | Group and level | Trial or intro offer | Entitlement granted | Launch |
|---|---|---|---|---|---|---|---|
| `plus_monthly` | Auto-renewing subscription | $5.99 | 1 month | `wayfold_membership`, level 3 | none | `plus` | Launch |
| `plus_annual` | Auto-renewing subscription | $39.99 | 1 year | `wayfold_membership`, level 3 | 7-day free trial (the only intro offer at launch) | `plus` | Launch (pre-selected) |
| `family_monthly` | Auto-renewing subscription | $8.99 | 1 month | `wayfold_membership`, level 2 | none | `family` | Launch |
| `family_annual` | Auto-renewing subscription | $59.99 | 1 year | `wayfold_membership`, level 2 | none | `family` | Launch |
| `pro_monthly` | Auto-renewing subscription | $11.99 | 1 month | `wayfold_membership`, level 1 | none | `pro` | Built, hidden behind `pro.enabled` |
| `pro_annual` | Auto-renewing subscription | $99.00 | 1 year | `wayfold_membership`, level 1 | none | `pro` | Built, hidden behind `pro.enabled` |
| `trip_pass_90d` | Non-renewing subscription | $9.99 | 90 days | none | none | `trip_pass` (one trip) | Launch (lead offer) |
| `group_trip_pass_90d` | Non-renewing subscription | $19.99 | 90 days | none | none | `group_trip_pass` (one trip) | Launch |
| `credits_50` | Consumable | $2.99 | n/a | none | none | 50 purchased credits | Launch |
| `credits_150` | Consumable | $6.99 | n/a | none | none | 150 purchased credits | Launch |
| `credits_400` | Consumable | $14.99 | n/a | none | none | 400 purchased credits | Launch |

Not App Store products: `advisor_seat` ($29 a seat a month, $24 a seat a month on annual billing) is sold on the web through Stripe (section 11). Group payments are Stripe, never an App Store product.

Rules:

- Apple allows one introductory offer per group per user. Only `plus_annual` carries one at launch. Win-back and promotional offers wait until after launch (section 7.10).
- Every product needs localized display names and descriptions, a paywall review screenshot and the subscription terms text. Use Apple's standard EULA plus our Terms and Privacy links.
- Family, Family Sharing and household are different things: a Family subscription is one Apple ID paying; members are invited inside Wayfold (section 7.8).
- Adding products later (for example a Pro promotional offer) never changes a product ID. New price points for experiments get new product IDs (section 6.7).

### 2.2 Tier limits (the capability table)

The entitlement service resolves to this table. Values the README states are final; others are defaults.

| Capability key | `free` | `plus` | `family` | `pro` | `trip_pass` (on its trip) | `group_trip_pass` (on its trip) |
|---|---|---|---|---|---|---|
| `active_trips` | 2 | unlimited (fair use 25) | unlimited (fair use 25 each member) | unlimited (fair use 50) | raises the owner's limit by 1 (the passed trip) | same |
| `cached_fare_routes_per_trip` | 1 | 3 | 5 | 6 | 2 | 2 |
| `live_routes` (checked daily, within 120 days of departure) | 0 | 3 | 5 | 6 | 2, at most 60 checks | 2, at most 60 checks |
| `credits_per_period` | 12 a month | 60 a month | 150 a month, pooled | 240 a month | 40 once | 80 once |
| `collaborators_per_trip` | 0 (joins others' trips free) | 6 (default) | 6 (default) | 12 (default) | 6 | 11 (up to 12 travelers) |
| `travelers_per_trip` | 2 | 8 | 8 | 12 | 8 | 12 |
| `alerts` (price alerts) | 1 cached-fare | 3 | 6 | 6 | 2 | 2 |
| `polls`, `cost_splitting` | no | no | no | no | no | yes |
| `room_block_request` | no | no | no | no | no | yes |
| `scheduled_routines` | no | no | no | yes (3 per trip) | no | no |
| `priority_queue` | no | no | no | yes | no | no |
| `presentation_footer` (Made with Wayfold footer and PDF watermark) | shown | hidden | hidden | hidden | hidden | hidden |

Free taster: one lifetime deep agent run per user, tracked on `users.taster_used_at`, outside the credit balance ([06-ai-agents-spec.md](06-ai-agents-spec.md) section 5.9).

## 3. RevenueCat setup

RevenueCat (RC) sits between StoreKit 2 and our server. It validates receipts, handles restore and cross-device sync, and sends webhooks. Our server remains the source of truth: RC is a transaction feed, and `subscriptions`, `entitlements`, `trip_passes`, `store_transactions` and `credit_grants` are ours. A periodic reconcile job compares them with RC's REST API so a later move to direct StoreKit stays possible.

### 3.1 Project configuration

| Item | Setting |
|---|---|
| Project and app | One RC project "Wayfold", one iOS app (bundle ID `app.wayfold.ios`, default) with the App Store Connect in-app purchase key. Android is added in Phase 4 to the same project. |
| App user ID | Our `users.id` (UUIDv7), never email. Call `Purchases.logIn(userId)` on sign-in and `logOut()` on sign-out. Anonymous IDs are not used because purchases are disabled until sign-in. |
| Attributes | Set `$email` off (we do not send it), `tier` not sent. Only `app_user_id`. No ad or attribution integrations. |
| Products | The eleven products in 2.1, each imported from App Store Connect. |
| Entitlements | `plus` (attached to `plus_monthly`, `plus_annual`), `family` (`family_monthly`, `family_annual`), `pro` (`pro_monthly`, `pro_annual`). Trip passes and packs are not relied on as RC entitlements (see 3.3). |
| Offerings | See 3.2. |
| Webhook | `POST https://api.wayfold.app/v1/webhooks/revenuecat` with an `Authorization` header holding a long random secret, environment-specific (sandbox events go to staging only). |
| Fees | RC is free under about $2,500 in monthly tracked revenue, then about 1% (verify). |

### 3.2 Offerings and packages

An offering is what the paywall shows. The server chooses the offering (section 6); the app fetches it by identifier from RC and renders our own React paywall in the passport theme (RC Paywalls UI is not used).

| Offering ID | Packages (RC package to product) | Used when |
|---|---|---|
| `default` | `$rc_annual` = `plus_annual` (highlighted, trial), `$rc_monthly` = `plus_monthly` (under "More options"), `trip_pass` = `trip_pass_90d` | Generic upgrade |
| `trip_first` | `trip_pass` = `trip_pass_90d` (lead), `$rc_annual` = `plus_annual`, `$rc_monthly` = `plus_monthly` | A trip with dates inside 120 days; live tracking and invite triggers |
| `plus_first` | `$rc_annual` = `plus_annual` (highlighted), `trip_pass`, `$rc_monthly` | Two or more active trips; third-trip limit |
| `group` | `group_pass` = `group_trip_pass_90d` (lead), `trip_pass`, `$rc_annual` | Polls, splitting, room block, more than 6 travelers |
| `family` | `family_annual` = `family_annual` (highlighted), `family_monthly`, `$rc_annual` | Household signals (section 6.4) |
| `credits` | `credits_50`, `credits_150`, `credits_400` | Out of credits |
| `pro` | `pro_annual`, `pro_monthly`, `credits` | Only when `pro.enabled` is on |
| `exp_*` | Variants created for experiments (section 6.7) | Experiments |

The paywall shows at most three visible choices; credit packs appear only in the `credits` offering or as a secondary row on a credit-out paywall. Pro is not shown until it launches.

### 3.3 How purchases reach our server

1. The app calls `Purchases.purchase(package)`. On success it calls `POST /v1/purchases/sync` with no payload (the server asks RC for the subscriber) so the unlock is instant, before the webhook lands.
2. RC sends a webhook. The handler is in 3.4.
3. For a trip pass, the app then shows "Which trip is this for?" (unless the purchase started from a trip, in which case the trip is pre-selected) and calls `POST /v1/trip-passes/{id}/bind` with the trip id.
4. A nightly reconcile job lists RC subscribers who changed in the last 48 hours and compares them with our rows; differences raise an alert and are repaired from RC.

Non-renewing subscriptions are not a reliable RC entitlement (RC treats them like one-off purchases, verify in the dashboard). So `trip_pass_90d` and `group_trip_pass_90d` arrive as `NON_RENEWING_PURCHASE` transactions and the server creates a `trip_passes` row; the 90 days, the trip binding and expiry are ours.

### 3.4 Webhook handling

Endpoint contract: verify the secret header; insert the raw body into `webhook_events` (`provider = 'revenuecat'`, `event_id` unique) and return 200 immediately; a worker job processes each row exactly once, idempotent on `event_id`, and sets `processed_at` or `error`. Failures retry with backoff for 24 hours, then alert.

| RC event | Server action |
|---|---|
| `INITIAL_PURCHASE` (subscription) | Upsert `subscriptions` (product, status `active` or `trialing`, `current_period_start`, `current_period_end`, `will_renew`), upsert `store_transactions` (keyed by store transaction id), recompute `entitlements` for the user, write a `credit_grants` row for the period (section 5.3), fire analytics `purchase_completed` |
| `RENEWAL` | Extend the period, new `store_transactions` row, grant credits for the new period if the plan is monthly (annual plans are granted monthly by the scheduler, 5.3), recompute entitlements |
| `PRODUCT_CHANGE` | Update product and tier; apply the upgrade or downgrade rules in 7.3 and 7.4 |
| `CANCELLATION` with `cancel_reason` `UNSUBSCRIBE` | Set `will_renew = false`, status stays `active` until `current_period_end`; start the win-back timer (7.10) |
| `CANCELLATION` with `cancel_reason` `CUSTOMER_SUPPORT` or a refund reason | Treat as a refund (7.6): revoke now, claw back credits |
| `UNCANCELLATION` | `will_renew = true` |
| `BILLING_ISSUE` | Status `grace` if Apple's grace period is on (entitlement stays), else `billing_retry`; send the billing email and in-app banner (7.5) |
| `EXPIRATION` | Status `expired`; recompute entitlements; expire allowance credits of the subscription (purchased credits stay) |
| `NON_RENEWING_PURCHASE` | If product is a pass: insert `trip_passes` (`status = 'unbound'`, `purchased_at`), write `store_transactions`; if a credit pack: write a `purchase` grant (5.2) |
| `TRANSFER` | Move the subscription to the new `app_user_id` only if both are our users and the target has no active membership; otherwise flag for support |
| Any refund of a consumable or pass | Reverse per 5.6 and 7.6 |

Each handler runs in one database transaction with the ledger writes, so a half-processed event cannot exist.

### 3.5 Server endpoints (contract only; full shapes in [04-api-spec.md](04-api-spec.md))

`POST /v1/webhooks/revenuecat`, `POST /v1/purchases/sync`, `GET /v1/me/entitlements` (tier, status, period end, will_renew, pass list, credit balance by pool, capability values), `POST /v1/trip-passes/{id}/bind`, `POST /v1/trip-passes/{id}/move`, `GET /v1/me/credits`, `GET /v1/me/credits/ledger`, `GET /v1/paywall`, `POST /v1/paywall/events`. A visible "Restore purchases" button is on every paywall and in Settings (App Review checks it); it calls `Purchases.restorePurchases()` then `POST /v1/purchases/sync`.

## 4. Entitlement resolution

### 4.1 Data

- `subscriptions`: one row per store subscription: `user_id`, `provider` (`apple`, `stripe`), `product_id`, `tier` (`plus`, `family`, `pro`), `status` (`trialing`, `active`, `grace`, `billing_retry`, `expired`, `refunded`), `current_period_start`, `current_period_end`, `will_renew`, `original_transaction_id`.
- `entitlements`: a materialized, per-user result of the algorithm below: `user_id`, `tier` (the user's own best, including household), `source` (`own`, `household`, `advisor`, `promo`), `household_id`, `valid_until`, `computed_at`. It is a cache that can always be recomputed; it is rewritten on every relevant event and by a nightly sweep.
- `trip_passes`: `id`, `purchaser_user_id`, `kind` (`trip_pass`, `group_trip_pass`), `store_transaction_id`, `status` (`unbound`, `active`, `expired`, `refunded`), `trip_id`, `bound_at`, `expires_at`, `moved_at`, `credits_grant_id`.
- `households`, `household_members` ([03-database-schema.md](03-database-schema.md)): the owner is the Family subscriber; up to 6 members including the owner.
- Advisor seats (`advisor_seats`) grant `pro`-level capabilities to an advisor user on client trips only (section 11.4).

Tier rank: `free` 0, `plus` 1, `family` 2, `pro` 3. A trip pass is an overlay on one trip, not a tier.

### 4.2 Algorithm

```python
RANK = {"free": 0, "plus": 1, "family": 2, "pro": 3}

def user_tier(user) -> Tier:
    """The user's own best tier, from their subscription or their household."""
    best = Tier("free", source="own", until=None)
    sub = active_subscription(user.id)           # status in trialing, active, grace; period_end >= now
    if sub:
        best = Tier(sub.tier, source="own", until=sub.current_period_end)
    m = household_membership(user.id)            # at most one household per user
    if m and household_owner_has_active_family(m.household_id):
        fam = Tier("family", source="household", until=owner_sub_period_end(m.household_id))
        best = max_rank(best, fam)
    if flags.get("pro.enabled") is False and best.code == "pro":
        best = Tier("family" if has_family(user) else "plus", ...)   # Pro hidden: never resolves before launch
    return best

def trip_capabilities(trip) -> Capabilities:
    """What the trip itself can do: best of its owner's tier and any active pass on it."""
    caps = [TIER_CAPS[user_tier(trip.owner).code]]
    for p in passes_on_trip(trip.id):            # status active, expires_at > now
        caps.append(PASS_CAPS[p.kind])
    return merge_best(caps)                      # per capability, see below

def merge_best(caps) -> Capabilities:
    out = {}
    for key in CAPABILITY_KEYS:
        vals = [c[key] for c in caps]
        out[key] = max(vals) if is_numeric(key) else any(vals) if is_boolean(key) else best_enum(key, vals)
    # live check budgets add up only within one source; take max of live_routes, not the sum
    return out

def actor_context(actor, trip) -> ActorContext:
    """What the person acting right now can do."""
    caps = trip_capabilities(trip)
    role = trip_role(actor, trip)                # owner, editor, viewer, from trip_members
    tier = user_tier(actor)
    return ActorContext(
        trip_caps=caps, role=role,
        personal_tier=tier,                      # governs actor's own limits: active trips they own, alerts on their own account
        credit_pools=spendable_pools(actor, trip),   # section 5.4
        ceiling=ceiling_for(actor, trip),        # 06 section 6.5
    )
```

Rules that the algorithm encodes:

1. **Best-of on a trip.** Capabilities on a trip are the per-capability best of the owner's tier and every active pass on the trip. Two passes on one trip (Trip Pass plus Group Trip Pass) take the higher value per capability; credits from both passes are separate pools and both spendable (live check budgets are the maximum, not the sum, because they are a cost cap).
2. **Invitees.** Collaborators and viewers get the trip's capabilities on that trip only. They do not gain tier benefits elsewhere. They do not pay and cannot buy passes for a trip they do not own (they can buy their own membership).
3. **Personal limits follow the person.** Active trips (the count a user may own), personal alerts and personal credits depend on `user_tier(actor)`, not on the trip.
4. **Owner lapse.** If the owner's tier drops, the trip keeps its data; capabilities recompute. Existing live routes beyond the new limit are paused (not deleted), oldest first kept; collaborators above the limit stay as viewers; AI on the trip continues to draw from whoever acts.
5. **Free is never a lock-out.** If any limit would block reading or exporting, it does not apply to read and export. Trips above the active-trip limit after a downgrade become read-only "archived" until the owner archives or upgrades; a Free user with three trips after a lapse keeps reading and exporting all three and may edit the two most recently edited ones.
6. **Grace.** Status `grace` counts as active for resolution. `billing_retry` after grace does not.
7. **Caching.** `entitlements` is recomputed on: webhook events, household changes, trip pass binding or expiry, the `pro.enabled` flag, and a nightly sweep. API routes read `user_tier` through a 30-second in-process cache keyed by user id; `POST /v1/purchases/sync` bypasses it.

### 4.3 Enforcement points

Every mutation route calls `require(actor_context, capability, value)`; limit errors return HTTP 402 with `code = 'limit_reached'`, `capability`, `limit`, and a `paywall_trigger` string that the client passes to the paywall engine (section 6). A client never infers a limit from its own data.

## 5. Credit system

One credit is a budget of up to $0.02 of provider spend. Credit action codes, prices and hard stops are in the README and in [06-ai-agents-spec.md](06-ai-agents-spec.md); this section owns the balance, grants, pools and ledger.

### 5.1 Pools and grants

`credit_grants` holds pools. `credit_ledger` holds every movement. A balance is the sum of `remaining` on unexpired pools; it is never stored as a single number.

| Pool `kind` | Created by | Amount | Owner | Expires | Spend priority |
|---|---|---|---|---|---|
| `allowance_free` | Lazily at first use in a month | 12 | user | End of calendar month (UTC) | 1 |
| `allowance_plus` | Subscription period or monthly tick | 60 | user | End of that month's period | 1 |
| `allowance_family` | Subscription period or monthly tick | 150 | household (pooled) | End of that month's period | 1 |
| `allowance_pro` | Subscription period or monthly tick | 240 (+ rollover, 5.5) | user | End of that month's period | 1 |
| `pass_trip` | Pass binding | 40 | trip (spendable by any member acting on that trip) | Pass expiry (90 days) | 2 |
| `pass_group` | Pass binding | 80 | trip (spendable by any member acting on that trip) | Pass expiry | 2 |
| `purchased` | Pack purchase | 50, 150 or 400 | user | 12 months after purchase | 3 (oldest first) |
| `adjust` | Support or concierge perk | any | user | set by admin (default 12 months) | 3 |

`credit_grants` columns used: `id`, `user_id` or `household_id` or `trip_id` (exactly one owner), `kind`, `amount`, `remaining`, `granted_at`, `expires_at`, `source_transaction_id`, `idempotency_key` (unique).

### 5.2 Purchase grants

- A pack purchase arrives as `NON_RENEWING_PURCHASE` or a consumable transaction. The handler writes a `credit_grants` row (kind `purchased`, amount from the product ID, `expires_at` = purchase time plus 12 months) and a `credit_ledger` row (`kind = 'purchase'`, positive delta), both keyed `store:{transaction_id}` so a replayed webhook never grants twice.
- The pack screen states: "Purchased credits last 12 months and are spent after your monthly credits."
- Purchased credits also raise the account's spend ceiling by their cost value ([06-ai-agents-spec.md](06-ai-agents-spec.md) section 6.5).

### 5.3 Grants on renewal

| Plan | When credits are granted | Key |
|---|---|---|
| Monthly (`plus_monthly`, `family_monthly`, `pro_monthly`) | On `INITIAL_PURCHASE` and each `RENEWAL` (a paid period) | `sub:{original_transaction_id}:{period_start_yyyymmdd}` |
| Annual (`plus_annual`, `family_annual`, `pro_annual`) | On purchase, and then on each monthly anniversary by the scheduler while the entitlement is active, until the annual period ends | same key with the anniversary date |
| Trial (`plus_annual` trial) | Plus allowance (60) is granted at trial start but the ceiling for the trial is the normal Plus ceiling; trial exposure is about $0.45 in live checks and credits for a typical trial | `sub:...:trial` |
| Grace or billing retry | No new grant during `billing_retry`; during `grace` the current period's pool remains spendable; if payment recovers, the grant for the new period is written with the recovered period start | |
| Free | Lazily written on first credit use each month; idle accounts cost nothing | `user:{id}:{yyyymm}` |

The scheduler job `grant_monthly` runs daily at 02:00 UTC, finds active annual subscriptions whose monthly anniversary is today and whose last grant is older than 28 days, and writes the grant. It never grants during `billing_retry`, `expired` or `refunded`.

### 5.4 Spend order

When an action reserves N credits, the ledger draws from pools in this order, oldest expiry first within a priority:

1. Monthly allowance pools the actor can use: their own allowance, or the household pool for a Family member.
2. Pass pools of the trip they are acting on.
3. Purchased and adjust pools, oldest expiry first.

A reservation that spans pools records each draw (`credit_ledger` rows with `grant_id`), so a refund returns credits to the same pools. If a pool expired before the refund, the refund is skipped for that part and the ledger says so; in practice runs last minutes, so this is rare. Credits are charged to the person who starts the action, so a collaborator on a Trip Pass trip first uses their own allowance, then the trip's pass pool.

### 5.5 Expiry and rollover

- Allowances do not roll over on Free, Plus or Family. Pro rolls over one month: before the new grant, unspent `allowance_pro` credits convert to a `rollover` pool capped so the total after the new grant does not exceed 240 (default; a product decision carried from the pricing plan, not in the README). Rolled credits expire at the end of the new period.
- Expiry is processed by a daily job: for each pool past `expires_at` with `remaining > 0`, write `credit_ledger` `kind = 'expire'` with the negative delta and set `remaining = 0`. The job is idempotent on `expire:{grant_id}`.
- Downgrade or lapse: allowance pools vanish at period end; purchased and adjust credits stay usable on Free.
- Trip pass credits expire with the pass; unspent credits do not convert to anything.

### 5.6 Refunds and clawback

| Event | Action |
|---|---|
| Refund of a pack | Remove the unspent part of that pack's pool (`credit_ledger` `kind = 'clawback'`). If some credits were already spent, the balance may go negative: write the negative balance, block all paid AI actions until the balance is positive again, show "Your balance is below zero after a refund. Buy credits or wait for your next monthly credits." Repeated refund abuse (3 refunds in 90 days, default) blocks pack purchases for 180 days and flags the account for review. |
| Refund of a subscription period | Revoke the entitlement now; remove the unspent part of that period's allowance pool; leave the credits of earlier periods. Spent allowance credits are not recovered (the cost is ours). |
| Refund of a trip pass | Status `refunded`; the trip drops to the owner's tier capabilities; remaining pass credits are removed; live checks stop. |
| AI action failed, refused, timed out or saved nothing | Automatic refund to the same pools ([06-ai-agents-spec.md](06-ai-agents-spec.md) section 6.3), never a support task. |
| Support goodwill | `adjust` grant with a reason; every adjustment writes `audit_log`. |

### 5.7 Ledger entries and balance

`credit_ledger` kinds: `grant_monthly`, `grant_pass`, `purchase`, `reserve`, `settle`, `refund`, `expire`, `adjust`, `clawback`. Each row: `user_id` (payer), `household_id` (when pooled), `delta`, `kind`, `feature` (credit action code), `run_id`, `grant_id`, `balance_after` (the payer's spendable balance after the row), `idempotency_key` (unique), `created_at`. Rules:

- Append only; corrections are new rows.
- A reserve writes a negative delta; a settle writes a zero-delta row that marks the reserve as final; a refund writes a positive delta keyed `run:{id}:refund`; partial refunds are allowed.
- The balance is computed under `SELECT ... FOR UPDATE` on the payer's unexpired `credit_grants` rows at admission, then reserved in the same transaction.
- `GET /v1/me/credits` returns the balance per pool with expiry dates; the in-app usage meter shows "Monthly credits", "Trip Pass credits", "Purchased credits" separately.
- A daily reconciliation asserts `SUM(delta)` per grant equals `amount - remaining`; any mismatch alerts.

## 6. Paywall decision engine

The server chooses whether to show a paywall and what to offer. The client renders the result. This keeps frequency rules, experiments and entitlements in one place and lets us change them without an app release.

### 6.1 API

`GET /v1/paywall?trigger={code}&trip_id={id}&session_id={id}` returns:

```json
{
  "show": true,
  "reason": "limit_reached",
  "trigger": "live_track",
  "offering": "trip_first",
  "highlight": "plus_annual",
  "copy_key": "paywall.live_track.trip",
  "trip_summary": "Live prices for Lisbon in April, checked daily until you fly",
  "free_path": {"label": "Not now", "action": "dismiss"},
  "credit_option": {"credits": 1, "label": "Check once for 1 credit"},
  "experiment": {"key": "annual_price", "variant": "control"},
  "muted_until": null
}
```

When `show` is false, `reason` says why (`session_cap`, `muted`, `first_session`, `recent_purchase`, `presentation`, `not_needed`), so the client can log and do nothing. `POST /v1/paywall/events` records `paywall_shown`, `paywall_dismissed`, `paywall_cta_tapped`, `purchase_started`, `purchase_completed`, `purchase_failed`, `restore_tapped` with the trigger, offering, variant and trip; these go to PostHog and to `analytics_events` (the table is used for paywall events because frequency caps need them server-side).

### 6.2 Triggers

| Trigger code | Moment | Shown when | Default offering | Free path |
|---|---|---|---|---|
| `third_trip` | Create a third active trip | Free limit reached | `plus_first` | Archive a trip |
| `second_route` | Add a second flight route | Free: 1 route per trip | `trip_first` (preview of cached fares first) | Keep one route |
| `live_track` | Tap "Track live" or "Refresh now" | No live access | `trip_first`, with "1 credit" option | Use 1 credit or cached fares |
| `alert_limit` | Price alert beyond the free one | Free alert used | `trip_first` | Keep the cached-fare alert |
| `invite_collab` | Invite a collaborator | Free owner | `trip_first` ("Plan together: they join free") | Share a read-only link |
| `draft_no_credits` | "Draft my itinerary" | Out of credits | `credits` or `plus_first`; blurred preview of day one | Plan manually |
| `research_no_credits` | "Research this" or "Ask" | Out of credits | `credits` (small pack first) | Skip |
| `agent_no_credits` | Deep agent run or fare hunt | Fewer than 40 credits | `credits` (400 pack highlighted when short by more than 50) or `plus_first` | Use a research question |
| `routine_locked` | Start a scheduled routine | Not Pro | Sample result from cache; one manual run for credits; Pro once launched | Run once manually |
| `group_feature` | Open polls, cost splitting or room block; more than 6 travelers | No group capability | `group` | Use notes; cost tracking without splitting |
| `footer_export` | Export or share with the Made with footer | Free export | Soft line at export, never a modal | Export with footer |
| `lodging_limit` | Save the 9th lodging option | Free limit | `trip_first`; keep saving to a "later" list | Later list |
| `lifecycle_14d` | 14 days before departure | Free trip with dates | `trip_first` via email or in-app card, not a modal | Dismiss |
| `household` | Invite a second household member | Household signals (6.4) | `family` | Invite as collaborator |

No trigger exists for the first session, for presentation playback, or for actions after an affiliate booking. Hard limits (third trip) are a block with the free alternative, not a nag.

### 6.3 Which offer to show

```python
def choose_offering(ctx, trigger):
    if not ctx.pro_enabled and trigger == "routine_locked":
        return "credits"                                   # manual run via credits, no Pro
    if trigger in CREDIT_TRIGGERS:                         # draft, research, agent out of credits
        return "credits" if ctx.tier != "free" or ctx.recent_pack_buyer else "plus_first"
    if trigger == "group_feature" or ctx.trip.travelers > 6:
        return "group"
    if ctx.household_signal:
        return "family"
    if ctx.trip and ctx.trip.dates_within(120):            # "I have a trip in March"
        return "trip_first"
    if ctx.active_trips >= 2:
        return "plus_first"
    return "default"
```

Defaults from the plan: best-converting first is Trip Pass, then annual Plus, then monthly Plus; Trip Pass leads when the trip has dates within 120 days, annual Plus leads when the user has two or more active trips. Plus annual is pre-selected in `default` and `plus_first`; the trial line states the price after the trial and the renewal date.

### 6.4 Household signal

`household_signal` is true when any of: the user has invited, or been asked to invite, two or more people to a household; the user's trips have 3 or more travelers that are also trip members on at least two different trips; or the user tapped "Family" in the plan comparison. It never uses names, ages or inferred relationships.

### 6.5 Frequency caps and mute rules

| Rule | Default |
|---|---|
| No paywall in the first session or before the user has created a trip | always |
| At most one paywall per session | always |
| At most 3 paywall views per rolling 7 days, across all triggers | 3 |
| Dismissing a trigger mutes that trigger for 7 days | 7 days |
| Dismissing the same trigger 3 times mutes it for 30 days | 30 days |
| No paywall within 24 hours after a purchase, or while a purchase is pending | 24 hours |
| Never during presentation playback, offline, or while a run the user started is in progress | always |
| Never on a trip where the user is an invitee and the trigger is about owning the trip (collaborator invite, footer) | always |
| Credit-out paywalls show only when the user tapped the AI action (never as a banner) | always |
| Hard-limit blocks (third trip) always show their block, but the offer section is subject to the mute rules | always |
| Lifecycle prompts go by email or an in-app card, never a modal, and at most one per trip per 14 days | 14 days |

Counters come from `analytics_events` (`paywall_shown`, `paywall_dismissed`) read server-side, so they hold across devices.

### 6.6 Paywall content rules

- Show price and billing period most prominently, then trial length and the price after the trial, auto-renew terms, links to Terms of Use and Privacy Policy, and Restore (Guideline 3.1.2).
- Say what the user gets on this trip ("Live prices for Lisbon in April"), use real numbers ("3 routes, checked daily until you fly"), and never "unlimited AI" or "unlimited live tracking".
- Always a "Not now" control of the same size and contrast as the main one. No countdown timers, no invented scarcity, no pre-checked upsells. Trial reminder: a local notification and an email two days before the trial converts.
- The free path and the plain-text "How we earn money" link are on every paywall. No affiliate card appears beside an upsell.

### 6.7 Experiments

Server-side assignment: `variant = hash(user_id || experiment_key) mod 100` against the experiment's allocation, stored in `feature_flags` with `key = 'exp.{name}'`, `allocation`, `variants`, `started_at`, `owner`. A user keeps their variant. Every variant discloses price and terms; no variant hides the free path. Price tests need separate App Store product IDs and an RC offering per variant (for example `trip_pass_90d_b` at $7.99 and `trip_pass_90d_c` at $12.99, `plus_annual_b` at $34.99).

| # | Experiment | Variants | Primary metric | Guardrail |
|---|---|---|---|---|
| 1 | Trip Pass price | $9.99, $7.99, $12.99 | Revenue per paywall view | Trip Pass to Plus cannibalization, refunds |
| 2 | Plus annual price | $39.99, $34.99 | Net revenue per view at 60 days | Trial start rate |
| 3 | Annual pre-selection | Annual pre-selected vs none | Annual share of purchases | Refund rate in 14 days |
| 4 | Lead offer on `live_track` | Trip Pass lead vs annual lead | Purchases per view | Plus churn at 60 days |
| 5 | Trial length | 7 days vs 3 days (annual only) | Trial to paid | Complaints |
| 6 | Credit pack order | 50 first vs 150 highlighted | Revenue per credit-out view | Pack refunds |
| 7 | Family visibility | Family as a row in `default` vs household trigger only | Family share | Plus downgrades |

Rules: one experiment per trigger at a time; pre-register the metric and minimum run length (at least 4 weeks and 1,000 views per arm, default); stop an arm that lowers satisfaction (support tickets, ratings prompts). Results are read in the admin console ([08-admin-control-center.md](08-admin-control-center.md)).

## 7. Lifecycle rules

### 7.1 Trials

- Only `plus_annual` has a 7-day free trial, one per Apple ID per group. The paywall shows "7 days free, then $39.99 a year" with the renewal date, and a reminder two days before it converts.
- During the trial: status `trialing`, full Plus capabilities and the normal Plus allowance, the normal Plus ceiling. Exposure for a typical trial is about $0.45.
- Trial to paid: `RENEWAL` event with a paid period; status `active`. Trial cancelled: access until the trial ends, then `EXPIRATION`.
- No trial for monthly plans, Family, Pro, passes or packs. Reinstalls and new devices cannot restart a trial (Apple enforces one per Apple ID per group).

### 7.2 Purchases outside the lifecycle

- Buying a trip pass while on a membership is allowed and useful (the pass lives on one trip and is best-of with the owner's tier).
- Buying a membership while a trip pass is active is allowed; both coexist.

### 7.3 Upgrades

Plus to Family or Pro, Family to Pro, monthly to annual of a higher tier: Apple applies the change immediately and refunds the unused time of the old plan pro rata (same group, higher level). Our handling on `PRODUCT_CHANGE`:

1. Switch the tier now; recompute entitlements and household capabilities.
2. Grant the new tier's allowance for the current period now, minus any allowance already granted and unspent in this period: the old allowance pool stays valid for spending (never reduce a pool the user already has), and the new grant is the difference up to the new amount (Plus 60 to Family 150: grant 90). The key includes the product change transaction.
3. Family gains the household pool: existing household members gain benefits immediately.
4. Analytics `upgrade_completed` with from and to tier.

### 7.4 Downgrades

Family to Plus or Plus to a cheaper cycle, or any lower level: Apple applies it at the next renewal. Until then the user keeps the current tier. At renewal:

1. The new product and tier apply; the old allowance expires with the old period; the new allowance is granted.
2. Family to Plus: the household dissolves at the boundary. Members lose household benefits and the pooled credits; each member keeps their own purchased credits and their own trips. Members with no plan fall to Free. The owner gets 14 days before the boundary an in-app notice listing who will lose benefits (7.8).
3. Limits above the new tier are handled by the owner-lapse rules in 4.2 (pause, never delete).

### 7.5 Cancellation, grace, billing retry

- **Cancellation.** The user cancels in iOS Settings (we link to Manage Subscriptions from Settings and never hide it). Status stays `active` with `will_renew = false` until the period ends, then `EXPIRATION`. The app shows "Your plan ends on {date}" and a one-tap resubscribe. Account deletion does not cancel an Apple subscription; the deletion screen says so and links to Manage Subscriptions.
- **Billing grace period.** Turn on Apple's billing grace period for all subscription products, 16 days (default). During grace the entitlement stays active and the credits of the current period stay spendable, but no new allowance is granted. The app shows a banner "We could not renew your plan. Update your payment method" with a deep link to the App Store subscription page; email on day 0, 7 and 14.
- **Billing retry.** After grace, Apple keeps retrying for up to 60 days in total. Status `billing_retry`: entitlement is off (the user drops to their remaining sources), the banner stays, purchased credits remain. If payment succeeds, a `RENEWAL` arrives, status returns to `active`, and the allowance for the new period is granted. If it never succeeds, `EXPIRATION`.
- **Pause.** Not used; Apple subscription pause is not offered. The pricing plan's "3-month pause" idea is handled by a win-back (7.10), not by the store.
- **Re-subscribe after expiry.** A new period, a new grant, no trial.

### 7.6 Refunds

Refunds happen through Apple (reportaproblem.apple.com); we cannot issue them. On a refund notice from RC:

| Product | Action |
|---|---|
| Subscription | Status `refunded`, revoke now, claw back the unspent allowance of that period (5.6), keep a refund count on the user |
| Trip pass or Group Trip Pass | Status `refunded`; the pass stops granting capabilities; its unspent credits are removed; live checks stop. The trip and its data stay. |
| Credit pack | Clawback (5.6); negative balance blocks paid AI until positive |
| Pattern | 3 refunds in 90 days: block purchases for that user for 180 days and flag for review (default) |

Support can grant goodwill credits (`adjust`) but never reverse a refund into a free pass.

### 7.7 Trip pass binding and expiry

1. On purchase a `trip_passes` row is created `unbound`. The app asks "Which trip is this for?" and lists the owner's trips. An unbound pass waits in Settings, Purchases, for 12 months (default) and then expires.
2. Binding sets `trip_id`, `bound_at = now`, `expires_at = bound_at + 90 days`, writes the credit pool (`pass_trip` 40 or `pass_group` 80) and recomputes the trip's capabilities. Only the trip owner may bind, and the purchaser must be the owner.
3. A pass can be moved once to another trip that the same owner owns (`moved_at` set); moving keeps the original `expires_at`, moves unspent credits, and pauses live routes on the old trip. A second move is refused.
4. Live check counters (the 60 checks) belong to the pass and move with it.
5. Expiry at `expires_at`: capabilities drop to the owner's tier; unspent pass credits expire; the trip stays. The app shows the pass status and expiry date in the trip's settings, a notice 7 days before, and offers renewal by buying a new pass (binding starts a new 90 days).
6. A pass is tied to the purchaser's Apple ID through the transaction; it is restorable, because it is a non-renewing subscription and not a consumable.
7. If the bound trip is deleted by the owner, the pass is not refunded; it returns to `unbound` if more than 30 days remain (once).

### 7.8 Family membership changes

- Household owner: the Family subscriber. Up to 6 members including the owner. Members are invited in the app (link or email), must accept, and must have a Wayfold account. Apple Family Sharing is not used.
- One household per user. A user with their own Plus or Pro subscription who joins a household keeps the higher tier from `user_tier` (best of) and their own allowance; they also draw from the household pool as a member.
- Household credits are one pool (`allowance_family`, 150 a month). Spend is charged to the person acting and drawn from the pool first; there is no per-member quota. A member can exhaust the pool (the owner sees per-member usage in Settings).
- Adding a member: immediate; no extra charge.
- Removing a member (by the owner) or a member leaving: benefits end immediately; the member's own purchased credits and own trips stay with them; trips they owned keep their data and revert to their personal tier capabilities; pooled credits already spent stay spent. A removed member may be re-invited.
- Churn guard (default): a person can join or leave a household at most twice in 12 months, and a household may have at most 2 replacements of members per quarter; counters in `household_members`.
- Owner cancels or lapses: the household dissolves at `current_period_end` with the notices in 7.4.
- Ownership transfer: not supported at launch (the owner must resubscribe under the new owner).

### 7.9 Group Trip Pass rules

- Bound to one trip, 90 days from binding, purchased by the trip owner only ($19.99).
- Raises the trip to up to 12 travelers (owner plus up to 11 collaborators), 80 credits (`pass_group`), polls, cost splitting (the expense and settlement features in section 10), and the room-block request form (`room_block_requests`, a lead form that goes to the concierge advisor; no payment).
- Capabilities for live routes are 2 routes and at most 60 checks, like Trip Pass.
- Coexists with Trip Pass on the same trip: best of per capability; both credit pools spendable.
- Guests in the group need no subscription; they join free and see polls and splits. Those who want to start AI actions draw from their own allowance, then the trip's pass pool.
- Expiry: polls and splits become read-only; past polls and recorded expenses remain readable and exportable; open payment collections continue to completion on Stripe (they are not an app feature, section 10). The owner sees a notice 7 days before expiry.
- Not refundable by us; Apple refund rules (7.6) apply.

### 7.10 Win-back and retention (after launch)

When `will_renew` turns false, the next two checkpoints are a cancellation survey (one question, skippable) and a win-back offer 7 days after expiry: an Apple promotional or win-back offer on the same product (for example 3 months at a discount, verify product configuration). Win-back offers are configured in App Store Connect after the first month of data and delivered through RC; never used as a dark pattern (shown once, clearly priced). A lifecycle email "Planning another trip?" goes out to lapsed users with a trip in the next 120 days.

## 8. Affiliate system

Affiliate income is the Free tier's revenue. It is earned on every tier in the same places. Every partner link goes through our redirect. Program details and rates are "reported, verify".

### 8.1 Program catalogue

`affiliate_programs` holds one row per program: `slug`, `name`, `network`, `category`, `status` (`planned`, `applied`, `live`, `paused`, `retired`), `commission_note`, `cookie_days`, `app_allowed`, `sub_id_limit`, `countries`, `kill_switch_key`, `launch_phase`, `notes`. Seed data for launch (Travelpayouts, Viator partner API, Stay22) and month-3 applications:

| Slug | Network | Category | Status at launch | Notes |
|---|---|---|---|---|
| `aviasales` | Travelpayouts | flights | live | Cached-fare data API is open; "Book" opens an Aviasales search with our marker |
| `kiwi` | Travelpayouts | flights | live | Label self-transfer fares |
| `tripcom_flights` | Travelpayouts | flights | live | |
| `booking_tp` | Travelpayouts | stays | live | Show Booking's required disclosure line next to the link |
| `agoda_tp` | Travelpayouts | stays | live | |
| `tripcom_hotels` | Travelpayouts | stays | live | |
| `hostelworld_tp` | Travelpayouts | stays | live | Hostel items only |
| `stay22` | Stay22 | stays | live (challenger) | Maps widget and Link Swap for pasted listing hosts that have approved programs |
| `discovercars` | Travelpayouts | cars | live | |
| `localrent` | Travelpayouts | cars | live | |
| `omio` | Travelpayouts | trains | live | |
| `welcome_pickups` | Travelpayouts | transfers | live | |
| `kiwitaxi` | Travelpayouts | transfers | live | |
| `viator` | Viator partner API | tours | live | Basic access is self-service; weekly payout, $50 minimum |
| `gyg_tp` | Travelpayouts | tours | live | |
| `tiqets` | Travelpayouts | tours | live | |
| `gocity` | Travelpayouts | tours | live | Pass cities only |
| `radical_storage` | Travelpayouts | luggage | live | On checkout days only |
| `compensair` | Travelpayouts | compensation | live | Paid per confirmed application |
| `ekta`, `visitorscoverage` | Travelpayouts | insurance | planned | Off until legal sign-off; insurer-approved copy only |
| `expedia_group` (Vrbo, Expedia, Hotels.com) | Impact | stays | applied at month 3 | The only route to Vrbo |
| `booking_direct` | confirm current network first | stays | applied at month 3 | |
| `skyscanner` | Impact | flights | applied at month 3 | The licensed fare data matters more than the cash |
| `airalo` | Impact | esim | applied at month 3 | Link out only; never sold in the app |
| `getyourguide_direct` | own program | tours | applied at month 3 | |
| `airhelp` | direct | compensation | month 3 plus | |
| `trainline`, `worldnomads`, `heymondo`, `klook` | various | various | month 3 plus | Add only when data shows demand |

Not integrated: Airbnb (no program an app can join: listings get a plain link that is never converted), credit cards, VPNs, Amazon product data, the Expedia Rapid API, and new integrations on Partnerize (merging into CJ).

Rules:

- One partner per surface per test cell; never two networks on one button.
- Each program has a `kill_switch_key` in `kill_switches` (`affiliate.{slug}`) and a global `affiliate.all`. An off switch hides that partner's buttons on the next fetch and makes `/go` return the non-affiliate fallback (the plain destination or a neutral search link).
- Pasted listing links stay exactly as pasted. A separate labeled "Book via partner" button offers a partner link built from the URL text (host, path, the trip's dates), never by fetching the page, and only for hosts with an approved program. It never appears for Airbnb. The server never fetches Airbnb, Vrbo or Booking.com pages, not even for link previews (previews for partner hosts are disabled by default).
- No list, badge, default sort or AI answer depends on commission. When two partners offer the same item, the choice is by A/B cell or the user's own criteria, never by payout.

### 8.2 Link templates

`affiliate_link_templates` holds one row per program, category and surface: `program_id`, `category`, `template` (a URL with placeholders), `params` (jsonb describing each placeholder source), `deep_link_builder` (a named function in code), `geo` (list or all), `status`, `version`. Templates are stored, never taken from a request. Placeholders: `{click_id}` (sub-id), `{short_id}`, `{marker}`, `{surface}`, `{dest_url}` (URL-encoded target), `{checkin}`, `{checkout}`, `{adults}`, `{children}`, `{origin}`, `{dest}`, `{date}`. Verify each template against the network's terms page after sign-up; these are the intended shapes.

| Program | Template shape (intended) | Sub-id field |
|---|---|---|
| Travelpayouts (partner links) | `https://tp.media/r?marker={marker}.{short_id}&p={program_p}&u={dest_url}&campaign_id={campaign}` | Appended to `marker` |
| Aviasales data API booking link | `https://www.aviasales.com/search/{route_code}?marker={marker}.{short_id}` | Appended to `marker` |
| Viator | `https://www.viator.com/tours/{path}?pid={pid}&mcid={mcid}&medium=api&campaign={short_id}` | `campaign` |
| Stay22 | `https://www.stay22.com/allez/{brand}?aid={aid}&campaign={short_id}&address={dest}&checkin={checkin}&checkout={checkout}&adults={adults}` | `campaign`; surface in a second field where supported |
| Impact (Expedia Group, Skyscanner, Airalo) | `https://{tracker}.sjv.io/c/{account}/{ad}/{program_id}?subId1={click_id}&subId2={surface}&u={dest_url}` | `subId1`, surface in `subId2` |
| Booking.com (once a direct program exists) | Per Partner Center deep links | `label` |

### 8.3 Creating a click: `/v1/outbound` and `/go/{click_id}`

1. The app calls `POST /v1/outbound` with `{entity_type, entity_id, surface, trip_id, checklist_item_kind?}` (authenticated; see [04-api-spec.md](04-api-spec.md)). The server checks trip access, checks that the program's kill switch is on, chooses the program (feature flags, geography, A/B cell; never commission), builds the target URL from the stored template and inserts a `link_clicks` row, then returns `https://go.wayfold.app/go/{click_id}`. Rate limit: 60 a minute per user (default), with repeat clicks on the same entity within 30 seconds returning the same `click_id`.
2. `click_id` is a random 128-bit value encoded in base62 (about 22 characters), generated only by this authenticated call. Where a network limits sub-id length, `link_clicks.short_id` (8 to 12 characters) is sent instead; the click id itself never leaves our system except in our own URL.
3. The app opens the URL in `SFSafariViewController` (Capacitor Browser plugin). The web app opens a new tab with `rel="noopener noreferrer"`.
4. `GET /go/{click_id}` looks the row up; checks it is under 10 minutes old and has not been used; sets `clicked_at`; returns HTTP 302 to the partner URL built from the stored template, with the sub-id. Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. The response has no body and renders no page, so there is no third-party script, pixel or cookie from us. An expired or used id returns a 302 to the plain destination (the non-affiliate route) so the user is never stranded.
5. No open redirects: the target is only ever a stored template filled with validated fields. There is no `url=` parameter on `/go`.

`link_clicks` columns used: `id` (the click id), `short_id`, `user_id`, `trip_id`, `program_id`, `template_id`, `category`, `surface`, `entity_type`, `entity_id`, `checklist_item_kind`, `program_variant` (A/B cell), `opened_in` (`sfsvc` or `safari` or `web`), `created_at`, `clicked_at`, `redirect_status`, `country`, `platform`, `app_version`, `ip_hash` (salted, rotated monthly). No advertising ID, no IDFA or IDFV, no device fingerprint.

### 8.4 Sub-ids, privacy and App Tracking Transparency

- The sub-id is a random per-click token. User id, trip id and email never appear in a URL; the join from a conversion to a click to a user and trip happens only in our database.
- No ad, attribution or third-party analytics SDK; no hashed email or phone to any partner. Conversions are pulled by our server from each network's API and joined to `link_clicks` in our database. This keeps the app outside App Tracking Transparency (no ATT prompt); note it in the review notes and verify with Apple.
- Privacy label: Usage Data (product interaction: outbound clicks), linked to identity, for analytics and app functionality, not used for tracking.
- Click rows are retained 25 months; aggregates 7 years (suggested; counsel to confirm). The privacy policy lists the purpose "affiliate revenue attribution and fraud detection".

### 8.5 Disclosure

- Sentence used everywhere, next to every partner button, in AI output cards, on shared trip pages, in presentation mode and in the PDF: **"We earn a commission if you book here."** Text, never color alone; VoiceOver reads it in the same element as the button.
- "Ad" tag on UK and EU storefronts (by App Store storefront country or account country; the stricter rule applies when unknown).
- Booking.com adds its own required line where its tracking link appears.
- Every list says how it is sorted (price, rating, distance, hearts) and that commission plays no part. Prices from partners show the date checked and provider. "How we earn money" page linked from Settings, every paywall and empty states; a "Hide booking links" switch collapses buttons to a plain "Open on partner site" link.
- No insurance card until the trip has a chosen flight or booking; no eSIM card for domestic trips; AI never gives insurance advice; visas link to official sites first.
- No affiliate push that exists only to drive clicks (Guideline 4.10). User-requested price alerts are fine, and they link into the app route, not to a partner.
- Affiliate purchases never unlock app features, and nothing is worded as if they do (Guideline 3.1.1).

### 8.6 Nightly conversion import

A worker job per network runs nightly (02:30 UTC, jittered per network) and on demand from the admin console. Each writes `affiliate_conversions`: `program_id`, `network_txn_id`, `click_id` (nullable when unmatched), `status` (`pending`, `approved`, `rejected`, `paid`, `reversed`), `sale_amount_minor`, `commission_minor`, `currency`, `commission_usd_micro` (converted with `fx_rates` at event date), `booked_at`, `clicks_lag_hours`, `reversal_at`, `paid_at`, `raw` (jsonb). Unique on `(program_id, network_txn_id)`; every import is an idempotent upsert that updates status and amounts and appends to a status history inside `raw.history`.

| Network | Source | Sub-id where it comes back |
|---|---|---|
| Travelpayouts | Booking statistics API, then payments API | The part of `marker` after the dot (`sub_id`) |
| Viator | Partner API commissions report (weekly payouts) | `campaign` |
| Stay22 | Reporting API or dashboard export (verify) | `campaign` |
| Impact (Expedia Group, Skyscanner, Airalo) | Impact Actions API | `subId1` |
| Awin or CJ (only if a program requires it) | Their reporting APIs | Network's sub-id field |

Matching and health:

- Match a conversion to a click by sub-id. Unmatched conversions are stored and counted; the unmatched share above 10% for a program is a tracking break and alerts.
- Status changes: `pending` becomes `approved` or `rejected` after the partner's validation window (often after check-out); `approved` becomes `paid` with `paid_at` when the network pays. Cancelled stays and returns become `rejected` or `reversed`.
- Job alerts: failed import, zero rows for 3 days on a live program, reversed amounts above 25% of the month, redirect 4xx or 5xx above 1%, clicks down more than 50% day over day, a program approval rate under 60%.
- Network payouts (what actually lands in the bank) are reconciled monthly by hand against `paid` rows; differences are logged as `adjust` notes in `audit_log`.
- A Travelpayouts written confirmation that a native app using the partner-links API with a server-side redirect is allowed, and the sub-id length and character rules, are a pre-launch item.

### 8.7 Revenue attribution

Revenue is attributed along the chain conversion, click, (user, trip, surface, program, category).

- **Recognition.** Show three numbers: pending (expected), approved, paid. Expected revenue for pending rows uses the program's trailing 90-day approved-to-pending ratio. Reported revenue for accounting is paid; management revenue is approved plus expected pending.
- **Per trip.** Sum of conversions whose click has that `trip_id`, in USD, by category. "Real trips" are trips with dates in the next 12 months and at least a chosen flight, a shortlisted stay or two itinerary items.
- **Per surface.** Conversions grouped by the click's `surface` and `checklist_item_kind`.
- **Per user and tier.** Joined to the user's tier at click time (snapshotted as `link_clicks.tier`, added to the columns above) so Free versus paid earnings are reportable.
- **Overlap.** When Viator and GetYourGuide both show the same item, only the booked one is counted; never count two commissions for one booking.
- **Dedupe of self-purchase.** Conversions from accounts on the internal list (`admin_users` and test accounts) are excluded.

### 8.8 Dashboards (admin console)

Views in [08-admin-control-center.md](08-admin-control-center.md), built on these queries: `revenue_by_month`, `revenue_by_surface`, `revenue_by_partner`, `revenue_by_category`, `revenue_per_mau` (same MAU definition as section 12), `click_to_booking_by_surface`, `epc_by_program_and_surface`, days from click to booking and from approval to payout, a cash view (pending, approved, paid, and a 3-month projection from the real pending-to-approved ratio), the unmatched share per program, and the A/B experiment results. Annualized affiliate income per monthly user is tracked from launch against the kill rule (under $0.20 at month 9).

### 8.9 Affiliate experiments

Queue in priority order (one per surface at a time, pre-registered metric, server-side assignment, never hide the disclosure or rank by commission): (1) link-out container (`SFSafariViewController` vs external Safari), measured as tracked bookings per 100 clicks; (2) lodging partner (Travelpayouts Booking.com vs Stay22 vs direct once approved), as net commission per click; (3) disclosure wording (every variant discloses: standard sentence, "Paid link: we earn a commission.", standard plus "Ad"); (4) checklist timing (45, 30 or 14 days before departure); (5) button position on lodging cards; (6) price alert delivery (push, email, in-app); (7) "Book the plan" last slide on or off by default; (8) "Hide booking links" visibility; (9) paid-tier weighting. Sample size note: detecting 3.0% to 3.6% lodging conversion needs about 20,000 clicks per arm, so early on test click-through and treat bookings as a slow aggregate.

## 9. Concierge lane

An optional "Have a human book this" request on stays, cruises and complex trips. A human advisor, working under a host travel agency, fulfills it. The user gets perks; Wayfold earns the agency commission. It is always optional, always disclosed, and never pushed.

### 9.1 Request flow

1. **Entry points.** A quiet card on a shortlisted stay ("Want a person to book this and handle changes?"), on a cruise idea, and on complex trips (more than 2 destinations, more than 8 travelers, a honeymoon or milestone flag). Never inside AI output, never on a paywall, never as a push.
2. **Request form.** Kind (`stay`, `cruise`, `multi_city`, `other`), dates and flexibility, party size and ages band, budget range, preferences (free text, 600 characters), the saved items it refers to (`lodging_options` ids), phone (optional), preferred contact method. The trip's public summary is attached.
3. **Consent screen** (section 9.2) must be accepted before submit.
4. **Confirmation.** The user sees "Request sent. An advisor replies within 1 business day" (default SLA), the status tracker and the disclosure.
5. **Advisor work.** Quote and proposal are prepared and sent by the advisor outside the app (email) at launch; proposals are attached to the request as files (R2). Booking happens on the agency's and supplier's systems; the client pays the supplier or agency directly. Wayfold never takes payment for the booking and never stores card data.
6. **After booking.** The advisor records the booking reference and commission estimate; the confirmation is added to the trip (flight, stay or itinerary item) with the client's consent.

### 9.2 Consent

A `consents` row (`type = 'concierge_handoff'`, policy version, timestamp, what was shared) is required. The screen lists exactly what goes to the advisor and the agency: name, email, phone (if given), the request details, the trip's dates and destination, and traveler names and dates of birth only at the time of booking and only when the advisor asks for them inside the request thread. It says: "Wayfold is paid a commission by the travel agency that books this. The price to you is the same as booking direct." Users can withdraw consent, which closes the request and deletes the advisor-side copy within 30 days (except records the agency must keep by law).

### 9.3 Handoff to the advisor

- **Launch mode.** The founder is the advisor. A new request creates an item in the admin console queue ([08-admin-control-center.md](08-admin-control-center.md)) and an email to the advisor inbox with a secure link (no personal data in the email body). The advisor works the request under the host agency's credentials.
- **Later mode.** Additional advisors get accounts in `admin_users` with role `advisor`, see only assigned `concierge_requests`, and may use Wayfold for Advisors (section 11.4). Assignment is round robin by kind and workload; users never choose by commission.
- `concierge_requests` columns used: `id`, `user_id`, `trip_id`, `kind`, `details` (jsonb), `consent_id`, `status`, `advisor_id`, `agency` (host agency slug), `handoff_at`, `booking_ref`, `supplier`, `booking_value_minor`, `currency`, `commission_estimate_minor`, `commission_actual_minor`, `commission_status` (`expected`, `confirmed`, `paid`, `lost`), `perk_note`, `closed_at`, `closed_reason`.

### 9.4 Status tracking

Statuses: `new`, `contacted`, `quoting`, `proposal_sent`, `booked`, `traveling`, `completed`, `declined`, `cancelled`, `closed`. The user sees a tracker with plain labels and dates, and gets an in-app message and optional push on changes they requested (no marketing). SLA alerts in the admin console: a `new` request older than 1 business day, a `proposal_sent` older than 7 days with no reply (advisor follow-up).

### 9.5 Commission recording

- The host agency pays commission after the traveler checks out (hotels roughly 8 to 15%, cruises 10 to 16%, host split 70 to 90%, all reported, verify the agency contract). The advisor records the expected commission at booking (`commission_estimate_minor`, `commission_status = 'expected'`).
- Monthly, the agency's commission statement is imported (CSV upload in the admin console) and matched by `booking_ref`; matched rows become `confirmed` and then `paid` when the payout lands, with `commission_actual_minor`. A cancelled booking is `lost`.
- Revenue is recognized when `paid`; management reports also show expected and confirmed.
- Perks (breakfast, upgrades, agency credits) are noted in `perk_note`. A Wayfold reward of 40 credits on a completed booking is granted as an `adjust` pool (default, configurable).

### 9.6 Disclosures and legal notes

- The card, the form, the confirmation and the advisor's proposal all say Wayfold earns a commission. Recommendations must include options the client asked for, are never ranked by commission, and the advisor records conflicts.
- **Seller of travel.** Several US states (California, Florida, Hawaii, Iowa, Washington and others) regulate sellers of travel. The advisor operates as an independent contractor under a host agency that holds the required registrations, consumer protection (trust or bond) and errors and omissions insurance; Wayfold itself does not sell travel, take payment for travel or hold itself out as a travel seller. The legal structure, the contract with the host agency, the disclosures wording and state-by-state rules are confirmed by counsel before launch (pre-launch item). Cruise lines and suppliers require the advisor's credentials (for example IATA/CLIA/ARC numbers through the host agency).
- Apple: the service is a physical travel service consumed outside the app, so it is outside In-App Purchase under Guideline 3.1.3(e); it never unlocks app features; it is described in the review notes.
- No insurance sales or advice through the concierge path unless the host agency and counsel approve in writing.

## 10. Group payments (Stripe)

Two layers, both free at launch: tracking (expenses and splits inside the app) and collection (paying each other through Stripe for real-world costs). Group payments are Stripe only: never In-App Purchase, and never for digital features. The Group Trip Pass (an IAP) unlocks the features; the money that travelers owe each other is real-world cost.

### 10.1 Tracking (all tiers that can split)

Cost splitting is a Group Trip Pass capability (polls and splitting; 7.9). `expenses` (payer, amount, currency, description, date, category, trip), `expense_shares` (expense, person, share in minor units, method) and `settlements` (from, to, amount, currency, method, status, stripe ids) hold it. Split methods: equal, by shares, exact amounts, by person-nights. Multi-currency expenses keep their original currency; balances are shown in the trip's home currency using `fx_rates` at the expense date, with the original shown beside. The settle-up screen proposes the minimal set of payments to zero every balance.

### 10.2 Collection

1. **Organizer setup.** The trip owner or a named organizer connects a Stripe Connect Express account (Stripe-hosted onboarding; Wayfold stores the account id only, never bank details). Without it, the app offers "Mark as paid" (cash, bank transfer or app of your choice) but no card collection.
2. **Collect.** The organizer creates a collection for a real-world cost ("Villa deposit, $2,400") and picks a split. The app generates one payment link per traveler (Stripe Checkout, reachable in the app browser or on the web; Apple Pay and Google Pay appear where available). Each traveler pays their own share.
3. **Destination charges.** Each payment is a Stripe destination charge to the organizer's connected account, so funds settle to the organizer and Wayfold never holds traveler money (the structure is reviewed with counsel for money transmission, pre-launch item).
4. **Fees.** Stripe's processing fee (about 2.9% plus $0.30 for US cards, verify) is shown to the payer as a separate line before paying, or absorbed by the organizer when they choose "I cover fees". Connect and payout fees (verify) are charged to the organizer's connected account. Wayfold's application fee is 0 at launch (default in `feature_flags` key `group_payments.fee_bps`); the lane is a driver of Group Trip Pass sales, not a margin. A later fee, if any, is disclosed before payment and is never a percentage of a digital purchase.
5. **Settle.** Webhooks (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated`, `payout.paid`) update `settlements` and the collection's progress: `status` `pending`, `paid`, `failed`, `refunded`, `disputed`. A collection closes when every share is `paid` or the organizer closes it; open balances remain tracked. Idempotency keys on every Stripe call are `settlement:{id}:{attempt}`.
6. **Refunds.** The organizer refunds through the app (a Stripe refund on the connected account); Wayfold's fee (none at launch) would be refunded with it. A refunded share reopens the balance. Disputes are handled by the organizer as the merchant on the connected account; the app shows status and instructions and Wayfold support assists. Wayfold cannot refund money it never held.
7. **Receipts and privacy.** Stripe emails receipts. We store Stripe ids and amounts, not card data. Payer names shown to the organizer are the trip's people names.

### 10.3 Apple rules for this lane

- Payments between travelers for real-world trip costs are for goods and services consumed outside the app, so they fall under Guideline 3.1.3(e) and do not use In-App Purchase. Verify the current text on the day of submission, and keep the review notes explicit that nothing digital is unlocked by these payments.
- The Group Trip Pass stays an In-App Purchase. The app never links to a web page to buy the Group Trip Pass.
- Collections are not offered to users in regions where Stripe Connect Express is unavailable; they fall back to "Mark as paid".
- Payment links open in the in-app browser with visible chrome (Guideline 5.1.1) and carry no tracking.

## 11. Later lanes (spec level)

Each lane is behind a `feature_flags` key (default off) and is specified to the depth needed to keep the schema and ledger ready. None changes the non-negotiable rules.

### 11.1 In-app hotel booking through LiteAPI (year 2 and later)

- Start only after click data shows strong booking intent (lodging click-to-booking and a meaningful share of users reaching the stay comparison). LiteAPI (Nuitee) is merchant of record; Wayfold earns a margin (5 to 15%, reported, verify) on the net rate.
- Flow: search by place and dates and party (server-side, server-held API key), show rates sorted by price or rating with the commission-blind statement, prebook (price lock), collect payment with LiteAPI's payment flow in a web view hosted by LiteAPI (card data never touches our servers), book, store the confirmation as a `lodging_options` booking with status `booked`, send the confirmation email.
- Apple: a physical service consumed outside the app; Stripe-style web payment is allowed under 3.1.3(e); never unlocks features. Terms, cancellation policy and the merchant of record are shown before payment.
- New table at that time (migration added then): `hotel_bookings` (user, trip, supplier, supplier_ref, price, margin, currency, status, commission_status). Revenue recognized at check-out. Support and cancellations go through LiteAPI; refunds follow their rules.
- Never displaces the affiliate options or their neutrality: the "Book in Wayfold" option appears beside them and is sorted by the same user-chosen criteria.

### 11.2 Partner guides (year 2 and later)

- Tourism boards and hotel brands sponsor labeled destination guides stored in `partner_guides` (`partner_name`, `destination`, `title`, `body`, `assets`, `disclosure_text`, `starts_at`, `ends_at`, `status`, `price_minor`, `currency`, `invoice_ref`). Sold as flat-fee sponsorships invoiced outside the app (Stripe invoices or bank transfer).
- Rules: every guide carries a visible "Sponsored by {partner}" label, lives in its own section, is never mixed into search, lists, rankings or AI answers, never gets a push, and is never cited by an agent. A sponsored guide cannot change a place's rating or position anywhere. FTC and UK ASA labeling: "Ad" or "Sponsored" in text.
- Reporting: impressions and taps (first-party events, no third-party SDK) go into a monthly sponsor report.

### 11.3 Printed trip books (year 2)

- Print-on-demand trip books and posters generated from presentation mode, ordered on the web (not in the iOS app; a link from the app opens the web order page in the in-app browser). Stripe Checkout takes payment; the print vendor's API (for example Prodigi or Printful, vendor chosen at that phase) receives the print job and ships.
- `print_orders`: `user_id`, `trip_id`, `product` (book, poster), `size`, `pages`, `artifact_file` (R2 key to the PDF), `price_minor`, `shipping_minor`, `tax_minor`, `currency`, `stripe_payment_intent`, `vendor`, `vendor_order_id`, `status` (`draft`, `paid`, `submitted`, `printing`, `shipped`, `delivered`, `refunded`), `tracking_url`, `address` (encrypted), `created_at`.
- Margin target 35 to 45% after vendor cost, shipping and Stripe fees. Sales tax or VAT through Stripe Tax (verify). Physical goods consumed outside the app are outside In-App Purchase. Affiliate and sponsor content is excluded from printed books unless the user adds it; the commission sentence is printed wherever a partner link is shown.
- Refunds for misprints and damage per vendor policy; data retention for addresses is 90 days after delivery.

### 11.4 Wayfold for Advisors (year 2 and later)

- Web SaaS for independent travel advisors: client trip workspaces, branded presentation mode, proposals, and commission tracking. Sold on the web through Stripe Billing, not through the App Store. The iOS app does not sell it and does not link to its purchase page (Guideline 3.1.1); advisors sign in on the web.
- Pricing: $29 a seat a month, or $24 a seat a month on annual billing ($288 a seat a year). Stripe Checkout and Customer Portal; per-seat quantity subscription; 14-day trial without a card is not offered (default: card required, cancel anytime).
- Tables: `advisor_orgs` (name, agency, billing email, Stripe customer id, plan, status), `advisor_seats` (org, user, role, stripe subscription item, active), `advisor_clients` (org, client name, client user id nullable, trip id, commission expectation, status).
- Entitlement: an active seat gives the advisor `pro`-level capabilities on trips in their org's client workspaces only (resolved in 4.2 with `source = 'advisor'`), no personal AI allowance beyond a seat allowance that is a default of 150 credits a month from a separate pool (`allowance_advisor`, default, configurable) so advisor AI spend is covered by seat revenue against the $0.40 daily and a seat ceiling of $3.40 (default). Client guests join free.
- Dunning: Stripe smart retries for 14 days; seats go read-only after that, never deleted; client data is exportable at all times.
- Commission tracking: advisors record bookings and expected commission per client trip (`advisor_clients` and a per-booking JSON), with monthly totals and CSV export. Wayfold takes no commission on an advisor's bookings.
- Webhooks: `customer.subscription.created`, `.updated`, `.deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`; handler writes `webhook_events` (`provider = 'stripe'`) and follows the same idempotent pattern as 3.4.
- Taxes: Stripe Tax for VAT and sales tax (verify registration thresholds). Advisors are business customers; capture VAT ids.

### 11.5 White-label and API (year 3 and later)

Licensed planner for agencies and tour operators; specified only as a direction: a separate tenancy (`advisor_orgs` with a `white_label` flag and custom domain), API keys, and annual contracts invoiced by Stripe. No work is scheduled before the advisor lane has paying customers.

## 12. Revenue reporting and metrics

### 12.1 Sources

| Source | What it gives | Stored in |
|---|---|---|
| RevenueCat webhooks and reconcile | Subscription, pass and pack transactions | `subscriptions`, `store_transactions`, `trip_passes`, `credit_grants` |
| App Store Connect sales and trends (monthly import) | Apple's net proceeds and tax adjustments | finance sheet, reconciled to `store_transactions` |
| Stripe | Advisor seats, print orders, group payment fees if any | `webhook_events`, `print_orders`, `advisor_*` |
| Affiliate networks | Commissions | `affiliate_conversions` |
| Concierge statements | Agency commissions | `concierge_requests` |
| `ai_usage`, `provider_calls` | Variable cost | [06-ai-agents-spec.md](06-ai-agents-spec.md) |
| PostHog and `analytics_events` | Funnels, paywall views | |

All amounts are stored in minor units with an ISO currency and converted to USD with `fx_rates` at the event date for reports. Apple revenue is reported net of Apple's 15% commission (Small Business Program, under $1M in annual proceeds; above that, standard rates apply and the model is rerun).

### 12.2 Definitions

| Metric | Definition |
|---|---|
| Net price per plan | Gross minus 15%: Plus monthly $5.09, Plus annual $33.99, Family monthly $7.64, Family annual $51.00, Pro monthly $10.19, Pro annual $84.15, Trip Pass $8.49, Group Trip Pass $16.99 |
| MRR | Sum over active subscriptions (status `active`, `grace`, `trialing` excluded until paid) of the monthly equivalent of net price; annual plans divided by 12; passes and packs excluded |
| New, expansion, contraction, churned MRR | The month-over-month movements by subscription; upgrades are expansion, downgrades contraction, expirations churned |
| ARR | MRR times 12 (subscriptions only) |
| Passes and packs revenue | Net sales in the month, reported separately, since they are one-off |
| ARPPU | Total net revenue in the month (subscriptions, passes, packs, advisor seats) divided by paying users in the month (any purchase or active subscription) |
| ARPU | Total net revenue including affiliate and concierge divided by monthly active users |
| Paid conversion | Users with at least one purchase or active subscription, divided by monthly active users; also cohort conversion at 30 and 90 days after signup |
| Trial to paid | Plus annual trials that produced a paid renewal, divided by trials started |
| Churn | Monthly subscriber churn (subscriptions that ended in the month divided by active at the start); annual plans measured at renewal |
| Refund rate | Refunded transactions over transactions, by product |
| Paywall conversion | Purchases attributed to a paywall view (within 24 hours, same trigger) divided by views; by trigger, offering, variant, tier |
| Credit burn | Credits reserved and settled per period by action code and by pool; the share of monthly allowance used; expiry rate (credits expired divided by granted) |
| Credit margin | Credit revenue (pack net price per credit times credits spent, plus allowance value by tier) versus real `ai_usage` and `provider_calls` cost per credit; alert when a feature's real cost per credit exceeds $0.02 by more than 20% |
| AI cost share | `ai_usage` plus `provider_calls` cost divided by net revenue excluding affiliate; target 20% or less (plan: 17% to 22%) |
| Affiliate EPC | Approved commission in USD divided by outbound clicks, by program, surface and category (earnings per click); also paid EPC |
| Affiliate revenue per MAU per year | Annualized approved affiliate revenue divided by monthly active users; kill rule at month 9 below $0.20 per monthly user per year |
| Revenue per trip | All revenue attributed to a real trip (passes bought for it, affiliate conversions from its clicks, concierge commission, print orders) divided by the number of real trips in the period; also per trip by tier of owner |
| Concierge | Requests, request to booked rate, average booking value, average commission, days to paid |
| Group payments | Collections opened, share of shares paid, refund and dispute rate, Group Trip Pass attach to collections |
| Gross margin | Net revenue minus variable cost (AI, provider calls, infrastructure allocation, payment fees) divided by net revenue |
| Free cost per MAU | (Free-tier AI plus provider cost) divided by Free MAU; guard value about $0.02 a month for AI |

Kill rule: at month 9 after launch, if under 1% of monthly users pay and affiliate income is under $0.20 per monthly user per year (annualized), stop investing. Both numbers are tracked monthly from launch.

### 12.3 Dashboards and cadence

- **Revenue overview.** MRR waterfall, ARR, passes and packs, affiliate (pending, approved, paid), concierge (expected, confirmed, paid), total net revenue, gross margin. Daily refresh, month close on the 5th.
- **Paywall.** Views, dismissals, purchases and revenue by trigger, offering and experiment variant; funnel from view to `purchase_started` to `purchase_completed`; mute and cap hit rates.
- **Plans.** Active by tier, trials, churn and reasons, upgrade and downgrade flows, household sizes, pass binding rate and time to bind, unbound passes.
- **Credits.** Balances by pool, burn by action code, expiry, negative balances, packs sold, credit margin by action.
- **Affiliate.** Section 8.8.
- **Concierge.** Section 9.4 metrics and commission aging.
- **Cohorts.** Revenue per user by signup month, by acquisition source, by first paywall trigger.
- **Alerts** (to email and the on-call channel): MRR drop over 10% month on month, webhook failures, reconcile mismatches, refund rate above 5% for a product, cost per active payer above $2 (Plus, Family) or $6 (Pro), negative credit balances above 20 accounts, affiliate import failures.

Weekly Monday review uses the same tiles: installs, activation, trial starts, paywall views and conversion, MRR and churn, credit burn, affiliate EPC, AI cost share, concierge pipeline. The Pro launch gate (200 measured agent runs averaging $0.60 or less per run, or more than 15% of Plus payers buying agent-run credits) is computed on the Credits dashboard and flips nothing automatically; a person turns `pro.enabled` on.

### 12.4 Events (first-party, PostHog and `analytics_events` for paywall)

`paywall_viewed`, `paywall_dismissed`, `paywall_cta_tapped`, `purchase_started`, `purchase_completed`, `purchase_failed`, `restore_tapped`, `trial_started`, `trial_converted`, `subscription_cancelled`, `upgrade_completed`, `downgrade_scheduled`, `pass_bound`, `pass_moved`, `pass_expired`, `credits_reserved`, `credits_settled`, `credits_refunded`, `credits_expired`, `pack_purchased`, `outbound_clicked`, `concierge_requested`, `concierge_status_changed`, `collection_created`, `collection_paid`. No event carries names, emails or free text; session replay is off or masked.

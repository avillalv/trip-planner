# Wayfold: build specification

Written 2026-09-30. This folder is everything needed to build Wayfold, a collaborative trip
planner for iOS and the web that earns money from subscriptions, trip passes, AI credits,
affiliate commissions and a concierge booking lane, without ads and without making the product
worse for free users.

It is written to be handed to a developer (or to Claude Code) with no other context. The parent
folder, [../](../README.md), holds the business reasoning; you do not need it to build, but it
explains why each decision was made.

![Wayfold logo](brand/wayfold-logo-preview.png)

## What Wayfold is

Wayfold helps couples, families and friend groups plan a trip together: pick dates and flights,
shortlist and vote on places to stay, plan each day, and walk through the plan in a full-screen
presentation. AI agents hunt fares and research events, and every fact they save links to the page
it came from. The brand is a passport: security-paper background, navy ink, burgundy accents,
guilloche linework, and a logo of an open passport with a route folded across it.

Positioning line: **Plan together. Know the fare.**

## How to use this folder

Read the files in order. Each one is complete for its topic and uses the shared names defined
below, so the database, API and screens line up.

| File | What it specifies |
|---|---|
| [01-product-spec.md](01-product-spec.md) | Personas, every feature as user stories with acceptance criteria, tier and entitlement matrix |
| [02-architecture.md](02-architecture.md) | Stack, repository layout, services, environments, configuration, third-party services, what to reuse from the existing Trip Planner code |
| [03-database-schema.md](03-database-schema.md) | Full PostgreSQL schema (DDL), indexes, row-level security, enums, migration order, seed data |
| [04-api-spec.md](04-api-spec.md) | REST API: auth, conventions, every endpoint, webhooks, the affiliate redirect, errors |
| [05-ui-ux-spec.md](05-ui-ux-spec.md) | Design system, navigation, every screen with states and interactions, paywalls, affiliate cards, accessibility, copy rules |
| [06-ai-agents-spec.md](06-ai-agents-spec.md) | Every AI feature: model, prompts, tools, limits, metering, shared cache, evals |
| [07-monetization-spec.md](07-monetization-spec.md) | In-app purchases, entitlements, credit ledger, paywall logic, affiliate links and reporting, concierge, group payments, advisor billing |
| [08-admin-control-center.md](08-admin-control-center.md) | The internal admin console: users, billing, credits, AI spend, kill switches, feature flags, affiliate revenue, support, audit |
| [09-build-roadmap.md](09-build-roadmap.md) | Milestones and an ordered backlog of epics and tickets with acceptance criteria and definitions of done |
| [10-quality-security-launch.md](10-quality-security-launch.md) | Testing, security, privacy and compliance, analytics events, observability, App Store submission, runbooks |
| [brand/](brand/BRAND.md) | Logo files, colors, type, icon rules |

## Shared decisions (every file follows these)

### Tiers and products

| Code | Name | Price (US) | Store product | Key limits |
|---|---|---|---|---|
| `free` | Free | $0 | none | 2 active trips, 1 cached-fare route per trip, 12 credits a month, one lifetime deep agent run ("taster"), 1 cached-fare alert, joins others' trips free |
| `plus` | Plus | $5.99 a month, $39.99 a year | auto-renewing subscription, group `wayfold_membership` | unlimited trips (fair use 25), 3 live routes checked daily within 120 days of departure, 60 credits a month, can invite collaborators |
| `family` | Family | $8.99 a month, $59.99 a year | auto-renewing subscription, same group | Plus for up to 6 household members, 150 pooled credits, 5 live routes |
| `pro` | Pro (launches later) | $11.99 a month, $99 a year | auto-renewing subscription, same group | 240 credits, 6 live routes, scheduled agent routines, priority queue |
| `trip_pass` | Trip Pass | $9.99 | non-renewing subscription, 90 days | one trip: 2 live routes, max 60 live checks, 40 credits, up to 6 collaborators |
| `group_trip_pass` | Group Trip Pass | $19.99 | non-renewing subscription, 90 days | one trip: up to 12 travelers, 80 credits, polls, cost splitting, room-block request |
| `credits_50` / `credits_150` / `credits_400` | Credit packs | $2.99 / $6.99 / $14.99 | consumable | purchased credits last 12 months and are spent last |
| `advisor_seat` | Wayfold for Advisors (year 2) | $29 a seat a month, $24 annual | Stripe on the web, not the App Store | client workspaces, branded presentations, proposals, commission tracking |

Rules: a trip's capabilities are the best of its owner's tier and any pass on that trip.
Invitees join free and get the trip's capabilities on that trip. AI credits are charged to the
person who starts the action (Family draws from the household pool). Apple Family Sharing is off.

### AI credits

1 credit is a budget of up to $0.02 of provider spend.

| Action code | Credits | Hard stop |
|---|---|---|
| `explain` (Haiku short answer) | 1 | $0.01 |
| `live_search` (flight or rental) | 1 | $0.02 |
| `draft_day` | 1 | $0.03 |
| `draft_trip` | 4 | $0.10 |
| `research` | 8 (1 from shared cache) | $0.16; 5 searches, 8 fetches |
| `agent_run` (fare hunt or deep research) | 40 (8 from shared cache) | $0.80; 20 turns, 10 searches, 10 fetches, one at a time |

Monthly provider-spend ceilings: Free $0.25 (plus the one-time taster), Plus $2.25, Family $3.40
pooled, Trip Pass $1.80, Group Trip Pass $3.60, Pro $5.50. Daily: Free $0.05, Plus, Family and
passes $0.40, Pro $1.25. An agent run is admitted if the month has $0.80 of headroom, even above
the daily budget. Cached data always keeps working. Models: Claude Haiku 4.5 (`claude-haiku-4-5`)
for short answers and page summaries, Claude Sonnet 5.5 (`claude-sonnet-5-5`) for drafting,
research and agents.

### Money that is not a subscription

- **Affiliate links** on every tier, same places, clearly labeled "We earn a commission if you
  book here." All outbound partner links go through `/go/{click_id}`. Launch networks:
  Travelpayouts, Viator partner API, Stay22; direct programs (Expedia Group for Vrbo, Booking.com,
  Skyscanner, Airalo, GetYourGuide) from month 3. Airbnb has no program: plain links only, and
  pasted listing links are never rewritten. The server never fetches Airbnb, Vrbo or Booking.com
  pages.
- **Concierge**: an optional "Have a human book this" request on stays, cruises and complex trips,
  fulfilled by an advisor under a host travel agency. Users get perks; Wayfold earns the agency
  commission. Always optional and disclosed.
- **Group payments**: cost splitting and collection for real-world trip costs through Stripe
  (never Apple In-App Purchase, never for digital features).
- **Later**: in-app hotel booking via LiteAPI, labeled partner guides, printed trip books,
  Wayfold for Advisors, white-label.
- **Never**: banner ads, selling user data, ranking anything by commission, lifetime plans.

### Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, Pydantic 2, uv |
| Database | PostgreSQL 18 on Render, point-in-time recovery, row-level security as a second layer |
| Jobs | Procrastinate (Postgres-backed queue); a scheduler process that enqueues due routines |
| Web and mobile client | React 19, Vite, React Router 7, TanStack Query, Tailwind CSS 4, Radix and shadcn components, MapLibre, FullCalendar, Recharts; wrapped for iOS with Capacitor (bundled, not a remote URL) |
| Auth | Supabase Auth for sign-in only (Sign in with Apple, Google, email code); our own `users` table |
| Payments | RevenueCat over StoreKit 2 for the app; Stripe for the web (advisors, group payments, print) |
| AI | Anthropic Claude Messages API with tool use, server web search and web fetch tools |
| Hosting | Render (API, worker, scheduler, Postgres) behind Cloudflare (DNS, WAF, R2 storage, Pages for the web app) |
| Observability | Sentry, structured JSON logs, Better Stack uptime, PostHog product analytics (no ad SDKs) |
| Email and push | Resend for email, APNs direct for push |

### Core entities (table names used everywhere)

`users`, `auth_identities`, `devices`, `households`, `household_members`, `trips`,
`trip_members`, `trip_invites`, `trip_share_links`, `trip_destinations`, `people`,
`trip_people`, `flight_routes`, `fare_observations`, `trip_fare_links`, `chosen_flights`,
`price_alerts`, `itinerary_days`, `itinerary_items`, `places_cache`, `saved_places`,
`lodging_options`, `lodging_votes`, `polls`, `poll_votes`, `expenses`, `expense_shares`,
`settlements`, `checklist_items`, `notes`, `routines`, `runs`, `run_events`, `ai_usage`,
`credit_ledger`, `credit_grants`, `provider_calls`, `shared_research_cache`, `subscriptions`,
`entitlements`, `trip_passes`, `store_transactions`, `webhook_events`, `affiliate_programs`,
`affiliate_link_templates`, `link_clicks`, `affiliate_conversions`, `concierge_requests`,
`room_block_requests`, `partner_guides`, `print_orders`, `advisor_orgs`, `advisor_seats`,
`advisor_clients`, `feature_flags`, `kill_switches`, `admin_users`, `audit_log`,
`support_tickets`, `consents`, `data_exports`, `deletion_requests`, `analytics_events`
(optional, if not only in PostHog), `airports`, `fx_rates`.

Public identifiers are UUIDv7. Money is stored as integer minor units plus an ISO 4217 currency.
Provider spend is stored in micro-dollars. All timestamps are `timestamptz` in UTC.

### Non-negotiable rules

1. No banner ads, no dark patterns, no fake urgency. The free path is always visible.
2. Never rank search results, lists or suggestions by commission.
3. The server never fetches Airbnb, Vrbo or Booking.com pages, and uses no scrapers.
4. Every AI-found fact carries the source URL it came from; fares must be seen on a page during
   the run.
5. AI never gives insurance, visa or legal advice; it links to official sources.
6. Account deletion in the app, data export on every tier, and no data held hostage on downgrade.
7. Secrets only in environment variables, never in the repo.
8. No UI copy with em dashes; sentence case; plain verbs (see [05-ui-ux-spec.md](05-ui-ux-spec.md)).

## Reusing the existing Trip Planner code

The current repository (`backend/`, `frontend/`) is a working single-household app. Much of it
carries over: flight route and fare logic, itinerary and lodging features, presentation mode,
the passport design tokens, Travelpayouts, Geoapify, Wikipedia and Frankfurter providers, the
evidence rules in `services/agent_ingest.py`, and the agent prompts. What does not carry over:
passcode auth, the Claude Code CLI runner and MCP bridge, APScheduler, Windows-only scripts, and
Tailscale sharing. [02-architecture.md](02-architecture.md) maps each module.

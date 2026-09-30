# Phase 1: the launch app (months 1 to 6)

Part of the [Wayfold build specification](../README.md). Written 2026-09-30.

Phase 1 is a complete, polished Wayfold that a solo developer working with Claude Code can build in
about six months and publish to the App Store (and the web). It earns money from day one:
subscriptions, trip passes, credit packs and affiliate links. Everything else waits for
[Phase 2](../phase-2-growth/README.md) or [Phase 3](../phase-3-scale/README.md).

## Scope

### In Phase 1

| Area | What ships |
|---|---|
| Accounts | Sign in with Apple, Google and email code (Supabase Auth); guest mode that is claimed on sign-up; onboarding with "Coming from TripIt or Wanderlog?"; profile, settings, data export, in-app account deletion |
| Switching | Import a trip from a calendar file or calendar feed (TripIt single-trip export or iCal feed, Google Calendar) and from pasted booking confirmations (Haiku extracts flights, stays and reservations); first import earns a free Trip Pass for that trip |
| Trips | Trips, destinations, travelers (`people`), dates, currency, archive, duplicate |
| Collaboration | Roles (owner, editor, viewer), invite links, share links; Free owners invite 1 collaborator per trip, Plus and Trip Pass up to 6; hearts on stays and places; activity log |
| Flights | Routes, cached fares (Travelpayouts), live fares behind a provider interface (SerpApi behind a flag), price history, chosen flight, price alerts, and the booked-fare drop alert ("you paid $X, it is now $Y; check the airline's change and credit rules") |
| Stays | Shortlist, pasted links (never fetched for Airbnb, Vrbo or Booking.com), hearts, compare, rental search (behind the SerpApi flag), "Book via partner" |
| Plan | Day-by-day itinerary, drag and drop, places search and details (Geoapify, Wikipedia), map, ideas list |
| Evidence | Notes with sources; every AI-found fact shows "Found on [site], checked [date]" |
| Present | Full-screen presentation mode, shareable read-only link, PDF export (Free adds a small footer) |
| Before you go | Checklist with official visa and entry links first, then labeled partner items (eSIM, insurance referral, transfers, bookings) |
| AI | `explain`, `draft_day`, `draft_trip`, `research`, `agent_run` (manual fare hunt and deep research), the one-time taster, packing list, booking import; shared research cache; credits and ceilings |
| Offline | Trips readable offline on every tier; edits queue and sync |
| Calendar | Live calendar subscription feed per trip |
| Notifications | Push (APNs) and email for price drops, invites, run results, pre-trip reminders |
| Money | Free, Plus (monthly and annual, 7-day trial on annual), Trip Pass, credit packs via RevenueCat; paywalls; affiliate links through `/go/{click_id}` with Travelpayouts, Stay22 and Viator; nightly conversion import |
| Admin | Overview dashboard, users, subscriptions and store transactions, credits and AI spend, kill switches, feature flags, affiliate revenue, support inbox, provider and system health, audit log, basic content reports |
| Platforms | Web app and iOS app (Capacitor, bundled). Android users get the web app until Phase 2. |
| Growth basics | Public sample trips and shared-trip pages for search, honest comparison pages (`/vs/...`), referral credits, App Store listing |

### Not in Phase 1

| Feature | Phase |
|---|---|
| Family plan and households | 2 |
| Group Trip Pass, polls, manual cost splitting, room-block requests | 2 |
| Comments on items | 2 |
| Email-forward import (plans@wayfold.app) | 2 |
| Flight status, delay and gate alerts | 2 |
| Pro tier and scheduled agent routines | 2 |
| Concierge lane (host agency) | 2 |
| Direct affiliate programs (Expedia Group and Vrbo, Booking.com, Skyscanner, Airalo, GetYourGuide) | 2 |
| Native Android app | 2 |
| After-trip flight compensation prompt, memories and "Year in travel" card | 2 |
| Stripe group payments | 3 |
| Wayfold for Advisors | 3 |
| Partner guides, printed trip books, in-app hotel booking (LiteAPI), white-label and API, card and loyalty offers | 3 |

## Month plan

| Month | Goal | Exit |
|---|---|---|
| 1 | Validate and set up: landing page and waitlist, 10 interviews, repo, CI, Docker, database, auth, tenancy | Demand signal; a signed-in user can create a trip on staging |
| 2 | Core planning: trips, collaboration, flights (cached), stays, itinerary, places, map | Two people can plan a trip together on the web |
| 3 | AI and credits: Claude API loop, explain, drafts, research, agent runs, taster, ledger, ceilings, shared cache, evidence labels | Agent run cost measured over 50 runs; ceilings enforced |
| 4 | Money: RevenueCat, Plus, Trip Pass, packs, paywalls, affiliate redirect and reporting, checklist; imports; admin essentials | Sandbox purchases work end to end; clicks and conversions tracked |
| 5 | iOS and polish: Capacitor shell, push, offline, calendar feed, presentation, accessibility, performance, onboarding, empty and error states; TestFlight beta | 30 beta testers, crash-free sessions above 99.5% |
| 6 | Launch: App Review, privacy labels, support, monitoring, runbooks, SEO pages, comparison pages, launch campaign | Live on the App Store and web |

## Files

| File | What it specifies |
|---|---|
| [01-product-spec.md](01-product-spec.md) | Phase 1 features as user stories with acceptance criteria, tier matrix |
| [02-architecture.md](02-architecture.md) | Stack, repository layout, services, configuration, reuse of the current code |
| [03-database-schema.md](03-database-schema.md) | Phase 1 PostgreSQL schema, security rules, seed data |
| [04-api-spec.md](04-api-spec.md) | Phase 1 endpoints and webhooks |
| [05-ui-ux-spec.md](05-ui-ux-spec.md) | Design system and every Phase 1 screen |
| [06-ai-agents-spec.md](06-ai-agents-spec.md) | Phase 1 AI features, prompts, tools, metering |
| [07-monetization-spec.md](07-monetization-spec.md) | Phase 1 products, entitlements, credits, paywalls, affiliate system |
| [08-admin-control-center.md](08-admin-control-center.md) | Phase 1 admin console |
| [09-build-roadmap.md](09-build-roadmap.md) | The six-month plan as ordered tickets |
| [10-quality-security-launch.md](10-quality-security-launch.md) | Testing, security, privacy, analytics, App Store submission, runbooks |

# Business plan: from a personal trip planner to an App Store product

Written 2026-09-30. This folder is a plan, not code: nothing in the app has changed yet.

Seven analysts each took one section, read the code, challenged the first round of
recommendations, and drafted their part. Their disagreements were then settled into one set of
decisions (below) that every file follows. Where a file argues against an earlier idea, it says
so in a closing section, so the reasoning stays visible.

## The short answer

- **Can it scale?** Yes, but not as built. Today the app runs on one Windows PC for one household,
  with a shared passcode, and its AI runs on the owner's personal Claude subscription (which cannot
  serve customers). Reaching the App Store means a hosted, multi-user backend, the Claude API, a
  mobile shell, and in-app purchases. Roughly 5 to 6 months of part-time work to a public launch.
- **Can it be profitable?** Yes, if AI is a metered, capped extra on top of cheap API features,
  and if the plan is sold per trip, not per month. Open-ended agents on a schedule would lose money on
  every active user. With the guardrails here, the illustrative month at 10,000 users has about
  56% gross margin, and the base-case scenario breaks even around month 16 to 20.
- **Is it a big business?** The base case is a solid side income (about $111k revenue in year 3),
  not a venture outcome. The optimistic case needs a sharing loop that is not yet proven. The first
  milestone is to validate demand before rewriting anything.

## Files

| File | What it covers |
|---|---|
| [01-business-plan.md](01-business-plan.md) | Customers, competitors, revenue model, 3-year scenarios, go-to-market, risks, KPIs, kill rule |
| [02-pricing-tiers.md](02-pricing-tiers.md) | Every feature mapped to a tier, AI credits, unit economics, guardrails, paywall moments |
| [03-ai-features-and-costs.md](03-ai-features-and-costs.md) | Moving from the Claude Code CLI to the Claude API, cost of each AI feature, cost controls, evals |
| [04-users-and-accounts.md](04-users-and-accounts.md) | Sign-in, accounts, trip sharing and roles, onboarding, privacy, account deletion, tenant isolation |
| [05-infrastructure.md](05-infrastructure.md) | Hosting, job queue, scheduling, CI/CD, observability, security, infra cost at each scale |
| [06-database-and-data-integrations.md](06-database-and-data-integrations.md) | Schema changes, data migration, flight and places providers and their terms, caching, affiliate tracking |
| [07-local-to-app-store.md](07-local-to-app-store.md) | Mobile approach, frontend changes, in-app purchases, App Review checklist, phased roadmap, launch plan |

Suggested reading order: this page, 01, 02, 07 (the roadmap), then 03 to 06 as each phase starts.

## Decisions of record

Every file uses these. If a number changes, change it here first.

### Product and pricing

| Decision | Value |
|---|---|
| Launch tiers | Free, Plus, Trip Pass, credit packs. Premium is built behind a flag and launches later. |
| Free | $0. 2 active trips, 1 cached-fare route per trip, 8 AI credits a month, 1 price alert on cached fares, joins others' trips free, affiliate booking links |
| Plus | $4.99 a month or $29.99 a year (7-day trial on annual only). Unlimited trips (fair use 25), 3 live-tracked routes checked daily within 120 days of departure, 40 credits a month, collaboration |
| Trip Pass (lead offer) | $9.99 once. Upgrades one trip for 90 days: 2 live routes, at most 60 live checks, 40 credits, up to 6 collaborators. Sold as a non-renewing subscription in StoreKit, bound to the trip on the server. |
| Premium (later) | $11.99 a month or $99 a year. 240 credits a month (about 6 deep agent runs), 6 live routes, scheduled agent routines, priority queue. Launches when measured agent cost is $0.60 or less per run over 200 runs, or when more than 15% of Plus payers buy agent-run credits. |
| Credit packs | $2.99 for 50, $6.99 for 150, $14.99 for 400. Purchased credits last 12 months and are spent last. |
| Collaboration | Only the trip owner pays. Invitees join free and get the owner's tier on that trip. AI credits are charged to the person who starts the action. |
| Ads | No banner ads. Affiliate links (flights, hotels, eSIM, insurance, tours) are the free-tier income. |
| Apple commission | 15% (Small Business Program, under $1M a year in proceeds) |

### AI credits and cost ceilings

| Decision | Value |
|---|---|
| Credit unit | 1 credit is a budget of up to $0.02 of provider spend (Claude, SerpApi, Geoapify) |
| Credit prices | Haiku explain 1, live flight or rental search 1, itinerary day 1, whole-trip draft 4, research question 8 (1 if served from the shared cache), deep agent run 40 (hard stop at $0.80; 8 if served from the shared cache) |
| Agent run caps | 20 turns, 10 web searches, 10 page fetches, effort `medium`, $0.80 hard stop, one run at a time per account |
| Research question caps | 5 searches, 8 fetches, $0.16 hard stop |
| Monthly provider-spend ceiling per account | Free $0.25, Plus $1.75, Trip Pass $1.80 per pass, Premium $5.50. Daily: Free $0.05, Plus and Trip Pass $0.40, Premium $1.25. Cached data keeps working when a ceiling is hit. A deep agent run is admitted if the month has $0.80 of headroom, even above the daily budget; its spend still counts toward that day, so no other paid actions run until the next day. |
| Models | Claude Haiku 4.5 for short answers and page summaries; Claude Sonnet 5.5 for drafting, research and agents |
| Batch API | Only for offline jobs: shared-cache warming, nightly digests, scheduled fare scans. Never for multi-turn agents or anything a user is waiting on. |
| Scheduled agents | Off for everyone until Premium. Scheduled work is API price checks plus cheap batch scans, not agents. |

### Technology

| Decision | Value |
|---|---|
| AI integration | Claude Messages API with tool use, run in our own worker. The existing ingest tools (`submit_flight_quotes`, `add_note`, `finish_run`) become in-process client tools, and the evidence rules and blocked domains (Airbnb, Vrbo, Booking) stay. Managed Agents was considered and deferred. |
| Identity | Supabase Auth for sign-in only (Sign in with Apple, Google, email code). Our own `users` table in our own database. |
| Hosting | Render (API, worker, managed Postgres with point-in-time recovery) behind Cloudflare (DNS, WAF, R2 storage, Pages for the web app). Move to AWS or Google Cloud around 50k MAU or $1,500 a month. |
| Jobs | Postgres-backed queue (Procrastinate). No Redis until about 10k MAU. |
| Database | Postgres with Alembic migrations run as a pre-deploy step, not at server start. Trip-scoped membership (`trip_members`), UUID public ids, row-level security as a second layer behind app checks. The existing `people` table is kept and gains `owner_user_id` and `linked_user_id`. |
| Flight data | Travelpayouts cached fares as the free baseline. Live fares go through a provider interface: SerpApi behind a feature flag at launch (legal risk flagged), with a licensed source (Skyscanner Partners) applied for now. |
| Mobile | Capacitor around the existing React app, bundled (not a remote URL). The hosted web beta ships before iOS. |
| Payments | RevenueCat over StoreKit 2, with entitlements stored on our server |
| Build machine | iOS builds need macOS: a Mac mini or Xcode Cloud |

### Roadmap

| Phase | Effort (part time, solo, with Claude Code) | Gate to move on |
|---|---|---|
| M0: validate | 2 to 4 weeks | Landing page, waitlist, 10 user interviews, a clear signal people want it |
| 0: foundations | 3 to 4 weeks | Agents run on the Claude API with metering; Docker image; CI |
| 1: hosted web beta | 6 to 8 weeks | Accounts, sharing, entitlements, ledger; 4-week retention measured |
| 2: iOS TestFlight | 5 to 7 weeks | Capacitor app, purchases, push, account deletion |
| 3: public launch | 3 to 4 weeks | App Review passed, support and monitoring in place |
| 4: growth | Ongoing | Android, shareable trip pages for SEO, Premium |

**Kill rule:** at month 9 after launch, if under 1% of monthly users pay and affiliate income is
under $0.20 per monthly user, stop investing and keep it as a personal tool.

## Open questions to verify before launch

These could not be confirmed from here and could change the numbers:

1. SerpApi's current price per search and whether its terms allow use in a paid consumer app
   (Google sued SerpApi in December 2025; the case was still active in September 2026).
2. Geoapify's commercial-use and caching terms on paid plans.
3. Travelpayouts commission rates and in-app attribution rules.
4. The real cost of an API agent run: measure 200 runs before setting Premium live.
5. Apple's current rules on linking out to web checkout in the US.
6. Competitor prices (taken from third-party reviews on 2026-09-30).

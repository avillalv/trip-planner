# Tiers, pricing, and AI credits

Part of the [business plan](README.md). The decisions of record in the README override anything here.

Date: 2026-09-30.
Scope: feature-to-tier matrix, tier limits, the AI credits system, unit economics, guardrails, launch configuration, paywall moments. This file is the pricing source of truth; the AI cost build-up is in [03-ai-features-and-costs.md](03-ai-features-and-costs.md).

Data caveats:
- SerpApi pricing could not be verified on 2026-09-30 (serpapi.com was blocked by the research sandbox's egress proxy). The plan ladder used is from memory: about $25 per 1,000 searches, $75 per 5,000, $150 per 15,000, $275 per 30,000, which is 0.9 to 2.5 cents per search. The model uses **1.5 cents** and treats it as unverified. Re-check before launch.
- Geoapify paid pricing, Travelpayouts commission rates, and infra costs are estimates.
- Claude prices used: Sonnet 5.5 $2 in / $10 out per 1M tokens, Haiku 4.5 $1 / $5, web search $10 per 1,000.

## 1. What the app does today (feature inventory)

Every row is something a user can do today, taken from the routers in `backend/tripplanner/api/`, the services, the frontend routes, and the app README.

| Area | Feature (source) | Cost driver | Nature |
|---|---|---|---|
| Trips | Create, edit, delete trips; multiple destinations; home currency (`trips.py`, `settings.py`) | DB only | Core |
| Trips | Destination lookup and autocomplete (`geo.py`, Geoapify) | Geoapify call | API |
| Trips | Destination summary, photo, local time, money info (`trips.py refresh-info`, Wikipedia) | Free API | API |
| Travelers | Traveler profiles with home airports (`people.py`) | DB only | Core |
| Flights | Airport search and nearby airports (`geo.py`) | Local dataset | Free |
| Flights | Routes: up to 4 airports per side, departure window, nights or return window (`flights.py`) | DB only | Core |
| Flights | Cached fare calendars (Travelpayouts/Aviasales), per adult, economy | Free API | API, cheap |
| Flights | Live Google Flights checks on a schedule, default twice a day (`serpapi_budget.py`, `search_planner.py`) | SerpApi, about $0.015 per search | API, costly |
| Flights | Price history chart, date grid, cheapest options, sort and filters, cheapest by trip length (`flights.py`) | DB only | Core |
| Flights | Choose a flight (sets trip dates), compare price movement vs chosen flight | DB only | Core |
| Itinerary | Day cards, drag-and-drop day calendar, ideas list, move between days, optimistic-lock conflict handling (`itinerary.py`) | DB only | Core |
| Places | Places search by category or name, map, hours, website (`places.py`, Geoapify, cached 1 week) | Geoapify call | API |
| Places | Wikipedia place summary (`places.py /wiki`) | Free API | API |
| Lodging | Shortlist, manual add, bookmarklet import, link preview, hearts, status, compare 2 to 4 (`lodging.py`) | DB only (preview fetches one page) | Core |
| Lodging | Rental search via Google Hotels partners (`search-rentals`, cached 12h) | SerpApi search | API, costly |
| Lodging | Price per night and per person, FX conversion (ECB rates, `fx.py`) | Free API | API |
| Presentation | Full-screen slide mode, keyboard and swipe, print to PDF (`presentation.py`) | DB only | Core |
| Agents | Flight-search agent routine (Claude, web search and fetch, 40 turns today) (`routines.py`, `runs.py`) | $0.50 to $1.50 per run | AI, costly |
| Agents | Research agent routine, notes with sources, shown as "Found by agents" (`runs.py /notes`) | $0.50 to $1.50 per run | AI, costly |
| Agents | Run log, stop run, rejected-items view, ingest API with evidence rules (`agent.py`, `agent_ingest.py`) | DB only | Trust feature |
| Ops | Backups, restore, setup checklist, passcode login, LAN and Tailscale sharing | n/a | Local-only, replaced by cloud accounts |

Features that exist only because the app is local (backups, passcode, setup checklist, LAN and Tailscale sharing, `.env` keys, SerpApi budget page) disappear or become server internals. Users get "your data is always synced" and "export your trip" instead. Export stays free on every tier.

New features the product needs that do not exist yet (all cheap or gated): accounts (see [04-users-and-accounts.md](04-users-and-accounts.md)), collaboration and invites, push alerts, itinerary drafting (AI), a quick "explain" assistant (Haiku), subscription state.

## 2. Principles

1. **Everything cheap stays free.** DB-only features and cached API data cost almost nothing, so they are the hook. Never gate the itinerary calendar, lodging shortlist, or presentation mode behind money. They are the reason people stay and share.
2. **Gate on marginal cost, not on features that feel premium.** Three things cost real money per use: live SerpApi searches, Sonnet calls with web search, and agent runs. Everything else is nearly free.
3. **Meter the expensive things with one unit (credits), and put a hard dollar ceiling on every account.** Users see credits; finance sees dollars.
4. **Travel is episodic.** People plan 1 to 3 trips a year, intensely for 4 to 12 weeks. Sell them the trip, not the month. The one-trip pass is the lead product; the subscription is for frequent planners.
5. **Never hold data hostage.** Archived trips stay readable and exportable forever on Free.

## 3. Tier definitions

Launch tiers: **Free**, **Plus**, **Trip Pass** (upgrades one trip for 90 days), and credit packs. **Premium** is built behind a flag and launches later (section 8).

### 3.1 Limits table

| Limit | Free | Trip Pass (per trip) | Plus | Premium (later) |
|---|---|---|---|---|
| Price (US) | $0 | $9.99 once | $4.99/mo or $29.99/yr | $11.99/mo or $99/yr |
| Active trips | 2 | 1 (the passed trip) | Unlimited (fair use 25) | Unlimited (fair use 50) |
| Archived trips (read and export) | Unlimited | Unlimited | Unlimited | Unlimited |
| Travelers per trip (profiles) | 2 | 8 | 8 | 12 |
| Collaborators who can edit | 0 (joins others' trips free) | 6 | 6 per trip | 12 per trip |
| Flight routes per trip | 1 (cached fares) | 3 | 5 | 8 |
| Airports per side of a route | 2 | 4 | 4 | 4 |
| Cached fare refresh (Travelpayouts) | Daily, server side | Daily | Daily | Daily |
| Live Google Flights tracking | No (2 "live peeks" a month via credits) | Up to 2 routes, 1 check per day, at most 60 checks total | Up to 3 live routes account-wide, 1 check per day each, only within 120 days of departure | Up to 6 live routes, 1 check per day each, plus 2 per day on 1 "watch" route |
| "Refresh now" (live) | 1 credit | 1 credit | 1 credit | 1 credit |
| Price-drop alerts (push) | 1 route, on cached fares | 2 routes, live and cached | 3 routes, live and cached | 6 routes, live, plus deal alerts |
| Saved lodging per trip | 8 | 30 | Unlimited (fair use 100) | Unlimited |
| Lodging compare | 2 places | 4 | 4 | 4 |
| Rental search (SerpApi) | 1 credit each | 1 credit each | 1 credit each | 1 credit each |
| Places search | 30 per day, cached | 100 per day | 100 per day | 200 per day |
| Presentation mode | Yes, small "Made with" footer, PDF watermark | No footer or watermark | No footer or watermark | No footer or watermark |
| AI credits | 8 per month (no rollover) | 40 once, for the 90 days of the pass | 40 per month (no rollover) | 240 per month (one month rolls over, capped at 240) |
| Deep agent runs | 0 | 0 (can buy with credits) | 0 (can buy with credits, 40 each) | About 6 a month from credits; scheduled routines allowed |
| Scheduled agent routines | No | No | No | Yes: up to 3 per trip, max 1 run per day per routine |
| Priority queue | No | No | No | Yes (agents and drafts jump the queue) |
| Data export (JSON, ICS, PDF) | Yes | Yes | Yes | Yes |
| Affiliate booking links | Yes | Yes | Yes | Yes (never removed) |

Notes on the choices:
- **Free gets 2 active trips, not 1.** Two people planning a couple's trip and a second idea (a weekend away) is normal. One trip makes users feel cornered; three makes Plus unnecessary for most.
- **Free cannot host collaboration but can join it.** Only the trip owner pays. Invitees join free and get the owner's tier on that trip. That is the viral loop: every paying trip pulls in 1 to 5 new accounts at almost no cost beyond an idle account. AI credits are charged to the person who starts the action.
- **Live tracking is limited by routes, frequency, and date window, not by credits.** Users hate seeing a price tracker burn a credit meter every morning. The ceiling in section 6 keeps it safe underneath.
- **The 120-day window matters.** Fares more than about 4 months out rarely move meaningfully, so live checks there are wasted spend. Cached fares cover those trips.
- **Alerts on cached fares are free.** Push costs nothing and drives return visits.
- **Trip Pass is a non-renewing subscription in StoreKit, bound to one trip on the server.** StoreKit only records the purchase and its 90-day term; our server decides which trip it upgrades, tracks the 90 days, and can move it at most once (section 6.2). A consumable would not carry a term or show up in restore.

### 3.2 API-only vs AI, by tier

| Class | Examples | Who gets it |
|---|---|---|
| API-only, free to us | Itinerary, lodging, presentation, airports, Wikipedia, ECB FX | Everyone, unmetered |
| API-only, cached | Travelpayouts fares, Geoapify places (1 week cache) | Everyone, soft daily caps |
| API-only, live and paid per call | SerpApi flights and rentals (behind a feature flag at launch, see [06-database-and-data-integrations.md](06-database-and-data-integrations.md)) | Plus and Trip Pass on schedule; anyone via credits |
| AI, cheap (Haiku, under $0.01) | "Explain this fare", "Is this place good for kids", short answers | Everyone via credits |
| AI, medium (Sonnet, no web, $0.03 to $0.10) | Itinerary drafting | Everyone via credits; more allowance on paid tiers |
| AI, research (Sonnet plus web search, $0.05 to $0.15, $0.16 hard stop) | Single research question | Everyone via credits; shared research cache |
| AI, agent (multi-turn, $0.50 to $1.50 today, $0.80 hard stop) | Fare-hunt agent, research agent, scheduled routines | Premium allowance, or credits on any tier for manual runs |

## 4. AI credits system

### 4.1 Unit definition

**1 credit is a budget of up to 2 cents of provider spend** (Claude, SerpApi, Geoapify). Actual cost is usually lower, and the gap is margin. Users never see dollars.

Why credits and not "N runs": one word covers three unlike things (a Haiku answer under 1 cent, a SerpApi search at 1.5 cents, an agent run at 80 cents). A single balance lets a user pick what to spend it on and lets us reprice a cost line without changing the plan promise.

### 4.2 Credit cost per action

| Action | Credits | Typical real cost | Max real cost (enforced) | Notes |
|---|---|---|---|---|
| Haiku explain or short answer | 1 | $0.003 to $0.008 | $0.01 | Output capped at 400 tokens |
| Live flight search on demand ("Refresh now") | 1 | $0.015 | $0.02 | Cached result under 6h old is free and says so |
| Rental search | 1 | $0.015 | $0.02 | Repeat within 12h is free (already in app) |
| Itinerary draft, one day | 1 | $0.02 | $0.03 | Sonnet, no web, cached system prompt |
| Itinerary draft, whole trip | 4 | $0.06 to $0.09 | $0.10 | Up to 14 days; longer trips bill per 14 days |
| Research question (Sonnet plus web search) | 8 | $0.05 to $0.15 | **$0.16 hard stop** | Max 5 searches, 8 fetches |
| Research question served from shared cache | 1 | about $0 | $0.005 | Same destination, same topic, under 7 days old |
| Deep agent run (flight-hunt or research) | 40 | $0.50 to $1.50 today | **$0.80 hard stop** | Caps in 4.6 |
| Deep agent run served from shared cache | 8 | about $0.05 | $0.15 | "Someone already researched this last week" |

Every price above equals its enforced maximum divided by $0.02 (8 x $0.02 = $0.16; 40 x $0.02 = $0.80), so a credit is never worth less than the most it can cost us.

Refund rules: any action that fails, times out, or returns nothing saved is refunded automatically. An agent run stopped by the user is billed pro rata by turns used (minimum 8 credits).

### 4.3 Monthly allowances

| Tier | Credits | Max provider cost of allowance | What it buys |
|---|---|---|---|
| Free | 8 per month | $0.16 | 8 explains, or 2 live peeks plus 6 explains, or 1 research question |
| Trip Pass | 40 once | $0.80 | 1 whole-trip draft (4) plus 4 research questions (32) plus 4 refreshes (4) = 40 |
| Plus | 40 per month | $0.80 | The same mix, or 5 research questions (5 x 8 = 40), or one deep agent run |
| Premium (later) | 240 per month | $4.80 | About 6 deep agent runs (6 x 40 = 240), or 30 research questions (30 x 8 = 240) |

Plus at 40 credits gives exactly the "about 5 research runs a month" of the initial idea. Premium at 10 to 15 agent runs is not affordable (section 5.4), so it is set at about 6.

### 4.4 Top-up packs (consumable in-app purchases)

Price per credit must sit above 2 cents to cover the maximum cost, plus Apple's 15%, plus margin. Target 50% gross margin on worst-case use.

| Pack | Price | Credits | Price per credit | Net after Apple | Margin if all credits spent at max cost |
|---|---|---|---|---|---|
| Small | $2.99 | 50 | 6.0 cents | $2.54 | 61% (cost $1.00) |
| Medium | $6.99 | 150 | 4.7 cents | $5.94 | 49% (cost $3.00) |
| Large | $14.99 | 400 | 3.75 cents | $12.74 | 37% (cost $8.00) |

Real margin is higher because actual cost is usually 40 to 60% of the maximum. One deep agent run costs the user 40 credits, about $1.87 on the Medium pack. One research question costs 8 credits, about $0.37 on the Medium pack. Sell a run as "one deep research run, about $2".

### 4.5 Rollover and expiry rules

- **Monthly allowance credits do not roll over** on Free or Plus, including annual subscribers (allowances are granted monthly on the renewal date). Premium rolls over one month's worth: the balance after rollover is capped at 240 before the new grant.
- **Purchased credits last 12 months** from purchase and are spent last. Some jurisdictions treat prepaid balances as liabilities, so expiry is generous and disclosed on the pack screen.
- **Spend order:** monthly allowance first, then Trip Pass credits, then purchased credits (oldest first).
- **Downgrade or lapse:** purchased credits stay usable on Free. Allowance credits vanish.
- **Refunds (Apple):** on a refund notification (App Store Server Notifications v2), remove unspent credits from that purchase. If already spent, flag the account and stop further top-ups.
- **Balance is server-side.** The app shows the balance but never decides it.

### 4.6 Agent run cost control (needed for the numbers to work)

Today a run allows 40 turns and about 30 fetches. To make 40 credits ($0.80) a real ceiling, every agent run gets these caps:
- **20 turns, 10 web searches, 10 page fetches, effort `medium`, $0.80 hard stop, one run at a time per account.**
- Token budget tracked live against the $0.80 stop.
- Fetched pages are summarized with Haiku before Sonnet sees them (cuts input tokens by more than half in practice).
- Prompt caching on the fixed system prompt and trip context (cache reads $0.20 per 1M).
- Research questions have their own smaller caps: 5 searches, 8 fetches, $0.16 hard stop.
- The Batch API does not fit multi-turn tool loops (each turn waits on the previous), so its 50% discount is only for offline jobs: shared-cache warming, nightly destination digests, scheduled fare scans. See [03-ai-features-and-costs.md](03-ai-features-and-costs.md).

## 5. Unit economics

### 5.1 Revenue per subscriber after Apple's 15%

| Product | Gross | Net (85%) | Net per month |
|---|---|---|---|
| Plus monthly | $4.99 | $4.24 | $4.24 |
| Plus annual | $29.99 | $25.49 | $2.12 (25.49 / 12) |
| Trip Pass | $9.99 | $8.49 | per purchase |
| Premium monthly | $11.99 | $10.19 | $10.19 |
| Premium annual | $99.00 | $84.15 | $7.01 |
| Premium annual at $79 (initial idea) | $79.00 | $67.15 | $5.60 |

The Small Business Program gives 15% while the developer stays under $1M a year in proceeds. Above that, standard rates apply (30% in the first year of a subscription, 15% after one year of paid retention). US web checkout (link out to Stripe, about 3% plus a fixed fee) is possible margin upside and out of scope here.

### 5.2 Cost assumptions

| Cost line | Assumption | Basis |
|---|---|---|
| SerpApi | $0.015 per search | Unverified, see caveats |
| Shared-cache dedupe on live checks | 35% of typical-user checks are served from another user's identical search | Popular routes overlap heavily; assumption to validate |
| Geoapify | About $0.0005 per uncached search after the free tier | Estimate; 1 week cache |
| Haiku explain | $0.005 | Under 1 cent |
| Full-trip draft | $0.08 | Sonnet, about 20k in, 5k out, with caching |
| Research question | $0.10 typical, $0.16 hard stop | $0.05 to $0.15 range |
| Deep agent run | $0.80 cap, $0.60 average with the controls in 4.6 | Uncapped today: $0.50 to $1.50 |
| Infra share (DB, workers, push, email, bandwidth, monitoring) | $0.03 per Free MAU, $0.06 per paid user per month | Estimate at 10k MAU; fixed costs excluded (see [05-infrastructure.md](05-infrastructure.md)) |

Moving research from 6 to 8 credits does not raise any cost line: real cost per question is unchanged, and users get fewer questions per credit. All figures below were re-checked after this change and hold.

### 5.3 Cost and margin per user type

"Typical" is measured as a share of allowance and is an assumption to validate in the first 60 days after launch.

**Free**

| User | Behavior | Monthly cost |
|---|---|---|
| Light | Browses, 1 cached route, 5 places searches | $0.03 |
| Typical | Cached route, 20 places searches, 3 Haiku, alert pushes | $0.06 |
| Heavy (abuse case) | Maxes credits and places soft cap | $0.25 (hard limited) |

Free revenue is affiliate only: an estimated $0.05 to $0.15 per MAU per month from Travelpayouts and hotel link-outs (unverified, not counted toward margin).

**Plus (monthly subscriber, net $4.24; annual, net $2.12 per month)**

| User | Behavior (in an active month) | Cost | Margin monthly | Margin annual |
|---|---|---|---|---|
| Light | 1 route, 15 days live (about 10 after dedupe), 5 credits, 10 places | $0.26 | 94% | 88% |
| Typical | 2 routes, 30 days live (about 39 checks after dedupe, 39 x $0.015 = $0.59), 15 credits used ($0.18), places $0.03, infra $0.06 | $0.86 | 80% | 59% |
| Heavy | 3 routes daily, all 40 credits, places at cap | $1.89 | 55% | 11% |
| Worst case (ceiling hits) | Ceiling $1.75 plus infra and places $0.14 | $1.89 | 55% | 11% |

Margins: (4.24 - 0.86) / 4.24 = 80%; (2.12 - 0.86) / 2.12 = 59%; (4.24 - 1.89) / 4.24 = 55%; (2.12 - 1.89) / 2.12 = 11%.

The ceiling is what saves the annual plan: without it a Plus user could reach 90 live searches ($1.35) plus 40 credits at max ($0.80) plus extras, which is above $2.12. With the ceiling, provider spend cannot exceed $1.75.

**Trip Pass (net $8.49, one purchase covers 90 days of one trip)**

| User | Behavior | Cost | Margin |
|---|---|---|---|
| Light | 1 route, 25 live checks ($0.38), 10 credits ($0.10), infra $0.10 | $0.58 | 93% |
| Typical | 2 routes, 45 checks ($0.68, about $0.44 after dedupe), 25 credits ($0.30), infra $0.10 | $0.84 | 90% |
| Heavy or worst | 60 checks ($0.90), all 40 credits at max ($0.80), infra $0.10 | $1.80 | 79% |

Margins: (8.49 - 0.58) / 8.49 = 93%; (8.49 - 0.84) / 8.49 = 90%; (8.49 - 1.80) / 8.49 = 79%. Trip Pass is the highest-margin product because its cost is capped per trip and it has built-in breakage.

**Premium (later; monthly net $10.19, annual $99 net $7.01 per month)**

| User | Behavior | Cost | Margin monthly | Margin annual ($99) |
|---|---|---|---|---|
| Light | 2 routes live, 30 credits | $1.00 | 90% | 86% |
| Typical | 4 routes live ($1.35 after dedupe), 2 deep runs ($1.60) and 5 research questions ($0.50), infra $0.08 | $3.53 | 65% | 50% |
| Heavy | 6 routes, 240 credits used at cost | $5.58 | 45% | 20% |
| Worst case (ceiling $5.50 plus infra) | | $5.58 | 45% | 20% |

Margins: (10.19 - 3.53) / 10.19 = 65%; (7.01 - 3.53) / 7.01 = 50%; (10.19 - 5.58) / 10.19 = 45%; (7.01 - 5.58) / 7.01 = 20%. At $79 a year the worst case is $5.58 against $5.60 of net monthly revenue: zero margin. That is why the price is $99.

### 5.4 Why 10 to 15 agent runs in Premium does not work

At $0.50 to $1.50 per run, 10 to 15 runs cost $5 to $22.50 a month against $10.19 net. Even at the low end plus live tracking, the annual plan goes negative. It only works if the average run drops below about $0.40. Sonnet 5.5 pricing is not the problem; the 40-turn, 30-fetch design was. So a run is capped at $0.80 (20 turns, 10 searches, 10 fetches), Premium allows about 6 (240 credits / 40), and heavier users buy credit packs (37% to 61% margin at worst case).

### 5.5 Illustrative month at 10,000 monthly active users

Assumption: 4% pay (150 + 100 + 120 + 30 = 400 payers, counting Trip Pass buyers in the month). This is a sanity check, not a forecast.

| Line | Count | Net revenue | Cost |
|---|---|---|---|
| Free MAU | 9,600 | $0 (affiliate excluded) | 9,600 x $0.05 = $480 |
| Plus annual | 150 | 150 x $2.12 = $318 | 150 x $0.86 = $129 |
| Plus monthly | 100 | 100 x $4.24 = $424 | 100 x $0.86 = $86 |
| Trip Pass purchases per month | 120 | 120 x $8.49 = $1,019 | 120 x $0.84 = $101 |
| Premium (blended) | 30 | 30 x $8.00 = $240 | 30 x $3.53 = $106 |
| Credit packs | 60 packs | 60 x $5.00 net = $300 | about $110 |
| Total | | $318 + 424 + 1,019 + 240 + 300 = $2,301 | $480 + 129 + 86 + 101 + 106 + 110 = $1,012 |

Gross margin: (2,301 - 1,012) / 2,301 = 56%, unchanged by the research-credit change, before fixed costs (developer, hosting minimums, support). Premium lines are included as a later-stage sanity check; without the 30 Premium users the total is $2,061 revenue and $906 cost, still about 56%. Two lessons: Free users are 47% of variable cost (480 / 1,012), so the Free tier must stay near $0.05 per user; and Trip Pass plus packs carry more revenue than subscriptions at low scale.

## 6. Guardrails

The design goal: no account can cost more than its net revenue, whatever it does.

### 6.1 Per-account dollar ceilings (server enforced, invisible to users)

| Tier | Monthly provider-spend ceiling | Daily budget | When the ceiling hits |
|---|---|---|---|
| Free | $0.25 | $0.05 | Live and AI actions off; cached data still works; upgrade prompt |
| Trip Pass | $1.80 per pass | $0.40 | Live checks pause; credit packs offered |
| Plus | $1.75 | $0.40 | Live tracking drops to cached only until the 1st; message says "checks resume on the 1st" |
| Premium (later) | $5.50 | $1.25 | Scheduled agents pause; top-up offered |

The ceiling counts SerpApi, Claude, and Geoapify spend attributed to the account. The ledger is the new `provider_calls` and `ai_usage` tables described in [06-database-and-data-integrations.md](06-database-and-data-integrations.md), which generalize today's `ApiCall` table (provider, units, cached) with user, trip, and cost in dollars. Purchased credits raise the ceiling by the pack's cost value, since that spend is separately paid.

A deep agent run ($0.80 hard stop) costs more than the $0.40 daily budget on Plus and Trip Pass, so the rule is: a run is admitted when the month has at least $0.80 of headroom, even if it pushes past the daily budget. Its spend still counts toward that day, so no other paid actions run until the next day.

### 6.2 Rate and abuse limits

- One agent run at a time per account, and one global concurrent-run cap per worker pool. Queue the rest (Premium first).
- Max 1 scheduled run per day per routine, min 12 hours between runs of the same routine (Premium only).
- Per-endpoint rate limits: AI endpoints 10 per minute per account; places search 30 per minute.
- One Free account per Apple ID (Sign in with Apple), device check with App Attest, plus IP velocity limits on signups (maximum 5 new accounts per IP per day).
- Trip Pass fraud: the pass is tied to the Apple ID and bound to one trip on the server; it can be moved at most once.
- Refund clawback (see 4.5); repeated refund abuse blocks purchases.
- Input controls: max 2,000 characters on prompts, max 14 days per draft call, identical requests within 6 hours return the earlier result free.
- No user-supplied URL for agent fetching beyond the allowed evidence rules (existing ingest checks and blocked domains stay).
- Prompt caching and the shared research cache are mandatory for every AI call, so repeated destinations cost near zero.

### 6.3 Global circuit breakers

- SerpApi budget: the existing monthly-cap logic in `serpapi_budget.py` generalizes to a global daily budget. If spend passes 90% of the plan's monthly quota, live checks go to top-value routes only (routes with a chosen flight or an active alert), then cached only.
- Anthropic spend: global daily limit; at 80% disable Free-tier AI, at 95% disable everything but paid tiers.
- Alert when cost per active payer exceeds $2 (Plus) or $6 (Premium).
- Fail closed: if the ledger cannot be read, do not run paid calls.

## 7. Pricing alternatives considered

| Option | Verdict | Reasoning |
|---|---|---|
| Monthly only | Reject as the lead | Travel is episodic: users subscribe for planning weeks, then cancel. Expect short lives (2 to 3 months). Kept as an option, not the headline. |
| Annual | Keep | $29.99 is under the psychological line for "keep it for my next trips". Best retention, lowest net per month, so it needs the ceiling. |
| One-trip Trip Pass at $9.99 | Lead product | Matches how people buy: "I have a trip in March". Highest margin (79% to 93%). Low commitment, so it converts Free users who would never subscribe. |
| Family or group plan (Apple Family Sharing) | Off at launch | Sharing lets up to 6 people share one subscription's allowances and live routes, multiplying cost with no revenue. Trip-level sharing is the natural group model: the trip owner pays, guests get that tier on that trip. |
| Free trial | Annual Plus only, 7 days | Trial exposure is about $0.45 (1 live route, 10 credits, 7 days). Expected conversion of 35 to 45% makes it worth it for annual. No trial for Trip Pass (already low cost) or Premium. |
| Lifetime purchase | Reject | Unbounded AI and live-search cost against one payment. |
| Credits only (no subscription) | Reject as primary | Users resent metering everything; the pass and Plus give predictability. Credits stay as the top-up. |
| Pay per AI action with no allowance | Reject | Kills discovery of the best feature; small allowances let people try it. |
| Ads on Free | Reject | Clutters a planner; affiliate links already monetize Free without hurting the UI. |

### Price points and price testing
- Plus: $4.99 per month or $29.99 per year (annual is 50% off monthly: 12 x $4.99 = $59.88). Test $34.99 for annual as a variant; a higher price with a 7-day trial often lifts revenue.
- Trip Pass: $9.99 (Apple tier 10). Test $7.99 and $12.99 in a paywall experiment.
- Premium: $11.99 per month or $99 per year.
- Launch US-priced with Apple's regional tiers. Do not localize by hand at launch.

## 8. Launch configuration

Ship this on day one (roadmap in [07-local-to-app-store.md](07-local-to-app-store.md)):

| Item | Launch setting |
|---|---|
| Tiers visible | Free, Plus, Trip Pass, credit packs |
| Premium | Entitlements built, shipped behind a flag. Launches when measured agent cost is $0.60 or less per run over 200 runs, or when more than 15% of Plus payers buy agent-run credits |
| Plus | $4.99 per month, $29.99 per year, 7-day trial on annual only |
| Trip Pass | $9.99, non-renewing subscription in StoreKit, bound to one trip on the server, 90 days, 40 credits, 2 live routes, at most 60 live checks |
| Credit packs | $2.99 for 50, $6.99 for 150, $14.99 for 400 |
| Free | 2 active trips, 1 cached route per trip, 8 credits per month, free guest joining, 1 alert on cached fares |
| Guardrails | Per-account ceilings, per-day budget, global circuit breakers, ledger from day one |
| Family Sharing | Off |

Why hold Premium back: agent routines are the riskiest cost and the least proven feature. Selling credits for manual agent runs (40 credits, $0.80 hard stop) tests demand and real cost without a monthly promise. Scheduled agents stay off for everyone until Premium; scheduled work before then is API price checks plus cheap batch scans.

Default paywall order, best converting first: Trip Pass, annual Plus, monthly Plus. Show the Trip Pass first when the user has a trip with dates within 120 days; show annual Plus first when they have 2 or more active trips.

## 9. Paywall moments and anti-patterns

### 9.1 Where the upgrade prompt appears

| Moment | Trigger | What we show | Best offer |
|---|---|---|---|
| Create a third active trip | Free limit reached | "Two trips are active. Archive one, or upgrade" | Annual Plus |
| Add a second route on Flights | Free: 1 route per trip | Preview of the second route's cached fares, unlock | Trip Pass |
| Tap "Track live" or "Refresh now" | No live access | "Live prices for this route, checked daily" plus a credit spend option | Trip Pass or 1 credit |
| Price-drop alert set up | Free alert used up | Explain what live alerts add | Trip Pass |
| Invite a collaborator | Free owner | "Plan together: they join free" | Trip Pass (best fit) |
| "Draft my itinerary" | Out of credits | Blurred preview of the first day, then unlock | Credit pack or Plus |
| "Research this" or "Ask" | Out of credits | Offer 8 credits for one question | Small pack |
| Start a scheduled agent routine | Not Premium | Sample result from the shared cache | Credits for one manual run, or Premium once launched |
| Presentation "Made with" footer and PDF watermark | Every Free share | Soft, at export | Trip Pass |
| Saving the 9th lodging option | Free limit | Keep saving to a locked "later" list | Trip Pass |
| 14 days before departure with a Free trip | Lifecycle | "Your fares moved this week" email or push | Trip Pass |
| After booking a flight through the affiliate link | Success moment | No paywall; only a soft prompt to plan the days | None |

Rules for each: the free path is always visible; the prompt says what the user gets on this trip; no more than one paywall per session; dismissing it once mutes the same prompt for 7 days.

### 9.2 Anti-patterns to avoid

1. **Paywalling before value.** No paywall at first launch. Let people build a trip, see cached fares, and add plans first. Prompt only at a limit they hit.
2. **Meters that punish core use.** Do not charge credits for editing the calendar, saving lodging, or scheduled live tracking.
3. **Surprise deductions.** Show the credit cost before every AI action, with a confirm for anything at 6 credits or more (research questions and agent runs).
4. **Hiding the free path.** Always show "Not now" and keep affiliate links visible and honest. Do not degrade free results to push upgrades.
5. **Hostage data.** Never lock, delete, or hide a trip on downgrade. Read and export always work.
6. **Dark patterns on trials.** State the price and renewal date on the trial screen. Send a reminder before conversion.
7. **Fake urgency.** No countdown timers or invented "only 2 spots" messages.
8. **Unbounded promises.** Never write "unlimited AI" or "unlimited live tracking" in marketing. Use "generous" and state real numbers.
9. **Selling what we cannot guarantee.** Agent results are indicative and cite sources; do not promise "lowest price" or "we found the best deal".
10. **Pricing by a feature that costs nothing.** Do not gate presentation mode itself, the itinerary, or the lodging list. Only the footer and watermark.
11. **Free tier that leaks cost.** Never let Free trigger live SerpApi or Sonnet calls without spending credits.
12. **Subscription lock-in for an episodic need.** Make cancellation and pausing easy; offer a 3-month pause instead of losing the customer.
13. **Family sharing by accident.** Leave Apple Family Sharing off until a group plan is designed.
14. **Currency confusion.** Show credits and prices in the store currency; show fares in the trip currency, as the app does today.

## 10. Where this plan changed the initial idea

Final decisions are in the README; this section keeps the reasoning.

1. **Premium cannot include 10 to 15 agent runs a month.** At $0.50 to $1.50 per run that is $5 to $22.50 against $10.19 net (monthly) or $5.60 net (annual at $79). Final: a run is capped at $0.80 (20 turns, 10 searches, 10 fetches, effort medium), Premium allows about 6 (240 credits), and heavy users buy packs.
2. **Premium annual is $99, not $79.** At $79 the worst-case margin is about zero. $99 gives 20% at the ceiling and about 50% for a typical user.
3. **Premium ships later.** Launch is Free, Plus, Trip Pass, and credit packs. Agents are the unproven cost line, so demand is tested by selling manual runs in credits first. Premium launches at $0.60 or less measured cost per run over 200 runs, or when more than 15% of Plus payers buy agent-run credits.
4. **Alerts are not Plus-only.** Push alerts on cached fares cost nothing and drive return visits. Free gets 1 alert route; paid tiers get live-fare alerts and more routes.
5. **Live tracking is limited by routes, frequency, and a 120-day window, not by credits.** Charging credits for a background tracker feels like a meter running. The account-level dollar ceiling is the real protection.
6. **The Batch API does not fit agent runs.** Multi-turn tool loops wait on each response; Batch is for cache warming, digests, scheduled fare scans, and non-interactive regeneration only. No 50% discount is counted in agent cost.
7. **Collaboration is free to join.** Only the trip owner pays; guests get that tier on that trip. This drives sign-ups and avoids a family plan that multiplies cost.
8. **Trip Pass is the lead offer**, with 40 credits and a hard cap of 60 live checks. The initial idea listed it as a third price point; episodic travel favors it. It is a non-renewing subscription in StoreKit bound to one trip on the server, not a consumable.
9. **"About 5 research runs a month" is expressed as 40 credits**, so users can spend on drafting or research as they wish. With research at 8 credits (was 6 in the first draft, with a $0.16 hard stop and caps of 5 searches and 8 fetches), 40 credits is exactly 5 research questions, or a draft plus 4.
10. **Apple Family Sharing is off at launch.** It would multiply allowances and live routes per payment.
11. **SerpApi at 1 to 2 cents is unverified.** Live fares go through SerpApi behind a feature flag at launch (legal risk flagged), with a licensed source (Skyscanner Partners) applied for. If the real cost per search is above 2.5 cents, cut Plus's live-route limit to 2 or raise the price; re-check before setting limits.

## 11. Open items for other files

- Backend ([06-database-and-data-integrations.md](06-database-and-data-integrations.md)): the `provider_calls` and `ai_usage` ledger, and an entitlement service driven by App Store Server Notifications v2, including the Trip Pass to trip binding.
- Legal and policy: SerpApi commercial terms for a consumer app; Travelpayouts affiliate terms for in-app use; prepaid credit disclosure rules.
- Measurement plan: track cost per active payer, credits used share, Trip Pass vs Plus split, paywall conversion by moment, and agent-run cost distribution. Review the "typical usage" assumptions in 5.3 after 60 days.

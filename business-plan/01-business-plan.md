# Business plan

Part of the [business plan](README.md). The decisions of record in the README override anything here.

Written 2026-09-30. Tier and price detail is in [02-pricing-tiers.md](02-pricing-tiers.md).

## Executive summary

Trip Planner today is a private app for two people on one Windows PC. It already has the parts of a credible trip product: flight price tracking (cached Travelpayouts fares and live Google Flights fares via SerpApi), a drag-and-drop day calendar, Geoapify places search, a lodging shortlist that never scrapes booking sites, Wikipedia destination summaries, a full-screen presentation mode, and agent routines that use Claude to hunt fares and research events with a source URL for every saved fact.

The plan is to turn it into a multi-user web and iOS product. It launches with Free, Plus, Trip Pass and credit packs. Premium is built behind a flag and launches later. Four beliefs drive the plan:

1. The product is a collaborative trip workspace with trustworthy price tracking, not an "AI trip planner". AI is a metered, capped extra.
2. Most users pay little or nothing. Money comes from a small paying minority, sold per trip first, plus affiliate commissions on bookings.
3. AI cost is controlled by design (per-account cost ceilings, run caps, shared cache, Batch API for offline jobs only), or heavy users lose money.
4. This is most likely a good side business ($5k to $50k a year profit by year 3) and only under favorable assumptions a real company. The optimistic case needs a sharing loop nothing in the product proves yet.

Year 3 headline numbers (details in [Three-year scenarios](#three-year-scenarios)):

| Scenario | Avg MAU | Paying users | Revenue | Net profit (before founder pay) |
|---|---|---|---|---|
| Conservative | 12,000 | 240 | about $7k | about -$5.2k (below break-even) |
| Base | 60,000 | 2,100 | about $99k | about +$35k |
| Optimistic | 200,000 | 10,000 | about $640k | about +$280k |

Affiliate income is $0.10, $0.60 and $1.50 per MAU per year in the three cases (see [Affiliate revenue](#affiliate-revenue)); it is the least certain input, and the optimistic profit depends on it heavily.

The decision that matters most: do not rewrite for the App Store until milestone M0 (validate) shows people want it. See [Milestones](#milestones).

## Problem and target customers

Planning a trip is spread across a flight tab, a notes app, a spreadsheet, chat threads and hotel screenshots. Two pains are poorly served:

- Fare timing. People do not know if a price is good, and alerts from big apps are noisy and unexplained. Nobody shows "here is the page where I saw this fare".
- Group coordination. Several people editing one plan, with clear conflict handling (the app refuses stale edits and shows the latest version), is still clumsy in TripIt and Google Docs.

| Persona | Who | What they pay for | Fit |
|---|---|---|---|
| Couple planner (primary) | Two adults planning 1 to 3 trips a year, one of them the organizer | Shared calendar, price alerts, presentation mode | Strong. The exact use case the app was built for. |
| Friend group organizer | 4 to 8 people, one organizer chases everyone | Collaboration, lodging votes, invite links | Strong for growth (each trip invites 3 to 7 people). Only the organizer pays, which suits Trip Pass. |
| Family planner | Parents, school-holiday limits, higher spend | Itinerary, printable PDF, lodging comparison | Medium. Willing to pay, but needs kid-friendly filters not yet built. |
| Deal hunter | Flexible dates, chases fares | Live fare tracking, date grid, agent fare hunt | Best future Premium payer, but small (perhaps 5 to 10% of users), price sensitive, and the most likely to abuse free tiers. |
| Casual dreamer | Browses, rarely books | Nothing | Free tier. Feeds affiliate clicks and the shared cache. |

Launch target: couples and friend-group organizers who fly internationally at least once a year. Business travelers are out of scope (TripIt owns them).

## Value proposition and differentiation

1. Evidence-backed fare hunting. Agent results are marked "indicative" and always carry a public source link, route, dates and currency (enforced by the ingest API). Competitors show a price with no provenance. This is a real trust differentiator only if the hunt finds fares people cannot find in Google Flights (budget carriers, sales, deal posts).
2. Prices tracked over time in one place: history chart, date grid, per-night cost, cheapest by trip length.
3. Collaborative planning with safe concurrent edits. Only the trip owner pays; invitees join free.
4. Presentation mode: a full-screen deck and printable PDF of the trip. Demo-friendly and shareable, so the best organic marketing asset.
5. A lodging shortlist that respects site terms (bookmarklet and pasted links, no scraping) with side-by-side compare. This is a legal moat as much as a feature.

None of these is hard to copy. Wanderlog already has collaboration and maps at about $40 a year. The defensible part is the combination, the evidence rule and execution speed. Do not pitch "AI-powered": ChatGPT, Layla and Mindtrip own that message.

Positioning: "Plan the trip together, and never overpay for the flight without knowing why."

## Market and competitors

Prices below come from third-party review sites (checked 2026-09-30). Verify each on the vendor's own page before publishing any comparison.

| Competitor | Free tier | Paid price found | Notes |
|---|---|---|---|
| Wanderlog | Generous, ad supported | Pro about $39.99 a year (range $39.99 to $49.99 in mid 2026) | Closest rival: collaborative itinerary, maps, offline. |
| TripIt | Basic organizing from email | Pro $49 a year, 30 day trial | Business travelers and frequent flyers. |
| Layla | Limited free chats | Premium about $49 to $50 a year | AI chat planner, live pricing, price alerts. |
| Mindtrip | Core planning free | No subscription found; moving to book-and-earn commission in 2026 | Same affiliate strategy we use. |
| Hopper | Free app | No subscription found; earns from booking fees and add-ons | Price-prediction brand. Do not compete head on. |
| Google Flights | Free | Free | Price tracking and date grid are free. This caps what tracking alone can charge. |
| ChatGPT | Free and $20 a month plans | $20 a month | Free to ask "plan 5 days in Lisbon". |

What the prices tell us:

- Direct rivals sell annual plans at $40 to $50. Plus at $29.99 a year undercuts all of them, a fine entry price. Premium at $99 a year is about double, so it must offer something rivals lack (see [Where this plan changed the initial idea](#where-this-plan-changed-the-initial-idea)). That is one reason Premium launches later.
- Google Flights tracks fares free, so "live tracking" alone converts poorly. People pay for tracking bundled with the workspace, or for a hunt that finds what Google cannot.
- There is no verified market-size figure here and none is invented. Tens of millions of people plan trips with apps each year; the constraint is acquisition cost, not market size.

## Revenue model

The lead offer is Trip Pass, then annual Plus. Credit packs and, later, Premium are extras. Streams in expected order of contribution (base case):

| Stream | Share of year 3 revenue | Notes |
|---|---|---|
| Subscriptions and passes (Plus, Trip Pass; Premium from year 2) | about 64% | Sold through the App Store at a 15% Apple commission (Small Business Program, under $1M a year in proceeds). Trip Pass is a non-renewing subscription in StoreKit, bound to the trip on the server. Expect it to be the most common first purchase. |
| Affiliate (lodging first, then tours, flights, cars, transfers, eSIM, insurance, post-trip compensation) | about 36% | Earned on free and paid users alike, in the same places on every tier. Payout is delayed and lumpy. Lodging is about 60% of it. |
| Credit packs ($2.99 for 50, $6.99 for 150, $14.99 for 400) | under 5%, treat as upside | Bought mostly by Plus payers who run out. A high pack-buying rate (over 15% of Plus payers buying agent-run credits) is a trigger to launch Premium. |

Pack revenue is counted inside the subscription line in the scenarios.

### Why no banner ads

- At 10k to 60k MAU, ads earn under $1 per MAU per year and compete with affiliate links for the same attention.
- Ad SDKs add tracking and consent flows (ATT, GDPR) and lower the trust the fare-evidence story depends on.
- Ads next to a price list look like they influence which fare is shown.
- They slow the app and presentation mode, the shareable showpiece.

Decision: no ad networks. Affiliate links are labeled and never change fare ranking.

### Affiliate revenue

Affiliate links appear on every tier in the same places (see [02-pricing-tiers.md](02-pricing-tiers.md)). The full program research, placement map, compliance and tracking design are in [08-affiliate-revenue.md](08-affiliate-revenue.md). Summary:

- **Categories, in order of expected money:** lodging first (about 60% of affiliate income), then tours and activities, flights, cars, transfers, eSIM, travel insurance, and post-trip flight-delay compensation. Flights are a service feature more than a revenue line: airline commissions are tiny (a flat few dollars or about 1% of the fare).
- **Launch networks:** Travelpayouts (flights, Booking.com, Agoda, Trip.com and Hostelworld stays, cars, transfers, tours, eSIM, insurance), Viator's self-service partner API for things to do, and Stay22 as the lodging challenger. From month 3, apply directly to Expedia Group, Booking.com, Skyscanner, Airalo and GetYourGuide.
- **Airbnb:** no affiliate program an app can join. The old Associates program closed in 2021, the current creator and demand tracks are invite-only for influencers and bloggers, and the host-referral reward pays for new hosts, not guest bookings. Airbnb listings get a plain link with no tracking, never a converted one.
- **Vrbo:** reachable only through the Expedia Group affiliate program (which also covers Expedia and Hotels.com, run on Impact), with Stay22 as a second route. Reported Vrbo rates are about 2 to 6% and inconsistent, so the plan uses the low side.
- **Tracking:** an own redirect (`/go/<click_id>`) with a random per-click sub-id, no ad or attribution SDKs and no device ids, so no App Tracking Transparency prompt. Attribution can still be lost in in-app browsers and across devices, which is built into the numbers below.
- **Apple:** links to physical travel services are allowed; digital goods (our plans) must use in-app purchase. Confirm the current guideline text (3.1.1 and 3.1.3(e)) and US external-purchase rules before launch.

Assumption per MAU per year, from the model in 08 (real trips per MAU x attribution survival x clicks x click-to-booking x net commission, summed over categories):

| | Conservative | Base | Optimistic |
|---|---|---|---|
| Affiliate revenue per MAU per year | $0.10 | $0.60 | $1.50 |
| Per MAU per month | about $0.01 | $0.05 | about $0.13 |

The $0.60 base case is about $1 per planned trip. The per-MAU figures are guesses built from third-party rate reports (the official partner sites could not be read), and they are the first thing to measure. Treat them as a floor that pays for infrastructure, not the growth plan.

## Unit economics per tier

Net revenue is after Apple's 15%. The worst-case cost is the per-account monthly provider-spend ceiling (Free $0.25, Plus $1.75, Trip Pass $1.80 per pass, Premium $5.50); typical users spend far less. Full detail is in [02-pricing-tiers.md](02-pricing-tiers.md), and AI costs in [03-ai-features-and-costs.md](03-ai-features-and-costs.md).

| Tier | Price | Net after Apple | Cost ceiling | Worst-case margin |
|---|---|---|---|---|
| Free | $0 | $0 | $0.25 a month; typical $0.01 to $0.02, offset by affiliate income of about $0.01 to $0.13 a month ($0.05 in the base case) | Roughly break-even if usage stays typical. |
| Plus monthly | $4.99 | $4.24 a month | $1.75 a month | About 59% |
| Plus annual | $29.99 | $25.49 (about $2.12 a month) | $1.75 in each active month; use is concentrated in 2 to 4 months a year | Healthy at typical use; thin (about 17% of a month's net) only if the ceiling is hit every month |
| Trip Pass | $9.99 once | $8.49 | $1.80 per pass (90 days, at most 60 live checks, 40 credits) | About 79% |
| Premium monthly (later) | $11.99 | $10.19 a month | $5.50 a month | About 46% |
| Premium annual (later) | $99 | $84.15 (about $7.01 a month) | $5.50 a month | About 22% at the ceiling; much better at typical use |

The Premium allowance is the whole margin. 240 credits a month is about 6 deep agent runs, each hard-stopped at $0.80, and the $5.50 monthly ceiling caps the total. Premium therefore launches only when measured agent cost is $0.60 or less per run over 200 runs, or when over 15% of Plus payers buy agent-run credits.

Blended assumptions used in the scenarios:

- Blended net revenue per paying user per year (ARPPU): $24 (conservative, mostly Trip Pass and Plus), $30 (base), $34 (optimistic, a larger Premium share from year 2).
- Variable AI and data cost: $0.15 per free MAU per year, $6 to $8 per paying user per year (after the ceilings and caches).
- Payment processing is inside Apple's 15%.

## Cost structure

| Cost | Estimate | Notes |
|---|---|---|
| Apple Developer Program | $99 a year | Required. |
| iOS build machine | Mac mini or Xcode Cloud | iOS builds need macOS. |
| Hosting (Render API, worker, managed Postgres; Cloudflare DNS, WAF, R2, Pages) | $40 to $150 a month in year 1 | Enough for the first 10k MAU. Move to AWS or Google Cloud around 50k MAU or $1,500 a month. See [05-infrastructure.md](05-infrastructure.md). |
| Sign-in and payments | Supabase Auth; RevenueCat over StoreKit 2 | Verify current pricing and free limits. |
| SerpApi (live Google Flights) | Unverified at scale; budget $75 to $300 a month | Behind a feature flag at launch (legal risk flagged), with a licensed source (Skyscanner Partners) applied for. Per-search cost drives the live-check caps. |
| Travelpayouts cached fares | Free | Free baseline for cached fares. Terms for a public app must be checked. |
| Geoapify | Free up to a daily limit, then paid | Results cached for a week. Check commercial terms. |
| Claude API | Variable, see [Unit economics](#unit-economics-per-tier) | Haiku 4.5 for short answers, Sonnet 5.5 for drafting, research and agents. |
| Email, push, analytics, error tracking | $30 to $100 a month | |
| Legal (privacy policy, terms, affiliate disclosures) and accounting | $1,500 to $4,000 in year 1 | |
| Support | Founder time | Budget 5 to 10 hours a week from 5,000 MAU. |

What must change technically (owned by the other files) drives cost and timeline: real accounts instead of one passcode ([04-users-and-accounts.md](04-users-and-accounts.md)), a multi-tenant database ([06-database-and-data-integrations.md](06-database-and-data-integrations.md)), a hosted worker with a queue, per-account quotas, and moving agents from `claude -p` on a personal subscription to the Claude API. That last change is a legal and cost necessity: a personal subscription cannot serve customers.

## Three-year scenarios

All figures are US dollars, rounded. Year 1 is the first year after public launch. "Avg MAU" is the average over the year. Net profit excludes founder pay and taxes. These are planning models, not forecasts.

All three scenarios use the launch lineup: Free, Plus, Trip Pass and credit packs. Premium is added from year 2, and only if it passes its launch gate. Year 1 has no Premium revenue.

### Assumptions

| Assumption | Conservative | Base | Optimistic |
|---|---|---|---|
| Avg MAU year 1 / 2 / 3 | 1,000 / 5,000 / 12,000 | 3,000 / 20,000 / 60,000 | 8,000 / 60,000 / 200,000 |
| Paid conversion (of MAU) | 2% | 3.5% | 5% |
| Blended net ARPPU per year | $24 | $30 | $34 |
| Affiliate per MAU per year | $0.10 | $0.60 | $1.50 |
| AI and data cost per free MAU per year | $0.15 | $0.15 | $0.15 |
| AI and data cost per paying user per year | $6 | $8 | $8 |
| Fixed infra, tools, legal (year 1 / 2 / 3) | $4k / $6k / $6k | $6k / $10k / $18k | $10k / $25k / $50k |
| Marketing and contractors (year 1 / 2 / 3) | $1k / $2k / $3k | $5k / $10k / $20k | $10k / $100k / $200k |

Marketing is deliberately low in the first two scenarios: they assume organic growth only.

### Results

| | Cons. Y1 | Y2 | Y3 | Base Y1 | Y2 | Y3 | Opt. Y1 | Y2 | Y3 |
|---|---|---|---|---|---|---|---|---|---|
| Paying users (avg) | 20 | 100 | 240 | 105 | 700 | 2,100 | 400 | 3,000 | 10,000 |
| Subscription, pass and pack revenue | $0.5k | $2.4k | $5.8k | $3.2k | $21k | $63k | $13.6k | $102k | $340k |
| Affiliate revenue | $0.1k | $0.5k | $1.2k | $1.8k | $12k | $36k | $12k | $90k | $300k |
| Total revenue | $0.6k | $2.9k | $7.0k | $5.0k | $33k | $99k | $25.6k | $192k | $640k |
| Variable AI and data cost | $0.3k | $1.4k | $3.2k | $1.3k | $8.5k | $25.5k | $4.4k | $33k | $110k |
| Fixed and marketing | $5k | $8k | $9k | $11k | $20k | $38k | $20k | $125k | $250k |
| Net profit | about -$4.7k | about -$6.5k | about -$5.2k | about -$7.3k | about +$4.5k | about +$35k | about +$1.2k | about +$34k | about +$280k |

Arithmetic, affiliate line = average MAU x affiliate per MAU:

- Conservative: 1,000 x $0.10 = $100; 5,000 x $0.10 = $500; 12,000 x $0.10 = $1,200.
- Base: 3,000 x $0.60 = $1,800; 20,000 x $0.60 = $12,000; 60,000 x $0.60 = $36,000.
- Optimistic: 8,000 x $1.50 = $12,000; 60,000 x $1.50 = $90,000; 200,000 x $1.50 = $300,000.

Totals and profit, year 3: conservative $5.8k + $1.2k = $7.0k, less $3.2k variable and $9k fixed = -$5.2k. Base $63k + $36k = $99k, less $25.5k and $38k = +$35.5k (about +$35k). Optimistic $340k + $300k = $640k, less $110k and $250k = +$280k. Year 2 base: $21k + $12k = $33k, less $8.5k and $20k = +$4.5k.

The conservative case stays at or below break-even in year 3 even with a trimmed cost base. It is a side project, not a business.

### Break-even

- Fixed costs of about $10k a year need about 330 paying users at $30 ARPPU, or about 16,700 MAU at $0.60 affiliate alone ($10k / $0.60), or a mix.
- Base-case monthly break-even, with the year 2 cost base ($20k a year, about $1,670 a month): each MAU contributes 3.5% x $30 = $1.05 of subscription revenue plus $0.60 affiliate, less about $0.43 of variable cost (0.965 x $0.15 + 0.035 x $8), or about $1.23 a year ($0.102 a month). Break-even needs about 16,300 MAU (was about 14,000 at $0.80 affiliate). With MAU growing about 1,400 a month through year 2, that is roughly two months later than before: **about month 18 to 22** (was month 16 to 20). Year 2 as a whole is still slightly profitable (+$4.5k) because MAU ends the year well above the break-even level.
- The conservative case does not break even on cash at its year 3 revenue: contribution is $7.0k - $3.2k = $3.8k, so fixed and marketing costs would have to stay under about $4k a year.
- A funded team of two (about $240k a year loaded) needs about 8,000 paying users at $30. Only the optimistic case reaches that, in year 3.

### What has to be true

1. Conversion of 3.5% needs a free tier limited enough to create a need and generous enough to hook users. Many consumer categories see lower free-to-paid rates, so 2% is the safer planning number.
2. 60,000 MAU in 3 years needs a working acquisition loop. Paid installs for a travel app are expensive (an unverified $2 to $6) and would erase Plus margin. Organic loops (shared trips, SEO, invites) are mandatory.
3. Retention is the structural problem. People use a trip app for 1 to 3 months before a trip, then leave. This is why Trip Pass and annual plans lead. Monthly plans churn 15 to 30% a month by design.
4. Affiliate at $0.60 per MAU is unproven. At $0.20, base year 3 revenue falls by about $24k (60,000 x $0.40).
5. Agent cost must be measured before Premium goes live: $0.60 or less per run over 200 runs. The cost ceilings limit the damage if it is not.
6. Apple's 15% applies only under $1M a year in proceeds, which none of these scenarios exceeds. Above that it is 30%.

## Go-to-market

| Channel | Tactic | Cost | Expected role |
|---|---|---|---|
| Referral via shared trips | Every invite to a co-planner is a signup; invitees join free. A small organizer reward is to be tested. | Low | Main viral loop, especially friend groups. |
| Reddit and forums | r/travel, r/solotravel, r/digitalnomad, r/awardtravel. Share fare findings with evidence; mention the app only when relevant, within each subreddit's rules. | Time | Good for deal hunters. |
| TikTok and Reels | 20 to 40 second clips: "I tracked this flight for 30 days", screen recordings of presentation mode. | Time, small creator budget | Awareness and downloads more than conversion. |
| Product Hunt and travel newsletters | One launch plus pitches to small newsletters | Low | One-off spike. |
| ASO (App Store search) | Keywords: trip planner, flight price tracker, group itinerary | Low | Steady trickle. |
| Shareable trip pages (SEO) | Public read-only pages from presentation mode ("5 days in Lisbon for two") with a "Copy this trip" button. Built in phase 4. | Engineering | Primary long-term engine. Needs quality content, not spam. |
| Creators and travel bloggers | Affiliate share on Plus | Variable | Test in year 2. |
| Paid ads | Not before organic acquisition cost is known | High | Avoid in year 1. |

Launch sequence (the roadmap is in [07-local-to-app-store.md](07-local-to-app-store.md)):

1. Invite-only hosted web beta with 50 to 100 couples and friend groups from Reddit and personal networks.
2. iOS TestFlight, then the public iOS launch with the lead offer: Trip Pass first, annual Plus second, monthly Plus lower on the paywall.
3. Growth: Android, shareable trip pages, then Premium.

Positioning rules:

- Lead with "plan together" and "know why a fare is cheap". Mention AI second.
- Show the source link on every agent-found fare in marketing screenshots.
- Publish factual, dated comparison pages (vs Wanderlog, vs TripIt) for SEO.

## Milestones

Effort is part time, solo, with Claude Code: about 5 to 6 months from the start of phase 0 to a public launch.

| Milestone | Effort | Exit criteria |
|---|---|---|
| M0: validate (no rewrite) | 2 to 4 weeks | Landing page, waitlist and 10 user interviews give a clear signal that people want it. Suggested bar: 500 waitlist emails and at least 30% of interviewed couples willing to invite a second person. |
| Phase 0: foundations | 3 to 4 weeks | Agents run on the Claude API with metering; Docker image; CI. |
| Phase 1: hosted web beta | 6 to 8 weeks | Accounts, sharing, entitlements, ledger. 4-week retention measured. |
| Phase 2: iOS TestFlight | 5 to 7 weeks | Capacitor app, purchases, push, account deletion. |
| Phase 3: public launch | 3 to 4 weeks | App Review passed, support and monitoring in place. |
| Phase 4: growth | Ongoing | Android, shareable trip pages for SEO, Premium (once its gate is met). |

Scale decision at month 18 to 24: if MAU is above 15,000 and paying users above 500, invest in growth; otherwise run it as a lean side business.

**Kill rule:** at month 9 after launch, if under 1% of monthly users pay and affiliate income is under $0.20 per monthly user per year (annualized), stop investing and keep it as a personal tool.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI cost overruns | High | High | Per-account monthly and daily cost ceilings, hard stops per run, shared research cache, Haiku for short answers, Batch API for offline jobs only, credits for extras, kill switch on daily spend. Scheduled agents stay off until Premium. |
| Low conversion and high churn (episodic use) | High | High | Trip Pass first, annual Plus second, price by trip not by month, reactivation email before the next trip. |
| Google, Skyscanner or Wanderlog add the same features free | Medium | High | Lean on evidence-backed hunting and collaboration; keep costs low. |
| Data provider terms or cost (SerpApi, Travelpayouts, Geoapify) | Medium | High | Verify commercial terms in M0; SerpApi stays behind a feature flag with a licensed source applied for; cached fares as the free baseline; behind a provider interface so sources can be swapped. |
| Scraping and site terms | Low today | High | Keep the rule: no Airbnb, Vrbo or Booking automation, no scraper libraries. |
| Wrong or stale fares harm trust | Medium | Medium | Keep the "indicative" label, source link, evidence rules and "last checked" time. |
| Apple review or rule changes | Medium | Medium | Read guidelines 3.1.1 and 3.1.3 early; keep a web checkout path where permitted; label affiliate links. |
| Privacy (dates, places, who is traveling) | Medium | High | Data minimization, delete account and export, GDPR and CCPA basics, no selling data, encrypted backups. See [04-users-and-accounts.md](04-users-and-accounts.md). |
| Rewrite from single-user local to multi-tenant slips | High | Medium | Scope tightly: auth, tenancy, quotas first; Premium and agents behind a flag. |
| Solo founder support load | Medium | Medium | Self-serve help, in-app status, one platform at launch. |
| Affiliate income much lower than assumed | High | Medium | Measure early; if under $0.20 per MAU per year, shift weight to Trip Pass and Plus. |
| Affiliate rates unverified, and attribution lost in in-app browsers | High | Medium | All rates come from third-party reports because the partner sites were unreadable; confirm each rate card and cookie window at sign-up, and replace the model inputs with measured data by month 3. Open links in SFSafariViewController, use a server-side sub-id per click and nightly conversion pulls instead of cookies alone, watch the unmatched-conversion share (over 10% means a tracking break), and treat attribution survival (0.60 to 0.90 in the model) as a key metric. See [08-affiliate-revenue.md](08-affiliate-revenue.md). |

## KPIs

Acquisition and activation:

- Installs and signups per channel; cost per install for any paid test.
- Activation: share of new users who create a trip and add a flight route or day plan within 7 days (target above 40%).
- Invite rate: share of trips with at least one collaborator (target above 30%); invites per organizer.

Engagement and retention:

- MAU, weekly actives, trips per user, trips departing in the next 90 days.
- Retention by trip cohort (D30, D90) and reactivation at the next trip.

Monetization:

- Free-to-paid conversion (target 2 to 4%), by tier: Trip Pass vs Plus annual vs Plus monthly.
- ARPPU, monthly churn on monthly plans, annual renewal rate.
- Affiliate clicks per MAU, click-to-booking rate, revenue per MAU, days to payout.
- Share of Plus payers buying credit packs (over 15% is a Premium trigger).
- MRR, ARR, LTV to CAC (target above 3).

Cost and quality:

- Agent cost per run (Premium gate: $0.60 or less over 200 runs), cost per user, cost per trip; research cache hit rate (target above 50%).
- Share of accounts hitting their monthly ceiling; live-check count per user; provider cost per MAU.
- Gross margin, blended (the illustrative 10,000-user month in [02-pricing-tiers.md](02-pricing-tiers.md) is about 56%) and per tier.
- Fare quality: share of agent fares passing evidence checks; user reports of wrong prices.
- Support tickets per 1,000 MAU, crash rate, App Store rating (target 4.5 or above).

## Where this plan changed the initial idea

Each point below records an earlier idea, the concern, and the final decision.

1. **Premium runs and price.** The initial idea was 10 to 15 agent runs a month at $11.99 or $79 a year. At $0.50 to $1.50 per run that costs $5 to $22 a month against $10.19 net (monthly) or $5.60 net (annual). Decision: Premium is $11.99 a month or $99 a year with 240 credits (about 6 deep runs), a $0.80 hard stop per run, a $5.50 monthly ceiling, and it launches later, when measured cost is $0.60 or less per run over 200 runs or over 15% of Plus payers buy run credits.
2. **Premium price against rivals.** Rivals charge $40 to $50 a year (Wanderlog $39.99, TripIt $49, Layla about $49), and the first draft suggested testing $49.99 to $59.99. The concern stands: $99 is about double, so Premium must clearly offer something they lack. But at $49.99 to $59.99 a year the net is only $3.54 to $4.25 a month, too little for a $5.50 ceiling. Decision: $99 is the launch price because of the ceiling. Premium's price will be tested once measured agent cost drops, and credit packs carry heavy users meanwhile.
3. **Live tracking as a headline.** Google Flights tracks prices free. Decision: Plus includes 3 live-tracked routes checked daily within 120 days of departure, but the pitch is "tracked with the reason and the source", and value comes from the workspace plus evidence-backed hunts.
4. **Research per month.** Use is episodic, so a fixed monthly quota fits badly. Decision: AI is priced in credits (1 credit is up to $0.02 of provider spend). Trip Pass gives a burst of 40 credits for one trip over 90 days; Plus gives 40 a month; purchased credits last 12 months.
5. **Affiliate as main free-tier income.** Plausible but unproven. At $0.10 to $1.50 per MAU per year it pays for infrastructure, not a salary. Decision: affiliate links are the free-tier income (no banner ads), treated as a floor, not the growth plan.
6. **Apple's commission.** 15% is not an advantage on a $4.99 plan. Decision: lead with Trip Pass and annual Plus, and check whether web checkout for US users is allowed to save fees.
7. **Monthly as the lead offer.** Wrong for episodic use. Decision: Trip Pass ($9.99 once) leads, annual Plus ($29.99, 7-day trial on annual only) is second, monthly Plus ($4.99) sits lower on the paywall.
8. **Where the paywall triggers.** Not on the first trip, since the shared trip is the growth loop. Decision: Free keeps 2 active trips and lets people join others' trips free; the paywall appears on collaboration size, live routes and credits.
9. **Banner ads.** Agreed to avoid them.
10. **Launch lineup and order of work.** The first draft launched all three tiers and a rewrite before proof of demand. Decision: validate first (M0), launch with Free, Plus, Trip Pass and packs, build Premium behind a flag, and keep scheduled agents off until Premium.
11. **Realism.** The base case ($35k profit in year 3) is a side income. A venture-style outcome needs the optimistic case and a sharing loop that is not yet proven.

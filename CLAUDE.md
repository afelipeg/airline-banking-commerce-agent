# Quasar Airlines (Airfintech) prototype

A shopping agent for Quasar Airlines customers (flights, ancillaries, co-branded card, miles,
travel insurance, installments) and a merchant agent for its commercial operators, both on the
`anthropics/commerce-agents` packages. Quasar Airlines, its people, and its figures are fictional.

## Layout

- `airline/`: the vertical, an importable module. `api/` (FastAPI host, backends, configs,
  presentation extensions, credit engine), `data/` (fixtures), `skills/shopping` and
  `skills/merchant` (the reference's flows, copied unchanged), `storefront-web/` (:3000),
  `merchant-web/` (:3100).
- `demo_common/`, `web-shared/`: vendored from the reference's `examples/` (host routes,
  sessions, fixture helpers, the shared contract tests; the shared web kit). Local edits to the
  vendored copy: `REPO_ROOT` in `demo_common/host.py` is this project's root, the missing-key
  hint names the root `.env`, and `metric_window` accepts any `last_<n>_days` period.
- `reference/commerce-agents/`: read-only clone of the reference, git-ignored.

## Run and verify

```bash
.venv/bin/uvicorn airline.api.main:app --app-dir . --reload --port 8000
npm run dev -w airline/storefront-web      # :3000
npm run dev -w airline/merchant-web        # :3100
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
```

`ANTHROPIC_API_KEY` goes in the root `.env` (git-ignored; `.env.example` is the template).

## Commerce agent decision record

Reference: `anthropics/commerce-agents` at `fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`, cloned in
`reference/commerce-agents` (read the hosted path's `managed-agents/` and
`scripts/deploy_managed_agent.sh` there). Lane: prototype for a live demo. Both roles.

### Shared

- Language and packages: Python 3.12, packages imported (not ported), pinned by `git+` at the
  reference commit in `requirements.txt` (`commerce-common[examples]`, `shopping-agent-core`,
  `shopping-agent-runtime`, `merchant-agent-core`, `merchant-agent-runtime`). Lint `ruff`, tests
  `pytest` over `airline/api/tests`. (commerce-architecture)
- Shell: one FastAPI service (`airline/api/main.py`) on the Messages API runtime, mounting the
  storefront routes and the merchant router under `/api/merchant`, as `examples/telecom` does.
  Client `AsyncAnthropic` on the Anthropic API; model `claude-sonnet-5` (config default).
- Sessions: the reference in-memory `SessionStore`; the request dependency writes the record back
  at request end and `stream_turn` at stream end. One worker only (sessions, carts, credit
  applications, and the `ChangeLedger` live in process memory). TODO: the real session store.
- Posture: single store (Quasar sells its own flights and products).
- Language and currency: fixtures, brand voice, and UI in Spanish; USD.
- Memory: on (`enable_memory`), retention and blocked patterns at their defaults.
- Credentials: none in code or fixtures; `ANTHROPIC_API_KEY` from `.env` via `load_demo_env`.

### Shopping agent (storefront)

- Identity: two fixed development principals chosen by the storefront's profile switcher at
  session start: `demo-user` (Valentina Ríos, holds the Quasar Visa Gold) and `demo-user-2`
  (Mateo Salazar, no card: the credit-application path). After session start requests carry
  the session id alone. TODO: real customer authentication replaces the switcher. Clock: the
  server's.
- Backend: `MockQuasar(StorefrontBackend)` in `airline/api/mock_quasar.py`, fixture-backed
  (`data/catalog.json`, `users.json`, `orders.json`, `policies.json`, `memory-seed.json`).
  Every system is fixture-backed: catalog and search, cart, orders (bookings), profile, policy
  content, fulfillment (e-ticket, card delivery). `get_account_context` returns loyalty
  (miles), the held card, and the credit application state; `get_disclosure` authors the facts
  box for card tiers, Quasar Pay, insurance, and each fare.
- Catalog shape (`docs/backends.md`): each flight (route + departure) is a family whose
  variants are the cabins `economy`, `premium`, `business` (option `cabin`), ids
  `QA-0412` / `QA-0412-ECO|PRE|BUS`; a cabin's stock is its seats left, and a sold-out cabin
  raises `Unavailable` naming its siblings. The card `QA-CARD-100` is a family of three tiers
  (option `tier`: `classic`, `gold`, `platinum`); its price is the annual fee. Miles packs,
  insurance, seat selection, and Quasar Pay are families too; other ancillaries are single
  products. Largest family: 3 variants. A fare is per passenger, one way, for that departure,
  stated in `attributes` (`origin`, `destination`, `travel_date`, `departure_time`).
- Fixture dates are static (flights in October-November 2026, orders not re-dated) so the
  upcoming booking stays aligned with its flight. Seats left per cabin come from
  `merchant_inventory.json` and are mirrored into the catalog's `seats_left`/`in_stock`.
  Catalog and policy search fold accents (the shared tokenizer keeps only a-z and 0-9).
- A cardholder's upcoming trip paid with the card lists the card's travel benefits in the
  account context (Valentina's Gold includes one checked bag).
- `domain_search_notes`: "Flights are dated: when the customer names them, pass the IATA codes
  as attributes.origin and attributes.destination and the departure date as
  attributes.travel_date (YYYY-MM-DD); results are the departures within three days of that
  date. A fare is per passenger, one way. Card tiers, miles packs, insurance, Quasar Pay and
  ancillaries are not dated."
- Lexicon additions (Spanish and English): `policy_intent_terms` += baggage, changes and
  refunds, check-in, miles, annual fee, interest/APR, installments, insurance and coverage,
  application requirements, right of withdrawal, lounge, pets; `policy_intent_cues` += Spanish
  question words; `order_intent_terms` += reserva, booking, PNR, itinerary, boarding pass;
  `order_intent_cues` += Spanish status words. `product_id_patterns` keep the defaults, which
  match `QA-0412`, `QA-0412-ECO`, and `QA-ANC-101`. Exact tuples in `airline/api/agent_config.py`.
- Credit application (card for a customer without one), scenario A, no external model:
  1. The agent calls `present_card_application`; the card renders a form prefilled from the
     profile, editable, with consent.
  2. The form posts to `POST /api/card-application` (host route; the applicant's data never
     passes through the model or a tool argument). The backend validates, runs the
     deterministic scorecard (`airline/api/credit.py`, `ScorecardEngine` behind the
     `CreditEngine` protocol), and stores the `CreditAssessment` on the session.
  3. The host queues an app event; the storefront sends the follow-up turn itself.
  4. The agent reads the decision from `get_account_context` and shows `present_credit_decision`,
     the tier comparison, and `present_disclosure`.
  5. `add_to_cart` of a tier the assessment did not approve raises `Unavailable`: approval is
     enforced in the backend, never by the model. `checkout` hands off to "sign and activate"
     (stub, TODO); nothing issues a card or places an order.
  Scorecard: knock-outs (under 18, more than 2 delinquencies in 24 months, debt-to-income over
  45 %); points from bureau band, debt-to-income, employment tenure, utilization; under 580
  declined, 580-649 manual review, 650-699 Classic, 700-749 Classic and Gold, 750+ all three,
  each tier also needing its minimum monthly income ($1,200 / $2,500 / $5,000);
  recommendation among approved tiers by travel profile. Protected attributes (gender,
  nationality, marital status) are never collected; age only feeds the 18+ rule. Each new
  submission replaces the session's assessment. A future Jev (typesafe.ai) path plugs into
  `CreditEngine`; the scorecard stays as the fallback.
- Surfaces: storefront web, renderer mode `components`. Component table:

  | Component (tool) | Card |
  |---|---|
  | product results, details, comparison, cart, checkout, order status, suggestions | the telecom storefront's existing cards, re-labelled |
  | `present_plan_comparison` (`plan_matrix`) | `PlanMatrix`, adapted: cabins, card tiers, insurance |
  | `present_disclosure` | `FactsBox` |
  | `present_card_application` (`card_application`) | new: `CardApplication` form |
  | `present_credit_decision` (`credit_decision`) | new: `CreditDecision` |

  Checkout handoff: the host's own checkout route, a stub with a TODO.
- v1 index: `search-discovery`, `purchase-research`, `planning-goals`, `customer-care`.
  `memory-personalization` is copied and parked under `skills/shopping/_staged/` until a real
  principal exists.
- Gates: fencing, provenance, cart caps, grounding, and the prompt-stability test come with the
  imported executor and runtime and stay on (commerce-trust-safety). The approved-tier gate is
  in `MockQuasar.add_to_cart`.

### Merchant agent (portal)

- Identity: fixed development operator `quasar-ops` (operator "Laura"), TODO real auth.
- Backend: `MockQuasarMerchant(MerchantBackend)` in `airline/api/mock_merchant.py` over the same
  `MockQuasar`, fixture-backed (`data/merchant_metrics.json`, `merchant_portfolio.json`,
  `merchant_inventory.json`, `merchant_campaigns.json`, `merchant_messages.json`).
  - Metrics (90 daily rows): ticket, ancillary, and fintech revenue; bookings, searches,
    passengers, seats (load factor), ancillary orders (attach rate, ancillary revenue per
    passenger), card applications, approvals, active cards, miles sold. Every figure the
    prototype needs exists in the fixtures; none is returned as `None`.
  - Portfolio (`present_portfolio_mix`, component `plan_mix`): card tiers and insurance plans
    with active base, share, monthly cancellation, revenue and cost per account, weekly trend.
  - Inventory: seats per flight cabin. Alerts: `low_stock` when a cabin is nearly full,
    `slow_mover` when it will not fill before departure at its current pace. Seat capacity is
    fixed: restocks raise `ChangeNotApplicable`.
  - Pricing: fares per cabin and ancillary prices, with date-window promotions. Card, Quasar
    Pay, and insurance pricing is regulated and set outside the portal: price updates and
    promotions on them raise `ChangeNotApplicable`.
  - `query_metrics` serves the names in `METRICS` (`mock_merchant.py`, also listed in the
    merchant context) and refuses an unknown name instead of guessing.
  - Campaigns by cohort; order issues from customer messages.
  - Analysis delegate off.
- Guardrails: `protected_fields` += the regulated card and financing terms (APR, installment
  rate, late fee, airport taxes); per-change caps at the config defaults.
- Approval: `require_host_approval=True`; `approval_surface` = the Approve button on the change
  preview card in the portal. Host code sets the approval mark (`change_action`); a chat
  approval alone applies nothing. `apply_change` writes the fixture state the storefront reads.
- Lexicon additions: `metrics_intent_terms` += load factor, occupancy, ancillary, attach,
  revenue per passenger, active cards, applications, approvals, cancellations, miles sold,
  passengers, bookings, searches (Spanish and English); `change_intent_terms` += Spanish verbs.
- v1 index: the five merchant flows, copied and indexed.

### Assumptions taken for skipped questions

Fixed development principals; in-memory sessions and one worker; server clock; the Anthropic
API; checkout handoff as a stub; USD.

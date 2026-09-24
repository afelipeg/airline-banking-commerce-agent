# Quasar Airlines (airline + fintech)

Both agents over one fictional airline catalog. The storefront searches dated flights and
compares cabins, sells ancillaries, miles, insurance, and Quasar Pay installments, and takes a
customer without a card through the Quasar Visa application: the form posts to the host, a
deterministic scorecard decides, and the agent presents the decision and adds only an approved
tier. The portal reads network, ancillary, and fintech metrics, the card and insurance
portfolio, and seats per cabin; it stages fare moves, promotions, and campaigns and applies
them from the preview card.

## Run

```bash
.venv/bin/uvicorn airline.api.main:app --app-dir . --reload --port 8000   # API
npm run dev -w airline/storefront-web                                    # :3000
npm run dev -w airline/merchant-web                                      # :3100
```

Chat needs `ANTHROPIC_API_KEY` in the project-root `.env`; browsing the catalog and the
portal's widgets do not. `MERCHANT_REQUIRE_HOST_APPROVAL=0` lets a chat approval apply a
change; by default the preview card's Approve button applies it.

## Try

Storefront as Mateo (no card):

1. Quiero volar de Bogotá a Madrid alrededor del 22 de octubre. ¿Qué opciones hay y qué diferencia hay entre economy y premium?
2. ¿Me conviene una tarjeta Quasar para pagar este viaje en cuotas?
3. (Submit the form.) Then: Quiero la Gold.
4. Edit the income on the form to 1,500 and resubmit to show a declined decision; 6,500 with 12 trips a year to show Platinum.

Storefront as Valentina (Gold cardholder):

1. Tengo reserva a Miami el 16 de octubre. Agrégame una maleta y el embarque prioritario.
2. ¿Qué gano si paso a la Platinum?

Portal:

1. ¿Cómo va el attach de ancillaries las últimas dos semanas y qué ruta lo está arrastrando?
2. ¿Qué cabinas están casi llenas y cuáles no se van a llenar antes de salir? Propón movimientos de tarifa.
3. Prepara un 12 % de descuento en economy del vuelo a Lima para las próximas dos semanas.
4. Muéstrame el portafolio de tarjetas: ¿dónde están subiendo las cancelaciones?
5. Sube la tasa de la tarjeta Classic. (Refused: regulated pricing.)

## What is specific to this vertical

- `api/mock_quasar.py`: `MockQuasar`, the `StorefrontBackend`. Flights are families with cabin
  variants; a dated search filters by route and a three-day window. Account context: miles, the
  card held, the credit application. Disclosures for card tiers, Quasar Pay (installments priced
  on an example purchase), insurance, and fares. `add_to_cart` accepts a card tier only when the
  session's assessment (or a cardholder's pre-approval) allows it.
- `api/credit.py`: the application, bureau record, and assessment models; `ScorecardEngine`
  behind the `CreditEngine` protocol.
- `api/card_flow.py`: `present_card_application` and `present_credit_decision`.
- `api/comparison.py`: `present_plan_comparison` for cabins, card tiers, insurance, miles.
- `api/mock_merchant.py`: `MockQuasarMerchant`, the `MerchantBackend`. Seats per cabin drive
  the alerts; card, Quasar Pay, and insurance pricing is refused as regulated.
- `api/portfolio_mix.py`: `present_portfolio_mix` over the card and insurance portfolio.
- `api/main.py`: the host, `/api/account`, `/api/cart/add`, and `/api/card-application`.
- `data/`: catalog, users, orders, policies, memory seed, `accounts.json` (loyalty, cards,
  bureau files, application drafts), and the `merchant_*.json` operations fixtures.

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

## Batería de demo

Prompts validados contra el modelo real (`claude-sonnet-5`). Úsalos tal cual, en orden.
La columna "Resultado garantizado" es lo que fija el backend o los fixtures (decisiones,
cifras, rechazos) y se repite en cada corrida; la redacción del agente cambia entre corridas.

**Antes de presentar:** reinicia el API. La memoria del agente, las sesiones, los carritos y
los cambios aprobados en el portal viven en memoria del proceso; sin reiniciar, el agente
puede "recordar" una aprobación de un ensayo anterior.

```bash
.venv/bin/uvicorn airline.api.main:app --app-dir . --port 8000
```

### Guion A · Storefront como Mateo (sin tarjeta)

Selecciona "Mateo Salazar" en el selector de perfil. Una sola sesión, en orden:

| # | Prompt | Resultado garantizado |
|---|---|---|
| A1 | Busca vuelos de Bogotá a Madrid el 22 de octubre y compárame economy con premium. | Vuelo QA 615 (21:30, directo). Matriz Economy $689 vs Premium $1,190 con maletas, cambios, millas y sillas. La recomendación entre las dos es criterio del agente y puede variar. |
| A2 | Quiero solicitar la tarjeta Quasar. | Formulario de solicitud prellenado (ingreso $3,200, obligaciones $700, 4 viajes al año). |
| A3 | Marca las dos casillas y pulsa **Enviar solicitud** (sin escribir nada). | El chat envía solo "Listo, envié mi solicitud…". Tarjeta de decisión: **aprobada, puntaje 780, cupo $8,000**, Classic y Gold aprobadas, **Gold recomendada**, Platinum "no disponible" (ingreso bajo el mínimo de $5,000). |
| A4 | Antes de decidir, muéstrame las condiciones de la Gold: tasa, cuota de manejo y costos. | Cuadro de condiciones: cuota de manejo $99/año, tasa 29.9 % EA, hasta 6 cuotas sin interés. |
| A5 | Quiero la Gold | Tarjeta Gold en el carrito ($99). |
| A6 | Agrega también la Platinum | Rechazo: la evaluación no aprobó Platinum. El carrito no cambia. |

Variantes del formulario (A3): pulsa "Editar y enviar de nuevo", cambia los campos y envía.
Cada envío reemplaza la decisión anterior.

| Cambio en el formulario | Resultado garantizado |
|---|---|
| Ingreso mensual 1500 | **No aprobada**: obligaciones del 47 % del ingreso (máximo 45 %). |
| Ingreso mensual 6500 y viajes al año 12 | **Aprobada**: las tres tarjetas; **Platinum recomendada**. |
| Meses en su actividad 3 y obligaciones 1400 | **En revisión** manual (2 días hábiles). |
| Año de nacimiento 2010 | **No aprobada**: debe ser mayor de 18 años. |

### Guion B · Storefront como Valentina (tiene la Gold)

Selecciona "Valentina Ríos". Una sola sesión, en orden:

| # | Prompt | Resultado garantizado |
|---|---|---|
| B1 | ¿Cuándo sale mi próximo vuelo? | Reserva QA-59120: QA 412 Bogotá → Miami, 16 de octubre, Economy. |
| B2 | ¿Tengo maleta incluida en mi vuelo a Miami? Agrégame solo el embarque prioritario. | Sí: 1 maleta incluida por pagar con la Gold. Carrito: solo embarque prioritario ($20). |
| B3 | ¿Qué gano si paso a la Platinum? | Matriz Gold vs Platinum con la Gold marcada como "tu tarjeta actual"; menciona el upgrade pre-aprobado. |
| B4 | Pásame a la Platinum. | Platinum en el carrito ($249), sin formulario. |
| B5 | Quiero también la Gold. | Rechazo: ya tiene la Gold. |

### Prompts sueltos del storefront (cualquier perfil, sesión nueva)

| Prompt | Resultado garantizado |
|---|---|
| Quiero business en el vuelo de las 18:45 de Bogotá a Miami del 16 de octubre. | Business del QA 418 agotada; ofrece Premium del mismo vuelo o Business del QA 412 (07:10). |
| ¿Cuánto equipaje puedo llevar en economy? | Desde la política: maleta de mano de 10 kg; maleta documentada de 23 kg por $45 por trayecto. |

### Guion C · Portal de operaciones (Laura)

Abre el panel del asistente en el portal. Una sola sesión, en orden:

| # | Prompt | Resultado garantizado |
|---|---|---|
| C1 | ¿Cómo va el attach de ancillaries en las últimas dos semanas? | Tarjeta de métricas: attach de ~40 % a 36.6 %, con ventas planas. |
| C2 | ¿Qué cabinas están casi llenas y cuáles no se van a llenar antes de salir? | Casi llenas: QA 418 Business (agotada), QA 615 Business (2 sillas), QA 412 Premium (3). No se llenan: QA 507 a Lima, Economy y Premium. También Quasar Protect Básico (base encogiéndose). |
| C3 | Prepara un 12 % de descuento en economy del vuelo a Lima por dos semanas desde mañana. | Tarjeta de vista previa del cambio: $219 → $192.72, con ventana de fechas e impacto en margen. |
| C4 | Apruébalo. | No aplica nada: indica el botón Aprobar de la tarjeta. Pulsa **Aprobar** en la tarjeta para aplicarlo. |
| C5 | Sube la tasa de la tarjeta Classic a 33,9 %. | Rechazo: la tasa la fija el banco emisor; ofrece campañas o contenido. |
| C6 | Muéstrame el portafolio de tarjetas y seguros. | Panel de portafolio: Classic con cancelación subiendo a 1.9 %, Platinum con el mayor ingreso por cuenta, Protect Básico en 3.8 %. |
| C7 | Baja la tarifa business del vuelo a Madrid a 1.500 dólares. | Rechazo: supera el tope de 20 % por cambio (nada por debajo de $2,312); ofrece alternativas. |
| C8 | ¿Cómo va la campaña de captación de la tarjeta? | QC-801: $21.4k gastados, $104.8k atribuidos, retorno ~4.9x. |

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

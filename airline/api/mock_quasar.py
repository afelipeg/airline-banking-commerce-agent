"""Quasar Airlines' ``StorefrontBackend`` over the fixtures in ``data/``. Flights are families
whose variants are the cabins (a cabin's ``seats_left`` is its stock); ancillaries, the
Quasar Visa card tiers, miles packs, insurance, and Quasar Pay are ordinary products and
families. On top of the interface it computes the account context (miles, the card held,
the credit application), authors the disclosures, and holds the card-application flow:
the form posts to the host, ``submit_card_application`` runs the credit engine, and
``add_to_cart`` accepts only a card tier the assessment approved.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from shopping_agent import (
    Cart,
    Disclosure,
    DisclosureRow,
    FulfillmentOption,
    Order,
    Policy,
    Product,
    ProductDetails,
    SearchFilters,
    ShoppingSessionContext,
    StorefrontBackend,
    Unavailable,
    UserPreferences,
)

from demo_common.storefront_fixtures import (
    SessionCarts,
    example_data_dir,
    find_order,
    find_product,
    keyword_score,
    load_catalog,
    load_json,
    load_orders,
    load_policies,
    load_users,
    matches_attribute_filters,
    newest_orders,
    orders_for,
    preferences_of,
    rank_products,
    search_help,
    summary_of,
    unavailable_detail,
    within_price_and_rating,
)

from .credit import (
    TIERS,
    BureauRecord,
    CardApplication,
    CreditAssessment,
    CreditEngine,
    ScorecardEngine,
)

DATA_DIR = example_data_dir(__file__)

CARD_FAMILY_ID = "QA-CARD-100"
# At most one line per cart in each of these categories: adding another replaces it.
_SINGLE_LINE_CATEGORIES = {"card", "financing"}
# A dated search returns the departures within this many days of the requested date.
_DATE_WINDOW_DAYS = 3
# The example purchase the Quasar Pay disclosure prices its installments on.
_INSTALLMENT_EXAMPLE_USD = 600.0

_SEARCH_WEIGHTS = {
    "title": 3.0,
    "brand": 1.0,
    "category": 2.5,
    "attributes": 1.5,
    "description": 1.0,
}
# Spanish and English phrasing mapped onto catalog vocabulary, so natural demo queries
# land without a real search engine.
_SYNONYMS: dict[str, list[str]] = {
    "vuelo": ["flights", "directo"],
    "vuelos": ["flights", "directo"],
    "flight": ["flights"],
    "tiquete": ["flights"],
    "tiquetes": ["flights"],
    "pasaje": ["flights"],
    "pasajes": ["flights"],
    "boleto": ["flights"],
    "miami": ["mia"],
    "madrid": ["mad"],
    "bogota": ["bog"],
    "medellin": ["mde"],
    "cancun": ["cun"],
    "lima": ["lim"],
    "nueva": ["jfk"],
    "york": ["jfk"],
    "maleta": ["equipaje", "ancillaries"],
    "maletas": ["equipaje", "ancillaries"],
    "equipaje": ["maleta"],
    "bag": ["maleta"],
    "baggage": ["maleta"],
    "asiento": ["asiento", "ancillaries"],
    "silla": ["asiento"],
    "seat": ["asiento"],
    "sala": ["lounge"],
    "vip": ["lounge"],
    "wifi": ["wi-fi"],
    "internet": ["wi-fi"],
    "perro": ["mascota"],
    "gato": ["mascota"],
    "pet": ["mascota"],
    "tarjeta": ["card", "visa"],
    "credito": ["card", "visa"],
    "card": ["tarjeta"],
    "millas": ["miles"],
    "miles": ["millas"],
    "seguro": ["insurance", "protect"],
    "insurance": ["seguro", "protect"],
    "asistencia": ["insurance", "protect"],
    "cuotas": ["financing", "pay"],
    "installments": ["financing", "pay"],
    "financiar": ["financing", "pay"],
    "financiacion": ["financing", "pay"],
    "prioritario": ["prioritario", "embarque"],
    "priority": ["prioritario"],
    "upgrade": ["premium", "business"],
    "ejecutiva": ["business"],
}

# Human labels for the category and option values the context and disclosures quote.
_TIER_LABELS = {"classic": "Classic", "gold": "Gold", "platinum": "Platinum"}


def _tier_of(product: Product) -> str | None:
    return product.option_values.get("tier") or product.attributes.get("tier")


def _fold(text: str) -> str:
    """Lowercase without accents: the shared tokenizer keeps only a-z and 0-9, so
    "Bogotá" and "bogota" must meet here to match."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def _iata(value: str) -> str:
    return value.strip().upper()


def _travel_date(filters: SearchFilters) -> date | None:
    raw = str(filters.attributes.get("travel_date", "")).strip()
    try:
        return date.fromisoformat(raw[:10]) if raw else None
    except ValueError:
        return None


def _monthly_payment(principal: float, annual_effective_pct: float, months: int) -> float:
    """The fixed installment for ``principal`` over ``months`` at an effective annual rate."""
    if annual_effective_pct <= 0:
        return round(principal / months, 2)
    rate = math.pow(1 + annual_effective_pct / 100, 1 / 12) - 1
    return round(principal * rate / (1 - math.pow(1 + rate, -months)), 2)


class CardHeld(Exception):
    """Raised by ``submit_card_application`` for a customer who already holds a card."""


@dataclass
class ApplicationRecord:
    application: CardApplication
    assessment: CreditAssessment


class MockQuasar(StorefrontBackend):
    def __init__(self, data_dir: Path = DATA_DIR, engine: CreditEngine | None = None) -> None:
        catalog, self.products, self.variants = load_catalog(data_dir)
        self.store_name: str = catalog.get("store_name", "Quasar Airlines")
        self._users = load_users(data_dir)
        self._orders = load_orders(data_dir)
        self._policies = load_policies(data_dir)
        # Accent-folded copies for search; results map back to the authored policies.
        self._folded_policies = [
            policy.model_copy(
                update={"title": _fold(policy.title), "content": _fold(policy.content)}
            )
            for policy in self._policies
        ]
        self._carts = SessionCarts()
        self._accounts: dict[str, dict[str, Any]] = load_json(data_dir, "accounts.json")["accounts"]
        self.engine: CreditEngine = engine or ScorecardEngine()
        # One credit application per session: each submission replaces the last, so a
        # presenter can show several outcomes in one session.
        self._applications: dict[str, ApplicationRecord] = {}

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    def _searchable_text(self, product: ProductDetails) -> dict[str, str]:
        fields = {
            "title": product.title,
            "brand": product.brand or "",
            "category": product.category or "",
            "attributes": " ".join(f"{k} {v}" for k, v in product.attributes.items()),
            "description": f"{product.short_description or ''} {product.long_description or ''}",
        }
        return {name: _fold(text) for name, text in fields.items()}

    def _score(self, product: ProductDetails, query_tokens: list[str]) -> float:
        return keyword_score(
            self._searchable_text(product), _SEARCH_WEIGHTS, query_tokens, _SYNONYMS
        )

    @staticmethod
    def _hard_filter(product: ProductDetails, filters: SearchFilters) -> bool:
        """Price and rating, plus the route and date for flights: origin and destination
        match the IATA code or the city, and a dated search keeps the departures within
        the window. Products that are not flights are not dated."""
        if not within_price_and_rating(product, filters):
            return False
        if product.category != "flights":
            return True
        attrs = product.attributes
        for key, city_key in (("origin", "origin_city"), ("destination", "destination_city")):
            wanted = str(filters.attributes.get(key, "")).strip()
            if not wanted:
                continue
            if _iata(wanted) != attrs.get(key, "").upper() and _fold(wanted) not in _fold(
                attrs.get(city_key, "")
            ):
                return False
        wanted_date = _travel_date(filters)
        if wanted_date is not None:
            try:
                departs = date.fromisoformat(attrs.get("travel_date", ""))
            except ValueError:
                return False
            if abs((departs - wanted_date).days) > _DATE_WINDOW_DAYS:
                return False
        return True

    @staticmethod
    def _soft_filter(product: ProductDetails, filters: SearchFilters) -> bool:
        return matches_attribute_filters(
            product, filters, ignore=frozenset({"origin", "destination", "travel_date"})
        )

    async def search_products(
        self,
        session: ShoppingSessionContext,
        query: str,
        filters: SearchFilters | None = None,
        limit: int = 8,
    ) -> list[Product]:
        del session
        ranked = rank_products(
            self.products.values(),
            _fold(query),
            filters,
            limit,
            score=self._score,
            hard_filter=self._hard_filter,
            soft_filter=self._soft_filter,
        )
        return [summary_of(product) for product in ranked]

    def product(self, product_id: str) -> ProductDetails | None:
        return find_product(self.products, self.variants, product_id)

    async def get_product_details(
        self, session: ShoppingSessionContext, product_id: str
    ) -> ProductDetails | None:
        """A flight family carries its three cabins as variants (option ``cabin``); a
        cabin's ``seats_left`` attribute is its stock and a sold-out cabin is
        ``in_stock: false``. The card family's variants are its tiers (option ``tier``)."""
        del session
        return self.product(product_id)

    # ------------------------------------------------------------------
    # Cart
    # ------------------------------------------------------------------

    async def get_cart(self, session: ShoppingSessionContext) -> Cart:
        return self._carts.cart(session.session_id)

    def _category_of(self, product_id: str) -> str:
        product = self.product(product_id)
        return (product.category or "") if product else ""

    def approved_card_tiers(self, session: ShoppingSessionContext) -> list[str]:
        """The tiers this customer may add: a pre-approved upgrade for a cardholder, or
        what this session's assessment approved."""
        account = self._accounts.get(session.user_id) or {}
        if account.get("card"):
            return list(account.get("preapproved_upgrade") or [])
        record = self._applications.get(session.session_id)
        if record is None or record.assessment.decision != "approved":
            return []
        return list(record.assessment.approved_tiers)

    def _check_card_tier(self, session: ShoppingSessionContext, product: Product) -> None:
        tier = _tier_of(product) or ""
        held = (self._accounts.get(session.user_id) or {}).get("card")
        if held and held.get("tier") == tier:
            raise Unavailable(f"{product.product_id}: the customer already holds this card tier")
        approved = self.approved_card_tiers(session)
        if tier in approved:
            return
        if held:
            raise Unavailable(
                f"{product.product_id}: not an upgrade this cardholder is pre-approved for; "
                f"pre-approved tiers: {', '.join(approved) or 'none'}"
            )
        record = self._applications.get(session.session_id)
        if record is None:
            raise Unavailable(
                f"{product.product_id}: requires an approved credit application; show "
                "present_card_application so the customer can apply first"
            )
        raise Unavailable(
            f"{product.product_id}: not approved by this session's credit assessment "
            f"(decision {record.assessment.decision}); approved tiers: "
            f"{', '.join(record.assessment.approved_tiers) or 'none'}"
        )

    async def add_to_cart(
        self, session: ShoppingSessionContext, product_id: str, quantity: int
    ) -> Cart:
        product = self.product(product_id)
        if product is None or product.has_options:
            raise KeyError(product_id)
        if not product.in_stock:
            family = self.product(product.variant_of) if product.variant_of else None
            raise Unavailable(unavailable_detail(product, family))
        if product.category == "card":
            self._check_card_tier(session, product)
        lines = self._carts.lines(session.session_id)
        if product.category in _SINGLE_LINE_CATEGORIES:
            for other in [pid for pid in lines if self._category_of(pid) == product.category]:
                lines.pop(other)
            quantity = 1
        elif existing := lines.get(product_id):
            quantity += existing.quantity
        return self._carts.put(session.session_id, product, quantity)

    async def update_cart_item(
        self, session: ShoppingSessionContext, product_id: str, quantity: int
    ) -> Cart:
        if self._category_of(product_id) in _SINGLE_LINE_CATEGORIES:
            quantity = min(quantity, 1)
        return self._carts.set_quantity(session.session_id, product_id, quantity)

    async def remove_from_cart(self, session: ShoppingSessionContext, product_id: str) -> Cart:
        return self._carts.remove(session.session_id, product_id)

    def reset_session(self, session_id: str) -> None:
        self._carts.reset(session_id)
        self._applications.pop(session_id, None)

    # ------------------------------------------------------------------
    # Credit application
    # ------------------------------------------------------------------

    def holds_card(self, user_id: str) -> bool:
        return bool((self._accounts.get(user_id) or {}).get("card"))

    def application_prefill(self, session: ShoppingSessionContext) -> dict[str, Any]:
        """The form's starting values: this session's last submission, else the draft the
        profile holds."""
        record = self._applications.get(session.session_id)
        if record is not None:
            return record.application.model_dump(mode="json")
        draft = (self._accounts.get(session.user_id) or {}).get("application_draft") or {}
        return CardApplication.model_validate(draft).model_dump(mode="json") if draft else {}

    def assessment_for(self, session: ShoppingSessionContext) -> CreditAssessment | None:
        record = self._applications.get(session.session_id)
        return record.assessment if record else None

    async def submit_card_application(
        self, session: ShoppingSessionContext, application: CardApplication
    ) -> CreditAssessment:
        """Run the credit engine on a submitted form and keep the result on the session.
        Called by the host route, never by a tool."""
        if self.holds_card(session.user_id):
            raise CardHeld(session.user_id)
        account = self._accounts.get(session.user_id) or {}
        bureau = BureauRecord.model_validate(
            account.get("bureau")
            or {
                "score_band": "thin",
                "delinquencies_24m": 0,
                "utilization_pct": 0,
                "open_credit_lines": 0,
            }
        )
        today = session.now.date() if session.now else date.today()
        assessment = await self.engine.assess(application, bureau, today=today)
        self._applications[session.session_id] = ApplicationRecord(application, assessment)
        # A new decision replaces any card line the previous one allowed.
        lines = self._carts.lines(session.session_id)
        for pid in [pid for pid in lines if self._category_of(pid) == "card"]:
            lines.pop(pid)
        return assessment

    def card_variant(self, tier: str) -> Product | None:
        family = self.products.get(CARD_FAMILY_ID)
        if family is None:
            return None
        return next((v for v in family.variants if _tier_of(v) == tier), None)

    # ------------------------------------------------------------------
    # Customer, account, orders, help content, fulfillment
    # ------------------------------------------------------------------

    async def get_preferences(self, session: ShoppingSessionContext) -> UserPreferences:
        return preferences_of(self._users, session.user_id)

    def _upcoming_trip(self, user_id: str) -> dict[str, Any] | None:
        for order in orders_for(self._orders, user_id, 20):
            if order.status.value != "processing":
                continue
            for item in order.items:
                product = self.product(item.product_id)
                family = (
                    self.product(product.variant_of) if product and product.variant_of else product
                )
                if family is not None and family.category == "flights":
                    return {
                        "order_id": order.order_id,
                        "title": family.title,
                        "travel_date": family.attributes.get("travel_date"),
                        "cabin": product.option_values.get("cabin") if product else None,
                        "booked_extras": [
                            line.title for line in order.items if line.product_id != item.product_id
                        ],
                    }
        return None

    def _card_benefits(self, card: dict[str, Any]) -> list[str]:
        """The travel benefits the held card adds to a trip paid with it."""
        variant = self.product(card["product_id"])
        attrs = variant.attributes if variant else {}
        benefits = []
        bag = attrs.get("free_checked_bag", "no")
        if bag and bag != "no":
            benefits.append(f"Maleta documentada gratis: {bag}")
        lounge = attrs.get("lounge_visits", "0")
        if lounge and lounge != "0":
            benefits.append(f"Sala VIP: {lounge}")
        insurance = attrs.get("travel_insurance_included", "no")
        if insurance and insurance != "no":
            benefits.append(f"Seguro de viaje incluido: {insurance}")
        return benefits

    def _held_card(self, account: dict[str, Any]) -> dict[str, Any] | None:
        card = account.get("card")
        if not card:
            return None
        variant = self.product(card["product_id"])
        attrs = variant.attributes if variant else {}
        return {
            "product_id": card["product_id"],
            "tier": card["tier"],
            "name": card_title(card["tier"]),
            "credit_limit_usd": card["credit_limit_usd"],
            "available_usd": card["available_usd"],
            "interest_free_installments": int(attrs.get("interest_free_installments", "0") or 0),
            "miles_per_usd": attrs.get("miles_per_usd"),
        }

    async def get_account_context(self, session: ShoppingSessionContext) -> dict[str, Any] | None:
        """Loyalty, the card held (or the credit application and its decision), and the
        next trip. Sent on every request; the decision here is the only one the agent may
        present."""
        account = self._accounts.get(session.user_id)
        if account is None:
            return None
        card = self._held_card(account)
        record = self._applications.get(session.session_id)
        if card is not None:
            application: dict[str, Any] = {"status": "not_applicable", "assessment": None}
        elif record is None:
            application = {"status": "not_started", "assessment": None}
        else:
            application = {
                "status": "decided",
                "assessment": record.assessment.model_dump(mode="json"),
            }
        context: dict[str, Any] = {
            "loyalty": dict(account.get("loyalty") or {}),
            "card": card,
            "card_application": application,
            "upcoming_trip": self._upcoming_trip(session.user_id),
        }
        if card is not None:
            context["card_upgrade_preapproved"] = list(account.get("preapproved_upgrade") or [])
            context["card_upgrade_how"] = (
                "a pre-approved tier is added with add_to_cart (QA-CARD-100-<TIER>); no "
                "application form is needed"
            )
            trip = context["upcoming_trip"]
            if trip is not None and account.get("upcoming_trip_paid_with_card"):
                # Card travel benefits apply when the ticket is paid with the card.
                trip["paid_with"] = card["name"]
                trip["card_benefits"] = self._card_benefits(card)
        return context

    # ------------------------------------------------------------------
    # Disclosures
    # ------------------------------------------------------------------

    async def get_disclosure(
        self, session: ShoppingSessionContext, product_id: str
    ) -> Disclosure | None:
        """The facts box for a card tier, a Quasar Pay plan, an insurance plan, or a
        flight cabin, authored from the catalog record; other products have none."""
        del session
        product = self.product(product_id)
        if product is None:
            return None
        family = self.product(product.variant_of) if product.variant_of else None
        category = product.category or (family.category if family else None)
        if product.has_options:
            return None  # a disclosure describes one purchasable record
        if category == "card":
            return self._card_disclosure(product)
        if category == "financing":
            return self._financing_disclosure(product)
        if category == "insurance":
            return self._insurance_disclosure(product)
        if category == "flights" and family is not None:
            return self._fare_disclosure(product, family)
        return None

    def _card_disclosure(self, product: Product) -> Disclosure:
        a = product.attributes
        return Disclosure(
            title=f"{card_title(_tier_of(product) or '')}: condiciones",
            product_id=product.product_id,
            rows=[
                DisclosureRow(label="Cuota de manejo", value=f"${product.price:,.0f} al año"),
                DisclosureRow(
                    label="Tasa de interés (EA)",
                    value=f"{a.get('apr_pct', '—')} %",
                    note="sobre saldos diferidos; fijada por Banco Andino Digital",
                ),
                DisclosureRow(
                    label="Cuotas sin interés",
                    value=f"hasta {a.get('interest_free_installments', '—')} en vuelos Quasar",
                ),
                DisclosureRow(
                    label="Cupo",
                    value=f"${a.get('credit_limit_range_usd', '—')}",
                    note="según evaluación",
                ),
                DisclosureRow(
                    label="Ingreso mínimo", value=f"${a.get('min_monthly_income_usd', '—')} al mes"
                ),
                DisclosureRow(label="Cargo por mora", value=f"${a.get('late_fee_usd', '—')}"),
                DisclosureRow(
                    label="Comisión por compras internacionales",
                    value=f"{a.get('foreign_transaction_fee_pct', '—')} %",
                ),
                DisclosureRow(label="Millas por dólar", value=a.get("miles_per_usd", "—")),
                DisclosureRow(
                    label="Bono de bienvenida", value=f"{a.get('welcome_bonus_miles', '—')} millas"
                ),
            ],
            sources=["quasar-card-rates-fees", "quasar-card-benefits", "card-application-process"],
            footnotes=[
                "Emisor: Banco Andino Digital. La aprobación y el cupo dependen de la evaluación de crédito.",
                "Retracto: 5 días hábiles desde la activación si la tarjeta no se ha usado.",
            ],
        )

    def _financing_disclosure(self, product: Product) -> Disclosure:
        a = product.attributes
        months = int(a.get("installments", "0") or 0) or 1
        raw_rate = a.get("interest_rate_ea_pct", "0")
        # "0 con tarjeta Quasar · 18.9 otros medios": the card rate first, then the rest.
        numbers = [float(part) for part in raw_rate.replace("·", " ").split() if _is_number(part)]
        card_rate = numbers[0] if numbers else 0.0
        other_rate = numbers[1] if len(numbers) > 1 else card_rate
        principal = _INSTALLMENT_EXAMPLE_USD
        rows = [
            DisclosureRow(label="Número de cuotas", value=str(months)),
            DisclosureRow(
                label="Tasa efectiva anual", value=raw_rate if "·" in raw_rate else f"{raw_rate} %"
            ),
            DisclosureRow(label="Costo de apertura", value=f"${a.get('setup_fee_usd', '0')}"),
            DisclosureRow(label="Compras elegibles", value=a.get("eligible_purchases", "—")),
        ]
        card_payment = _monthly_payment(principal, card_rate, months)
        rows.append(
            DisclosureRow(
                label=f"Ejemplo: ${principal:,.0f} en {months} cuotas",
                value=f"${card_payment:,.2f}/mes · total ${card_payment * months:,.2f}",
                note="con tarjeta Quasar" if other_rate != card_rate else None,
            )
        )
        if other_rate != card_rate:
            other_payment = _monthly_payment(principal, other_rate, months)
            rows.append(
                DisclosureRow(
                    label=f"Ejemplo: ${principal:,.0f} en {months} cuotas",
                    value=f"${other_payment:,.2f}/mes · total ${other_payment * months:,.2f}",
                    note="con otros medios de pago",
                )
            )
        return Disclosure(
            title=f"{product.title}: costo del crédito",
            product_id=product.product_id,
            rows=rows,
            sources=["quasar-pay-installments", "quasar-card-rates-fees"],
            footnotes=["Cuotas fijas calculadas con la tasa efectiva anual indicada."],
        )

    def _insurance_disclosure(self, product: Product) -> Disclosure:
        a = product.attributes
        return Disclosure(
            title=f"{product.title}: coberturas",
            product_id=product.product_id,
            rows=[
                DisclosureRow(label="Precio", value=f"${product.price:,.0f} por viaje"),
                DisclosureRow(
                    label="Gastos médicos", value=f"hasta ${a.get('medical_coverage_usd', '—')}"
                ),
                DisclosureRow(label="Cancelación del viaje", value=a.get("trip_cancellation", "—")),
                DisclosureRow(
                    label="Equipaje perdido", value=f"hasta ${a.get('lost_baggage_usd', '—')}"
                ),
                DisclosureRow(label="Retraso de vuelo", value=a.get("flight_delay", "—")),
                DisclosureRow(label="Aseguradora", value=a.get("underwriter", "—")),
            ],
            sources=["travel-insurance-coverage"],
            footnotes=["Aplican exclusiones; lee la póliza antes de comprar."],
        )

    def _fare_disclosure(self, product: Product, family: ProductDetails) -> Disclosure:
        a = {**family.attributes, **product.attributes}
        cabin = product.option_values.get("cabin", a.get("cabin", ""))
        return Disclosure(
            title=f"{family.title} · {cabin.capitalize()}: reglas de la tarifa",
            product_id=product.product_id,
            rows=[
                DisclosureRow(
                    label="Tarifa", value=f"${product.price:,.0f}", note=a.get("price_qualifier")
                ),
                DisclosureRow(label="Equipaje de mano", value=a.get("carry_on", "—")),
                DisclosureRow(label="Maletas documentadas", value=a.get("checked_bags", "—")),
                DisclosureRow(label="Selección de asiento", value=a.get("seat_selection", "—")),
                DisclosureRow(label="Cambios", value=a.get("changes", "—")),
                DisclosureRow(label="Reembolsable", value=a.get("refundable", "—")),
                DisclosureRow(label="Millas que acumula", value=a.get("miles_earned", "—")),
                DisclosureRow(label="Sala VIP", value=a.get("lounge_access", "—")),
            ],
            sources=["baggage-allowance", "flight-changes-refunds"],
            footnotes=[a.get("installments", "")] if a.get("installments") else [],
        )

    # ------------------------------------------------------------------
    # Orders, help, fulfillment
    # ------------------------------------------------------------------

    async def get_orders(self, session: ShoppingSessionContext, limit: int = 5) -> list[Order]:
        return orders_for(self._orders, session.user_id, limit)

    async def get_order(self, session: ShoppingSessionContext, order_id: str) -> Order | None:
        return find_order(self._orders, session.user_id, order_id)

    def recent_orders(self, limit: int = 6) -> list[Order]:
        return newest_orders(self._orders, limit)

    async def search_policies(self, session: ShoppingSessionContext, query: str) -> list[Policy]:
        del session
        by_id = {policy.policy_id: policy for policy in self._policies}
        return [by_id[hit.policy_id] for hit in search_help(self._folded_policies, _fold(query))]

    async def get_fulfillment_options(
        self, session: ShoppingSessionContext, product_ids: list[str]
    ) -> list[FulfillmentOption]:
        """How each kind of purchase reaches the customer: e-ticket, card delivery, miles
        credit, policy by email."""
        del session
        categories: set[str] = set()
        for pid in product_ids:
            product = self.product(pid)
            if product is None:
                continue
            family = self.product(product.variant_of) if product.variant_of else None
            categories.add(product.category or (family.category if family else "") or "")
        options: list[FulfillmentOption] = []
        if categories & {"flights", "ancillaries"} or not categories:
            options.append(
                FulfillmentOption(
                    method="delivery",
                    eta="boleto electrónico por correo al confirmar; check-in en línea desde 24 h antes",
                )
            )
        if "card" in categories:
            options.append(
                FulfillmentOption(
                    method="delivery",
                    eta="tarjeta digital en la app al firmar; lista para compras en línea el mismo día",
                )
            )
            options.append(
                FulfillmentOption(
                    method="shipping",
                    eta="tarjeta física en 5 a 7 días hábiles, sin costo",
                )
            )
        if "miles" in categories:
            options.append(
                FulfillmentOption(method="delivery", eta="millas acreditadas en máximo 24 h")
            )
        if "insurance" in categories:
            options.append(
                FulfillmentOption(method="delivery", eta="póliza por correo al confirmar")
            )
        return options


def _is_number(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


def tier_label(tier: str) -> str:
    return _TIER_LABELS.get(tier, tier.capitalize())


def card_title(tier: str) -> str:
    return f"Tarjeta Quasar Visa {tier_label(tier)}"


__all__ = [
    "CARD_FAMILY_ID",
    "DATA_DIR",
    "TIERS",
    "CardHeld",
    "MockQuasar",
    "tier_label",
]

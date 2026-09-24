"""Quasar Airlines' ``MerchantBackend``: the operations fixtures in ``data/`` (network and
revenue metrics, the fintech portfolio with its weekly series and cohorts, seats per flight
cabin, ancillary sales, campaigns, customer messages) overlaid on the ``MockQuasar`` the
storefront serves.

A flight cabin's stock is its seats left; seat capacity is fixed by the aircraft, so a
restock is refused. A card tier or insurance plan's stock is its active accounts, which
every change to it states as its blast radius. Card, Quasar Pay, and insurance pricing is
regulated and set outside the portal: price updates and promotions on them are refused.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from merchant_agent import (
    ActorKind,
    AlertCounts,
    BusinessSnapshot,
    Campaign,
    CampaignDraft,
    ChangeItem,
    ChangeKind,
    ChangeLedger,
    ChangeNotApplicable,
    InventoryActionItem,
    InventoryAlert,
    Listing,
    ListingDetails,
    ListingFilters,
    MerchantAgentConfig,
    MerchantBackend,
    MerchantSessionContext,
    MetricPoint,
    MetricSeries,
    OrderIssue,
    PriceUpdateItem,
    PricingContext,
    PromotionDraft,
    StagedChange,
)
from shopping_agent import ProductDetails, SearchFilters, ShoppingSessionContext

from demo_common.merchant_fixtures import (
    FAMILY_CONTENT_FIELDS,
    alert_counts,
    apply_campaign_item,
    family_pricing_context,
    filter_listings,
    is_browse,
    load_campaigns,
    load_issues,
    margin_pct,
    metric_window,
    named_ids,
    promotion_targets,
    rebase_daily,
    rebase_weeks,
    refuse_outside_range,
    refuse_shared_content,
    share_content,
    snapshot_of,
    stage_campaign,
    staged_promotion_windows,
)
from demo_common.storefront_fixtures import load_json, refresh_family

from .mock_quasar import DATA_DIR, MockQuasar

# A portfolio product is flagged once its base shrank over the series and its latest
# monthly cancellation reached this rate.
_PORTFOLIO_CANCELLATION_ALERT_PCT = 1.8
# Categories whose price the bank or the underwriter sets; the portal cannot move it.
_REGULATED_CATEGORIES = {"card", "financing", "insurance"}

_MONEY_METRICS = {
    "sales",
    "revenue",
    "ticket_revenue",
    "ancillary_revenue",
    "fintech_revenue",
    "average_order_value",
    "aov",
    "ancillary_per_passenger",
    "arpu",
    "revenue_per_account",
}
_PCT_METRICS = {
    "conversion",
    "conversion_rate",
    "load_factor",
    "attach_rate",
    "approval_rate",
    "churn",
    "churn_rate",
    "cancellation",
    "cancellation_rate",
}
# Metric names as operators and the model phrase them, mapped to the canonical name.
_METRIC_ALIASES = {
    "bookings": "orders",
    "reservas": "orders",
    "searches": "traffic",
    "busquedas": "traffic",
    "conversion_rate": "conversion",
    "occupancy": "load_factor",
    "ocupacion": "load_factor",
    "ancillary_attach": "attach_rate",
    "ancillary_attach_rate": "attach_rate",
    "attach_rate_pct": "attach_rate",
    "load_factor_pct": "load_factor",
    "ancillary_revenue_per_pax": "ancillary_per_passenger",
    "card_approval_rate": "approval_rate",
    "ticket_sales": "ticket_revenue",
    "fintech": "fintech_revenue",
    "ancillaries": "ancillary_revenue",
    "attach": "attach_rate",
    "ancillary_revenue_per_passenger": "ancillary_per_passenger",
    "revenue_per_passenger": "ancillary_per_passenger",
    "applications": "card_applications",
    "approvals": "card_approvals",
    "cards": "active_cards",
    "churn": "cancellation_rate",
    "churn_rate": "cancellation_rate",
    "cancellation": "cancellation_rate",
    "arpu": "revenue_per_account",
    "subscribers": "accounts",
    "average_order_value": "aov",
}


# Every metric query_metrics serves from the daily rows.
METRICS = frozenset(
    {
        "sales",
        "orders",
        "traffic",
        "conversion",
        "aov",
        "revenue",
        "ticket_revenue",
        "ancillary_revenue",
        "fintech_revenue",
        "passengers",
        "load_factor",
        "attach_rate",
        "ancillary_orders",
        "ancillary_per_passenger",
        "card_applications",
        "card_approvals",
        "approval_rate",
        "active_cards",
        "accounts",
        "miles_sold",
    }
)


class PortfolioPricingContext(PricingContext):
    """The pricing read for a card tier or insurance plan: its base, per-account economics,
    and the note that its price is set outside the portal."""

    price_unit: str = "per_year"
    active_accounts: int | None = None
    portfolio_share_pct: float | None = None
    revenue_per_account: float | None = None
    cost_per_account_usd: float | None = None
    margin_per_account_usd: float | None = None
    price_set_by: str = "Banco Andino Digital / the underwriter; not editable from the portal"


class FlightPricingContext(PricingContext):
    """The pricing read for a flight cabin: seats, pace, and the days to departure."""

    seats_left: int | None = None
    seats_sold_last_30d: int | None = None
    departure_date: str | None = None
    days_to_departure: int | None = None
    projected_unsold_seats: int | None = None
    active_promotions: list[dict[str, Any]] = []


class MockQuasarMerchant(MerchantBackend):
    def __init__(
        self,
        storefront: MockQuasar,
        config: MerchantAgentConfig | None = None,
        data_dir: Path = DATA_DIR,
    ) -> None:
        self.storefront = storefront
        self.config = config or MerchantAgentConfig(brand_name=storefront.store_name)
        self.ledger = ChangeLedger(self.config)
        metrics = load_json(data_dir, "merchant_metrics.json")
        self._daily = rebase_daily(metrics["daily"])
        self._currency: str = metrics.get("currency", "USD")
        portfolio = load_json(data_dir, "merchant_portfolio.json")
        self.airline_name: str = portfolio.get("airline", "Quasar Airlines · Operaciones")
        self._economics_note: str = portfolio.get("economics_note", "")
        # Portfolio rows in the plan-mix shape the portal and the component read.
        self._portfolio: dict[str, dict[str, Any]] = {}
        for row in portfolio["products"]:
            weeks = rebase_weeks(row.get("weeks") or [])
            self._portfolio[row["product_id"]] = {
                "kind": row.get("kind", "card"),
                "subscribers": int(row["accounts"]),
                "wholesale_cost_per_line_usd": row.get("cost_per_account_usd"),
                "weeks": [
                    {
                        "week_start": week["week_start"],
                        "subscribers": int(week["accounts"]),
                        "churn_rate_pct": week["cancellation_rate_pct"],
                        "arpu": week["revenue_per_account"],
                    }
                    for week in weeks
                ],
            }
        self._cohorts: list[dict[str, Any]] = [
            {**cohort, "plan_ids": list(cohort.get("product_ids", []))}
            for cohort in portfolio.get("cohorts", [])
        ]
        inventory = load_json(data_dir, "merchant_inventory.json")
        self._seats: dict[str, dict[str, Any]] = {
            row["product_id"]: dict(row) for row in inventory["items"]
        }
        self._service_content: dict[str, dict[str, Any]] = {
            row["product_id"]: dict(row) for row in inventory.get("service_content", [])
        }
        self._ancillary_sales: dict[str, dict[str, Any]] = {
            row["product_id"]: dict(row) for row in inventory.get("ancillary_sales", [])
        }
        self._campaigns = load_campaigns(data_dir)
        self._issues = load_issues(data_dir)
        self._listing_state: dict[str, dict[str, Any]] = {}
        self.promo_windows: dict[str, list[dict[str, Any]]] = {}
        self._promotion_windows: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Listings
    # ------------------------------------------------------------------

    def _state_row(self, product_id: str) -> dict[str, Any]:
        if product_id not in self._listing_state:
            overlay = self._service_content.get(product_id) or self._seats.get(product_id) or {}
            self._listing_state[product_id] = {
                "product_id": product_id,
                "status": "active",
                "content_quality": overlay.get("content_quality", "good"),
                "missing_attributes": list(overlay.get("missing_attributes", [])),
            }
        return self._listing_state[product_id]

    def _stock_for(self, product_id: str) -> int:
        """A flight cabin's seats left; a portfolio product's active accounts."""
        seats = self._seats.get(product_id)
        if seats is not None:
            return int(seats["stock"])
        account_row = self._portfolio.get(product_id)
        if account_row is not None:
            return int(account_row["subscribers"])
        return 0

    def _product(self, listing_id: str) -> ProductDetails | None:
        return self.storefront.product(listing_id)

    def _category(self, product: ProductDetails) -> str:
        if product.category:
            return product.category
        family = self._product(product.variant_of) if product.variant_of else None
        return (family.category if family else None) or ""

    def _listing(self, product_id: str) -> Listing | None:
        product = self._product(product_id)
        if product is None:
            return None
        product_id = product.product_id
        row = self._state_row(product_id)
        status = row.get("status", "active")
        variants = [v for variant in product.variants if (v := self._listing(variant.product_id))]
        stock = sum(v.stock for v in variants) if variants else self._stock_for(product_id)
        price = min((v.price for v in variants), default=product.price)
        if status == "active" and not product.in_stock:
            status = "out_of_stock"
        attributes = dict(product.attributes)
        if product_id in self._portfolio:
            attributes["active_accounts"] = str(self._portfolio[product_id]["subscribers"])
        return Listing(
            listing_id=product_id,
            title=product.title,
            status=status,
            price=price,
            currency=product.currency,
            stock=stock,
            category=product.category or self._category(product),
            content_quality=row.get("content_quality", "good"),
            attributes=attributes,
            image_url=product.image_url,
            short_description=product.short_description,
            options=product.options,
            option_values=product.option_values,
            variant_of=product.variant_of,
        )

    def all_listings(self) -> list[Listing]:
        listings = [
            listing
            for product_id in self.storefront.products
            if (listing := self._listing(product_id)) is not None
        ]
        listings.sort(key=lambda listing: (listing.category or "", listing.listing_id))
        return listings

    # ------------------------------------------------------------------
    # Fintech portfolio: the per-product series and the portal's reads of them
    # ------------------------------------------------------------------

    def total_subscribers(self) -> int:
        return sum(int(row["subscribers"]) for row in self._portfolio.values())

    def active_cards(self) -> int:
        return sum(
            int(row["subscribers"]) for row in self._portfolio.values() if row["kind"] == "card"
        )

    def _portfolio_margin(self, row: dict[str, Any]) -> float | None:
        revenue = row["weeks"][-1]["arpu"] if row.get("weeks") else None
        cost = row.get("wholesale_cost_per_line_usd")
        if revenue is None or cost is None:
            return None
        return round(revenue - cost, 2)

    def plan_mix_rows(self, plan_ids: list[str] | None = None) -> list[dict[str, Any]]:
        """Portfolio rows per known card tier or insurance plan, in the plan-mix shape."""
        total = self.total_subscribers()
        rows: list[dict[str, Any]] = []
        for product_id, row in self._portfolio.items():
            if plan_ids is not None and product_id not in plan_ids:
                continue
            product = self._product(product_id)
            if product is None:
                continue
            latest = row["weeks"][-1] if row.get("weeks") else {}
            rows.append(
                {
                    "plan_id": product_id,
                    "title": product.title,
                    "kind": row["kind"],
                    "price": product.price,
                    "currency": product.currency,
                    "subscribers": int(row["subscribers"]),
                    "share_pct": round(row["subscribers"] / total * 100, 1) if total else 0.0,
                    "churn_rate_pct": latest.get("churn_rate_pct"),
                    "arpu": latest.get("arpu"),
                    "wholesale_cost_per_line_usd": row.get("wholesale_cost_per_line_usd"),
                    "margin_per_line_usd": self._portfolio_margin(row),
                    "weeks": [dict(week) for week in row.get("weeks", [])],
                }
            )
        return rows

    def base_overview(self) -> dict[str, Any]:
        """The portal's portfolio view: every row, the cohorts, the economics note, and the
        pending promotion windows."""
        return {
            "total_subscribers": self.total_subscribers(),
            "plans": self.plan_mix_rows(),
            "cohorts": [dict(cohort) for cohort in self._cohorts],
            "wholesale": {"note": self._economics_note},
            "staged_windows": self.staged_promotion_windows(),
        }

    def today_snapshot(self) -> dict[str, Any] | None:
        """Yesterday's network and revenue motion for the portal home page."""
        if not self._daily:
            return None
        latest = self._daily[-1]
        seats = latest.get("seats_available") or 0
        return {
            "date": latest["date"],
            "bookings": latest["orders"],
            "passengers": latest["passengers"],
            "load_factor_pct": round(latest["passengers"] / seats * 100, 1) if seats else None,
            "ancillary_revenue": latest["ancillary_revenue"],
            "fintech_revenue": latest["fintech_revenue"],
            "card_approvals": latest["card_approvals"],
        }

    def staged_promotion_windows(self) -> list[dict[str, Any]]:
        return staged_promotion_windows(self.ledger, self._promotion_windows)

    # ------------------------------------------------------------------
    # Performance
    # ------------------------------------------------------------------

    def _alert_counts(self) -> AlertCounts:
        return alert_counts(self._compute_alerts(), self._issues, self.ledger)

    async def get_business_snapshot(
        self, session: MerchantSessionContext, period: str | None = None
    ) -> BusinessSnapshot:
        del session
        return snapshot_of(
            self._daily, period, currency=self._currency, alerts=self._alert_counts()
        )

    def _portfolio_for_segment(self, segment: str | None) -> tuple[str, dict[str, Any]] | None:
        """The portfolio product a segment names, by id, tier, or title."""
        if not segment:
            return None
        cleaned = segment.strip().lower()
        for product_id, row in self._portfolio.items():
            product = self._product(product_id)
            title = (product.title if product else "").lower()
            tier = (
                (product.option_values.get("tier") or product.option_values.get("plan") or "")
                if product
                else ""
            )
            suffix = product_id.rsplit("-", 1)[-1].lower()  # CLASSIC, GOLD, BASIC, PLUS...
            if cleaned in {product_id.lower(), title, tier.lower(), suffix} or (
                tier and cleaned == f"{row['kind']} {tier}".lower()
            ):
                return product_id, row
        return None

    async def query_metrics(
        self,
        session: MerchantSessionContext,
        metric: str,
        period: str | None = None,
        granularity: str = "day",
        segment: str | None = None,
    ) -> MetricSeries:
        del session
        cleaned = metric.strip().lower().replace(" ", "_").replace("-", "_")
        cleaned = _METRIC_ALIASES.get(cleaned, cleaned)
        segment_cleaned = (segment or "").strip() or None

        # A segment naming a card tier or insurance plan reads that product's weekly series.
        match = self._portfolio_for_segment(segment_cleaned)
        if match is not None and cleaned in {
            "cancellation_rate",
            "revenue_per_account",
            "accounts",
        }:
            product_id, row = match
            key = {
                "cancellation_rate": "churn_rate_pct",
                "revenue_per_account": "arpu",
                "accounts": "subscribers",
            }[cleaned]
            weeks = row.get("weeks", [])
            unit = "%" if key == "churn_rate_pct" else (self._currency if key == "arpu" else None)
            return MetricSeries(
                metric=cleaned,
                unit=unit,
                granularity="week",
                period=f"{weeks[0]['week_start']}/{weeks[-1]['week_start']}" if weeks else None,
                segment=product_id,
                points=[
                    MetricPoint(date=week["week_start"], value=float(week[key])) for week in weeks
                ],
            )

        if cleaned not in METRICS:
            raise ValueError(
                f"Unknown metric {metric!r}. Available: {', '.join(sorted(METRICS))}; "
                "cancellation_rate, revenue_per_account, and accounts also take a card tier or "
                "insurance plan as the segment."
            )
        current, _, label = metric_window(self._daily, period or "last_30_days")

        def value_for(rows: list[dict[str, Any]]) -> float:
            # Ratios are recomputed from the bucket's totals; the card base reports the
            # bucket's closing value.
            def total(key: str) -> float:
                return float(sum(r.get(key, 0) for r in rows))

            orders = total("orders")
            traffic = total("traffic")
            passengers = total("passengers")
            if cleaned == "sales":
                return round(total("sales"), 2)
            if cleaned in {"orders", "traffic", "passengers", "ancillary_orders", "miles_sold"}:
                return total(cleaned)
            if cleaned in {"card_applications", "card_approvals"}:
                return total(cleaned)
            if cleaned == "conversion":
                return round(orders / traffic * 100, 2) if traffic else 0.0
            if cleaned == "aov":
                return round(total("sales") / orders, 2) if orders else 0.0
            if cleaned in {"revenue", "ticket_revenue", "ancillary_revenue", "fintech_revenue"}:
                return round(total(cleaned), 2)
            if cleaned == "load_factor":
                seats = total("seats_available")
                return round(passengers / seats * 100, 2) if seats else 0.0
            if cleaned == "attach_rate":
                return round(total("ancillary_orders") / orders * 100, 2) if orders else 0.0
            if cleaned == "ancillary_per_passenger":
                return round(total("ancillary_revenue") / passengers, 2) if passengers else 0.0
            if cleaned == "approval_rate":
                applications = total("card_applications")
                return (
                    round(total("card_approvals") / applications * 100, 2) if applications else 0.0
                )
            if cleaned in {"active_cards", "accounts"}:
                return float(rows[-1].get("active_cards", 0))
            raise ValueError(f"unknown metric {metric!r}")

        if granularity == "week":
            points = [
                MetricPoint(
                    date=current[start]["date"], value=value_for(current[start : start + 7])
                )
                for start in range(0, len(current), 7)
            ]
        else:
            points = [MetricPoint(date=row["date"], value=value_for([row])) for row in current]
        unit = (
            self._currency
            if cleaned in _MONEY_METRICS
            else ("%" if cleaned in _PCT_METRICS else None)
        )
        return MetricSeries(
            metric=cleaned,
            unit=unit,
            granularity="week" if granularity == "week" else "day",
            period=label,
            segment=segment_cleaned,
            points=points,
        )

    async def get_campaign_performance(
        self, session: MerchantSessionContext, campaign_id: str | None = None
    ) -> list[Campaign]:
        del session
        campaigns = list(self._campaigns.values())
        if campaign_id:
            campaigns = [c for c in campaigns if c.campaign_id == campaign_id]
        return campaigns

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def search_listings(
        self,
        session: MerchantSessionContext,
        query: str,
        filters: ListingFilters | None = None,
        limit: int = 8,
    ) -> list[Listing]:
        if ids := named_ids(query, [*self.storefront.products, *self.storefront.variants]):
            listings = [listing for pid in ids if (listing := self._listing(pid))]
        elif is_browse(query):
            listings = self.all_listings()
        else:
            shopper = ShoppingSessionContext(
                session_id=session.session_id, user_id="merchant-portal"
            )
            products = await self.storefront.search_products(
                shopper, query, SearchFilters(), limit=max(limit, 8)
            )
            listings = [listing for p in products if (listing := self._listing(p.product_id))]
        return filter_listings(
            listings,
            filters,
            limit,
            sales_of=lambda listing_id: self._sales_last_30d(listing_id) or 0,
        )

    def _sales_last_30d(self, product_id: str) -> int | None:
        row = self._seats.get(product_id) or self._ancillary_sales.get(product_id)
        return int(row["sales_last_30d"]) if row is not None else None

    async def get_listing(
        self, session: MerchantSessionContext, listing_id: str
    ) -> ListingDetails | None:
        del session
        product = self._product(listing_id)
        if product is None:
            return None
        listing = self._listing(product.product_id)
        if listing is None:
            return None
        row = self._state_row(product.product_id)
        variants = [v for variant in product.variants if (v := self._listing(variant.product_id))]
        sales = [s for v in variants if (s := self._sales_last_30d(v.listing_id)) is not None]
        return ListingDetails(
            **listing.model_dump(),
            long_description=product.long_description,
            review_snippets=product.review_highlights,
            sales_last_30d=(sum(sales) if sales else None)
            if variants
            else self._sales_last_30d(product.product_id),
            missing_attributes=row.get("missing_attributes") or [],
            variants=variants,
        )

    # ------------------------------------------------------------------
    # Seats and order health
    # ------------------------------------------------------------------

    def _departure(self, product: ProductDetails) -> date | None:
        family = self._product(product.variant_of) if product.variant_of else product
        raw = (family.attributes if family else {}).get("travel_date", "")
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None

    def _flight_pace(self, product: ProductDetails) -> dict[str, Any]:
        """Seats left, the trailing daily pace, the days to departure, and the seats that
        pace leaves unsold."""
        row = self._seats[product.product_id]
        stock = int(row["stock"])
        daily_pace = int(row["sales_last_30d"]) / 30
        departs = self._departure(product)
        days = (departs - date.today()).days if departs else None
        unsold = None
        if days is not None:
            unsold = max(0, round(stock - daily_pace * max(days, 0)))
        return {
            "stock": stock,
            "threshold": int(row["threshold"]),
            "sales": int(row["sales_last_30d"]),
            "days_of_cover": round(stock / daily_pace, 1) if daily_pace else None,
            "departure": departs.isoformat() if departs else None,
            "days_to_departure": days,
            "projected_unsold": unsold,
        }

    def _compute_alerts(self) -> list[InventoryAlert]:
        """A cabin at or under its seat threshold is ``low_stock`` (nearly full: a fare
        opportunity); a cabin whose pace leaves seats unsold at departure is ``slow_mover``
        (a promotion candidate). A card tier or insurance plan whose base shrank while its
        cancellations reached the alert rate is a ``slow_mover`` with its accounts as stock."""
        alerts: list[InventoryAlert] = []
        for product_id in self._seats:
            product = self._product(product_id)
            if product is None or product.has_options:
                continue
            pace = self._flight_pace(product)
            state = self._state_row(product_id)
            visible = product.in_stock and state.get("status") != "paused"
            departed = pace["days_to_departure"] is not None and pace["days_to_departure"] < 0
            if departed:
                continue
            common = {
                "listing_id": product_id,
                "title": product.title,
                "option_values": product.option_values,
                "variant_of": product.variant_of,
                "stock": pace["stock"],
                "threshold": pace["threshold"],
                "days_of_cover": pace["days_of_cover"],
                "sales_last_30d": pace["sales"],
                "storefront_visible": visible,
            }
            if pace["stock"] <= pace["threshold"]:
                alerts.append(InventoryAlert(kind="low_stock", **common))
            elif (pace["projected_unsold"] or 0) > pace["threshold"]:
                alerts.append(InventoryAlert(kind="slow_mover", **common))
        for product_id, row in self._portfolio.items():
            product = self._product(product_id)
            weeks = row.get("weeks") or []
            if product is None or len(weeks) < 2:
                continue
            declined = weeks[-1]["subscribers"] < weeks[0]["subscribers"]
            if declined and weeks[-1]["churn_rate_pct"] >= _PORTFOLIO_CANCELLATION_ALERT_PCT:
                alerts.append(
                    InventoryAlert(
                        listing_id=product_id,
                        title=product.title,
                        kind="slow_mover",
                        option_values=product.option_values,
                        variant_of=product.variant_of,
                        stock=int(row["subscribers"]),
                        threshold=int(weeks[0]["subscribers"]),
                        days_of_cover=None,
                        sales_last_30d=None,
                        storefront_visible=product.in_stock,
                    )
                )
        alerts.sort(key=lambda alert: (alert.kind != "low_stock", alert.stock))
        return alerts

    async def get_inventory_alerts(self, session: MerchantSessionContext) -> list[InventoryAlert]:
        del session
        return self._compute_alerts()

    async def get_order_issues(self, session: MerchantSessionContext) -> list[OrderIssue]:
        del session
        return list(self._issues)

    # ------------------------------------------------------------------
    # Pricing
    # ------------------------------------------------------------------

    def _unit_cost(self, product_id: str) -> float | None:
        row = self._seats.get(product_id) or self._ancillary_sales.get(product_id)
        if row is not None and row.get("unit_cost") is not None:
            return float(row["unit_cost"])
        account_row = self._portfolio.get(product_id)
        if account_row is not None:
            return account_row.get("wholesale_cost_per_line_usd")
        return None

    async def get_pricing_context(
        self, session: MerchantSessionContext, listing_id: str
    ) -> PricingContext | None:
        del session
        product = self._product(listing_id)
        if product is None:
            return None
        listing_id = product.product_id
        if product.has_options:
            return family_pricing_context(
                product,
                [self._item_pricing_context(variant) for variant in product.variants],
                self.config,
            )
        return self._item_pricing_context(product)

    def _item_pricing_context(self, product: ProductDetails) -> PricingContext:
        listing_id = product.product_id
        row = self._state_row(listing_id)
        unit_cost = self._unit_cost(listing_id)
        margin = margin_pct(product.price, unit_cost) if unit_cost and product.price else None
        account_row = self._portfolio.get(listing_id)
        if account_row is not None:
            weeks = account_row.get("weeks") or []
            latest = weeks[-1] if weeks else {}
            demand = "steady"
            if len(weeks) >= 5:
                delta = weeks[-1]["subscribers"] - weeks[-5]["subscribers"]
                demand = "falling" if delta < 0 else "rising" if delta > 200 else "steady"
            total = self.total_subscribers()
            return PortfolioPricingContext(
                listing_id=listing_id,
                current_price=product.price,
                currency=product.currency,
                unit_cost=unit_cost,
                margin_pct=None,
                min_price=None,
                max_price=None,
                max_price_delta_pct=self.config.max_price_delta_pct,
                max_promotion_discount_pct=self.config.max_promotion_discount_pct,
                demand_signal=demand,
                last_changed=row.get("last_price_change"),
                option_values=product.option_values,
                active_accounts=int(account_row["subscribers"]),
                portfolio_share_pct=round(account_row["subscribers"] / total * 100, 1)
                if total
                else None,
                revenue_per_account=latest.get("arpu"),
                cost_per_account_usd=account_row.get("wholesale_cost_per_line_usd"),
                margin_per_account_usd=self._portfolio_margin(account_row),
            )
        sales = self._sales_last_30d(listing_id)
        if listing_id in self._seats:
            pace = self._flight_pace(product)
            demand = (
                "rising"
                if pace["stock"] <= pace["threshold"]
                else "falling"
                if (pace["projected_unsold"] or 0) > pace["threshold"]
                else "steady"
            )
            return FlightPricingContext(
                listing_id=listing_id,
                current_price=product.price,
                currency=product.currency,
                unit_cost=unit_cost,
                margin_pct=margin,
                min_price=round(unit_cost * 1.05, 2) if unit_cost else None,
                max_price=round(product.price * 1.2, 2),
                max_price_delta_pct=self.config.max_price_delta_pct,
                max_promotion_discount_pct=self.config.max_promotion_discount_pct,
                demand_signal=demand,
                last_changed=row.get("last_price_change"),
                option_values=product.option_values,
                seats_left=pace["stock"],
                seats_sold_last_30d=pace["sales"],
                departure_date=pace["departure"],
                days_to_departure=pace["days_to_departure"],
                projected_unsold_seats=pace["projected_unsold"],
                active_promotions=list(self.promo_windows.get(listing_id, [])),
            )
        if sales is not None and sales >= 3000:
            demand = "rising"
        elif sales is not None and sales <= 150:
            demand = "falling"
        else:
            demand = "steady"
        return PricingContext(
            listing_id=listing_id,
            current_price=product.price,
            currency=product.currency,
            unit_cost=unit_cost,
            margin_pct=margin,
            min_price=round(unit_cost * 1.1, 2) if unit_cost else None,
            max_price=round(product.price * 1.2, 2),
            max_price_delta_pct=self.config.max_price_delta_pct,
            max_promotion_discount_pct=self.config.max_promotion_discount_pct,
            demand_signal=demand,
            last_changed=row.get("last_price_change"),
            option_values=product.option_values,
        )

    # ------------------------------------------------------------------
    # Staged writes
    # ------------------------------------------------------------------

    def _refuse_regulated(self, product: ProductDetails) -> None:
        if self._category(product) in _REGULATED_CATEGORIES:
            raise ChangeNotApplicable(
                f"{product.title} is a regulated financial product: its price, rates, and fees "
                "are set by Banco Andino Digital or the underwriter, not from this portal. Use "
                "a campaign or listing content instead."
            )

    def _blast_radius_note(self, product: ProductDetails) -> str | None:
        account_row = self._portfolio.get(product.product_id)
        if account_row is not None:
            return (
                f"{product.product_id} affects {int(account_row['subscribers']):,} active "
                f"accounts on {product.title}"
            )
        if self._category(product) == "ancillaries":
            return f"{product.product_id}: the new price applies to every booking from the moment it is applied"
        if product.product_id in self._seats:
            pace = self._flight_pace(product)
            return (
                f"{product.product_id}: {pace['stock']} seats left, departs "
                f"{pace['departure']} ({pace['days_to_departure']} days); already-sold seats keep their fare"
            )
        return None

    async def stage_listing_update(
        self,
        session: MerchantSessionContext,
        listing_id: str,
        fields: dict[str, Any],
        note: str | None = None,
    ) -> StagedChange:
        listing = await self.get_listing(session, listing_id)
        if listing is None:
            raise ValueError(f"no listing {listing_id}")
        refuse_shared_content(listing, fields)
        items = [
            ChangeItem(
                target=listing.listing_id,
                field=name,
                before=getattr(listing, name, listing.attributes.get(name)),
                after=value,
            )
            for name, value in fields.items()
        ]
        return self.ledger.stage(
            kind=ChangeKind.LISTING_UPDATE,
            summary=note or f"Update listing content on {listing.listing_id}",
            items=items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
        )

    async def stage_price_update(
        self,
        session: MerchantSessionContext,
        items: list[PriceUpdateItem],
        note: str | None = None,
    ) -> StagedChange:
        """Standing fare and ancillary price changes; the margin impact is the week's
        revenue delta at the trailing sales pace."""
        change_items = []
        margin_impact = 0.0
        margins: list[tuple[float, float]] = []
        notes: list[str] = []
        currency: str | None = None
        for item in items:
            product = self._product(item.listing_id)
            if product is None:
                raise ValueError(f"no listing {item.listing_id}")
            if product.has_options:
                raise ValueError(f"{product.product_id} is priced per variant")
            self._refuse_regulated(product)
            resolved = product.product_id
            context = await self.get_pricing_context(session, resolved)
            if context is not None:
                refuse_outside_range(resolved, item.new_price, context)
            before = product.price
            currency = currency or product.currency
            sales = self._sales_last_30d(resolved) or 0
            margin_impact += (item.new_price - before) * sales / 30 * 7
            if radius := self._blast_radius_note(product):
                notes.append(radius)
            unit_cost = self._unit_cost(resolved)
            if unit_cost is not None:
                margin_before = margin_pct(before, unit_cost)
                margin_after = margin_pct(item.new_price, unit_cost)
                margins.append((margin_before, margin_after))
                notes.append(
                    f"{resolved} margin: {margin_before}% → {margin_after}% "
                    f"({margin_after - margin_before:+.1f} pts)"
                )
            change_items.append(
                ChangeItem(target=resolved, field="price", before=before, after=item.new_price)
            )
        return self.ledger.stage(
            kind=ChangeKind.PRICE_UPDATE,
            summary=note or f"Price update for {len(items)} listing(s)",
            items=change_items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
            currency=currency,
            margin_impact=round(margin_impact, 2),
            margin_before_pct=margins[0][0] if len(margins) == 1 else None,
            margin_after_pct=margins[0][1] if len(margins) == 1 else None,
            guardrail_notes=notes or None,
        )

    async def stage_inventory_action(
        self,
        session: MerchantSessionContext,
        items: list[InventoryActionItem],
        note: str | None = None,
    ) -> StagedChange:
        """Pause and activate apply to any listing. Nothing restocks: seat capacity is fixed
        by the aircraft and every other product is a service."""
        change_items = []
        for item in items:
            product = self._product(item.listing_id)
            if product is None:
                raise ValueError(f"no listing {item.listing_id}")
            if item.action == "restock":
                raise ChangeNotApplicable(
                    f"{product.title} cannot be restocked: seat capacity is fixed by the "
                    "aircraft and services hold no inventory. Pause or activate it, or use the "
                    "pricing tools instead."
                )
            resolved = product.product_id
            listing = self._listing(resolved)
            change_items.append(
                ChangeItem(
                    target=resolved,
                    field="status",
                    before=listing.status if listing else None,
                    after="paused" if item.action == "pause" else "active",
                )
            )
        return self.ledger.stage(
            kind=ChangeKind.INVENTORY_ACTION,
            summary=note or f"Availability action for {len(items)} listing(s)",
            items=change_items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
        )

    async def stage_promotion(
        self, session: MerchantSessionContext, promotion: PromotionDraft
    ) -> StagedChange:
        """A promotional fare or ancillary price for a date window, recorded as a window
        when applied; the standing price does not move."""
        try:
            window_days = max(
                1,
                (date.fromisoformat(promotion.ends) - date.fromisoformat(promotion.starts)).days
                + 1,
            )
        except ValueError:
            window_days = 30
        requested = {listing_id: self._product(listing_id) for listing_id in promotion.listing_ids}
        if missing := [listing_id for listing_id, found in requested.items() if found is None]:
            raise ValueError(f"no listing {missing[0]}")
        targets = promotion_targets(requested.values())
        items = []
        margin_impact = 0.0
        margins: list[tuple[float, float]] = []
        notes: list[str] = []
        currency: str | None = None
        for product in targets:
            self._refuse_regulated(product)
            resolved = product.product_id
            currency = currency or product.currency
            discount_value = product.price * promotion.discount_pct / 100
            promo_price = round(product.price * (1 - promotion.discount_pct / 100), 2)
            sales = self._sales_last_30d(resolved) or 0
            margin_impact -= discount_value * sales / 30 * window_days
            if radius := self._blast_radius_note(product):
                notes.append(radius)
            unit_cost = self._unit_cost(resolved)
            if unit_cost is not None and promo_price > 0:
                margin_before = margin_pct(product.price, unit_cost)
                margin_after = margin_pct(promo_price, unit_cost)
                margins.append((margin_before, margin_after))
                notes.append(
                    f"{resolved} margin: {margin_before}% → {margin_after}% "
                    f"({margin_after - margin_before:+.1f} pts) for the window"
                )
            items.append(
                ChangeItem(target=resolved, field="price", before=product.price, after=promo_price)
            )
        direction = "off" if promotion.discount_pct >= 0 else "increase on"
        change = self.ledger.stage(
            kind=ChangeKind.PROMOTION,
            summary=f"{promotion.name} ({abs(promotion.discount_pct):.0f}% {direction} "
            f"the price, {promotion.starts} to {promotion.ends})",
            items=items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
            currency=currency,
            margin_impact=round(margin_impact, 2),
            margin_before_pct=margins[0][0] if len(margins) == 1 else None,
            margin_after_pct=margins[0][1] if len(margins) == 1 else None,
            guardrail_notes=notes or None,
        )
        self._promotion_windows[change.change_id] = {
            "starts": promotion.starts,
            "ends": promotion.ends,
            "discount_pct": promotion.discount_pct,
            "name": promotion.name,
        }
        return change

    async def stage_campaign(
        self, session: MerchantSessionContext, campaign: CampaignDraft
    ) -> StagedChange:
        return stage_campaign(
            self.ledger, self._campaigns, campaign, actor=session.operator, currency=self._currency
        )

    async def get_pending_changes(self, session: MerchantSessionContext) -> list[StagedChange]:
        del session
        return self.ledger.pending()

    async def apply_change(self, session: MerchantSessionContext, change_id: str) -> StagedChange:
        applied = self.ledger.apply(change_id, actor=session.operator)
        self._apply_to_live_state(applied)
        return applied

    async def discard_change(
        self,
        session: MerchantSessionContext,
        change_id: str,
        actor_kind: ActorKind = ActorKind.OPERATOR,
    ) -> StagedChange:
        discarded = self.ledger.discard(change_id, actor=session.operator, actor_kind=actor_kind)
        self._promotion_windows.pop(change_id, None)
        return discarded

    def _apply_to_live_state(self, change: StagedChange) -> None:
        """Make an approved change visible in the storefront's shared state."""
        for item in change.items:
            product = self._product(item.target)
            if product is not None and change.kind in {
                ChangeKind.PRICE_UPDATE,
                ChangeKind.INVENTORY_ACTION,
                ChangeKind.LISTING_UPDATE,
            }:
                row = self._state_row(item.target)
                family = self._product(product.variant_of) if product.variant_of else None
                if change.kind is ChangeKind.PRICE_UPDATE:
                    product.price = float(item.after)
                    row["last_price_change"] = datetime.now(UTC).date().isoformat()
                elif change.kind is ChangeKind.INVENTORY_ACTION and item.field == "status":
                    row["status"] = "paused" if item.after == "paused" else "active"
                    for variant in product.variants or [product]:
                        if product.has_options:
                            self._state_row(variant.product_id)["status"] = row["status"]
                        seats = self._seats.get(variant.product_id)
                        has_stock = seats is None or int(seats.get("stock", 0)) > 0
                        variant.in_stock = item.after != "paused" and has_stock
                refresh_family(family or product)
                if change.kind is ChangeKind.LISTING_UPDATE:
                    if item.field in FAMILY_CONTENT_FIELDS:
                        share_content(product, item.field, item.after)
                    elif item.field == "content_quality":
                        row["content_quality"] = item.after
                    else:
                        product.attributes[item.field] = str(item.after)
                        if item.field in row.get("missing_attributes", []):
                            row["missing_attributes"].remove(item.field)
                    if row.get("content_quality") == "needs_work" and item.field in {
                        "short_description",
                        "long_description",
                    }:
                        row["content_quality"] = "good"
            elif change.kind is ChangeKind.PROMOTION:
                window = self._promotion_windows.get(change.change_id, {})
                self.promo_windows.setdefault(item.target, []).append(
                    {
                        "starts": window.get("starts"),
                        "ends": window.get("ends"),
                        "promo_price": float(item.after),
                        "standing_price": float(item.before) if item.before is not None else None,
                        "discount_pct": window.get("discount_pct"),
                        "summary": change.summary,
                        "change_id": change.change_id,
                    }
                )
            elif change.kind is ChangeKind.CAMPAIGN:
                apply_campaign_item(self._campaigns, item)

    # ------------------------------------------------------------------
    # Merchant context
    # ------------------------------------------------------------------

    async def get_merchant_context(self, session: MerchantSessionContext) -> dict[str, Any] | None:
        counts = self._alert_counts()
        latest = self._daily[-1]["date"]
        week_start = (date.fromisoformat(latest) - timedelta(days=6)).isoformat()
        return {
            "airline": self.airline_name,
            "storefront": self.storefront.store_name,
            "operator": session.operator,
            "current_period": f"{week_start}/{latest}",
            "active_cards": self.active_cards(),
            "portfolio_listings": sorted(self._portfolio),
            "metrics_available": sorted(METRICS),
            "data_history": f"{self._daily[0]['date']}/{latest} daily",
            "regulated_listings": (
                "card tiers, Quasar Pay, and insurance: pricing set by the bank or the "
                "underwriter; campaigns and listing content only"
            ),
            "cohorts": [
                {"cohort_id": c["cohort_id"], "label": c["label"], "size": c["size"]}
                for c in self._cohorts
            ],
            "alerts": {
                "cabins_nearly_full": counts.low_stock,
                "behind_pace_or_shrinking": counts.slow_movers,
                "customer_messages": counts.order_issues,
                "pending_changes": counts.pending_changes,
            },
        }

"""The Quasar Visa credit engine: the application the storefront form submits, the bureau
record the backend holds, and the deterministic scorecard that decides which card tiers a
customer is approved for. The decision is made here, server-side; the shopping agent only
reads it from the account context and presents it.

``CreditEngine`` is the seam a model-backed engine (a Jev judgment, say) plugs into later;
``ScorecardEngine`` stays as its fallback. Protected attributes (gender, nationality,
marital status) are never collected; the birth year only feeds the 18+ rule.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Literal, Protocol

from pydantic import BaseModel, Field

Tier = Literal["classic", "gold", "platinum"]
TIERS: tuple[Tier, ...] = ("classic", "gold", "platinum")


class EmploymentStatus(StrEnum):
    EMPLOYED = "employed"
    SELF_EMPLOYED = "self_employed"
    RETIRED = "retired"
    STUDENT = "student"
    UNEMPLOYED = "unemployed"


class Housing(StrEnum):
    OWN = "own"
    RENT = "rent"
    MORTGAGE = "mortgage"
    FAMILY = "family"


class CardApplication(BaseModel):
    """What the applicant states on the form. Amounts are monthly unless named annual."""

    employment_status: EmploymentStatus
    employer_description: str = Field(default="", max_length=200)
    employment_months: int = Field(ge=0, le=720)
    monthly_income_usd: float = Field(ge=0, le=1_000_000)
    monthly_obligations_usd: float = Field(ge=0, le=1_000_000)
    housing: Housing
    trips_per_year: int = Field(ge=0, le=365)
    usual_routes: str = Field(default="", max_length=200)
    annual_travel_spend_usd: float = Field(ge=0, le=10_000_000)
    preferred_cabin: Literal["economy", "premium", "business"] = "economy"
    goal: str = Field(default="", max_length=300)
    birth_year: int = Field(ge=1900, le=2100)


class CardApplicationSubmission(CardApplication):
    """The form as posted: the application plus the two consents it requires."""

    consent_bureau: bool
    accept_terms: bool


class BureauRecord(BaseModel):
    """The applicant's credit-bureau file, fixture-backed in the prototype."""

    score_band: Literal["excellent", "good", "fair", "thin", "poor"]
    delinquencies_24m: int = Field(ge=0)
    utilization_pct: float = Field(ge=0, le=100)
    open_credit_lines: int = Field(ge=0)


class Reason(BaseModel):
    code: str
    text: str
    effect: Literal["positive", "negative"]


class CreditAssessment(BaseModel):
    decision: Literal["approved", "review", "declined"]
    score: int
    score_band: str
    approved_tiers: list[Tier] = Field(default_factory=list)
    recommended_tier: Tier | None = None
    credit_limit_usd: int | None = None
    reasons: list[Reason] = Field(default_factory=list)
    engine: str
    decided_at: datetime
    fallback_used: bool = False


class CreditEngine(Protocol):
    name: str

    async def assess(
        self, application: CardApplication, bureau: BureauRecord, *, today: date
    ) -> CreditAssessment: ...


# Per-tier product rules, as the catalog and the card-application policy state them.
MIN_MONTHLY_INCOME: dict[Tier, float] = {"classic": 1_200, "gold": 2_500, "platinum": 5_000}
CREDIT_LIMIT_RANGE: dict[Tier, tuple[int, int]] = {
    "classic": (1_000, 3_000),
    "gold": (3_000, 8_000),
    "platinum": (8_000, 20_000),
}
# The lowest score each tier needs; under REVIEW_FLOOR declines, between it and the
# classic floor goes to manual review.
TIER_SCORE_FLOOR: dict[Tier, int] = {"classic": 650, "gold": 700, "platinum": 750}
REVIEW_FLOOR = 580
MAX_DEBT_TO_INCOME = 0.45
MAX_DELINQUENCIES = 2

_BASE_POINTS = 300
_BAND_POINTS = {"excellent": 260, "good": 200, "fair": 140, "thin": 110, "poor": 40}
_BAND_LABELS = {
    "excellent": "Excelente",
    "good": "Bueno",
    "fair": "Regular",
    "thin": "Historial corto",
    "poor": "Débil",
}


def _score_band_label(score: int) -> str:
    if score >= 750:
        return "Excelente"
    if score >= 700:
        return "Muy bueno"
    if score >= 650:
        return "Bueno"
    if score >= REVIEW_FLOOR:
        return "En revisión"
    return "Insuficiente"


def _dti_points(dti: float) -> tuple[int, Reason]:
    pct = f"{dti * 100:.0f} %"
    if dti <= 0.15:
        return 150, Reason(
            code="DTI_LOW", text=f"Endeudamiento bajo ({pct} del ingreso)", effect="positive"
        )
    if dti <= 0.30:
        return 110, Reason(
            code="DTI_OK", text=f"Endeudamiento moderado ({pct} del ingreso)", effect="positive"
        )
    if dti <= 0.40:
        return 60, Reason(
            code="DTI_HIGH", text=f"Endeudamiento alto ({pct} del ingreso)", effect="negative"
        )
    return 20, Reason(
        code="DTI_LIMIT",
        text=f"Endeudamiento cerca del límite ({pct} del ingreso)",
        effect="negative",
    )


def _tenure_points(application: CardApplication) -> tuple[int, Reason]:
    status = application.employment_status
    months = application.employment_months
    if status is EmploymentStatus.RETIRED:
        return 60, Reason(
            code="INCOME_PENSION", text="Ingreso estable por pensión", effect="positive"
        )
    if status is EmploymentStatus.STUDENT:
        return 10, Reason(
            code="INCOME_STUDENT", text="Ingreso de estudiante, poco estable", effect="negative"
        )
    if months >= 60:
        return 90, Reason(
            code="TENURE_LONG", text="Más de 5 años en su actividad actual", effect="positive"
        )
    if months >= 24:
        return 70, Reason(
            code="TENURE_STABLE", text="Más de 2 años en su actividad actual", effect="positive"
        )
    if months >= 12:
        return 45, Reason(
            code="TENURE_OK", text="Más de 1 año en su actividad actual", effect="positive"
        )
    if months >= 6:
        return 20, Reason(
            code="TENURE_SHORT", text="Menos de 1 año en su actividad actual", effect="negative"
        )
    return 0, Reason(
        code="TENURE_NEW", text="Menos de 6 meses en su actividad actual", effect="negative"
    )


def _utilization_points(utilization: float) -> tuple[int, Reason]:
    pct = f"{utilization:.0f} %"
    if utilization <= 30:
        return 60, Reason(
            code="UTIL_LOW", text=f"Uso bajo de sus cupos de crédito ({pct})", effect="positive"
        )
    if utilization <= 50:
        return 35, Reason(
            code="UTIL_MID", text=f"Uso medio de sus cupos de crédito ({pct})", effect="positive"
        )
    if utilization <= 75:
        return 10, Reason(
            code="UTIL_HIGH", text=f"Uso alto de sus cupos de crédito ({pct})", effect="negative"
        )
    return 0, Reason(
        code="UTIL_MAX", text=f"Cupos de crédito casi agotados ({pct})", effect="negative"
    )


def _fit_tier(application: CardApplication) -> Tier:
    """The tier the travel profile gets the most value from, before approval."""
    if (
        application.trips_per_year >= 10
        or application.annual_travel_spend_usd >= 8_000
        or application.preferred_cabin == "business"
    ):
        return "platinum"
    if (
        application.trips_per_year >= 4
        or application.annual_travel_spend_usd >= 2_500
        or application.preferred_cabin == "premium"
    ):
        return "gold"
    return "classic"


def _credit_limit(tier: Tier, score: int, income: float) -> int:
    factor = 2.5 if score >= 750 else 2.0 if score >= 700 else 1.5
    low, high = CREDIT_LIMIT_RANGE[tier]
    raw = min(high, max(low, income * factor))
    return int(round(raw / 100) * 100)


class ScorecardEngine:
    """Deterministic rules: knock-outs first, then points, then per-tier income and score
    floors, then the recommendation among approved tiers by travel profile."""

    name = "scorecard-v1"

    async def assess(
        self, application: CardApplication, bureau: BureauRecord, *, today: date
    ) -> CreditAssessment:
        return self.assess_sync(application, bureau, today=today)

    def assess_sync(
        self, application: CardApplication, bureau: BureauRecord, *, today: date
    ) -> CreditAssessment:
        decided_at = datetime.now(UTC)
        income = application.monthly_income_usd
        knockouts: list[Reason] = []
        if today.year - application.birth_year < 18:
            knockouts.append(
                Reason(
                    code="KO_AGE",
                    text="El solicitante debe ser mayor de 18 años",
                    effect="negative",
                )
            )
        if income <= 0 or application.employment_status is EmploymentStatus.UNEMPLOYED:
            knockouts.append(
                Reason(
                    code="KO_NO_INCOME",
                    text="No registra un ingreso mensual verificable",
                    effect="negative",
                )
            )
        dti = application.monthly_obligations_usd / income if income > 0 else 1.0
        if income > 0 and dti > MAX_DEBT_TO_INCOME:
            knockouts.append(
                Reason(
                    code="KO_DTI",
                    text=f"Sus obligaciones son el {dti * 100:.0f} % del ingreso (máximo {MAX_DEBT_TO_INCOME * 100:.0f} %)",
                    effect="negative",
                )
            )
        if bureau.delinquencies_24m > MAX_DELINQUENCIES:
            knockouts.append(
                Reason(
                    code="KO_DELINQ",
                    text="Más de 2 moras en los últimos 24 meses",
                    effect="negative",
                )
            )
        if knockouts:
            return CreditAssessment(
                decision="declined",
                score=REVIEW_FLOOR - 1,
                score_band=_score_band_label(REVIEW_FLOOR - 1),
                reasons=knockouts,
                engine=self.name,
                decided_at=decided_at,
            )

        reasons: list[Reason] = []
        points = _BASE_POINTS + _BAND_POINTS[bureau.score_band]
        band_positive = bureau.score_band in {"excellent", "good"}
        reasons.append(
            Reason(
                code=f"BUREAU_{bureau.score_band.upper()}",
                text=f"Historial en central de riesgo: {_BAND_LABELS[bureau.score_band].lower()}",
                effect="positive" if band_positive else "negative",
            )
        )
        for part, reason in (
            _dti_points(dti),
            _tenure_points(application),
            _utilization_points(bureau.utilization_pct),
        ):
            points += part
            reasons.append(reason)
        if bureau.delinquencies_24m == 0:
            points += 40
            reasons.append(
                Reason(
                    code="NO_DELINQ", text="Sin moras en los últimos 24 meses", effect="positive"
                )
            )
        elif bureau.delinquencies_24m == 1:
            points += 10
            reasons.append(
                Reason(code="DELINQ_1", text="Una mora en los últimos 24 meses", effect="negative")
            )
        else:
            points -= 20
            reasons.append(
                Reason(code="DELINQ_2", text="Dos moras en los últimos 24 meses", effect="negative")
            )
        score = min(points, 850)

        approved: list[Tier] = []
        for tier in TIERS:
            if score < TIER_SCORE_FLOOR[tier]:
                continue
            if income < MIN_MONTHLY_INCOME[tier]:
                reasons.append(
                    Reason(
                        code=f"INCOME_BELOW_{tier.upper()}",
                        text=f"El ingreso no alcanza el mínimo de ${MIN_MONTHLY_INCOME[tier]:,.0f} para {tier.capitalize()}",
                        effect="negative",
                    )
                )
                continue
            approved.append(tier)

        if not approved:
            decision: Literal["approved", "review", "declined"] = (
                "review" if score >= REVIEW_FLOOR else "declined"
            )
            return CreditAssessment(
                decision=decision,
                score=score,
                score_band=_score_band_label(score),
                reasons=reasons,
                engine=self.name,
                decided_at=decided_at,
            )

        fit = _fit_tier(application)
        eligible = [tier for tier in approved if TIERS.index(tier) <= TIERS.index(fit)]
        recommended: Tier = eligible[-1] if eligible else approved[0]
        return CreditAssessment(
            decision="approved",
            score=score,
            score_band=_score_band_label(score),
            approved_tiers=approved,
            recommended_tier=recommended,
            credit_limit_usd=_credit_limit(recommended, score, income),
            reasons=reasons,
            engine=self.name,
            decided_at=decided_at,
        )

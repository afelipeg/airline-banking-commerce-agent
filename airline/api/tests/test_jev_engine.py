"""The Jev engine adds bounded judgments to the scorecard and falls back to it on failure."""

from datetime import date
from types import SimpleNamespace

import pytest

from airline.api.credit import BureauRecord, CardApplication, ScorecardEngine
from airline.api.jev_engine import JevCreditEngine, build_credit_engine

pytest.importorskip("typesafe_sdk")

TODAY = date(2026, 9, 24)
BUREAU = BureauRecord(
    score_band="good", delinquencies_24m=0, utilization_pct=28, open_credit_lines=2
)
MATEO = CardApplication(
    employment_status="employed",
    employer_description="Diseñador de producto",
    employment_months=38,
    monthly_income_usd=3200,
    monthly_obligations_usd=700,
    housing="rent",
    trips_per_year=4,
    usual_routes="MDE-BOG, BOG-MAD",
    annual_travel_spend_usd=3000,
    preferred_cabin="economy",
    goal="Acumular millas",
    birth_year=1994,
)


def score(value: float, confidence: float = 0.9):
    return SimpleNamespace(score=value, confidence=confidence)


class FakeJev:
    def __init__(self, answers=None, error: Exception | None = None):
        self.answers = answers or {}
        self.error = error
        self.calls = 0

    async def system_one(self, state, questions):
        self.calls += 1
        assert "birth_year" not in state["application"]
        assert set(questions) >= {
            "repayment_capacity",
            "income_stability",
            "application_consistency",
            "fit_gold",
        }
        if self.error:
            raise self.error
        return SimpleNamespace(answers=self.answers)


def answers(repayment=3, stability=2, inconsistent=0.05, fit=(1, 3, 3), confidence=0.9):
    return {
        "repayment_capacity": score(repayment, confidence),
        "income_stability": score(stability, confidence),
        "application_consistency": SimpleNamespace(noul=inconsistent),
        "fit_classic": score(fit[0]),
        "fit_gold": score(fit[1]),
        "fit_platinum": score(fit[2]),
    }


async def test_a_failing_jev_returns_the_scorecard_decision():
    engine = JevCreditEngine(FakeJev(error=TimeoutError()))
    result = await engine.assess(MATEO, BUREAU, today=TODAY)
    expected = ScorecardEngine().assess_sync(MATEO, BUREAU, today=TODAY)
    assert result.fallback_used
    assert (result.decision, result.approved_tiers) == (expected.decision, expected.approved_tiers)


async def test_low_confidence_is_not_used():
    engine = JevCreditEngine(FakeJev(answers(repayment=4, confidence=0.3)))
    result = await engine.assess(MATEO, BUREAU, today=TODAY)
    assert result.fallback_used
    assert result.score == 780


async def test_judgments_shift_the_score_within_the_band_and_fit_picks_the_tier():
    engine = JevCreditEngine(FakeJev(answers(repayment=4, stability=3, fit=(3, 2, 1))))
    result = await engine.assess(MATEO, BUREAU, today=TODAY)
    assert result.engine == "scorecard+jev-v1"
    assert result.score == 780 + 40 + 20
    assert result.approved_tiers == ["classic", "gold"]  # the income floor still holds
    assert result.recommended_tier == "classic"
    assert any(r.code == "JEV_CAPACITY" for r in result.reasons)


async def test_an_inconsistent_application_goes_to_review():
    engine = JevCreditEngine(FakeJev(answers(inconsistent=0.9)))
    result = await engine.assess(MATEO, BUREAU, today=TODAY)
    assert result.decision == "review"


async def test_knock_outs_never_reach_jev():
    fake = FakeJev(answers())
    result = await JevCreditEngine(fake).assess(
        MATEO.model_copy(update={"monthly_income_usd": 1500}), BUREAU, today=TODAY
    )
    assert result.decision == "declined" and fake.calls == 0


def test_the_scorecard_is_the_default(monkeypatch):
    monkeypatch.delenv("QUASAR_CREDIT_ENGINE", raising=False)
    assert isinstance(build_credit_engine(), ScorecardEngine)
    monkeypatch.setenv("QUASAR_CREDIT_ENGINE", "jev")
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert isinstance(build_credit_engine(), ScorecardEngine)

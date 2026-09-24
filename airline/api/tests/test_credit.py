"""The scorecard's decisions on the demo applicants and the edits a presenter makes."""

from datetime import date

from airline.api.credit import BureauRecord, CardApplication, ScorecardEngine

TODAY = date(2026, 9, 24)
GOOD_BUREAU = BureauRecord(
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


def assess(application: CardApplication, bureau: BureauRecord = GOOD_BUREAU):
    return ScorecardEngine().assess_sync(application, bureau, today=TODAY)


def test_mateo_is_approved_for_classic_and_gold_and_gold_is_recommended():
    result = assess(MATEO)
    assert result.decision == "approved"
    assert result.approved_tiers == ["classic", "gold"]
    assert result.recommended_tier == "gold"
    assert result.credit_limit_usd == 8000
    assert any(r.code == "INCOME_BELOW_PLATINUM" for r in result.reasons)


def test_a_higher_income_and_frequent_travel_unlock_platinum():
    result = assess(MATEO.model_copy(update={"monthly_income_usd": 6500, "trips_per_year": 12}))
    assert result.approved_tiers == ["classic", "gold", "platinum"]
    assert result.recommended_tier == "platinum"


def test_the_recommendation_never_exceeds_the_travel_profile():
    result = assess(
        MATEO.model_copy(
            update={"monthly_income_usd": 6500, "trips_per_year": 1, "annual_travel_spend_usd": 500}
        )
    )
    assert "platinum" in result.approved_tiers
    assert result.recommended_tier == "classic"


def test_debt_to_income_over_the_limit_declines():
    result = assess(MATEO.model_copy(update={"monthly_income_usd": 1500}))
    assert result.decision == "declined"
    assert result.approved_tiers == []
    assert [r.code for r in result.reasons] == ["KO_DTI"]


def test_a_new_job_and_heavy_debt_go_to_manual_review():
    result = assess(
        MATEO.model_copy(update={"employment_months": 3, "monthly_obligations_usd": 1400})
    )
    assert result.decision == "review"
    assert result.approved_tiers == []


def test_minors_and_repeat_delinquents_are_knocked_out():
    assert assess(MATEO.model_copy(update={"birth_year": 2010})).decision == "declined"
    bad = GOOD_BUREAU.model_copy(update={"delinquencies_24m": 3})
    assert assess(MATEO, bad).decision == "declined"

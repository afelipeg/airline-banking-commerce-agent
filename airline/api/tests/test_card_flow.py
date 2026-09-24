"""The card tiers only go in the cart when the backend approved them, and the host route is
the only way an application reaches the credit engine."""

import pytest
from shopping_agent import ShoppingSessionContext, Unavailable

from airline.api.credit import CardApplication
from airline.api.mock_quasar import MockQuasar


@pytest.fixture
def quasar() -> MockQuasar:
    return MockQuasar()


def mateo() -> ShoppingSessionContext:
    return ShoppingSessionContext(session_id="s-mateo", user_id="demo-user-2")


def valentina() -> ShoppingSessionContext:
    return ShoppingSessionContext(session_id="s-valentina", user_id="demo-user")


async def test_no_card_tier_goes_in_the_cart_before_an_application(quasar):
    with pytest.raises(Unavailable, match="approved credit application"):
        await quasar.add_to_cart(mateo(), "QA-CARD-100-CLASSIC", 1)


async def test_only_the_approved_tiers_can_be_added_after_the_decision(quasar):
    session = mateo()
    draft = quasar.application_prefill(session)
    assessment = await quasar.submit_card_application(
        session, CardApplication.model_validate(draft)
    )
    assert assessment.approved_tiers == ["classic", "gold"]
    cart = await quasar.add_to_cart(session, "QA-CARD-100-GOLD", 1)
    assert [line.product_id for line in cart.items] == ["QA-CARD-100-GOLD"]
    with pytest.raises(Unavailable, match="not approved"):
        await quasar.add_to_cart(session, "QA-CARD-100-PLATINUM", 1)
    context = await quasar.get_account_context(session)
    assert context["card_application"]["status"] == "decided"
    assert context["card"] is None


async def test_a_new_submission_replaces_the_decision_and_clears_the_card_line(quasar):
    session = mateo()
    draft = CardApplication.model_validate(quasar.application_prefill(session))
    await quasar.submit_card_application(session, draft)
    await quasar.add_to_cart(session, "QA-CARD-100-GOLD", 1)
    declined = await quasar.submit_card_application(
        session, draft.model_copy(update={"monthly_income_usd": 1500})
    )
    assert declined.decision == "declined"
    assert (await quasar.get_cart(session)).items == []


async def test_a_cardholder_gets_the_preapproved_upgrade_only(quasar):
    session = valentina()
    with pytest.raises(Unavailable, match="already holds"):
        await quasar.add_to_cart(session, "QA-CARD-100-GOLD", 1)
    with pytest.raises(Unavailable):
        await quasar.add_to_cart(session, "QA-CARD-100-CLASSIC", 1)
    cart = await quasar.add_to_cart(session, "QA-CARD-100-PLATINUM", 1)
    assert cart.items[0].product_id == "QA-CARD-100-PLATINUM"


async def test_a_sold_out_cabin_is_unavailable(quasar):
    with pytest.raises(Unavailable):
        await quasar.add_to_cart(mateo(), "QA-0418-BUS", 1)


async def test_a_dated_route_search_returns_that_route(quasar):
    from shopping_agent import SearchFilters

    results = await quasar.search_products(
        mateo(),
        "vuelo Bogotá Madrid",
        SearchFilters(
            attributes={"origin": "BOG", "destination": "MAD", "travel_date": "2026-10-21"}
        ),
    )
    assert results and results[0].product_id == "QA-0615"


def test_the_application_route_decides_and_queues_an_app_event(main, client, shopper):
    headers = shopper(user_id="demo-user-2")
    prefill = main.backend.application_prefill(
        ShoppingSessionContext(session_id="unused", user_id="demo-user-2")
    )
    refused = client.post(
        "/api/card-application",
        json=prefill | {"consent_bureau": False, "accept_terms": True},
        headers=headers,
    )
    assert refused.status_code == 400
    response = client.post(
        "/api/card-application",
        json=prefill | {"consent_bureau": True, "accept_terms": True},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["assessment"]["decision"] == "approved"
    assert body["account"]["card_application"]["status"] == "decided"

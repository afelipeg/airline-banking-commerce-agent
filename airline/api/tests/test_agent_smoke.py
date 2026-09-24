"""The shopping agent runs a turn over the Quasar backend with a scripted client, and the
card cards render from backend state only."""

from commerce_common.memory import InMemoryMemoryStore
from commerce_common.testing import FakeClient, text_message, tool_use_message
from shopping_agent import ShoppingSessionContext, ShoppingSessionState
from shopping_agent_runtime import ShoppingAgent

from airline.api.agent_config import build_shopping_config
from airline.api.card_flow import build_card_extensions
from airline.api.comparison import build_comparison_extension
from airline.api.credit import CardApplication
from airline.api.main import SKILLS_DIR
from airline.api.mock_quasar import MockQuasar


def build_agent(backend: MockQuasar, *responses) -> ShoppingAgent:
    return ShoppingAgent(
        backend=backend,
        skills_dir=SKILLS_DIR / "shopping",
        config=build_shopping_config(),
        memory_store=InMemoryMemoryStore(),
        client=FakeClient(list(responses)),
        extra_presentation_tools=[build_comparison_extension(), *build_card_extensions()],
    )


async def run(agent: ShoppingAgent, session: ShoppingSessionContext, text: str, state=None):
    messages = [{"role": "user", "content": text}]
    return [event async for event in agent.stream_turn(messages, session, state)]


async def test_a_turn_streams_text():
    agent = build_agent(MockQuasar(), text_message("¡Hola! Soy el Asistente Quasar."))
    session = ShoppingSessionContext(session_id="smoke", user_id="demo-user-2")
    events = await run(agent, session, "hola")
    assert any(event.type == "text_delta" for event in events)


async def test_the_decision_card_is_refused_before_an_application_and_filled_after():
    backend = MockQuasar()
    session = ShoppingSessionContext(session_id="smoke-card", user_id="demo-user-2")
    state = ShoppingSessionState()
    agent = build_agent(
        backend,
        tool_use_message("present_credit_decision", {}),
        text_message("Primero necesitas enviar la solicitud."),
    )
    events = await run(agent, session, "¿me aprobaron?", state)
    assert not any(event.type == "ui" for event in events)

    draft = CardApplication.model_validate(backend.application_prefill(session))
    await backend.submit_card_application(session, draft)
    agent = build_agent(
        backend,
        tool_use_message("present_credit_decision", {"note": "La Gold encaja con tus viajes."}),
        text_message("¡Aprobada!"),
    )
    events = await run(agent, session, "Listo, envié mi solicitud.", state)
    cards = [event.data for event in events if event.type == "ui"]
    assert cards and cards[0]["component"] == "credit_decision"
    payload = cards[0]["payload"] if "payload" in cards[0] else cards[0]
    assert payload["recommended_product_id"] == "QA-CARD-100-GOLD"
    assert "QA-CARD-100-GOLD" in state.seen_products

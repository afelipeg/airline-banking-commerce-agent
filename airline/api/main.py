"""Quasar Airlines API: the storefront routes over ``MockQuasar``, the Quasar-only routes
below (account, direct add, the card application), and the operations router under
/api/merchant.

    .venv/bin/uvicorn airline.api.main:app --app-dir . --reload --port 8000

The demo has two profiles: ``demo-user`` (Valentina, holds the Quasar Visa Gold) and
``demo-user-2`` (Mateo, no card: the credit-application path). The storefront's profile
switcher starts a session for the chosen one.
"""

from __future__ import annotations

from commerce_common.memory import InMemoryMemoryStore
from fastapi import HTTPException
from shopping_agent_runtime import ShoppingAgent

from demo_common import (
    CartAddRequest,
    MemorySeeder,
    build_storefront_host,
    load_demo_env,
)

from .agent_config import build_shopping_config
from .card_flow import build_card_extensions
from .comparison import build_comparison_extension
from .credit import CardApplication, CardApplicationSubmission
from .jev_engine import build_credit_engine
from .merchant import create_merchant_router
from .mock_quasar import DATA_DIR, CardHeld, MockQuasar

SKILLS_DIR = DATA_DIR.parent / "skills"

load_demo_env(DATA_DIR.parent)

backend = MockQuasar(engine=build_credit_engine())
agent = ShoppingAgent(
    backend=backend,
    skills_dir=SKILLS_DIR / "shopping",
    config=build_shopping_config(),
    memory_store=InMemoryMemoryStore(),
    extra_presentation_tools=[build_comparison_extension(), *build_card_extensions()],
)
host = build_storefront_host(
    title="Quasar Airlines demo API",
    example_root=DATA_DIR.parent,
    backend=backend,
    agent=agent,
    memory_seeder=MemorySeeder(DATA_DIR / "memory-seed.json"),
)
app = host.app
app.include_router(create_merchant_router(backend, InMemoryMemoryStore()), prefix="/api/merchant")

# The card and Quasar Pay go through the assistant (the card needs a credit decision and
# both have terms to review); everything else can be added from its tile.
_DIRECT_ADD_CATEGORIES = {"flights", "ancillaries", "miles", "insurance"}


def _category(product_id: str) -> str | None:
    product = backend.product(product_id)
    if product is None:
        return None
    if product.category:
        return product.category
    family = backend.product(product.variant_of) if product.variant_of else None
    return family.category if family else None


@app.post("/api/cart/add")
async def cart_add(request: CartAddRequest, record: host.CurrentSession) -> dict:
    if _category(request.product_id) not in _DIRECT_ADD_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=(
                "La tarjeta Quasar y Quasar Pay se solicitan con el asistente, para revisar "
                "primero sus condiciones."
            ),
        )
    return await host.direct_add(
        record,
        request,
        note="Customer tapped the add button on {title} ({product_id}), quantity {quantity}.",
    )


@app.get("/api/account")
async def get_account(record: host.CurrentSession) -> dict:
    """The profile's account context, as the agent sees it, for the storefront chrome."""
    return {"account": await backend.get_account_context(host.context(record))}


@app.post("/api/card-application")
async def submit_card_application(
    request: CardApplicationSubmission, record: host.CurrentSession
) -> dict:
    """The application form's submit. The applicant's data goes from the form to the credit
    engine here and never through the model; the agent hears only that a decision exists
    and reads it from the account context on the next turn."""
    if not (request.consent_bureau and request.accept_terms):
        raise HTTPException(
            status_code=400,
            detail="Para enviar la solicitud debes autorizar la consulta y aceptar los términos.",
        )
    context = host.context(record)
    application = CardApplication.model_validate(
        request.model_dump(exclude={"consent_bureau", "accept_terms"})
    )
    try:
        assessment = await backend.submit_card_application(context, application)
    except CardHeld as exc:
        raise HTTPException(
            status_code=400,
            detail="Ya tienes una tarjeta Quasar Visa; pregunta al asistente por el upgrade.",
        ) from exc
    record.pending_app_events.append(
        "The customer submitted the Quasar Visa application form; the credit engine's decision "
        f"({assessment.decision}) is in the account context under card_application. Present it "
        "with present_credit_decision."
    )
    return {
        "ok": True,
        "assessment": assessment.model_dump(mode="json"),
        "account": await backend.get_account_context(context),
    }

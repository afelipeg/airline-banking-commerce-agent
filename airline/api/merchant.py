"""The Quasar Airlines operations router: the shared portal routes over
``MockQuasarMerchant``, the ``present_portfolio_mix`` extension, and the portal's portfolio
read (served at ``/base``, the path the portal's portfolio view fetches)."""

from __future__ import annotations

from commerce_common.memory import MemoryStore
from fastapi import APIRouter
from merchant_agent_runtime import MerchantAgent

from demo_common import MerchantIdentity, build_merchant_router

from .agent_config import build_merchant_config
from .mock_merchant import MockQuasarMerchant
from .mock_quasar import DATA_DIR, MockQuasar
from .portfolio_mix import build_portfolio_mix_extension

IDENTITY = MerchantIdentity(merchant_id="quasar-ops", operator="Laura")


def create_merchant_router(storefront: MockQuasar, memory_store: MemoryStore) -> APIRouter:
    config = build_merchant_config(storefront.store_name)
    merchant = MockQuasarMerchant(storefront, config)
    agent = MerchantAgent(
        backend=merchant,
        skills_dir=DATA_DIR.parent / "skills" / "merchant",
        config=config,
        memory_store=memory_store,
        extra_presentation_tools=[build_portfolio_mix_extension(merchant)],
    )
    return build_merchant_router(
        storefront=storefront,
        backend=merchant,
        agent=agent,
        identity=IDENTITY,
        example_dir="airline",
        overview_extras=lambda: {"today": merchant.today_snapshot()},
        portal_reads={"/base": merchant.base_overview},
    )

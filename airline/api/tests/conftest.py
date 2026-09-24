import pytest

from airline.api import main as main_module
from airline.api.agent_config import build_merchant_config
from airline.api.merchant import IDENTITY, create_merchant_router
from airline.api.mock_merchant import MockQuasarMerchant
from airline.api.mock_quasar import MockQuasar
from airline.api.portfolio_mix import build_portfolio_mix_extension
from demo_common.tests.fixtures import *  # noqa: F403


@pytest.fixture(scope="session")
def main():
    return main_module


@pytest.fixture(scope="session")
def make_storefront():
    return MockQuasar


@pytest.fixture
def merchant(backend) -> MockQuasarMerchant:
    return MockQuasarMerchant(backend, build_merchant_config("Quasar Airlines"))


@pytest.fixture
def merchant_extensions(merchant) -> list:
    return [build_portfolio_mix_extension(merchant)]


@pytest.fixture(scope="session")
def merchant_identity():
    return IDENTITY


@pytest.fixture(scope="session")
def make_merchant_router():
    return create_merchant_router


@pytest.fixture(scope="session")
def extra_public_routes() -> set[str]:
    return set()


@pytest.fixture(scope="session")
def restockable_listing() -> None:
    """Seat capacity is fixed and every other product is a service: nothing restocks."""
    return None


@pytest.fixture(scope="session")
def cart_product() -> str:
    return "QA-ANC-101"


@pytest.fixture(scope="session")
def relevance_probe() -> tuple[str, str, str, set[str]]:
    """Query, non-relevance sort, the product it must lead with, one-token matches it must omit."""
    return ("seguro de viaje Quasar Protect", "price_asc", "QA-INS-300", {"QA-ANC-140"})


def pytest_collection_modifyitems(items):
    """The storefront has no showcase pages, so the shared showcase check does not apply."""
    skip = pytest.mark.skip(reason="the Quasar storefront ships no showcase-fixtures.ts")
    for item in items:
        if item.name == "test_showcase_products_are_catalog_records_plus_the_backends_stamps":
            item.add_marker(skip)

import pytest
from httpx import AsyncClient, ASGITransport

from backend.main import app
from backend.signaling import manager, SignalingRoom


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def reset_manager():
    """Reset the global manager between tests."""
    manager._rooms.clear()
    yield
    manager._rooms.clear()


@pytest.fixture
def fresh_room():
    return SignalingRoom("test")

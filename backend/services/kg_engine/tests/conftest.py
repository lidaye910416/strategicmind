"""
conftest for backend/services/kg_engine/tests/.

Pre-stubs the broken ``backend.services`` package so pytest's
collection doesn't execute the broken
``__init__.py → service_factory → ..interfaces.graph_store`` chain.

The chain fails because ``backend/services/service_factory.py`` does
``from ..interfaces.graph_store import IGraphStore`` — a relative
import that goes "up two" from ``backend.services`` to (the
non-existent) ``backend`` package.

The stubs in this conftest make ``from .service_factory import
ServiceFactory`` in ``backend/services/__init__.py`` resolve to a
no-op class, so the broken chain inside service_factory is never
executed.
"""

import sys
import types
from pathlib import Path


def _project_root() -> Path:
    cur = Path(__file__).resolve().parent
    for _ in range(8):
        if (cur / "backend" / "services" / "kg_engine").is_dir():
            return cur
        cur = cur.parent
    return Path(__file__).resolve().parents[5]


_ROOT = _project_root()
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _stub(name, **attrs):
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod


# Stub the deepest chain first (leaf modules).
_stub("backend.models.strategic_agent", AgentType=object)
_stub(
    "backend.interfaces.knowledge_store",
    IKnowledgeStore=type("IKnowledgeStore", (), {}),
)
_stub(
    "backend.interfaces.llm_provider",
    ILLMProvider=type("ILLMProvider", (), {}),
)
_stub(
    "backend.interfaces.graph_store",
    IGraphStore=type("IGraphStore", (), {}),
)


# Stub service_factory LAST — ``from .service_factory import
# ServiceFactory`` in ``backend/services/__init__.py`` resolves to
# this stub, so the broken chain inside service_factory is never
# executed.
class _StubServiceFactory:
    pass


_stub(
    "backend.services.service_factory",
    ServiceFactory=_StubServiceFactory,
)

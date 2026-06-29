"""
conftest for backend/services/kg_engine/tests/.

Why this file exists
--------------------
The tests live at ``backend/services/kg_engine/tests/`` which sits
inside ``backend/services/``. Pytest's rootdir is ``backend/`` (per
``backend/pytest.ini``), so the test file's parent package is
``backend.services`` — but ``backend.services`` has a broken
``__init__.py`` chain
(``service_factory`` → ``..interfaces.graph_store`` relative import)
that fires at collection time and aborts the test run.

This conftest lives in the same directory as the test file. When
the directory has no ``__init__.py``, pytest treats the tests as a
"rootless" collection of modules and imports each test file
directly — bypassing the broken parent ``__init__.py``. The conftest
itself runs BEFORE the test file's body, and is responsible for
preparing the import path so the test can ``import networkx`` and
its own helpers normally.

The conftest does NOT trigger any ``from backend.services...``
import — it only manipulates ``sys.path``. The test file uses the
same sys.path trick to import ``kg_engine`` directly from its
file path.
"""

import sys
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

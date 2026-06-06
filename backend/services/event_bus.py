"""
EventBus - Per-run in-process pub/sub for real-time pipeline events.

Provides:
    - per-run_id asyncio.Queue subscribers (used by SSE endpoint)
    - per-run_id history buffer (ring, max 200 events) for REST catch-up
    - thread-safe publish (pipeline runs in mixed thread + asyncio context)
    - module-level singleton `event_bus` for convenient import

Frame structure (per arch-spec §1.1):
    {
        "type": "live_event",
        "stage": <stage_name or None>,
        "ts": <float seconds>,
        "event": {
            "type": <event_type string, e.g. "round_progress">,
            "data": <event-specific payload dict>,
        },
    }

Implements: arch-spec §2.1 (event_bus.py)
"""
import asyncio
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional


class EventBus:
    """In-process per-run pub/sub with bounded history buffer.

    Concurrency model:
        - publish is sync + thread-safe (uses `threading.Lock`).
        - subscribers receive via `asyncio.Queue` (must be awaited from a
          running event loop). Senders use `put_nowait` so a slow
          subscriber cannot backpressure the pipeline.
        - history is a bounded `deque(maxlen=HISTORY_MAXLEN)` per run.
    """

    HISTORY_MAXLEN = 200  # ring size per run_id
    SUBSCRIBER_QUEUE_MAX = 1024  # backpressure cap per subscriber

    def __init__(self) -> None:
        self._history: Dict[str, Deque[dict]] = {}
        self._subs: Dict[str, List[asyncio.Queue]] = {}
        self._lock = threading.Lock()

    # ---------- Publish ----------

    def emit(
        self,
        run_id: str,
        event_type: str,
        data: Dict[str, Any],
        stage: Optional[str] = None,
    ) -> None:
        """Publish an event for `run_id`.

        Appends a frame to history (ring) and fans it out to all live
        subscribers. Silently drops frames for slow subscribers.
        """
        frame: Dict[str, Any] = {
            "type": "live_event",
            "ts": time.time(),
            "event": {
                "type": event_type,
                "data": data,
            },
        }
        if stage:
            frame["stage"] = stage

        with self._lock:
            hist = self._history.setdefault(
                run_id, deque(maxlen=self.HISTORY_MAXLEN)
            )
            hist.append(frame)
            # Snapshot subscriber list under lock to avoid race with unsubscribe
            subs = list(self._subs.get(run_id, []))

        for q in subs:
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                # Slow subscriber - drop this frame for that queue only.
                # Other subscribers and history are unaffected.
                pass
            except Exception:
                # Defensive: never let a single bad subscriber break the bus.
                pass

    # ---------- Subscribe ----------

    def subscribe(self, run_id: str) -> asyncio.Queue:
        """Create a new subscriber queue for `run_id`.

        The caller is responsible for:
            - calling `unsubscribe(run_id, queue)` when done
            - reading from the queue with `await queue.get()` from an
              asyncio event loop.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=self.SUBSCRIBER_QUEUE_MAX)
        with self._lock:
            self._subs.setdefault(run_id, []).append(q)
        return q

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        """Remove a subscriber queue (idempotent)."""
        with self._lock:
            subs = self._subs.get(run_id, [])
            if queue in subs:
                subs.remove(queue)

    # ---------- History (REST catch-up) ----------

    def get_history(
        self,
        run_id: str,
        since_ts: Optional[float] = None,
    ) -> List[dict]:
        """Return history frames for `run_id`, optionally filtered by ts.

        If `since_ts` is given, returns frames with `ts > since_ts`.
        If run_id has no history yet, returns [].
        """
        with self._lock:
            hist = self._history.get(run_id)
            if hist is None:
                return []
            snapshot = list(hist)
        if since_ts is None:
            return snapshot
        return [f for f in snapshot if f.get("ts", 0.0) > since_ts]

    # ---------- Lifecycle ----------

    def close(self, run_id: str) -> None:
        """Close all subscriber queues for `run_id` and drop history.

        Called when a pipeline run is disposed. Sends a `closed` sentinel
        to each subscriber so SSE generators can exit cleanly.
        """
        with self._lock:
            subs = self._subs.pop(run_id, [])
            self._history.pop(run_id, None)
        sentinel = {"type": "closed", "ts": time.time(), "run_id": run_id}
        for q in subs:
            try:
                q.put_nowait(sentinel)
            except Exception:
                pass


# Module-level singleton (used by default; tests can instantiate their own)
event_bus = EventBus()

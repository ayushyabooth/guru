"""In-memory ring buffer for API response times and ingestion step timings.

Used by:
- API timing middleware (main.py) to record per-request response times
- Ingestion orchestrator to record step-level timings
- /admin/perf-metrics endpoint to serve data to the Dev Metrics Panel
"""

import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class APICallRecord:
    method: str
    path: str
    status_code: int
    duration_ms: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class IngestionTimingRecord:
    tier: str
    step: str
    duration_ms: float
    detail: str = ""
    timestamp: float = field(default_factory=time.time)


class PerfStore:
    """Thread-safe singleton storing recent performance metrics in memory."""

    _instance: Optional["PerfStore"] = None
    _lock = threading.Lock()

    def __init__(self, max_api_records: int = 200, max_ingestion_records: int = 100):
        self._api_records: deque[APICallRecord] = deque(maxlen=max_api_records)
        self._ingestion_records: deque[IngestionTimingRecord] = deque(maxlen=max_ingestion_records)
        self._api_lock = threading.Lock()
        self._ingestion_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> "PerfStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # --- API Timing ---

    def record_api_call(self, method: str, path: str, status_code: int, duration_ms: float):
        with self._api_lock:
            self._api_records.append(APICallRecord(
                method=method, path=path, status_code=status_code, duration_ms=duration_ms
            ))

    def get_api_summary(self) -> Dict:
        """Return P50/P95/max grouped by endpoint, plus last N raw records."""
        with self._api_lock:
            records = list(self._api_records)

        if not records:
            return {"endpoints": {}, "recent": [], "total_requests": 0}

        # Group by path
        by_endpoint: Dict[str, List[float]] = defaultdict(list)
        for r in records:
            # Normalize paths: strip query params, collapse UUIDs
            path = r.path.split("?")[0]
            by_endpoint[path].append(r.duration_ms)

        endpoints = {}
        for path, durations in sorted(by_endpoint.items()):
            durations.sort()
            n = len(durations)
            endpoints[path] = {
                "count": n,
                "p50_ms": round(durations[n // 2], 1),
                "p95_ms": round(durations[int(n * 0.95)], 1) if n >= 2 else round(durations[-1], 1),
                "max_ms": round(durations[-1], 1),
                "avg_ms": round(sum(durations) / n, 1),
            }

        # Last 20 raw records (most recent first)
        recent = [
            {
                "method": r.method,
                "path": r.path,
                "status": r.status_code,
                "ms": round(r.duration_ms, 1),
                "ago_s": round(time.time() - r.timestamp, 1),
            }
            for r in reversed(records[-20:])
        ]

        # Top 5 slowest endpoints
        slowest = sorted(endpoints.items(), key=lambda x: x[1]["p95_ms"], reverse=True)[:5]

        return {
            "endpoints": endpoints,
            "recent": recent,
            "slowest": [{"path": p, **s} for p, s in slowest],
            "total_requests": len(records),
        }

    # --- Ingestion Timing ---

    def record_ingestion_step(self, tier: str, step: str, duration_ms: float, detail: str = ""):
        with self._ingestion_lock:
            self._ingestion_records.append(IngestionTimingRecord(
                tier=tier, step=step, duration_ms=duration_ms, detail=detail
            ))

    def get_ingestion_summary(self) -> Dict:
        """Return ingestion step timings grouped by tier."""
        with self._ingestion_lock:
            records = list(self._ingestion_records)

        if not records:
            return {"tiers": {}, "total_steps": 0}

        by_tier: Dict[str, List[Dict]] = defaultdict(list)
        for r in records:
            by_tier[r.tier].append({
                "step": r.step,
                "ms": round(r.duration_ms, 1),
                "detail": r.detail,
                "ago_s": round(time.time() - r.timestamp, 1),
            })

        return {
            "tiers": dict(by_tier),
            "total_steps": len(records),
        }

    def clear(self):
        """Clear all records (for testing)."""
        with self._api_lock:
            self._api_records.clear()
        with self._ingestion_lock:
            self._ingestion_records.clear()

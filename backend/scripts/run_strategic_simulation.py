"""
run_strategic_simulation.py - CLI entry point for strategic simulations.

Wraps PipelineOrchestrator for command-line use:
    python -m backend.scripts.run_strategic_simulation \\
        --config path/to/config.json \\
        --max-rounds 5

Implements: US-077
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Make project importable
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Mirror the run_server env setup
BACKEND_DIR = ROOT / "backend"
os.environ.setdefault("UPLOAD_FOLDER", str(BACKEND_DIR / "uploads"))
os.environ.setdefault("REPORTS_DIR", str(BACKEND_DIR / "data" / "reports"))
os.environ.setdefault("PIPELINE_CHECKPOINT_DIR", str(BACKEND_DIR / "data" / "pipelines"))
for d in (os.environ["UPLOAD_FOLDER"], os.environ["REPORTS_DIR"],
          os.environ["PIPELINE_CHECKPOINT_DIR"]):
    Path(d).mkdir(parents=True, exist_ok=True)


def run_simulation(config_path: str, max_rounds: int = 10) -> int:
    """Run a strategic simulation synchronously and return the run id."""
    from backend.services.pipeline_orchestrator import PipelineOrchestrator

    with open(config_path, "r") as f:
        cfg = json.load(f)

    run_id = f"cli_{int(time.time())}"
    cfg.setdefault("max_rounds", max_rounds)
    cfg["run_id"] = run_id

    orch = PipelineOrchestrator()
    orch.start(run_id, cfg)

    # Poll until terminal
    deadline = time.time() + 600
    while time.time() < deadline:
        snap = orch.get_run(run_id)
        if snap and snap.get("status") in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.5)
    else:
        print("⏱ Timeout waiting for pipeline to finish")
        return 2

    final = orch.get_run(run_id)
    print(f"\n{'='*60}")
    print(f"Pipeline {run_id}: {final['status']}")
    print(f"{'='*60}")
    print(f"Completed stages: {final.get('completed_stages', [])}")
    print(f"Progress: {final.get('progress', 0):.2f}")
    if final.get("error"):
        print(f"Error: {final['error'][:500]}")
    for stage, art in (final.get("artifacts") or {}).items():
        if stage.startswith("_"):
            continue
        if isinstance(art, dict):
            summary = {k: v for k, v in art.items() if not isinstance(v, (list, dict))}
            print(f"  {stage}: {summary}")
    if final.get("status") == "completed":
        print(f"\n📄 Report: /api/report/{run_id}")
        print(f"   File:   {os.environ['REPORTS_DIR']}/{run_id}.md")
    return 0 if final.get("status") == "completed" else 1


def main():
    parser = argparse.ArgumentParser(description="Run a strategic-mind simulation.")
    parser.add_argument("--config", required=True, help="Path to JSON config")
    parser.add_argument("--max-rounds", type=int, default=10, help="Max rounds")
    args = parser.parse_args()
    sys.exit(run_simulation(args.config, args.max_rounds))


if __name__ == "__main__":
    main()

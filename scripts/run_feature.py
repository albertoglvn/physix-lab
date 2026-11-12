"""Run a planned feature command when its entry point exists."""

import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY_POINTS = {
    "data.generate": ROOT,
    "model.train": ROOT,
    "model.export": ROOT,
    "physix_mcp.server": ROOT / "mcp",
}


def main() -> None:
    module = sys.argv.pop(1)
    source_root = ENTRY_POINTS[module]
    module_path = source_root.joinpath(*module.split(".")).with_suffix(".py")
    if not module_path.is_file():
        raise SystemExit(
            f"{module} is planned but unavailable in this scaffold. See docs/PLAN.md."
        )

    sys.path.insert(0, str(source_root))
    runpy.run_module(module, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()

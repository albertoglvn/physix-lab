"""Run pytest while allowing the initial, intentionally empty suite."""

from pathlib import Path

import pytest

TEST_ROOT = Path(__file__).resolve().parents[1] / "tests"


def main() -> int:
    exit_code = pytest.main()
    if exit_code == pytest.ExitCode.NO_TESTS_COLLECTED and not any(
        path.is_file()
        for pattern in ("test_*.py", "*_test.py")
        for path in TEST_ROOT.rglob(pattern)
    ):
        return 0
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

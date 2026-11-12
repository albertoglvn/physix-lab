# Physix

Physix is a monorepo for fast, solver-backed estimates of 2D linear-elastic stress fields in parametric plates and brackets with holes. The v1 design pairs a five-member PyTorch U-Net ensemble with a scikit-fem reference solver. Agents will use the Python MCP server and Codex skill. The browser will run exported ONNX models locally.

This commit establishes the development harness and a minimal React entry point. The geometry generator, solver, data pipeline, models, MCP tools, and stress visualization are scheduled in the [milestone plan](docs/PLAN.md).

## Setup

Install GNU Make, [uv 0.13.5](https://docs.astral.sh/uv/), [Node.js 22.18.0](https://nodejs.org/), and [pnpm 11.25.0](https://pnpm.io/installation). On Windows, use GNU Make from your development shell or use the direct commands below in PowerShell. uv selects Python 3.11 and can install it if needed.

```sh
make setup
make lint
make test
make web
```

Direct setup and verification commands for shells without GNU Make:

```sh
uv sync --all-groups
pnpm install
uv run --no-sync pre-commit install
uv run --no-sync ruff check .
uv run --no-sync ruff format --check .
pnpm --filter @physix/web run lint
uv run --no-sync python -m scripts.run_tests
pnpm --filter @physix/web run test
pnpm --filter @physix/web run build
```

Direct dependencies are pinned in the manifests. The first online setup generates `uv.lock` and `pnpm-lock.yaml`. Commit both generated files together. Once present, `make setup` enforces them. For direct setup with lockfiles, use `uv sync --locked --all-groups` and `pnpm install --frozen-lockfile`. The default model environment uses CPU PyTorch. Initial setup needs access to PyPI, the PyTorch wheel index, and the npm registry.

## Commands

| Target | Purpose |
| --- | --- |
| `make setup` | Sync Python and web dependencies and install Git hooks |
| `make gen-data` | Run the dataset generator once `data.generate` lands |
| `make train` | Train the five-member ensemble once `model.train` lands |
| `make export` | Export the ensemble once `model.export` lands |
| `make mcp` | Launch the MCP server once `physix_mcp.server` lands |
| `make web` | Start the Vite development server |
| `make test` | Run pytest and Vitest, including the initial empty suites |
| `make lint` | Check Python and web lint and formatting |

The four planned Python targets accept `ARGS="..."` and exit with an explanatory error until their entry points are implemented.

## Repository

| Path | Owner and purpose |
| --- | --- |
| `physics/` | Parametric geometry, validation, meshing, and scikit-fem reference solves |
| `data/` | Sampling, rasterization, dataset manifests, and active-learning intake |
| `model/` | PyTorch ensemble, training, calibration, evaluation, and ONNX export |
| `mcp/physix_mcp/` | Python MCP server and solver-backed tool orchestration |
| `web/` | React, TypeScript, Vite, and browser ONNX inference |
| `skills/physix/` | Repository Codex skill for choosing and interpreting MCP tools |
| `scripts/` | Development command entry points |
| `tests/` | Python tests organized by module |
| `docs/` | [Milestones](docs/PLAN.md) and [two-minute demo](docs/DEMO.md) |

The planned free demo deploy is a static build from `web/dist/` on GitHub Pages for a public repository. The local MCP server will provide live FEM fallback and active-learning intake. See [GitHub Pages hosting requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Read [AGENTS.md](AGENTS.md) before changing shared contracts or reporting solver comparisons.

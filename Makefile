UV ?= uv
PNPM ?= pnpm

# A first setup creates missing lockfiles. Existing lockfiles are enforced.
UV_SYNC_FLAGS := $(if $(wildcard uv.lock),--locked)
PNPM_INSTALL_FLAGS := $(if $(wildcard pnpm-lock.yaml),--frozen-lockfile,--no-frozen-lockfile)

UV_RUN = $(UV) run --no-sync
WEB = $(PNPM) --filter @physix/web

.DEFAULT_GOAL := setup
.PHONY: setup gen-data train export mcp serve web demo test lint

setup:
	$(UV) sync $(UV_SYNC_FLAGS) --all-groups
	$(PNPM) install $(PNPM_INSTALL_FLAGS)
	$(UV_RUN) pre-commit install

gen-data:
	$(UV_RUN) python -m scripts.run_feature data.generate $(ARGS)

train:
	$(UV_RUN) python -m scripts.run_feature model.train $(ARGS)

export:
	$(UV_RUN) python -m scripts.run_feature model.export $(ARGS)

mcp:
	$(UV_RUN) python -m scripts.run_feature physix_mcp.server $(ARGS)

# Local HTTP API on 127.0.0.1:8765 (FEM verification, prediction and optimisation).
serve:
	$(UV_RUN) python -m scripts.run_feature physix_mcp.http_api $(ARGS)

web:
	$(WEB) run dev

# Production build of the web app served by the local API at http://127.0.0.1:8765.
demo:
	$(WEB) run build
	$(UV_RUN) python -m scripts.run_feature physix_mcp.http_api --static web/dist $(ARGS)

test:
	$(UV_RUN) python -m scripts.run_tests
	$(WEB) run test

lint:
	$(UV_RUN) ruff check .
	$(UV_RUN) ruff format --check .
	$(WEB) run lint

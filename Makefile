# Dev environment for the isaacwallace.dev portfolio network.
#
#   make up        → everything in Docker (Postgres + APIs + all public sites)
#   make dev-db    → just Postgres in Docker; run apps natively for hot reload:
#                      make dev-api / dev-web / dev-cyberlab  (one terminal each)
#
# Day-to-day: code with the native dev targets (fast HMR); use `make up` to demo
# the whole network or sanity-check the real images.

COMPOSE := docker compose

.PHONY: help up down build rebuild logs ps fresh dev-db dev-auth-service dev-api dev-web dev-admin dev-cyberlab dev-homelab dev-ailab check ci lint fmt format-check test security k8s-validate smoke clean

help: ## list targets
	@grep -E '^[a-zA-Z-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ── full stack in docker ──────────────────────────────────────────────────

up: ## build + start the database, APIs, and all five sites
	$(COMPOSE) up -d --build
	@echo "portfolio     http://localhost:3000"
	@echo "cyberlab      http://localhost:3001"
	@echo "homelab       http://localhost:3002"
	@echo "ailab         http://localhost:3003"
	@echo "admin         http://localhost:3004"
	@echo "auth+sign-in  http://localhost:5170/login"
	@echo "api           http://localhost:5180/health"

down: ## stop the stack (keeps the database volume)
	$(COMPOSE) down

build: ## build all images
	$(COMPOSE) build

rebuild: ## build all images from scratch
	$(COMPOSE) build --no-cache

logs: ## follow logs (make logs s=api for one service)
	$(COMPOSE) logs -f $(s)

ps: ## show service status
	$(COMPOSE) ps

fresh: ## stop everything AND delete the database volume
	$(COMPOSE) down -v

## ── hybrid dev: db in docker, apps native (fast hot reload) ───────────────

dev-db: ## start only Postgres
	$(COMPOSE) up -d db

dev-auth-service: ## run the auth service natively with hot reload (:5170), against docker Postgres
	cd apps/auth && ConnectionStrings__Postgres="Host=localhost;Port=5432;Database=iw;Username=iw;Password=iw-dev-only" dotnet watch --launch-profile http

dev-api: ## run the general app API natively with hot reload (:5180), against docker Postgres
	cd apps/api && ConnectionStrings__Postgres="Host=localhost;Port=5432;Database=iw;Username=iw;Password=iw-dev-only" dotnet watch --launch-profile http

dev-web: ## run the main site natively with hot reload (:3000)
	cd apps/web && npm run dev

dev-admin: ## run the admin console natively with hot reload (:3004)
	cd apps/admin && npm run dev

dev-cyberlab: ## run cyberlab natively with hot reload (:3001)
	cd apps/cyberlab && npm run dev

dev-homelab: ## run homelab natively with hot reload (:3002)
	cd apps/homelab && npm run dev

dev-ailab: ## run AI lab natively with hot reload (:3003)
	cd apps/ailab && npm run dev

## ── quality ───────────────────────────────────────────────────────────────

check: ## typecheck + build every web app, build the .NET services
	dotnet build IsaacWallace.sln
	cd apps/web && npm run typecheck && npm run build
	cd apps/admin && npm run typecheck && npm run build
	cd apps/cyberlab && npm run typecheck && npm run build
	cd apps/homelab && npm run typecheck && npm run build
	cd apps/ailab && npm run typecheck && npm run build
	cd packages/lab-runtime && npm run typecheck

ci: lint format-check test check security k8s-validate ## run the complete local CI suite

test: ## API integration tests (xunit) + cyberlab unit tests (vitest)
	dotnet test tests/Auth.Tests/Auth.Tests.csproj
	cd apps/cyberlab && npm run test
	cd packages/lab-runtime && npm run test

lint: ## eslint every web app
	cd apps/web && npm run lint
	cd apps/admin && npm run lint
	cd apps/cyberlab && npm run lint
	cd apps/homelab && npm run lint
	cd apps/ailab && npm run lint

fmt: ## prettier --write every web app
	cd apps/web && npm run format
	cd apps/admin && npm run format
	cd apps/cyberlab && npm run format
	cd apps/homelab && npm run format
	cd apps/ailab && npm run format

format-check: ## verify formatting for every web app
	npm run format:check

security: ## scan secrets and dependency advisories
	gitleaks detect --source . --no-banner --redact
	npm audit --audit-level=high
	dotnet list IsaacWallace.sln package --vulnerable --include-transitive

k8s-validate: ## validate Kubernetes manifests against the connected API schema
	kubectl apply --dry-run=server -f deploy/k8s/

smoke: ## curl the running stack (make up first)
	@curl -fsS http://localhost:5170/health && echo
	@curl -fsS http://localhost:5180/health && echo
	@curl -fsS -o /dev/null -w "portfolio  %{http_code}\n" http://localhost:3000/
	@curl -fsS -o /dev/null -w "cyberlab   %{http_code}\n" http://localhost:3001/
	@curl -fsS -o /dev/null -w "homelab    %{http_code}\n" http://localhost:3002/
	@curl -fsS -o /dev/null -w "ailab      %{http_code}\n" http://localhost:3003/
	@curl -fsS -o /dev/null -w "admin      %{http_code}\n" http://localhost:3004/
	@curl -fsS -o /dev/null -w "sign-in    %{http_code}\n" http://localhost:5170/login

clean: ## remove build output
	dotnet clean IsaacWallace.sln
	rm -rf apps/web/.next apps/admin/.next apps/cyberlab/.next apps/homelab/.next apps/ailab/.next

# WhatsApp Arrendamento — build and management
SHELL := /bin/bash

BIN      := listings
SERVICE  := whatsapp-listings
SYNC_SVC := wacli-pro
PKG      := .

GREEN  := \033[0;32m
RED    := \033[0;31m
YELLOW := \033[0;33m
BLUE   := \033[0;34m
BOLD   := \033[1m
RESET  := \033[0m

.PHONY: all build rebuild rebuild-fresh run run-dev restart restart-svc stop start \
        clean clean-db clean-all clean-dev status logs doctor \
        sync sync-stop sync-start backfill tidy fmt help \
        seed seed-large

all: build

# --- build ---------------------------------------------------------------

build: ## Build the binary
	@printf "$(BOLD)>> Building $(BIN)$(RESET)\n"
	@if go build -o $(BIN) $(PKG); then \
	  printf "$(GREEN)  ✔ Build succeeded$(RESET)\n"; \
	else \
	  printf "$(RED)  ✘ Build failed$(RESET)\n"; \
	  exit 1; \
	fi

rebuild: ## Wipe binary and DB, rebuild, restart service
	@rm -f $(BIN) listings.db
	@printf "$(GREEN)  ✔ Cleaned binary and database$(RESET)\n"
	@if go build -o $(BIN) $(PKG); then \
	  printf "$(GREEN)  ✔ Build succeeded$(RESET)\n"; \
	else \
	  printf "$(RED)  ✘ Build failed$(RESET)\n"; \
	  exit 1; \
	fi
	@printf "$(BLUE)  → Restarting $(SERVICE)$(RESET)\n"
	@if systemctl --user restart $(SERVICE); then \
	  sleep 1; \
	  if systemctl --user is-active --quiet $(SERVICE); then \
	    printf "$(GREEN)  ✔ Service is running$(RESET)\n"; \
	  else \
	    printf "$(RED)  ✘ Service failed to start — check 'make logs'$(RESET)\n"; \
	    exit 1; \
	  fi; \
	else \
	  printf "$(RED)  ✘ Restart command failed$(RESET)\n"; \
	  exit 1; \
	fi

tidy: ## Sync go.mod / go.sum
	@go mod tidy && printf "$(GREEN)  ✔ tidy ok$(RESET)\n" || { printf "$(RED)  ✘ tidy failed$(RESET)\n"; exit 1; }

fmt: ## Format source files
	@gofmt -w . && printf "$(GREEN)  ✔ fmt ok$(RESET)\n"

# --- dev / run -----------------------------------------------------------

run: build ## Build then run in foreground (Ctrl+C to stop)
	@printf "$(BLUE)  → Starting $(BIN) in foreground$(RESET)\n"
	@./$(BIN)

restart: build ## Rebuild and restart the systemd service
	@printf "$(BLUE)  → Restarting $(SERVICE)$(RESET)\n"
	@if systemctl --user restart $(SERVICE); then \
	  sleep 1; \
	  if systemctl --user is-active --quiet $(SERVICE); then \
	    printf "$(GREEN)  ✔ Service is running$(RESET)\n"; \
	  else \
	    printf "$(RED)  ✘ Service failed to start — check 'make logs'$(RESET)\n"; \
	    exit 1; \
	  fi; \
	else \
	  printf "$(RED)  ✘ Restart command failed$(RESET)\n"; \
	  exit 1; \
	fi

stop: ## Stop the systemd service
	@systemctl --user stop $(SERVICE) && printf "$(GREEN)  ✔ Stopped$(RESET)\n"

start: ## Start the systemd service
	@systemctl --user start $(SERVICE) && printf "$(GREEN)  ✔ Started$(RESET)\n"

# --- wacli sync ----------------------------------------------------------

sync: ## Restart the wacli-pro sync daemon
	@systemctl --user restart $(SYNC_SVC) && printf "$(GREEN)  ✔ Sync restarted$(RESET)\n"

sync-stop: ## Stop the wacli-pro sync daemon (needed before backfill)
	@systemctl --user stop $(SYNC_SVC) && printf "$(GREEN)  ✔ Sync stopped$(RESET)\n"

sync-start: ## Start the wacli-pro sync daemon
	@systemctl --user start $(SYNC_SVC) && printf "$(GREEN)  ✔ Sync started$(RESET)\n"

backfill: sync-stop ## Backfill all group chats (stops sync first)
	@printf "$(BOLD)>> Backfilling all groups$(RESET)\n"
	@wacli-pro chats list --json --limit 100000 \
	  | jq -r '.data[] | select(.kind=="group") | .jid' \
	  | while read -r jid; do \
	      printf "$(BLUE)  → %s$(RESET)\n" "$$jid"; \
	      wacli-pro history backfill --chat "$$jid" --requests 3 --count 50 || true; \
	    done
	@$(MAKE) --no-print-directory sync-start

# --- diagnostics ---------------------------------------------------------

status: ## Show service status, store stats, listing counts
	@printf "$(BOLD)=== Service ===$(RESET)\n"
	@if systemctl --user is-active --quiet $(SERVICE); then \
	  printf "$(GREEN)  ✔ %s is active$(RESET)\n" "$(SERVICE)"; \
	  systemctl --user --no-pager status $(SERVICE) | grep -E "Active|Main PID" | sed 's/^/    /'; \
	else \
	  printf "$(RED)  ✘ %s is not running$(RESET)\n" "$(SERVICE)"; \
	fi

	@printf "\n$(BOLD)=== wacli-pro store ===$(RESET)\n"
	@if wacli-pro store stats 2>/dev/null; then \
	  printf "$(GREEN)  ✔ store reachable$(RESET)\n"; \
	else \
	  printf "$(RED)  ✘ wacli-pro not reachable$(RESET)\n"; \
	fi

	@printf "\n$(BOLD)=== listings.db ===$(RESET)\n"
	@if [ -f listings.db ]; then \
	  total=$$(sqlite3 listings.db "SELECT COUNT(*) FROM listings;" 2>/dev/null); \
	  printf "  total: %s\n" "$$total"; \
	  sqlite3 listings.db "SELECT '  ' || category || ': ' || COUNT(*) FROM listings GROUP BY category ORDER BY 2 DESC;" 2>/dev/null; \
	else \
	  printf "$(YELLOW)  ! listings.db not created yet$(RESET)\n"; \
	fi

	@printf "\n$(BOLD)=== HTTP ===$(RESET)\n"
	@if curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null | grep -q 200; then \
	  printf "$(GREEN)  ✔ server responds on :8080$(RESET)\n"; \
	else \
	  printf "$(RED)  ✘ server not responding on :8080$(RESET)\n"; \
	fi

logs: ## Tail service logs
	journalctl --user -u $(SERVICE) -f

doctor: ## Run wacli-pro doctor
	@wacli-pro doctor

# --- cleanup -------------------------------------------------------------

clean: ## Remove built binary
	@rm -f $(BIN) && printf "$(GREEN)  ✔ Cleaned binary$(RESET)\n"

clean-db: ## Remove listings.db (forces full re-parse)
	@rm -f listings.db && printf "$(GREEN)  ✔ Database wiped$(RESET)\n"

clean-all: clean clean-db ## Remove binary and database
	@printf "$(GREEN)  ✔ Full clean complete$(RESET)\n"

# --- dev / seed ----------------------------------------------------------

DEV_DB := listings.dev.db

seed: ## Regenerate dev DB with exactly 100 listings per category
	@printf "$(BOLD)>> Seeding $(DEV_DB)$(RESET)\n"
	@go run ./seed -db $(DEV_DB)


run-dev: build seed ## Build, seed dev DB, run server against it
	@printf "$(BLUE)  → Running with LISTINGS_DB=$(DEV_DB)$(RESET)\n"
	@LISTINGS_DB=$(DEV_DB) ./$(BIN)

clean-dev: ## Remove the dev DB
	@rm -f $(DEV_DB) && printf "$(GREEN)  ✔ Removed $(DEV_DB)$(RESET)\n"

# --- help ----------------------------------------------------------------

help: ## Show this help
	@printf "$(BOLD)Usage: make <target>$(RESET)\n\n"
	@printf "$(BOLD)Targets:$(RESET)\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[0;34m%-14s\033[0m %s\n", $$1, $$2}'
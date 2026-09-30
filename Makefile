# Detect OS
ifeq ($(OS),Windows_NT)
    BIN := listings.exe
    RUN := ./$(BIN)
else
    BIN := listings
    RUN := ./$(BIN)
endif

# Paths
LISTINGS_DB     ?= listings.db
LISTINGS_DB_DEV ?= listings.dev.db
PORT            ?= 8090
WACLI_DB        ?= $(HOME)/.wacli-pro/wacli.db

# Backfill args (override: make backfill DAYS=60 LIMIT=500)
DAYS  ?= 30
LIMIT ?= 0

.PHONY: build run run-dev seed seed-backfill backfill status clean re kill

build:
	go build -o $(BIN) .

run: build
	$(RUN)

run-dev: build
	rm -f $(LISTINGS_DB_DEV)
	LISTINGS_DB=$(LISTINGS_DB_DEV) go run ./seed
	LISTINGS_DB=$(LISTINGS_DB_DEV) $(RUN)

seed:
	rm -f $(LISTINGS_DB_DEV)
	LISTINGS_DB=$(LISTINGS_DB_DEV) go run ./seed

seed-backfill:
	go run ./seed -backfill

# Media backfill — see backfill_media.sh
backfill:
	./backfill_media.sh $(DAYS) $(LIMIT)

PORT ?= 8090

# Kill whatever is listening on $(PORT). Frees the port for `make run`.
kill:
	@echo "→ Freeing port $(PORT)…"
	@if command -v fuser >/dev/null 2>&1; then \
		fuser -k $(PORT)/tcp 2>/dev/null && echo "  killed (fuser)" || echo "  nothing on :$(PORT)"; \
	elif command -v lsof >/dev/null 2>&1; then \
		pids=$$(lsof -ti tcp:$(PORT)); \
		if [ -n "$$pids" ]; then kill -9 $$pids && echo "  killed (lsof): $$pids"; else echo "  nothing on :$(PORT)"; fi; \
	else \
		echo "  no fuser/lsof — install one, or kill manually"; exit 1; \
	fi

# Kill and immediately restart. Use after `go build` to pick up changes.
re: kill build run

# Simple health check of a running app
status:
	@curl -s http://localhost:$(PORT)/api/sync-status || echo "app not running"

clean:
	rm -f $(BIN)
	rm -f $(LISTINGS_DB_DEV)
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

.PHONY: build run run-dev restart stop seed seed-backfill backfill status clean

build:
	go build -o $(BIN) .

run: build
	$(RUN)

run-dev: build
	rm -f $(LISTINGS_DB_DEV)
	LISTINGS_DB=$(LISTINGS_DB_DEV) go run ./seed
	LISTINGS_DB=$(LISTINGS_DB_DEV) $(RUN)

restart: build
	systemctl --user restart whatsapp-listings

stop:
	-systemctl --user stop whatsapp-listings 2>/dev/null || true
	-pkill -f "$(BIN)" 2>/dev/null || true

seed:
	rm -f $(LISTINGS_DB_DEV)
	LISTINGS_DB=$(LISTINGS_DB_DEV) go run ./seed

seed-backfill:
	go run ./seed -backfill

# Media backfill — see backfill_media.sh
backfill:
	./backfill_media.sh $(DAYS) $(LIMIT)

status:
	-systemctl --user status whatsapp-listings 2>/dev/null || true
	@echo "---"
	@curl -s http://localhost:$(PORT)/api/sync-status || echo "not running"

clean:
	rm -f $(BIN)
	rm -f $(LISTINGS_DB_DEV)
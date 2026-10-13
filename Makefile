# ============================================================
# Jinzo — portable Makefile (Linux/Debian + Windows/MSYS2)
# ============================================================
# Detects OS and picks:
#   - binary name (.exe on Windows)
#   - shell (cmd vs sh) for command execution
#   - port-killing strategy (fuser/lsof on Unix, netstat+taskkill on Windows)
# Rule names are identical on both platforms.
# ============================================================

ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
    BIN         := listings.exe
    RUN         := ./$(BIN)
    # In MSYS2/UCRT64 the shell is bash, so `sh -c` works, but we
    # double-slash native Windows flags (//F, //PID) to keep MSYS
    # from translating them into paths.
    SHELL       := sh
    KILL_TARGET := kill-windows
else
    DETECTED_OS := $(shell uname -s 2>/dev/null || echo Linux)
    BIN         := listings
    RUN         := ./$(BIN)
    SHELL       := /bin/sh
    KILL_TARGET := kill-unix
endif

# Paths and config
LISTINGS_DB     ?= listings.db
LISTINGS_DB_DEV ?= listings.dev.db
PORT            ?= 8090
WACLI_DB        ?= $(HOME)/.wacli-pro/wacli.db

# Backfill args (override: make backfill DAYS=60 LIMIT=500)
DAYS  ?= 30
LIMIT ?= 0

.PHONY: build run run-dev seed seed-backfill backfill status clean re kill \
        kill-unix kill-windows info

# ------------------------------------------------------------
# Informational — print what the Makefile detected
# ------------------------------------------------------------
info:
	@echo "detected OS : $(DETECTED_OS)"
	@echo "binary      : $(BIN)"
	@echo "port        : $(PORT)"
	@echo "db          : $(LISTINGS_DB)"
	@echo "shell       : $(SHELL)"

# ------------------------------------------------------------
# Build
# ------------------------------------------------------------
build:
	go build -o $(BIN) .

# ------------------------------------------------------------
# Run (foreground)
# ------------------------------------------------------------
run: build
	$(RUN)

# ------------------------------------------------------------
# Dev run — fresh seed DB, run against it
# ------------------------------------------------------------
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

# ------------------------------------------------------------
# Kill whatever is listening on $(PORT)
# Delegates to the OS-specific rule below.
# ------------------------------------------------------------
kill: $(KILL_TARGET)

# Unix: prefer fuser, fall back to lsof
kill-unix:
	@echo "→ Freeing port $(PORT) (unix)…"
	@if command -v fuser >/dev/null 2>&1; then \
		fuser -k $(PORT)/tcp 2>/dev/null && echo "  killed (fuser)" || echo "  nothing on :$(PORT)"; \
	elif command -v lsof >/dev/null 2>&1; then \
		pids=$$(lsof -ti tcp:$(PORT)); \
		if [ -n "$$pids" ]; then \
			kill -9 $$pids && echo "  killed (lsof): $$pids"; \
		else \
			echo "  nothing on :$(PORT)"; \
		fi; \
	else \
		echo "  no fuser/lsof — install one (apt install psmisc)"; exit 1; \
	fi

# Windows: netstat + taskkill. Double-slash native flags so
# MSYS2 doesn't rewrite //F into a path.
kill-windows:
	@echo "→ Freeing port $(PORT) (windows)…"
	@pid=$$(netstat -ano | grep ':$(PORT)' | grep LISTENING | awk '{print $$5}' | head -1); \
	if [ -n "$$pid" ]; then \
		if taskkill //F //PID $$pid >/dev/null 2>&1; then \
			echo "  killed (taskkill): $$pid"; \
		else \
			echo "  taskkill failed for PID $$pid (try running as admin)"; \
		fi; \
	else \
		echo "  nothing on :$(PORT)"; \
	fi

# ------------------------------------------------------------
# Kill + rebuild + run
# ------------------------------------------------------------
re: kill build run

# ------------------------------------------------------------
# Health check
# ------------------------------------------------------------
status:
	@curl -s http://localhost:$(PORT)/api/sync-status || echo "app not running"

# ------------------------------------------------------------
# Clean
# ------------------------------------------------------------
clean:
	rm -f $(BIN)
	rm -f $(LISTINGS_DB_DEV)
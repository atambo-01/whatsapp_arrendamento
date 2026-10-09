ADMIN_PASSWORD ?= jinzo123
export ADMIN_PASSWORD

.PHONY: all run install dev demo test check-node proxy dep

all: run

# Requer Node >= 22.13 (usa o node:sqlite embutido)
check-node:
	@node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a<22||(a===22&&b<13)) { console.error('Node '+process.versions.node+' e demasiado antigo: precisa de >= 22.13'); process.exit(1) }"


# Instala dependências (se necessário) e arranca o servidor: make
run: check-node node_modules
	npm start

node_modules: package.json
	npm install
	npx puppeteer browsers install chrome
	@touch node_modules

install: check-node
	npm install
	npx puppeteer browsers install chrome

dev: check-node node_modules
	npm run dev

# Modo demo sem WhatsApp, com dados de exemplo
demo: check-node node_modules
	LISTINGS_DB=listings.dev.db npm run seed
	WA_DISABLED=1 LISTINGS_DB=listings.dev.db npm start

test:
	npm test

# Arranca o wireproxy (WireGuard -> SOCKS5 local) e o servidor a usá-lo, sem VPN
# no sistema. Precisa de um wireproxy.conf (ver wireproxy.conf.example).
WIREPROXY_URL ?= https://github.com/windtf/wireproxy/releases/latest/download/wireproxy_linux_amd64.tar.gz
PROXY_ADDR ?= 127.0.0.1:25344

# Instala e configura tudo: npm, Chrome, wireproxy e a config WireGuard (WARP)
dep: install
	WIREPROXY_URL=$(WIREPROXY_URL) ./scripts/setup-proxy.sh

proxy: check-node node_modules
	@test -x .bin/wireproxy -a -f wireproxy.conf || ./scripts/setup-proxy.sh
	@.bin/wireproxy -c wireproxy.conf & WP=$$!; \
	trap 'kill $$WP 2>/dev/null' EXIT INT TERM; \
	sleep 2; kill -0 $$WP 2>/dev/null || { echo "wireproxy falhou a arrancar"; exit 1; }; \
	WA_PROXY=socks5://$(PROXY_ADDR) npm start

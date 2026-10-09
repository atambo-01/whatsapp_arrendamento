ADMIN_PASSWORD ?= jinzo123
export ADMIN_PASSWORD

.PHONY: run install dev demo test check-node

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

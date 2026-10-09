ADMIN_PASSWORD ?= jinzo123
export ADMIN_PASSWORD

.PHONY: run install dev demo test

# Instala dependências (se necessário) e arranca o servidor: make
run: node_modules
	npm start

node_modules: package.json
	npm install
	@touch node_modules

install:
	npm install

dev: node_modules
	npm run dev

# Modo demo sem WhatsApp, com dados de exemplo
demo: node_modules
	LISTINGS_DB=listings.dev.db npm run seed
	WA_DISABLED=1 LISTINGS_DB=listings.dev.db npm start

test:
	npm test

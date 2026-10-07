# Jinzo

Find rentals, here. Lê os grupos de WhatsApp da tua conta (via
[whatsapp-web.js](https://wwebjs.dev)), identifica anúncios de arrendamento,
procura, venda e ruído, e mostra tudo numa interface web simples com filtros e
mapa. **Só Node.js** — sem Go, sem CLI externa.

## Arrancar

```bash
npm install
npm start            # http://localhost:8090
```

Abre a página e lê o **QR code** (WhatsApp → Dispositivos ligados). A sessão
fica guardada em `.wwebjs_auth/`; depois da ligação os grupos são sincronizados
e as novas mensagens são analisadas em tempo real.

Requer Node ≥ 22.13 (usa o `node:sqlite` embutido).

### Desenvolvimento sem WhatsApp

```bash
LISTINGS_DB=listings.dev.db npm run seed
WA_DISABLED=1 LISTINGS_DB=listings.dev.db npm start
```

### Variáveis de ambiente

| Variável | Default | |
|---|---|---|
| `PORT` | 8090 | porta HTTP |
| `LISTINGS_DB` | `listings.db` | ficheiro SQLite |
| `WWEBJS_AUTH` | `.wwebjs_auth` | sessão do WhatsApp |
| `SYNC_LIMIT` | 300 | mensagens por grupo em cada sincronização |
| `WA_DISABLED` | – | `1` desliga o WhatsApp |
| `PUPPETEER_EXECUTABLE_PATH` | – | usar um Chrome/Chromium existente |

## Arquitectura

```
src/
  server.js            Express + arranque do WhatsApp
  config.js            configuração por env
  routes/api.js        /api/* (listings, nearby, counts, facets, whatsapp, send)
  db/                  SQLite (node:sqlite) e queries
  whatsapp/client.js   whatsapp-web.js: QR, sync, mensagens em tempo real, envio
  parser/              mensagem → anúncio (classify, price, location, patterns…)
  services/geo.js      coordenadas e distância (haversine)
  data/                bairros, coordenadas, marcadores
public/                front-end (HTML/CSS/ES modules, sem build)
scripts/seed.js        dados de teste
test/                  testes do parser (npm test)
```

## Front-end

Cartões em vez de tabela, separadores com contagens, filtros por tipologia/zona/
preço, pesquisa (`/` foca), mapa com ordenação por proximidade e raio, painel de
detalhe com link directo (`/listing/:id`), resposta ao anúncio no grupo, tema
claro/escuro e estado dos filtros no URL.

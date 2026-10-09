import { EventEmitter } from "node:events";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode";
import { config } from "../config.js";
import { parseListing } from "../parser/index.js";
import { upsert, upsertMany } from "../db/listings.js";

const { Client, LocalAuth } = pkg;

/**
 * Wraps whatsapp-web.js. Emits "state" events with a snapshot:
 * { status: idle|starting|qr|authenticated|ready|disconnected|error|disabled,
 *   qr: dataURL|null, me, error, sync: {running, done, total, saved, chat} }
 */
class WhatsApp extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.state = {
      status: config.waDisabled ? "disabled" : "idle",
      qr: null, me: null, error: null,
      sync: { running: false, done: 0, total: 0, saved: 0, chat: "" },
    };
  }

  snapshot() { return this.state; }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  async start() {
    if (config.waDisabled || this.client) return;
    this.#set({ status: "starting", error: null, qr: null });

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.authPath }),
      puppeteer: {
        headless: true,
        executablePath: config.chromePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      },
    });
    this.client = client;

    client.on("qr", async (qr) => this.#set({ status: "qr", qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) }));
    client.on("authenticated", () => this.#set({ status: "authenticated", qr: null }));
    client.on("auth_failure", (m) => this.#set({ status: "error", error: `Falha de autenticação: ${m}` }));
    client.on("ready", () => {
      this.#set({ status: "ready", qr: null, me: client.info?.pushname || client.info?.wid?.user || null });
      this.sync().catch((e) => console.error("[wa] initial sync failed:", e.message));
    });
    client.on("disconnected", (reason) => {
      this.client = null;
      this.#set({ status: "disconnected", me: null, error: String(reason) });
    });
    client.on("message_create", (msg) => this.#ingest(msg).then((row) => row && upsert(row)).catch(() => {}));

    try {
      await client.initialize();
    } catch (e) {
      this.client = null;
      await client.destroy().catch(() => {});
      const net = /timeout|ERR_(CONNECTION|NAME|INTERNET|TIMED)/i.test(e.message);
      this.#set({
        status: "error",
        error: net
          ? "Não foi possível chegar a web.whatsapp.com (tempo esgotado). Esta rede/máquina pode estar a bloquear o WhatsApp — tente noutra rede ou com VPN."
          : e.message,
      });
      console.error("[wa] start failed:", e.message);
    }
  }

  async #ingest(msg, chat) {
    const jid = msg.fromMe ? msg.to : msg.from;
    if (!jid?.endsWith("@g.us") || !msg.body) return null;
    chat ??= await msg.getChat();
    const senderJid = msg.author || msg.from;
    return parseListing({
      msgId: msg.id._serialized,
      chatName: chat.name,
      chatJid: jid,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
      sender: msg._data?.notifyName || "",
      senderJid,
      text: msg.body,
      displayText: msg.hasQuotedMsg ? "" : "",
    });
  }

  async sync(limit = config.syncLimit) {
    if (this.state.status !== "ready") throw new Error("WhatsApp não está ligado");
    if (this.state.sync.running) return;
    const chats = (await this.client.getChats()).filter((c) => c.isGroup);
    this.#set({ sync: { running: true, done: 0, total: chats.length, saved: 0, chat: "" } });
    let saved = 0;
    try {
      for (const [i, chat] of chats.entries()) {
        this.#set({ sync: { ...this.state.sync, chat: chat.name, done: i } });
        const msgs = await chat.fetchMessages({ limit }).catch((e) => {
          console.error(`[wa] fetchMessages failed for "${chat.name}":`, e.message);
          return [];
        });
        const rows = [];
        for (const m of msgs) {
          const row = await this.#ingest(m, chat).catch((e) => {
            console.error("[wa] ingest failed:", e.message);
            return null;
          });
          if (row) rows.push(row);
        }
        upsertMany(rows);
        saved += rows.length;
      }
    } finally {
      this.#set({ sync: { running: false, done: chats.length, total: chats.length, saved, chat: "" } });
    }
  }

  async send(chatJid, text, quotedMsgId) {
    if (this.state.status !== "ready") throw new Error("WhatsApp não está ligado");
    const opts = {};
    if (quotedMsgId) opts.quotedMessageId = quotedMsgId;
    await this.client.sendMessage(chatJid, text, opts);
  }

  async logout() {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    await c.logout().catch(() => {});
    await c.destroy().catch(() => {});
    this.#set({ status: "idle", me: null, qr: null });
  }
}

export const whatsapp = new WhatsApp();

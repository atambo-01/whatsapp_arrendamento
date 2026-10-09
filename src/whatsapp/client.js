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
        args: [
          "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
          ...(config.proxy ? [`--proxy-server=${config.proxy}`] : []),
        ],
      },
    });
    this.client = client;

    client.on("qr", async (qr) => this.#set({ status: "qr", qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) }));
    client.on("authenticated", () => this.#set({ status: "authenticated", qr: null }));
    client.on("auth_failure", (m) => this.#set({ status: "error", error: `Falha de autenticação: ${m}` }));
    client.on("ready", () => {
      this.#set({ status: "ready", qr: null, me: client.info?.pushname || client.info?.wid?.user || null });
      this.sync().catch((e) => console.error("[wa] initial sync failed:", e.stack || e.message));
    });
    client.on("disconnected", (reason) => {
      this.client = null;
      this.#set({ status: "disconnected", me: null, error: String(reason) });
    });
    client.on("message_create", (msg) => this.#ingest(msg).then((row) => row && upsert(row)).catch((e) => console.error("[wa] live message failed:", e?.message ?? e)));

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

  // Live messages: normalise the whatsapp-web.js Message into a plain object.
  async #ingest(msg) {
    const jid = msg.fromMe ? msg.to : msg.from;
    if (!jid?.endsWith("@g.us") || !msg.body) return null;
    const chat = await msg.getChat();
    return this.#toRow({
      id: msg.id._serialized, chatJid: jid, chatName: chat.name, body: msg.body,
      timestamp: msg.timestamp, sender: msg._data?.notifyName || "",
      senderJid: msg.author || msg.from,
    });
  }

  #toRow(m) {
    if (!m.body) return null;
    return parseListing({
      msgId: m.id,
      chatName: m.chatName,
      chatJid: m.chatJid,
      timestamp: new Date(m.timestamp * 1000).toISOString(),
      sender: m.sender || "",
      senderJid: m.senderJid,
      text: m.body,
      displayText: "",
    });
  }

  // Reads groups and their messages inside the WhatsApp Web page, avoiding
  // whatsapp-web.js getChats()/getChatById(), which break on newer WA versions.
  async #groups() {
    return this.client.pupPage.evaluate(() =>
      window.require("WAWebCollections").Chat.getModelsArray()
        .filter((c) => c.id._serialized.endsWith("@g.us"))
        .map((c) => ({ jid: c.id._serialized, name: c.formattedTitle || c.name || c.id.user })));
  }

  async #fetchGroup(jid, limit) {
    return this.client.pupPage.evaluate(async (jid, limit) => {
      const id = (w) => (w ? w._serialized ?? String(w) : "");
      const chat = window.require("WAWebCollections").Chat.get(jid);
      if (!chat) return [];
      const keep = (m) => !m.isNotification;
      let msgs = chat.msgs.getModelsArray().filter(keep);
      while (msgs.length < limit) {
        const more = await window.require("WAWebChatLoadMessages").loadEarlierMsgs({ chat });
        if (!more || !more.length) break;
        msgs = [...more.filter(keep), ...msgs];
      }
      msgs.sort((a, b) => a.t - b.t);
      return msgs.slice(-limit).map((m) => ({
        id: id(m.id), body: m.body || "", timestamp: m.t,
        sender: m.notifyName || "", senderJid: id(m.author) || id(m.from),
      }));
    }, jid, limit);
  }

  async sync(limit = config.syncLimit) {
    if (this.state.status !== "ready") throw new Error("WhatsApp não está ligado");
    if (this.state.sync.running) return;
    // Right after "ready" the chat list may still be loading: wait for it.
    let chats = await this.#groups();
    for (let t = 0; !chats.length && t < 10; t++) {
      await new Promise((r) => setTimeout(r, 3000));
      chats = await this.#groups();
    }
    console.log(`[wa] sync: ${chats.length} groups`);
    this.#set({ sync: { running: true, done: 0, total: chats.length, saved: 0, chat: "" } });
    let saved = 0;
    try {
      for (const [i, chat] of chats.entries()) {
        this.#set({ sync: { ...this.state.sync, chat: chat.name, done: i } });
        const msgs = await this.#fetchGroup(chat.jid, limit).catch((e) => {
          console.error(`[wa] "${chat.name}" failed:`, e?.message ?? e);
          return [];
        });
        const rows = msgs
          .map((m) => this.#toRow({ ...m, chatJid: chat.jid, chatName: chat.name }))
          .filter(Boolean);
        upsertMany(rows);
        saved += rows.length;
        console.log(`[wa] "${chat.name}": ${rows.length}/${msgs.length} messages`);
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

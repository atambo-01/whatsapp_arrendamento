import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS listings (
    msg_id TEXT PRIMARY KEY,
    chat_name TEXT, chat_jid TEXT, timestamp TEXT,
    sender TEXT, sender_jid TEXT, title TEXT, typology TEXT,
    price INTEGER, price_text TEXT, price_ok INTEGER,
    location TEXT, location_raw TEXT, phone TEXT, raw_text TEXT, category TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_typology ON listings(typology);
  CREATE INDEX IF NOT EXISTS idx_location ON listings(location);
  CREATE INDEX IF NOT EXISTS idx_price ON listings(price);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON listings(timestamp);
  CREATE INDEX IF NOT EXISTS idx_category ON listings(category);
`);

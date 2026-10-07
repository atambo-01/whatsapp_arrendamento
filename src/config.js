import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  port: Number(process.env.PORT) || 8090,
  dbPath: process.env.LISTINGS_DB || path.join(ROOT, "listings.db"),
  authPath: process.env.WWEBJS_AUTH || path.join(ROOT, ".wwebjs_auth"),
  publicDir: path.join(ROOT, "public"),
  // Messages fetched per group on a manual sync.
  syncLimit: Number(process.env.SYNC_LIMIT) || 300,
  // Set WA_DISABLED=1 to run the UI only (e.g. with seeded data).
  waDisabled: process.env.WA_DISABLED === "1",
  // Admin password (ADMIN_PASSWORD). If unset, a random one is printed at startup.
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminSecret: process.env.ADMIN_SECRET || "",
  chromePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
};

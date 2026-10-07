import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";

const TTL_MS = 12 * 3600 * 1000;
const COOKIE = "jinzo_admin";

const password = config.adminPassword || crypto.randomBytes(9).toString("base64url");
const secret = config.adminSecret || crypto.randomBytes(32).toString("hex");
export const generatedPassword = config.adminPassword ? null : password;

const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");
const safeEq = (a, b) => {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k)
      .map(([k, ...v]) => [k, v.join("=")]),
  );
}

export function isAdmin(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split(".");
  return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: "Apenas o administrador pode fazer isto" });
}

// Naive in-memory brute-force guard: 5 failures per IP per 10 minutes.
const fails = new Map();
const blocked = (ip) => (fails.get(ip) || []).filter((t) => t > Date.now() - 600000).length >= 5;

export const authRoutes = Router();

authRoutes.get("/me", (req, res) => res.json({ admin: isAdmin(req) }));

authRoutes.post("/login", (req, res) => {
  const ip = req.ip;
  if (blocked(ip)) return res.status(429).json({ error: "Demasiadas tentativas. Tente mais tarde." });
  if (!safeEq(String(req.body?.password ?? ""), password)) {
    fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
    return res.status(401).json({ error: "Palavra-passe incorreta" });
  }
  fails.delete(ip);
  const exp = String(Date.now() + TTL_MS);
  res.setHeader("Set-Cookie", `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}`);
  res.json({ admin: true });
});

authRoutes.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ admin: false });
});

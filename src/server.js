import express from "express";
import { config } from "./config.js";
import { authRoutes, generatedPassword } from "./auth.js";
import { api } from "./routes/api.js";
import { whatsapp } from "./whatsapp/client.js";

const app = express();
app.use(express.json());
app.use("/api/admin", authRoutes);
app.use("/api", api);
app.use(express.static(config.publicDir, { etag: true, maxAge: 0 }));
app.get("/listing/:id", (_req, res) => res.sendFile("index.html", { root: config.publicDir }));

app.listen(config.port, () => {
  console.log(`Jinzo running at http://localhost:${config.port}  (db: ${config.dbPath})`);
  if (generatedPassword) console.log(`Admin password (set ADMIN_PASSWORD to fix it): ${generatedPassword}`);
  whatsapp.start();
});


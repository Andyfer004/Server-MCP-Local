// src/http.ts
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import Database from "better-sqlite3";

// Servicios locales (¡nota el .js por ESM!)
import { runLlama } from "./services/llm.js";
import { ensureDirs, listDocHits, buildMarkdown, buildPdf } from "./services/report.js";
import { createSession, chatSend } from "./services/chat.js";
import { planFromMessage, executePlan } from "./services/router.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------------------- CONFIG ----------------------
const API_TOKEN = process.env.API_TOKEN ?? "dev-token";
const DB_PATH = process.env.DB_PATH ?? "./data/app.db";
const PORT = Number(process.env.PORT ?? 3001);
const HOST = "127.0.0.1";

// Directorios permitidos (seguridad)
const allowedDirs = (process.env.MCP_ALLOWED_DIRS || "docs,reports,data")
  .split(",")
  .map((d) => path.resolve(process.cwd(), d.trim()));

function isAllowedFile(p: string) {
  const abs = path.resolve(process.cwd(), p);
  return allowedDirs.some((dir) => abs === dir || abs.startsWith(dir + path.sep));
}

// ---------------------- AUTH ----------------------
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const auth = req.header("authorization") ?? "";
  if (auth === `Bearer ${API_TOKEN}`) return next();
  res.status(401).json({ error: "unauthorized" });
});

// ---------------------- HEALTH ----------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------- FS ----------------------
// Lee archivo
app.post("/fs/read", async (req, res, next) => {
  try {
    const { path: p } = req.body ?? {};
    if (typeof p !== "string" || !p) return res.status(400).json({ error: "path requerido" });
    if (!isAllowedFile(p)) return res.status(403).json({ error: "Path no permitido" });

    const content = await fs.readFile(p, "utf8");
    res.json({ path: p, content });
  } catch (e) {
    next(e);
  }
});

// Escribe archivo
app.post("/fs/write", async (req, res, next) => {
  try {
    const { path: p, content } = req.body ?? {};
    if (typeof p !== "string" || !p) return res.status(400).json({ error: "path requerido" });
    if (typeof content !== "string") return res.status(400).json({ error: "content debe ser string" });
    if (!isAllowedFile(p)) return res.status(403).json({ error: "Path no permitido" });

    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf8");
    res.json({ ok: true, path: p, size: Buffer.byteLength(content, "utf8") });
  } catch (e) {
    next(e);
  }
});

// ---------------------- SQLITE ----------------------
app.post("/sqlite/query", async (req, res, next) => {
  try {
    const { sql } = req.body ?? {};
    if (typeof sql !== "string" || !sql) return res.status(400).json({ error: "sql requerido" });
    if (!/^\s*select\b/i.test(sql)) return res.status(400).json({ error: "Solo se permite SELECT" });

    const db = new Database(DB_PATH);
    try {
      const rows = db.prepare(sql).all();
      res.json({ rows });
    } finally {
      db.close();
    }
  } catch (e) {
    next(e);
  }
});

// ---------------------- LLM ----------------------
// Genera texto
app.post("/llm/generate", async (req, res, next) => {
  try {
    const { prompt, system, maxTokens, temperature } = req.body ?? {};
    if (typeof prompt !== "string" || !prompt) return res.status(400).json({ error: "prompt requerido" });

    const text = await runLlama(prompt, {
      system: typeof system === "string" ? system : undefined,
      maxTokens: typeof maxTokens === "number" ? maxTokens : 200,
      temperature: typeof temperature === "number" ? temperature : 0.3,
    });

    res.json({ text });
  } catch (e) {
    next(e);
  }
});

// Resume archivo
app.post("/llm/summarize", async (req, res, next) => {
  try {
    const { path: p } = req.body ?? {};
    if (typeof p !== "string" || !p) return res.status(400).json({ error: "path requerido" });
    if (!isAllowedFile(p)) return res.status(403).json({ error: "Path no permitido" });

    const content = await fs.readFile(p, "utf8");
    const summary = await runLlama(
      "Resume en 5 viñetas claras y breves el siguiente texto:\n\n" + content,
      { maxTokens: 220, system: "Eres conciso y claro. Responde en español en viñetas '- '." }
    );
    res.json({ path: p, summary });
  } catch (e) {
    next(e);
  }
});

// ---------------------- REPORTES ----------------------
app.post("/report/build", async (req, res, next) => {
  try {
    const { title, query, includeSummary } = req.body ?? {};
    if (typeof title !== "string" || !title) return res.status(400).json({ error: "title requerido" });

    await ensureDirs();
    const hits = await listDocHits(typeof query === "string" ? query : undefined);

    let summaryText = "";
    if (includeSummary === undefined || includeSummary === true) {
      try {
        // Intento en JSON para robustez
        const out = await runLlama(
          `Genera 4 viñetas sobre el estado del proyecto MCP local (FS, SQLite, PDF, LLM).
Devuelve JSON válido { "bullets": string[] }.`,
          { maxTokens: 200, system: "Devuelve SOLO JSON VÁLIDO." }
        );
        const parsed = JSON.parse(out);
        if (Array.isArray(parsed?.bullets)) {
          summaryText = parsed.bullets.map((s: string) => `- ${s}`).join("\n");
        }
      } catch {
        // Fallback en texto libre
        summaryText = await runLlama(
          "Escribe 4 viñetas breves en español con el estado del proyecto MCP local (FS, SQLite, PDF, LLM).",
          { maxTokens: 180, system: "Sé conciso y claro." }
        );
      }
    }

    const mdPath = await buildMarkdown(title, typeof query === "string" ? query : undefined, hits, summaryText);
    const pdfPath = await buildPdf(title, hits, summaryText);
    res.json({ ok: true, mdPath, pdfPath });
  } catch (e) {
    next(e);
  }
});

// ---------------------- CHAT LOCAL ----------------------
// crea sesión
app.post("/chat/session", async (req, res, next) => {
  try {
    const { system } = req.body ?? {};
    const s = createSession(typeof system === "string" ? system : "Eres un asistente local, técnico y en español.");
    res.json({ sessionId: s.id });
  } catch (e) {
    next(e);
  }
});

// envía mensaje
app.post("/chat/send", async (req, res, next) => {
  try {
    const { sessionId, message, params } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId) return res.status(400).json({ error: "sessionId requerido" });
    if (typeof message !== "string" || !message) return res.status(400).json({ error: "message requerido" });

    const { reply } = await chatSend(sessionId, message, {
      maxTokens: params?.maxTokens ?? 400,
      temperature: params?.temperature ?? 0.2,
    });
    res.json({ reply });
  } catch (e) {
    next(e);
  }
});

// ---------------------- ROUTER INTELIGENTE ----------------------
app.post("/agent/command", async (req, res, next) => {
  try {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message) return res.status(400).json({ error: "message requerido" });

    const plan = await planFromMessage(message);
    const result = await executePlan(plan);
    res.json({ plan, result });
  } catch (e) {
    next(e);
  }
});

// ---------------------- 404 ----------------------
app.use((_req, res, _next) => {
  res.status(404).json({ error: "not_found" });
});

// ---------------------- ERRORS ----------------------
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[http] error:", err);
  res.status(500).json({ error: String(err?.message ?? err) });
});

// ---------------------- START ----------------------
await ensureDirs();
app.listen(PORT, HOST, () => {
  console.log(`[HTTP] escuchando en http://${HOST}:${PORT}`);
  console.log(`[HTTP] allowedDirs:`, allowedDirs);
});

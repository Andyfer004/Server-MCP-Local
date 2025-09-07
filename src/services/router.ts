// src/services/router.ts
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";

import { runLlama } from "./llm.js";
import { ensureDirs, listDocHits, buildMarkdown, buildPdf } from "./report.js";
import { createSession, chatSend } from "./chat.js";

const allowedDirs = (process.env.MCP_ALLOWED_DIRS || "docs,reports,data")
  .split(",")
  .map((d) => path.resolve(process.cwd(), d.trim()));

function isAllowed(p: string) {
  const abs = path.resolve(process.cwd(), p);
  return allowedDirs.some((dir) => abs.startsWith(dir + path.sep) || abs === dir);
}

export const Action = z.enum([
  "write_file",      // { path, content }
  "read_file",       // { path }
  "sql_select",      // { sql }   (solo SELECT)
  "summarize_file",  // { path }
  "build_report",    // { title, query?, includeSummary? }
  "chat"             // { text, sessionId? }
]);

export const RoutePlanSchema = z.object({
  action: Action,
  params: z.record(z.any())
});

export type RoutePlan = z.infer<typeof RoutePlanSchema>;

/** Usa el LLM local para producir un plan JSON { action, params } a partir de un mensaje libre */
export async function planFromMessage(message: string): Promise<RoutePlan> {
  const schema = {
    type: "object",
    properties: {
      action: { type: "string", enum: Action.options },
      params: { type: "object" }
    },
    required: ["action", "params"],
    additionalProperties: false
  };

  const system =
    `Eres un planificador 100% local. Devuelve SOLO JSON válido que cumpla el schema.
Acciones y parámetros:
- write_file: { path, content }         (rutas permitidas: ${allowedDirs.join(", ")})
- read_file: { path }                    (rutas permitidas)
- sql_select: { sql }                    (solo SELECT)
- summarize_file: { path }
- build_report: { title, query?, includeSummary? }
- chat: { text, sessionId? }
Si piden fuera de rutas permitidas o SQL no-SELECT, usa 'chat' y explica la limitación.`;

  const user =
    `Mensaje del usuario:
"""${message}"""

Reglas de mapeo:
- "guarda/escribe ..." → write_file
- "lee ..." → read_file
- "resume ..." → summarize_file
- "reporte ..." → build_report (includeSummary=true por defecto)
- si hay SQL o "consulta notas" → sql_select SOLO si empieza con SELECT
- en duda → chat

Ejemplos válidos:
{"action":"write_file","params":{"path":"docs/nota.txt","content":"hola"}}
{"action":"chat","params":{"text":"explica MCP local"}}`;

  let raw = "";
  try {
    raw = await runLlama(user, { system, maxTokens: 300, temperature: 0.1, schema });
    const parsed = JSON.parse(raw);
    return RoutePlanSchema.parse(parsed);
  } catch (e) {
    console.error("[planFromMessage] fallo al parsear:", e, "raw=", raw);

    // --- fallback seguro ---
    // Detecta acción con heurística simple
    if (/escribe|guarda/i.test(message)) {
      return {
        action: "write_file",
        params: { path: "docs/demo.txt", content: message }
      };
    }
    if (/lee/i.test(message)) {
      return {
        action: "read_file",
        params: { path: "docs/demo.txt" }
      };
    }
    if (/resume/i.test(message)) {
      return {
        action: "summarize_file",
        params: { path: "docs/demo.txt" }
      };
    }
    if (/reporte/i.test(message)) {
      return {
        action: "build_report",
        params: { title: "Reporte generado", includeSummary: true }
      };
    }

    // fallback final → chat
    return {
      action: "chat",
      params: { text: message }
    };
  }
}

/** Ejecuta el plan generado por el planner */
export async function executePlan(plan: RoutePlan): Promise<any> {
  switch (plan.action) {
    case "write_file": {
      const { path: p, content } = z.object({
        path: z.string().min(1),
        content: z.string()
      }).parse(plan.params);
      if (!isAllowed(p)) throw new Error("Path no permitido");
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf8");
      return { ok: true, path: p };
    }

    case "read_file": {
      const { path: p } = z.object({ path: z.string().min(1) }).parse(plan.params);
      if (!isAllowed(p)) throw new Error("Path no permitido");
      const content = await fs.readFile(p, "utf8");
      return { path: p, content };
    }

    case "sql_select": {
      const { sql } = z.object({ sql: z.string().min(1) }).parse(plan.params);
      if (!/^\s*select\b/i.test(sql)) throw new Error("Solo SELECT permitido");
      const db = new Database(process.env.DB_PATH ?? "./data/app.db");
      try {
        return { rows: db.prepare(sql).all() };
      } finally {
        db.close();
      }
    }

    case "summarize_file": {
      const { path: p } = z.object({ path: z.string().min(1) }).parse(plan.params);
      if (!isAllowed(p)) throw new Error("Path no permitido");
      const content = await fs.readFile(p, "utf8");
      const summary = await runLlama(
        "Resume en 5 viñetas claras y breves el siguiente texto:\n\n" + content,
        { maxTokens: 220, system: "Sé conciso. Responde en español con viñetas '- '." }
      );
      return { path: p, summary };
    }

    case "build_report": {
      const { title, query, includeSummary } = z.object({
        title: z.string().min(1),
        query: z.string().optional(),
        includeSummary: z.boolean().optional()
      }).parse(plan.params);

      await ensureDirs();
      const hits = await listDocHits(query);

      let summaryText = "";
      if (includeSummary ?? true) {
        try {
          const jsonOut = await runLlama(
            `Genera 4 viñetas sobre el estado del proyecto MCP local (FS, SQLite, PDF, LLM).
Devuelve JSON válido { "bullets": string[] }.`,
            { maxTokens: 200, system: "Devuelve SOLO JSON VÁLIDO." }
          );
          const parsed = JSON.parse(jsonOut);
          if (Array.isArray(parsed?.bullets)) {
            summaryText = parsed.bullets.map((s: string) => `- ${s}`).join("\n");
          }
        } catch {
          summaryText = await runLlama(
            "Escribe 4 viñetas breves en español con el estado del proyecto MCP local (FS, SQLite, PDF, LLM).",
            { maxTokens: 180, system: "Sé conciso y claro." }
          );
        }
      }

      const mdPath = await buildMarkdown(title, query, hits, summaryText);
      const pdfPath = await buildPdf(title, hits, summaryText);
      return { ok: true, mdPath, pdfPath };
    }

    case "chat": {
      const { text, sessionId } = z.object({
        text: z.string().min(1),
        sessionId: z.string().uuid().optional()
      }).parse(plan.params);
      const sid = sessionId ?? createSession("Eres un asistente local, técnico y en español.").id;
      const { reply } = await chatSend(sid, text, { maxTokens: 400, temperature: 0.2 });
      return { sessionId: sid, reply };
    }
  }
}
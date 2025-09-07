// src/tools/taskTools.ts
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import PDFDocument from "pdfkit";

const REPORTS_DIR = "reports";
const DOCS_DIR = "docs";

function llamaBin() {
  return process.env.LLAMA_BIN || "/opt/homebrew/opt/llama.cpp/bin/llama-cli";
}
function assertEnv() {
  if (!process.env.LLAMA_MODEL) throw new Error("LLAMA_MODEL no configurada (ruta al .gguf)");
  return process.env.LLAMA_MODEL!;
}

async function runLlama(
  prompt: string,
  { maxTokens = 200, temperature = 0.2, system = "Eres un asistente técnico en español. No inventes.", seed = 42, schema }: {
    maxTokens?: number; temperature?: number; system?: string; seed?: number; schema?: any
  } = {}
) {
  const model = assertEnv();
  const args = [
    "-m", model,
    "-n", String(maxTokens),
    "--temp", String(temperature),
    "--seed", String(seed),
    "--simple-io", "--no-display-prompt", "-st",
    "--ignore-eos",
    "-sys", system,
    "-p", prompt,
  ];
  if (schema) args.splice(args.length - 2, 0, "-j", JSON.stringify(schema)); // inserta antes de -p

  return new Promise<string>((resolve, reject) => {
    const p = spawn(llamaBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", c => (c === 0 ? resolve(out.trim()) : reject(new Error(err || "llama-cli failed"))));
  });
}

async function ensureDirs() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

export function registerTaskTools(server: any) {
  // 1) Generación libre con LLM local
  server.tool("llm_generate", {
    description: "Genera texto con el LLM local (llama.cpp)",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        maxTokens: { type: "number" },
        temperature: { type: "number" },
        system: { type: "string" },
        seed: { type: "number" }
      },
      required: ["prompt"]
    }
  }, async (args: any) => {
    const txt = await runLlama(args.prompt, {
      maxTokens: args.maxTokens ?? 200,
      temperature: args.temperature ?? 0.2,
      system: args.system,
      seed: args.seed ?? 42
    });
    return { content: [{ type: "text", text: txt }] };
  });

  // 2) Resumen de archivo con LLM local
  server.tool("llm_summarize", {
    description: "Resume un archivo (texto) usando el LLM local",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  }, async (args: any) => {
    const full = path.resolve(process.cwd(), args.path);
    const body = await fs.readFile(full, "utf8");
    const summary = await runLlama(
      "Resume en 5 viñetas claras y breves el siguiente texto:\n\n" + body,
      { maxTokens: 200, system: "Eres conciso y claro. Responde en español con viñetas '- '." }
    );
    return { content: [{ type: "text", text: summary }] };
  });

  // 3) Tareas varias (incluye build_report => MD + PDF + resumen LLM)
  server.tool("run_task", {
    description: "Ejecuta una tarea predefinida",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: ["build_report"] },
        args: {
          type: "object",
          properties: {
            title: { type: "string" },
            query: { type: "string" },
            includeSummary: { type: "boolean" }
          },
          required: ["title"]
        }
      },
      required: ["name", "args"]
    }
  }, async (args: any) => {
    if (args.name !== "build_report") throw new Error("Tarea no soportada");
    await ensureDirs();

    const ts = Date.now();
    const mdPath = path.join(REPORTS_DIR, `reporte-${ts}.md`);
    const pdfPath = path.join(REPORTS_DIR, `reporte-${ts}.pdf`);

    // 3.1 Buscar en /docs (simple)
    const query = (args.args.query || "").toLowerCase();
    const files = await fs.readdir(DOCS_DIR);
    const hits: string[] = [];
    for (const f of files) {
      const p = path.join(DOCS_DIR, f);
      const stat = await fs.stat(p);
      if (!stat.isFile()) continue;
      const txt = await fs.readFile(p, "utf8").catch(() => "");
      if (!query || txt.toLowerCase().includes(query) || f.toLowerCase().includes(query)) {
        hits.push(f);
      }
    }

    // 3.2 Contenido base (MD)
    let md = `# ${args.args.title}\n\n`;
    md += `Fecha: ${new Date().toISOString()}\n\n`;
    md += `## Archivos coincidentes en \`${DOCS_DIR}\`${query ? ` (query: \`${query}\`)` : ""}\n`;
    md += hits.length ? hits.map(h => `- ${h}`).join("\n") + "\n\n" : "_Sin coincidencias_\n\n";

    // 3.3 Resumen del día con LLM (opcional)
    let summaryText = "";
    if (args.args.includeSummary) {
      const schema = {
        type: "object",
        properties: { bullets: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } } },
        required: ["bullets"], additionalProperties: false
      };
      const jsonOut = await runLlama(
        `bullets: 4 viñetas, en español, sobre el estado del proyecto MCP local (FS, SQLite, PDF, LLM).`,
        { maxTokens: 220, schema, system: "Eres conciso y técnico. Devuelve JSON VÁLIDO." }
      ).catch(() => "");
      try {
        const parsed = jsonOut ? JSON.parse(jsonOut) : { bullets: [] };
        summaryText = parsed.bullets?.map((s: string) => `- ${s}`).join("\n") || "";
        if (summaryText) {
          md += `## Resumen (LLM local)\n${summaryText}\n\n`;
        }
      } catch {
        // fallback plano
        const txt = await runLlama(
          "Escribe 4 viñetas breves en español con el estado del proyecto MCP local (FS, SQLite, PDF, LLM).",
          { maxTokens: 180, system: "Sé conciso y claro." }
        );
        md += `## Resumen (LLM local)\n${txt}\n\n`;
      }
    }

    // 3.4 Guardar MD
    await fs.writeFile(mdPath, md, "utf8");

    // 3.5 Generar PDF
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48 });
      const stream = (doc as any).pipe(require("fs").createWriteStream(pdfPath));
      doc.fontSize(18).text(args.args.title, { underline: true });
      doc.moveDown();
      doc.fontSize(10).text(`Fecha: ${new Date().toLocaleString()}`);
      doc.moveDown();
      doc.fontSize(14).text("Archivos:");
      doc.moveDown(0.5);
      if (hits.length) hits.forEach(h => doc.fontSize(12).text(`• ${h}`));
      else doc.fontSize(12).text("Sin coincidencias");
      if (summaryText) {
        doc.moveDown();
        doc.fontSize(14).text("Resumen (LLM local):");
        doc.moveDown(0.5);
        summaryText.split("\n").forEach(l => doc.fontSize(12).text(l));
      }
      doc.end();
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });

    return {
      content: [
        { type: "text", text: `OK: ${mdPath}\nOK: ${pdfPath}` }
      ]
    };
  });
}
import { runLlama } from "./llm.js";

const SYSTEM_PROMPT = `
Eres un clasificador de intenciones para un asistente MCP local.
Tienes que devolver *solo* una de estas etiquetas:
- fs_read
- fs_write
- sqlite_query
- report_build
- llm_generate

Ejemplo:
Usuario: "Escribe hola mundo en docs/hola.txt"
Respuesta: fs_write
`;

/**
 * Clasifica el mensaje del usuario en una intención.
 */
export async function classifyIntent(message: string): Promise<string> {
  const prompt = `
${SYSTEM_PROMPT}

Usuario: "${message}"
Respuesta:
  `.trim();

  const raw = await runLlama(prompt, { maxTokens: 10, temperature: 0 });
  const intent = (raw || "").trim().toLowerCase();

  // Normaliza
  if (intent.includes("fs_read")) return "fs_read";
  if (intent.includes("fs_write")) return "fs_write";
  if (intent.includes("sqlite")) return "sqlite_query";
  if (intent.includes("report")) return "report_build";
  return "llm_generate"; // fallback
}

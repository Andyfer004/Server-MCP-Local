// src/services/llm.ts
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function llamaBin() {
  return process.env.LLAMA_BIN || "/opt/homebrew/opt/llama.cpp/bin/llama-cli";
}
function assertEnvModel() {
  const m = process.env.LLAMA_MODEL;
  if (!m) throw new Error("LLAMA_MODEL no configurada (ruta al .gguf)");
  return m;
}

const LLAMA_TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 60000);

// ---- Mutex simple para evitar saturar GPU/Metal ----
let queue: Promise<void> = Promise.resolve();
function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(() => undefined, () => undefined);
  return next;
}

// ---- Ejecutar llama-cli con timeout ----
async function runCli(args: string[]): Promise<string> {
  const ac = new AbortController();

  const p = spawn(llamaBin(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    signal: ac.signal as any,
  });

  let out = "", err = "";
  p.stdout.on("data", d => (out += d.toString()));
  p.stderr.on("data", d => (err += d.toString()));

  const done = new Promise<string>((resolve, reject) => {
    p.on("close", code => (code === 0 ? resolve(out.trim()) : reject(new Error(err || "llama-cli failed"))));
    p.on("error", reject);
  });

  const timer = delay(LLAMA_TIMEOUT_MS).then(() => {
    try { ac.abort(); } catch {}
  });

  return Promise.race([
    done,
    timer.then(() => Promise.reject(new Error("llama timeout"))),
  ]);
}

/** Prompt directo con -sys (bullets, resumen, etc.) */
export async function runLlama(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number; system?: string; seed?: number; schema?: any }
): Promise<string> {
  const model = assertEnvModel();
  const maxTokens = Math.min(Math.max(opts?.maxTokens ?? 256, 1), 2048);
  const temperature = opts?.temperature ?? 0.2;
  const system = opts?.system ?? "Eres un asistente TÉCNICO, en español, preciso. No inventes.";
  const seed = opts?.seed ?? 42;

  const args = [
    "-m", model,
    "-n", String(maxTokens),
    "--temp", String(temperature),
    "--seed", String(seed),
    "--simple-io", "--no-display-prompt", "-st",
    "--ignore-eos",
    "-sys", system,
  ];
  if (opts?.schema) { args.push("-j", JSON.stringify(opts.schema)); }
  args.push("-p", prompt);

  return withMutex(() => runCli(args));
}

/** Chat con historial: envías el prompt ya plantillado; usamos -no-cnv */
export async function runLlamaRawPrompt(
  fullPrompt: string,
  opts?: { maxTokens?: number; temperature?: number; seed?: number }
): Promise<string> {
  const model = assertEnvModel();
  const maxTokens = Math.min(Math.max(opts?.maxTokens ?? 256, 1), 2048);
  const temperature = opts?.temperature ?? 0.2;
  const seed = opts?.seed ?? 42;

  const args = [
    "-m", model,
    "-n", String(maxTokens),
    "--temp", String(temperature),
    "--seed", String(seed),
    "--simple-io", "--no-display-prompt", "-st",
    "--ignore-eos",
    "-no-cnv",
    "-p", fullPrompt,
  ];

  return withMutex(() => runCli(args));
}

// ---------- Chat template ----------
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Formato compatible con tu TinyLlama: <|system|> ... <|user|> ... <|assistant|> ... */
export function buildChatPrompt(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") parts.push("<|system|>\n" + m.content);
    if (m.role === "user") parts.push("<|user|>\n" + m.content);
    if (m.role === "assistant") parts.push("<|assistant|>\n" + m.content);
  }
  if (messages[messages.length - 1]?.role !== "assistant") {
    parts.push("<|assistant|>");
  }
  return parts.join("");
}
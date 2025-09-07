// src/services/chat.ts
import { randomUUID } from "node:crypto";
import { buildChatPrompt, ChatMessage, runLlamaRawPrompt } from "./llm.js";

type Session = {
  id: string;
  messages: ChatMessage[];
};

const sessions = new Map<string, Session>();

export function createSession(system?: string): Session {
  const id = randomUUID();
  const s: Session = {
    id,
    messages: [
      { role: "system", content: system || "Eres un asistente local. Responde en español con precisión." },
    ],
  };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export async function chatSend(
  id: string,
  userText: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<{ reply: string; session: Session }> {
  const s = sessions.get(id);
  if (!s) throw new Error("session not found");

  s.messages.push({ role: "user", content: userText });

  const prompt = buildChatPrompt(s.messages);
  const reply = await runLlamaRawPrompt(prompt, {
    maxTokens: opts?.maxTokens ?? 256,
    temperature: opts?.temperature ?? 0.2,
  });

  s.messages.push({ role: "assistant", content: reply });
  return { reply, session: s };
}
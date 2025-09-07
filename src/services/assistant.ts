// src/services/assistant.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFsTools } from "../tools/fsTools.js";
import { registerDbTools } from "../tools/dbTools.js";
import { registerTaskTools } from "../tools/taskTools.js";

/**
 * Registra todas las herramientas del asistente en el servidor MCP.
 * Incluye: lectura/escritura de archivos, consultas SQLite, generación de reportes,
 * uso del LLM local y resúmenes.
 */
export function registerAssistant(server: McpServer) {
  // Herramientas de sistema de archivos
  registerFsTools(server);

  // Herramientas de base de datos SQLite
  registerDbTools(server);

  // Herramientas de tareas (reportes, LLM, resúmenes, etc.)
  registerTaskTools(server);

}

import { z } from "zod";
import Database from "better-sqlite3";
import { CONFIG } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerDbTools(server: McpServer) {
  server.registerTool(
    "sqlite_query",
    {
      title: "Consulta SQLite (solo lectura)",
      description: "Ejecuta una consulta SELECT en la base SQLite local",
      inputSchema: {
        sql: z.string(),
        params: z.array(z.any()).optional()
      }
    },
    async ({ sql, params }) => {
      const db = new Database(CONFIG.dbPath, { readonly: true });
      try {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...(params ?? []));
        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          structuredContent: { rows }
        };
      } finally {
        db.close();
      }
    }
  );
}
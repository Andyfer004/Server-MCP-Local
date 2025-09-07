import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { assertAllowedPath } from "../utils/pathGuard.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerFsTools(server: McpServer) {
  server.registerTool(
    "fs_read",
    {
      title: "Leer archivo",
      description: "Lee un archivo de texto dentro de los directorios permitidos",
      inputSchema: { path: z.string() }
    },
    async ({ path: inPath }) => {
      const p = assertAllowedPath(inPath);
      const content = await fs.readFile(p, "utf8");
      return {
        // texto para el LLM / UI
        content: [{ type: "text", text: content }],
        // y también salida estructurada por si el cliente valida JSON-schema
        structuredContent: {
          path: path.relative(process.cwd(), p),
          length: content.length
        }
      };
    }
  );

  server.registerTool(
    "fs_write",
    {
      title: "Escribir archivo",
      description: "Escribe contenido de texto en un archivo permitido",
      inputSchema: { path: z.string(), content: z.string() }
    },
    async ({ path: inPath, content }) => {
      const p = assertAllowedPath(inPath);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf8");
      return {
        content: [{ type: "text", text: `OK -> ${path.relative(process.cwd(), p)}` }],
        structuredContent: { ok: true, path: path.relative(process.cwd(), p) }
      };
    }
  );
}
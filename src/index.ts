import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFsTools } from "./tools/fsTools.js";
import { registerDbTools } from "./tools/dbTools.js";
import { registerTaskTools } from "./tools/taskTools.js";

async function main() {
  const server = new McpServer({
    name: "local-mcp-server",
    version: "1.0.0",
  });

  // Registrar tools
  registerFsTools(server);
  registerDbTools(server);
  registerTaskTools(server);

  // Conectar por STDIO (lo que esperan la mayoría de hosts MCP locales)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[MCP] Servidor listo por STDIO\n");
}

main().catch(err => {
  console.error("[MCP] Fatal:", err);
  process.exit(1);
});
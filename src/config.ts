import "dotenv/config";

export const CONFIG = {
  dbPath: process.env.DB_PATH ?? "./data/app.db",
  allowedDirs: (process.env.MCP_ALLOWED_DIRS ?? "docs,reports,data")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
};
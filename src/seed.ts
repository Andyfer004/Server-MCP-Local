import Database from "better-sqlite3";
import "dotenv/config";
const db = new Database(process.env.DB_PATH ?? "./data/app.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL);
  INSERT INTO notas (titulo) VALUES ('hola'), ('mcp'), ('sqlite');
`);
console.log("Seed listo");
db.close();

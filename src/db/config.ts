import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data/config.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULTS: Record<string, string> = {
  voice_id:           "Aoede",
  system_instruction: "You are a helpful voice assistant. Respond concisely.",
  name:               "Gemini",
};

const upsert = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
for (const [key, value] of Object.entries(DEFAULTS)) {
  upsert.run(key, value);
}

export function getConfig(key: string): string {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function setConfig(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
}

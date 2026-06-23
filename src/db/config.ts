import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data/config.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL UNIQUE,
    display_name       TEXT NOT NULL,
    voice_id           TEXT NOT NULL DEFAULT 'alloy',
    system_instruction TEXT NOT NULL DEFAULT 'You are a helpful voice assistant. Respond concisely.'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// デフォルトペルソナが1件もなければ挿入
const count = (db.prepare("SELECT COUNT(*) as c FROM personas").get() as { c: number }).c;
if (count === 0) {
  db.prepare(`
    INSERT INTO personas (name, display_name, voice_id, system_instruction)
    VALUES (?, ?, ?, ?)
  `).run("default", "Assistant", "alloy", "You are a helpful voice assistant. Respond concisely.");
}

export interface Persona {
  id: number;
  name: string;
  display_name: string;
  voice_id: string;
  system_instruction: string;
}

const DEFAULT_PERSONA: Persona = {
  id: 0,
  name: "default",
  display_name: "Assistant",
  voice_id: "alloy",
  system_instruction: "You are a helpful voice assistant. Respond concisely.",
};

export function getPersonas(): Persona[] {
  return db.prepare("SELECT * FROM personas ORDER BY id").all() as Persona[];
}

export function getPersona(name: string): Persona | undefined {
  return db.prepare("SELECT * FROM personas WHERE name = ?").get(name) as Persona | undefined;
}

export function getActivePersona(): Persona {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'active_persona'").get() as { value: string } | undefined;
  if (row) {
    const persona = getPersona(row.value);
    if (persona) return persona;
  }
  // アクティブが未設定 or 削除済みなら先頭のペルソナを返す
  const first = db.prepare("SELECT * FROM personas ORDER BY id LIMIT 1").get() as Persona | undefined;
  return first ?? DEFAULT_PERSONA;
}

export function setActivePersona(name: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_persona', ?)").run(name);
}

export function upsertPersona(data: Omit<Persona, "id">): void {
  db.prepare(`
    INSERT INTO personas (name, display_name, voice_id, system_instruction)
    VALUES (@name, @display_name, @voice_id, @system_instruction)
    ON CONFLICT(name) DO UPDATE SET
      display_name       = excluded.display_name,
      voice_id           = excluded.voice_id,
      system_instruction = excluded.system_instruction
  `).run(data);
}

export function deletePersona(name: string): void {
  db.prepare("DELETE FROM personas WHERE name = ?").run(name);
}

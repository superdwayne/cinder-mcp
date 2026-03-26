#!/usr/bin/env tsx
/**
 * build-knowledge.ts
 *
 * Indexes Cinder documentation into a SQLite FTS5 knowledge base
 * for use by the docs tools (search_docs, get_class, etc.).
 *
 * Usage: npm run index-knowledge [-- --cinder-path /path/to/cinder]
 */

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig, validateCinderPath } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");
const DB_PATH = path.resolve(__dirname, "../data/cinder.db");

interface KnowledgeEntry {
  title: string;
  category: string;
  namespace: string;
  tags: string;
  content: string;
  code_examples: string;
}

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: match[2] };
}

function extractCodeExamples(body: string): string {
  const blocks: string[] = [];
  const regex = /```(?:cpp|c\+\+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(body)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks.join("\n\n// ---\n\n");
}

function collectMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function main(): void {
  const config = readConfig();

  const cinderPathArg = process.argv.includes("--cinder-path")
    ? process.argv[process.argv.indexOf("--cinder-path") + 1]
    : undefined;

  const cinderPath = cinderPathArg || config.CINDER_PATH;

  if (cinderPath) {
    const validation = validateCinderPath(cinderPath);
    if (!validation.valid) {
      console.warn(`Warning: ${validation.reason}`);
    }
  }

  // Ensure data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Remove existing DB
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Create main table
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      namespace TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      code_examples TEXT NOT NULL DEFAULT ''
    );
  `);

  // Create FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title,
      category,
      namespace,
      tags,
      content,
      code_examples,
      content='knowledge',
      content_rowid='id',
      tokenize='porter unicode61'
    );
  `);

  // Sync triggers
  db.exec(`
    CREATE TRIGGER knowledge_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, title, category, namespace, tags, content, code_examples)
      VALUES (new.id, new.title, new.category, new.namespace, new.tags, new.content, new.code_examples);
    END;

    CREATE TRIGGER knowledge_ad AFTER DELETE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, category, namespace, tags, content, code_examples)
      VALUES ('delete', old.id, old.title, old.category, old.namespace, old.tags, old.content, old.code_examples);
    END;

    CREATE TRIGGER knowledge_au AFTER UPDATE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, category, namespace, tags, content, code_examples)
      VALUES ('delete', old.id, old.title, old.category, old.namespace, old.tags, old.content, old.code_examples);
      INSERT INTO knowledge_fts(rowid, title, category, namespace, tags, content, code_examples)
      VALUES (new.id, new.title, new.category, new.namespace, new.tags, new.content, new.code_examples);
    END;
  `);

  const insert = db.prepare(`
    INSERT INTO knowledge (title, category, namespace, tags, content, code_examples)
    VALUES (@title, @category, @namespace, @tags, @content, @code_examples)
  `);

  const files = collectMarkdownFiles(KNOWLEDGE_DIR);
  console.log(`Found ${files.length} markdown files in ${KNOWLEDGE_DIR}`);

  const insertMany = db.transaction((entries: KnowledgeEntry[]) => {
    for (const entry of entries) {
      insert.run(entry);
    }
  });

  const entries: KnowledgeEntry[] = [];

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const codeExamples = extractCodeExamples(body);

    entries.push({
      title: meta.title || path.basename(filePath, ".md"),
      category: meta.category || "",
      namespace: meta.namespace || "",
      tags: meta.tags || "",
      content: body,
      code_examples: codeExamples,
    });

    console.log(`  Indexed: ${meta.title || path.basename(filePath)}`);
  }

  insertMany(entries);

  const count = db.prepare("SELECT COUNT(*) as cnt FROM knowledge").get() as {
    cnt: number;
  };
  console.log(`\nDatabase created at ${DB_PATH}`);
  console.log(`Total entries: ${count.cnt}`);

  db.close();
}

main();

/**
 * Shared SQLite knowledge-base module.
 * Opens data/cinder.db (FTS5) and exposes query helpers used by the docs tools.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "cinder.db");

let _db: Database.Database | null = null;

/**
 * Returns the open database handle, or null if the DB file doesn't exist yet.
 */
function getDb(): Database.Database | null {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) return null;
  _db = new Database(DB_PATH, { readonly: true });
  _db.pragma("journal_mode = WAL");
  return _db;
}

export interface DocEntry {
  id: number;
  title: string;
  category: string;
  content: string;
  type: string;
  namespace?: string;
  url?: string;
}

export interface SearchResult extends DocEntry {
  snippet: string;
  rank: number;
}

const DB_MISSING_MSG =
  "Knowledge database not found. Run `npm run index-knowledge` to build data/cinder.db from the Cinder docs.";

/**
 * Full-text search across the knowledge base.
 */
export function searchDocs(
  query: string,
  category?: string,
  limit = 10,
): SearchResult[] | string {
  const db = getDb();
  if (!db) return DB_MISSING_MSG;

  let sql = `
    SELECT d.id, d.title, d.category, d.content, d.type, d.namespace, d.url,
           snippet(docs_fts, 2, '<mark>', '</mark>', '…', 48) AS snippet,
           rank
    FROM docs_fts
    JOIN docs d ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (category) {
    sql += " AND d.category = ?";
    params.push(category);
  }

  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as SearchResult[];
}

/**
 * Look up a single class by name.
 */
export function getClassEntry(className: string): DocEntry | string {
  const db = getDb();
  if (!db) return DB_MISSING_MSG;

  const row = db
    .prepare("SELECT * FROM docs WHERE title = ? AND type = 'class' LIMIT 1")
    .get(className) as DocEntry | undefined;

  if (!row) {
    // Try a fuzzy FTS match
    const fuzzy = db
      .prepare(
        `SELECT d.* FROM docs_fts
         JOIN docs d ON d.id = docs_fts.rowid
         WHERE docs_fts MATCH ? AND d.type = 'class'
         LIMIT 1`,
      )
      .get(className) as DocEntry | undefined;
    return fuzzy ?? `Class "${className}" not found in knowledge base.`;
  }
  return row;
}

/**
 * Return all entries in a given namespace.
 */
export function getNamespaceEntries(namespace: string): DocEntry[] | string {
  const db = getDb();
  if (!db) return DB_MISSING_MSG;

  const rows = db
    .prepare("SELECT * FROM docs WHERE namespace = ? ORDER BY title")
    .all(namespace) as DocEntry[];

  if (rows.length === 0) {
    // Try prefix match
    const prefix = db
      .prepare("SELECT * FROM docs WHERE namespace LIKE ? ORDER BY title")
      .all(`${namespace}%`) as DocEntry[];
    return prefix.length > 0
      ? prefix
      : `No entries found for namespace "${namespace}".`;
  }
  return rows;
}

/**
 * Return a guide entry by name.
 */
export function getGuideEntry(guideName: string): DocEntry | string {
  const db = getDb();
  if (!db) return DB_MISSING_MSG;

  const row = db
    .prepare(
      "SELECT * FROM docs WHERE (type = 'guide' OR category = 'Guide') AND lower(title) LIKE ? LIMIT 1",
    )
    .get(`%${guideName.toLowerCase()}%`) as DocEntry | undefined;

  return row ?? `Guide "${guideName}" not found in knowledge base.`;
}

/**
 * Return all distinct categories.
 */
export function listAllCategories(): string[] | string {
  const db = getDb();
  if (!db) return DB_MISSING_MSG;

  const rows = db
    .prepare("SELECT DISTINCT category FROM docs ORDER BY category")
    .all() as { category: string }[];

  return rows.map((r) => r.category);
}

export { DB_PATH, DB_MISSING_MSG };

#!/usr/bin/env bun
// @bun
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/logger/index.ts
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
function shouldLog(level) {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[_minLevel];
}
function formatEntry(entry) {
  return JSON.stringify(entry);
}
function writeLog(entry) {
  if (!shouldLog(entry.level))
    return;
  const line = formatEntry(entry) + `
`;
  try {
    if (!existsSync(LOG_DIR))
      mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE)) {
      const { statSync } = __require("fs");
      const stats = statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE + ".1";
        const { renameSync } = __require("fs");
        try {
          renameSync(LOG_FILE, rotated);
        } catch {}
      }
    }
    appendFileSync(LOG_FILE, line);
  } catch {
    process.stderr.write(line);
  }
}
function createLogger(module) {
  const log = (level, msg, data) => {
    writeLog({
      ts: new Date().toISOString(),
      level,
      module,
      msg,
      ...data ? { data } : {}
    });
  };
  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data)
  };
}
var LEVEL_PRIORITY, LOG_DIR, LOG_FILE, MAX_LOG_SIZE, _minLevel, logger;
var init_logger = __esm(() => {
  LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  LOG_DIR = join(homedir(), ".claude-memory-hub", "logs");
  LOG_FILE = join(LOG_DIR, "memory-hub.log");
  MAX_LOG_SIZE = 5 * 1024 * 1024;
  _minLevel = process.env.CMH_LOG_LEVEL || "info";
  logger = createLogger("core");
});

// src/db/schema.ts
import { Database } from "bun:sqlite";
import { existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
function getDbPath() {
  const dir = join2(homedir2(), ".claude-memory-hub");
  if (!existsSync2(dir)) {
    mkdirSync2(dir, { recursive: true, mode: 448 });
  }
  return join2(dir, "memory.db");
}
function initDatabase(db) {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA cache_size = -8000");
  repairSchema(db);
  db.run(CREATE_TABLES);
  applyMigrations(db);
}
function repairSchema(db) {
  try {
    const result = db.query("PRAGMA integrity_check").get();
    if (result && result.integrity_check !== "ok") {
      log.error("Database integrity check failed", { result: result.integrity_check });
      log.warn("Attempting WAL checkpoint recovery...");
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  } catch (e) {
    log.error("Integrity check threw", { error: String(e) });
  }
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fts_%'").all();
    for (const t of tables) {
      if (t.name === "fts_memories" || t.name.startsWith("fts_memories_"))
        continue;
      log.warn("Orphaned FTS table detected, dropping", { table: t.name });
      try {
        db.run(`DROP TABLE IF EXISTS "${t.name}"`);
      } catch {}
    }
  } catch {}
}
function applyMigrations(db) {
  const currentVersion = db.query("SELECT MAX(version) as version FROM schema_versions").get()?.version ?? 0;
  if (currentVersion < 1) {
    log.info("Applying migration v1: base schema");
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (1, ?)", [Date.now()]);
  }
  if (currentVersion < 2) {
    log.info("Applying migration v2: discovery_tokens, health, tfidf");
    try {
      db.run("ALTER TABLE entities ADD COLUMN discovery_tokens INTEGER NOT NULL DEFAULT 0");
    } catch {}
    try {
      db.run("ALTER TABLE long_term_summaries ADD COLUMN discovery_tokens INTEGER NOT NULL DEFAULT 0");
    } catch {}
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (2, ?)", [Date.now()]);
    log.info("Migration v2 complete");
  }
}
function getDatabase() {
  if (!_db) {
    const path = getDbPath();
    _db = new Database(path);
    initDatabase(_db);
  }
  return _db;
}
var log, CREATE_TABLES = `
-- Migration version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

-- L2: Session lifecycle
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  user_prompt TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_project    ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_started    ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status     ON sessions(status);

-- L2: Entity capture from tool events (no XML \u2014 direct hook metadata)
CREATE TABLE IF NOT EXISTS entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project       TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  entity_type   TEXT NOT NULL
    CHECK(entity_type IN ('file_read','file_modified','file_created','error','decision')),
  entity_value  TEXT NOT NULL,
  context       TEXT,
  importance    INTEGER NOT NULL DEFAULT 1
    CHECK(importance BETWEEN 1 AND 5),
  created_at    INTEGER NOT NULL,
  prompt_number INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entities_session    ON entities(session_id);
CREATE INDEX IF NOT EXISTS idx_entities_project    ON entities(project);
CREATE INDEX IF NOT EXISTS idx_entities_type       ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_value      ON entities(entity_value);
CREATE INDEX IF NOT EXISTS idx_entities_created    ON entities(created_at DESC);

-- L2: Manual session notes (from MCP memory_store tool or summarizer)
CREATE TABLE IF NOT EXISTS session_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);

-- L3: Cross-session persistent summaries
CREATE TABLE IF NOT EXISTS long_term_summaries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL UNIQUE,
  project       TEXT NOT NULL,
  summary       TEXT NOT NULL,
  files_touched TEXT NOT NULL DEFAULT '[]',  -- JSON array
  decisions     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  errors_fixed  TEXT NOT NULL DEFAULT '[]',  -- JSON array
  token_savings INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lts_project  ON long_term_summaries(project);
CREATE INDEX IF NOT EXISTS idx_lts_created  ON long_term_summaries(created_at DESC);

-- L3: FTS5 virtual table for semantic search across summaries
-- porter stemming + unicode61 handles English technical content well
CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(
  session_id    UNINDEXED,
  project,
  summary,
  files_touched,
  decisions,
  content       = 'long_term_summaries',
  content_rowid = 'id',
  tokenize      = 'porter unicode61'
);

-- Keep FTS5 index in sync with content table via triggers
CREATE TRIGGER IF NOT EXISTS fts_memories_insert
  AFTER INSERT ON long_term_summaries BEGIN
    INSERT INTO fts_memories(rowid, session_id, project, summary, files_touched, decisions)
    VALUES (new.id, new.session_id, new.project, new.summary, new.files_touched, new.decisions);
  END;

CREATE TRIGGER IF NOT EXISTS fts_memories_update
  AFTER UPDATE ON long_term_summaries BEGIN
    INSERT INTO fts_memories(fts_memories, rowid, session_id, project, summary, files_touched, decisions)
    VALUES ('delete', old.id, old.session_id, old.project, old.summary, old.files_touched, old.decisions);
    INSERT INTO fts_memories(rowid, session_id, project, summary, files_touched, decisions)
    VALUES (new.id, new.session_id, new.project, new.summary, new.files_touched, new.decisions);
  END;

CREATE TRIGGER IF NOT EXISTS fts_memories_delete
  AFTER DELETE ON long_term_summaries BEGIN
    INSERT INTO fts_memories(fts_memories, rowid, session_id, project, summary, files_touched, decisions)
    VALUES ('delete', old.id, old.session_id, old.project, old.summary, old.files_touched, old.decisions);
  END;

-- V2: Health monitoring
CREATE TABLE IF NOT EXISTS health_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  component   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK(status IN ('ok','degraded','error')),
  message     TEXT,
  latency_ms  INTEGER,
  checked_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_component ON health_checks(component, checked_at DESC);

-- V2: TF-IDF vector index for semantic search
CREATE TABLE IF NOT EXISTS tfidf_index (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type    TEXT NOT NULL CHECK(doc_type IN ('summary','entity','note')),
  doc_id      INTEGER NOT NULL,
  term        TEXT NOT NULL,
  tf          REAL NOT NULL,
  idf         REAL NOT NULL DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS idx_tfidf_term ON tfidf_index(term);
CREATE INDEX IF NOT EXISTS idx_tfidf_doc  ON tfidf_index(doc_type, doc_id);
`, _db = null;
var init_schema = __esm(() => {
  init_logger();
  log = createLogger("schema");
});

// src/health/monitor.ts
var exports_monitor = {};
__export(exports_monitor, {
  runHealthCheck: () => runHealthCheck,
  formatHealthReport: () => formatHealthReport
});
import { existsSync as existsSync4, statSync } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4 } from "path";
function checkDatabase(db) {
  const start = performance.now();
  try {
    db.query("SELECT 1").get();
    return {
      component: "sqlite",
      status: "ok",
      message: "Database responsive",
      latency_ms: Math.round(performance.now() - start)
    };
  } catch (e) {
    return {
      component: "sqlite",
      status: "error",
      message: `Database error: ${e}`,
      latency_ms: Math.round(performance.now() - start)
    };
  }
}
function checkFTS5(db) {
  const start = performance.now();
  try {
    db.query("SELECT * FROM fts_memories LIMIT 0").all();
    return {
      component: "fts5",
      status: "ok",
      message: "FTS5 index available",
      latency_ms: Math.round(performance.now() - start)
    };
  } catch (e) {
    return {
      component: "fts5",
      status: "degraded",
      message: `FTS5 unavailable, fallback to LIKE: ${e}`,
      latency_ms: Math.round(performance.now() - start)
    };
  }
}
function checkDiskSpace() {
  const start = performance.now();
  const dbPath = join4(homedir4(), ".claude-memory-hub", "memory.db");
  try {
    if (!existsSync4(dbPath)) {
      return { component: "disk", status: "ok", message: "DB not yet created", latency_ms: 0 };
    }
    const stats = statSync(dbPath);
    const sizeMB = stats.size / (1024 * 1024);
    const status = sizeMB > 500 ? "degraded" : "ok";
    return {
      component: "disk",
      status,
      message: `DB size: ${sizeMB.toFixed(1)}MB`,
      latency_ms: Math.round(performance.now() - start)
    };
  } catch (e) {
    return {
      component: "disk",
      status: "error",
      message: `Disk check failed: ${e}`,
      latency_ms: Math.round(performance.now() - start)
    };
  }
}
function checkDataIntegrity(db) {
  const start = performance.now();
  try {
    const orphans = db.query(`SELECT COUNT(*) as c FROM entities
       WHERE session_id NOT IN (SELECT id FROM sessions)`).get();
    const count = orphans?.c ?? 0;
    if (count > 0) {
      return {
        component: "integrity",
        status: "degraded",
        message: `${count} orphaned entities (no parent session)`,
        latency_ms: Math.round(performance.now() - start)
      };
    }
    return {
      component: "integrity",
      status: "ok",
      message: "No orphaned records",
      latency_ms: Math.round(performance.now() - start)
    };
  } catch (e) {
    return {
      component: "integrity",
      status: "error",
      message: `Integrity check failed: ${e}`,
      latency_ms: Math.round(performance.now() - start)
    };
  }
}
function runHealthCheck(db) {
  const d = db ?? getDatabase();
  const checks = [
    checkDatabase(d),
    checkFTS5(d),
    checkDiskSpace(),
    checkDataIntegrity(d)
  ];
  let overall = "ok";
  for (const c of checks) {
    if (c.status === "error") {
      overall = "error";
      break;
    }
    if (c.status === "degraded")
      overall = "degraded";
  }
  const now = Date.now();
  try {
    const stmt = d.prepare("INSERT INTO health_checks(component, status, message, latency_ms, checked_at) VALUES (?, ?, ?, ?, ?)");
    for (const c of checks) {
      stmt.run(c.component, c.status, c.message, c.latency_ms, now);
    }
    d.run(`DELETE FROM health_checks WHERE id NOT IN (
        SELECT id FROM health_checks ORDER BY checked_at DESC LIMIT 400
      )`);
  } catch (e) {
    log2.warn("Failed to persist health check", { error: String(e) });
  }
  const report = { overall, checks, checked_at: now };
  if (overall !== "ok") {
    log2.warn("Health check degraded", { overall, checks: checks.filter((c) => c.status !== "ok") });
  }
  return report;
}
function formatHealthReport(report) {
  const lines = [`Health: ${report.overall.toUpperCase()}`];
  for (const c of report.checks) {
    const icon = c.status === "ok" ? "[OK]" : c.status === "degraded" ? "[WARN]" : "[ERR]";
    lines.push(`  ${icon} ${c.component}: ${c.message} (${c.latency_ms}ms)`);
  }
  return lines.join(`
`);
}
var log2;
var init_monitor = __esm(() => {
  init_schema();
  init_logger();
  log2 = createLogger("health");
});

// src/search/vector-search.ts
var exports_vector_search = {};
__export(exports_vector_search, {
  vectorSearch: () => vectorSearch,
  reindexAll: () => reindexAll,
  rebuildIDF: () => rebuildIDF,
  indexDocument: () => indexDocument
});
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_./\-]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}
function computeTF(tokens) {
  const freq = new Map;
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const maxFreq = Math.max(...freq.values(), 1);
  for (const [k, v] of freq) {
    freq.set(k, 0.5 + 0.5 * (v / maxFreq));
  }
  return freq;
}
function indexDocument(docType, docId, text, db) {
  const d = db ?? getDatabase();
  const tokens = tokenize(text);
  if (tokens.length === 0)
    return;
  const tf = computeTF(tokens);
  d.run("DELETE FROM tfidf_index WHERE doc_type = ? AND doc_id = ?", [docType, docId]);
  const stmt = d.prepare("INSERT INTO tfidf_index(doc_type, doc_id, term, tf) VALUES (?, ?, ?, ?)");
  const tx = d.transaction(() => {
    for (const [term, tfVal] of tf) {
      stmt.run(docType, docId, term, tfVal);
    }
  });
  tx();
}
function rebuildIDF(db) {
  const d = db ?? getDatabase();
  try {
    const totalDocs = d.query("SELECT COUNT(DISTINCT doc_type || ':' || doc_id) as c FROM tfidf_index").get()?.c ?? 1;
    d.run(`
      UPDATE tfidf_index SET idf = (
        SELECT LOG(CAST(? AS REAL) / MAX(COUNT(DISTINCT doc_type || ':' || doc_id), 1))
        FROM tfidf_index t2
        WHERE t2.term = tfidf_index.term
      )
    `, [totalDocs]);
    log3.info("IDF rebuilt", { totalDocs });
  } catch (e) {
    log3.error("IDF rebuild failed", { error: String(e) });
  }
}
function vectorSearch(query, limit = 10, docTypeFilter, db) {
  const d = db ?? getDatabase();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0)
    return [];
  const queryTF = computeTF(queryTokens);
  const placeholders = queryTokens.map(() => "?").join(",");
  const typeFilter = docTypeFilter ? `AND doc_type = '${docTypeFilter}'` : "";
  try {
    const results = d.prepare(`
      SELECT doc_type, doc_id,
             SUM(tf * COALESCE(NULLIF(idf, 0), 1.0)) as score
      FROM tfidf_index
      WHERE term IN (${placeholders}) ${typeFilter}
      GROUP BY doc_type, doc_id
      ORDER BY score DESC
      LIMIT ?
    `).all(...queryTokens, limit);
    return results;
  } catch (e) {
    log3.error("Vector search failed", { error: String(e) });
    return [];
  }
}
function reindexAll(db) {
  const d = db ?? getDatabase();
  log3.info("Starting full reindex...");
  const summaries = d.query("SELECT id, summary, files_touched, decisions FROM long_term_summaries").all();
  for (const s of summaries) {
    const text = [s.summary, s.files_touched, s.decisions].join(" ");
    indexDocument("summary", s.id, text, d);
  }
  const entities = d.query("SELECT id, entity_value, context FROM entities WHERE entity_type IN ('decision', 'error')").all();
  for (const e of entities) {
    const text = [e.entity_value, e.context || ""].join(" ");
    indexDocument("entity", e.id, text, d);
  }
  rebuildIDF(d);
  log3.info("Full reindex complete", { summaries: summaries.length, entities: entities.length });
}
var log3, STOP_WORDS;
var init_vector_search = __esm(() => {
  init_schema();
  init_logger();
  log3 = createLogger("vector-search");
  STOP_WORDS = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "yet",
    "both",
    "each",
    "every",
    "all",
    "any",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "just",
    "because",
    "if",
    "when",
    "where",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "they",
    "them",
    "their"
  ]);
});

// src/search/search-workflow.ts
function searchIndex(query, opts = {}, db) {
  const d = db ?? getDatabase();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const results = [];
  try {
    const safeQuery = sanitizeFtsQuery(query);
    if (safeQuery) {
      const ftsResults = d.prepare(`SELECT lts.id, lts.session_id, lts.project, SUBSTR(lts.summary, 1, 80) as summary, lts.created_at
         FROM fts_memories
         JOIN long_term_summaries lts ON lts.id = fts_memories.rowid
         WHERE fts_memories MATCH ?1
         ORDER BY rank
         LIMIT ?2 OFFSET ?3`).all(safeQuery, limit, offset);
      for (const r of ftsResults) {
        results.push({
          id: r.id,
          type: "summary",
          title: r.summary,
          project: r.project,
          created_at: r.created_at,
          score: 1
        });
      }
    }
  } catch {}
  const vectorResults = vectorSearch(query, limit, undefined, d);
  for (const vr of vectorResults) {
    if (vr.doc_type === "summary" && results.some((r) => r.type === "summary" && r.id === vr.doc_id))
      continue;
    if (vr.doc_type === "summary") {
      const row = d.prepare("SELECT id, project, SUBSTR(summary, 1, 80) as summary, created_at FROM long_term_summaries WHERE id = ?").get(vr.doc_id);
      if (row) {
        results.push({ id: row.id, type: "summary", title: row.summary, project: row.project, created_at: row.created_at, score: vr.score });
      }
    } else if (vr.doc_type === "entity") {
      const row = d.prepare("SELECT id, project, SUBSTR(entity_value, 1, 80) as entity_value, created_at FROM entities WHERE id = ?").get(vr.doc_id);
      if (row) {
        results.push({ id: row.id, type: "entity", title: row.entity_value, project: row.project, created_at: row.created_at, score: vr.score });
      }
    }
  }
  const filtered = opts.project ? results.filter((r) => r.project === opts.project) : results;
  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, limit);
}
function sanitizeFtsQuery(query) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/["*^():{}[\]]/g, "").trim()).filter((w) => w.length > 1);
  if (words.length === 0)
    return "";
  if (words.length === 1)
    return words[0] + "*";
  const head = words.slice(0, -1).map((w) => `"${w}"`);
  const last = words[words.length - 1];
  return [...head, `"${last}"*`].join(" ");
}
var log4;
var init_search_workflow = __esm(() => {
  init_schema();
  init_vector_search();
  init_logger();
  log4 = createLogger("search-workflow");
});

// src/ui/viewer.ts
var exports_viewer = {};
__export(exports_viewer, {
  startViewer: () => startViewer
});
function handleApi(url) {
  const db = getDatabase();
  const path = url.pathname;
  if (path === "/api/health") {
    const report = runHealthCheck(db);
    return json(report);
  }
  if (path === "/api/stats") {
    const sessions = db.query("SELECT COUNT(*) as c FROM sessions").get()?.c ?? 0;
    const entities = db.query("SELECT COUNT(*) as c FROM entities").get()?.c ?? 0;
    const summaries = db.query("SELECT COUNT(*) as c FROM long_term_summaries").get()?.c ?? 0;
    const notes = db.query("SELECT COUNT(*) as c FROM session_notes").get()?.c ?? 0;
    return json({ sessions, entities, summaries, notes });
  }
  if (path === "/api/search") {
    const query = url.searchParams.get("q") || "";
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const project = url.searchParams.get("project") || undefined;
    const results = searchIndex(query, { limit, offset, project }, db);
    return json(results);
  }
  if (path === "/api/sessions") {
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const rows = db.query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?", limit, offset).all();
    return json(rows);
  }
  if (path === "/api/summaries") {
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const rows = db.query("SELECT * FROM long_term_summaries ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset).all();
    return json(rows);
  }
  if (path === "/api/entities") {
    const sessionId = url.searchParams.get("session_id");
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    if (sessionId) {
      const rows2 = db.query("SELECT * FROM entities WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?", sessionId, limit, offset).all();
      return json(rows2);
    }
    const rows = db.query("SELECT * FROM entities ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset).all();
    return json(rows);
  }
  return json({ error: "Not found" }, 404);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
function startViewer() {
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/"))
        return handleApi(url);
      return new Response(HTML, { headers: { "Content-Type": "text/html" } });
    }
  });
  console.log(`claude-memory-hub viewer running at http://localhost:${server.port}`);
  log5.info("Viewer started", { port: server.port });
}
var log5, PORT = 37888, HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-memory-hub viewer</title>
<style>
  :root { --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  header { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  header h1 { font-size: 20px; font-weight: 600; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; min-width: 140px; }
  .stat .value { font-size: 28px; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 12px; color: var(--muted); text-transform: uppercase; }
  .search-bar { display: flex; gap: 8px; margin-bottom: 24px; }
  .search-bar input { flex: 1; background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; color: var(--text); font-size: 14px; outline: none; }
  .search-bar input:focus { border-color: var(--accent); }
  .search-bar button { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; font-weight: 600; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tabs button { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
  .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 8px; }
  .card .meta { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .card .type { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .type-summary { background: rgba(88,166,255,0.15); color: var(--accent); }
  .type-entity { background: rgba(63,185,80,0.15); color: var(--green); }
  .type-session { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .card .content { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .health { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .health .check { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .check-ok { background: rgba(63,185,80,0.15); color: var(--green); }
  .check-degraded { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .check-error { background: rgba(248,81,73,0.15); color: var(--red); }
  .pagination { display: flex; justify-content: center; gap: 8px; margin-top: 16px; }
  .pagination button { background: var(--card); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  .pagination button:disabled { opacity: 0.4; cursor: default; }
  .empty { text-align: center; color: var(--muted); padding: 40px; }
  #results { min-height: 200px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>claude-memory-hub</h1>
    <div id="health"></div>
  </header>

  <div class="stats" id="stats"></div>

  <div class="search-bar">
    <input id="searchInput" type="text" placeholder="Search memories..." />
    <button onclick="doSearch()">Search</button>
  </div>

  <div class="tabs">
    <button class="active" onclick="switchTab('summaries',this)">Summaries</button>
    <button onclick="switchTab('sessions',this)">Sessions</button>
    <button onclick="switchTab('entities',this)">Entities</button>
  </div>

  <div id="results"></div>

  <div class="pagination">
    <button id="prevBtn" onclick="paginate(-1)" disabled>&larr; Previous</button>
    <span id="pageInfo" style="color:var(--muted);font-size:13px;padding:6px;"></span>
    <button id="nextBtn" onclick="paginate(1)">Next &rarr;</button>
  </div>
</div>

<script>
let currentTab = 'summaries';
let currentOffset = 0;
const PAGE_SIZE = 20;

async function api(path) {
  const res = await fetch(path);
  return res.json();
}

async function init() {
  const [stats, health] = await Promise.all([api('/api/stats'), api('/api/health')]);

  document.getElementById('stats').innerHTML =
    ['sessions','entities','summaries','notes'].map(k =>
      '<div class="stat"><div class="value">'+stats[k]+'</div><div class="label">'+k+'</div></div>'
    ).join('');

  document.getElementById('health').innerHTML = health.checks.map(c => {
    const cls = 'check-' + c.status;
    return '<span class="check '+cls+'">'+c.component+': '+c.status+'</span>';
  }).join('');

  loadTab();
}

function switchTab(tab, btn) {
  currentTab = tab;
  currentOffset = 0;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadTab();
}

async function loadTab() {
  const results = document.getElementById('results');
  results.innerHTML = '<div class="empty">Loading...</div>';

  const data = await api('/api/' + currentTab + '?limit=' + PAGE_SIZE + '&offset=' + currentOffset);

  if (data.length === 0) {
    results.innerHTML = '<div class="empty">No data yet.</div>';
    updatePagination(0);
    return;
  }

  if (currentTab === 'summaries') {
    results.innerHTML = data.map(s =>
      '<div class="card"><div class="meta"><span class="type type-summary">summary</span> ' +
      fmtDate(s.created_at) + ' | ' + esc(s.project) + ' | session: ' + esc(s.session_id).slice(0,8) + '...</div>' +
      '<div class="content">' + esc(s.summary) + '</div></div>'
    ).join('');
  } else if (currentTab === 'sessions') {
    results.innerHTML = data.map(s =>
      '<div class="card"><div class="meta"><span class="type type-session">session</span> ' +
      fmtDate(s.started_at) + ' | ' + esc(s.project) + ' | ' + esc(s.status) + '</div>' +
      '<div class="content">' + esc(s.user_prompt || '(no prompt)') + '</div></div>'
    ).join('');
  } else {
    results.innerHTML = data.map(e =>
      '<div class="card"><div class="meta"><span class="type type-entity">' + esc(e.entity_type) + '</span> ' +
      fmtDate(e.created_at) + ' | ' + esc(e.tool_name) + ' | importance: ' + e.importance + '</div>' +
      '<div class="content">' + esc(e.entity_value) + (e.context ? '\\n' + esc(e.context) : '') + '</div></div>'
    ).join('');
  }
  updatePagination(data.length);
}

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) { loadTab(); return; }

  const results = document.getElementById('results');
  results.innerHTML = '<div class="empty">Searching...</div>';

  const data = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=' + PAGE_SIZE);
  if (data.length === 0) {
    results.innerHTML = '<div class="empty">No results for "' + esc(q) + '"</div>';
    return;
  }
  results.innerHTML = data.map(r =>
    '<div class="card"><div class="meta"><span class="type type-' + r.type + '">' + esc(r.type) + '#' + r.id + '</span> ' +
    fmtDate(r.created_at) + ' | ' + esc(r.project) + ' | score: ' + (r.score||0).toFixed(2) + '</div>' +
    '<div class="content">' + esc(r.title) + '</div></div>'
  ).join('');
}

function paginate(dir) {
  currentOffset = Math.max(0, currentOffset + dir * PAGE_SIZE);
  loadTab();
}

function updatePagination(count) {
  document.getElementById('prevBtn').disabled = currentOffset === 0;
  document.getElementById('nextBtn').disabled = count < PAGE_SIZE;
  const page = Math.floor(currentOffset / PAGE_SIZE) + 1;
  document.getElementById('pageInfo').textContent = 'Page ' + page;
}

function fmtDate(epoch) { return epoch ? new Date(epoch).toLocaleString() : 'N/A'; }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
init();
</script>
</body>
</html>`;
var init_viewer = __esm(() => {
  init_schema();
  init_logger();
  init_monitor();
  init_search_workflow();
  log5 = createLogger("viewer");
});

// src/cli/main.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync, writeFileSync } from "fs";
import { homedir as homedir5 } from "os";
import { join as join5, resolve, dirname } from "path";

// src/migration/claude-mem-migrator.ts
init_schema();
import { Database as Database2 } from "bun:sqlite";
import { existsSync as existsSync3 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
var CLAUDE_MEM_DB_PATHS = [
  join3(homedir3(), ".claude-mem", "claude-mem.db"),
  join3(homedir3(), ".claude-mem", "memory.db")
];
function detectClaudeMemDb() {
  for (const p of CLAUDE_MEM_DB_PATHS) {
    if (existsSync3(p))
      return p;
  }
  return null;
}
function safeJsonArray(raw) {
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function mapObservationType(cmType) {
  switch (cmType) {
    case "bugfix":
    case "feature":
    case "refactor":
    case "change":
      return "file_modified";
    case "discovery":
      return "file_read";
    case "decision":
      return "decision";
    default:
      return "decision";
  }
}
function importanceFromType(cmType) {
  switch (cmType) {
    case "decision":
      return 4;
    case "bugfix":
      return 5;
    case "feature":
      return 4;
    case "refactor":
      return 3;
    case "discovery":
      return 2;
    case "change":
      return 3;
    default:
      return 2;
  }
}
function sessionIdFromCm(cm) {
  return cm.content_session_id || `cm-${cm.id}`;
}
function epochFromCm(epoch, isoStr) {
  if (epoch && epoch > 0)
    return epoch;
  if (isoStr) {
    const ts = new Date(isoStr).getTime();
    if (!isNaN(ts))
      return ts;
  }
  return Date.now();
}
function migrateFromClaudeMem(sourceDbPath) {
  const dbPath = sourceDbPath ?? detectClaudeMemDb();
  if (!dbPath || !existsSync3(dbPath)) {
    throw new Error(`claude-mem database not found at: ${dbPath ?? "~/.claude-mem/claude-mem.db"}`);
  }
  const stats = {
    sessions: { total: 0, migrated: 0, skipped: 0 },
    entities: { total: 0, migrated: 0, skipped: 0 },
    notes: { total: 0, migrated: 0 },
    summaries: { total: 0, migrated: 0, skipped: 0 },
    errors: []
  };
  const src = new Database2(dbPath, { readonly: true });
  const dst = getDatabase();
  try {
    const tables = src.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const hasObs = tables.includes("observations");
    const hasSessions = tables.includes("sdk_sessions");
    const hasSummaries = tables.includes("session_summaries");
    if (!hasSessions && !hasObs && !hasSummaries) {
      throw new Error("Source database does not contain claude-mem tables (sdk_sessions, observations, session_summaries)");
    }
    if (hasSessions) {
      const cmSessions = src.query("SELECT * FROM sdk_sessions").all();
      stats.sessions.total = cmSessions.length;
      const upsertSession = dst.prepare(`INSERT INTO sessions(id, project, started_at, ended_at, user_prompt, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ended_at    = COALESCE(excluded.ended_at, ended_at),
           user_prompt = COALESCE(excluded.user_prompt, user_prompt),
           status      = excluded.status`);
      const migrateSessionsTx = dst.transaction(() => {
        for (const cm of cmSessions) {
          try {
            const sid = sessionIdFromCm(cm);
            const project = cm.project || "unknown";
            const startedAt = epochFromCm(cm.started_at_epoch, cm.started_at);
            const endedAt = cm.completed_at_epoch || (cm.completed_at ? new Date(cm.completed_at).getTime() : null);
            const status = cm.status === "completed" ? "completed" : cm.status === "failed" ? "failed" : "active";
            upsertSession.run(sid, project, startedAt, endedAt || null, cm.user_prompt || null, status);
            stats.sessions.migrated++;
          } catch (e) {
            stats.sessions.skipped++;
            stats.errors.push(`session ${cm.content_session_id}: ${e}`);
          }
        }
      });
      migrateSessionsTx();
    }
    if (hasObs && hasSessions) {
      const sessionMap = new Map;
      const cmSessions = src.query("SELECT * FROM sdk_sessions").all();
      for (const s of cmSessions) {
        if (s.memory_session_id) {
          sessionMap.set(s.memory_session_id, sessionIdFromCm(s));
        }
      }
      const cmObs = src.query("SELECT * FROM observations").all();
      stats.entities.total = cmObs.length;
      const insertEntity = dst.prepare(`INSERT INTO entities(session_id, project, tool_name, entity_type, entity_value, context, importance, created_at, prompt_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertNote = dst.prepare(`INSERT INTO session_notes(session_id, content, created_at) VALUES (?, ?, ?)`);
      const existingEntities = new Set(dst.query("SELECT entity_value, created_at FROM entities").all().map((r) => `${r.entity_value}:${r.created_at}`));
      const existingNotes = new Set(dst.query("SELECT session_id, created_at FROM session_notes").all().map((r) => `${r.session_id}:${r.created_at}`));
      const migrateObsTx = dst.transaction(() => {
        for (const obs of cmObs) {
          try {
            const sessionId = obs.memory_session_id ? sessionMap.get(obs.memory_session_id) : null;
            if (!sessionId) {
              stats.entities.skipped++;
              continue;
            }
            const project = obs.project || "unknown";
            const createdAt = epochFromCm(obs.created_at_epoch, obs.created_at);
            const promptNum = obs.prompt_number ?? 0;
            for (const f of safeJsonArray(obs.files_read)) {
              const key = `${f}:${createdAt}`;
              if (!existingEntities.has(key)) {
                insertEntity.run(sessionId, project, "Read", "file_read", f, obs.title, 2, createdAt, promptNum);
                existingEntities.add(key);
              }
            }
            for (const f of safeJsonArray(obs.files_modified)) {
              const key = `${f}:${createdAt}`;
              if (!existingEntities.has(key)) {
                insertEntity.run(sessionId, project, "Edit", "file_modified", f, obs.title, 3, createdAt, promptNum);
                existingEntities.add(key);
              }
            }
            const decisionText = obs.title || obs.narrative || obs.subtitle;
            if (decisionText) {
              const entityType = mapObservationType(obs.type);
              const importance = importanceFromType(obs.type);
              const key = `${decisionText}:${createdAt}`;
              if (!existingEntities.has(key)) {
                insertEntity.run(sessionId, project, "Agent", entityType, decisionText, obs.narrative || obs.subtitle, importance, createdAt, promptNum);
                existingEntities.add(key);
                stats.entities.migrated++;
              } else {
                stats.entities.skipped++;
              }
            }
            const noteContent = buildNoteFromObservation(obs);
            if (noteContent) {
              const noteKey = `${sessionId}:${createdAt}`;
              if (!existingNotes.has(noteKey)) {
                insertNote.run(sessionId, noteContent, createdAt);
                existingNotes.add(noteKey);
                stats.notes.total++;
                stats.notes.migrated++;
              }
            }
          } catch (e) {
            stats.entities.skipped++;
            stats.errors.push(`observation ${obs.id}: ${e}`);
          }
        }
      });
      migrateObsTx();
    }
    if (hasSummaries && hasSessions) {
      const sessionMap = new Map;
      const cmSessions = src.query("SELECT * FROM sdk_sessions").all();
      for (const s of cmSessions) {
        if (s.memory_session_id) {
          sessionMap.set(s.memory_session_id, sessionIdFromCm(s));
        }
      }
      const cmSummaries = src.query("SELECT * FROM session_summaries").all();
      stats.summaries.total = cmSummaries.length;
      const upsertSummary = dst.prepare(`INSERT INTO long_term_summaries(session_id, project, summary, files_touched, decisions, errors_fixed, token_savings, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           summary       = excluded.summary,
           files_touched = excluded.files_touched,
           decisions     = excluded.decisions,
           errors_fixed  = excluded.errors_fixed`);
      const migrateSummariesTx = dst.transaction(() => {
        for (const s of cmSummaries) {
          try {
            const sessionId = s.memory_session_id ? sessionMap.get(s.memory_session_id) : null;
            if (!sessionId) {
              stats.summaries.skipped++;
              continue;
            }
            const project = s.project || "unknown";
            const createdAt = epochFromCm(s.created_at_epoch, s.created_at);
            const summary = buildSummaryText(s);
            const decisions = [];
            if (s.learned)
              decisions.push(s.learned);
            if (s.completed)
              decisions.push(s.completed);
            const obsFiles = src.query("SELECT files_read, files_modified FROM observations WHERE memory_session_id = ?").all(s.memory_session_id);
            const allFiles = new Set;
            for (const o of obsFiles) {
              for (const f of safeJsonArray(o.files_read))
                allFiles.add(f);
              for (const f of safeJsonArray(o.files_modified))
                allFiles.add(f);
            }
            upsertSummary.run(sessionId, project, summary, JSON.stringify([...allFiles]), JSON.stringify(decisions), "[]", 0, createdAt);
            stats.summaries.migrated++;
          } catch (e) {
            stats.summaries.skipped++;
            stats.errors.push(`summary ${s.id}: ${e}`);
          }
        }
      });
      migrateSummariesTx();
    }
  } finally {
    src.close();
  }
  return stats;
}
function buildNoteFromObservation(obs) {
  const parts = [];
  if (obs.type)
    parts.push(`[${obs.type}]`);
  if (obs.title)
    parts.push(obs.title);
  if (obs.subtitle && obs.subtitle !== obs.title)
    parts.push(`\u2014 ${obs.subtitle}`);
  const facts = safeJsonArray(obs.facts);
  if (facts.length > 0) {
    parts.push(`
Facts: ${facts.join("; ")}`);
  }
  const concepts = safeJsonArray(obs.concepts);
  if (concepts.length > 0) {
    parts.push(`
Concepts: ${concepts.join(", ")}`);
  }
  if (parts.length === 0)
    return null;
  return parts.join(" ").trim();
}
function buildSummaryText(s) {
  const sections = [];
  if (s.request)
    sections.push(`Request: ${s.request}`);
  if (s.investigated)
    sections.push(`Investigated: ${s.investigated}`);
  if (s.learned)
    sections.push(`Learned: ${s.learned}`);
  if (s.completed)
    sections.push(`Completed: ${s.completed}`);
  if (s.next_steps)
    sections.push(`Next steps: ${s.next_steps}`);
  if (s.notes)
    sections.push(`Notes: ${s.notes}`);
  return sections.join(`
`) || "Migrated from claude-mem (no summary content)";
}

// src/cli/main.ts
import { spawnSync } from "child_process";
var CLAUDE_DIR = join5(homedir5(), ".claude");
var SETTINGS_PATH = join5(CLAUDE_DIR, "settings.json");
var PKG_DIR = resolve(dirname(import.meta.dir));
function getHookPath(hookName) {
  return join5(PKG_DIR, "dist", "hooks", `${hookName}.js`);
}
function getMcpServerPath() {
  return join5(PKG_DIR, "dist", "index.js");
}
function loadSettings() {
  if (!existsSync5(SETTINGS_PATH))
    return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function saveSettings(settings) {
  if (!existsSync5(CLAUDE_DIR))
    mkdirSync3(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + `
`);
}
function install() {
  console.log(`claude-memory-hub \u2014 install
`);
  console.log("1. Registering MCP server...");
  const mcpPath = getMcpServerPath();
  const result = spawnSync("claude", ["mcp", "add", "claude-memory-hub", "-s", "user", "--", "bun", "run", mcpPath], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.log("   claude CLI not available \u2014 registering in settings.json directly");
    const settings2 = loadSettings();
    settings2.mcpServers ??= {};
    settings2.mcpServers["claude-memory-hub"] = {
      command: "bun",
      args: ["run", mcpPath]
    };
    saveSettings(settings2);
  }
  console.log("   MCP server registered.");
  console.log(`
2. Registering hooks...`);
  const settings = loadSettings();
  settings.hooks ??= {};
  const hookEntries = [
    ["PostToolUse", getHookPath("post-tool-use")],
    ["UserPromptSubmit", getHookPath("user-prompt-submit")],
    ["PreCompact", getHookPath("pre-compact")],
    ["PostCompact", getHookPath("post-compact")],
    ["Stop", getHookPath("session-end")]
  ];
  let registered = 0;
  for (const [event, scriptPath] of hookEntries) {
    const hooks = settings.hooks;
    hooks[event] ??= [];
    const exists = hooks[event].some((e) => JSON.stringify(e).includes("claude-memory-hub"));
    if (!exists) {
      hooks[event].push({
        matcher: "",
        hooks: [{ type: "command", command: `bun run ${scriptPath}` }]
      });
      registered++;
    }
  }
  saveSettings(settings);
  console.log(`   ${registered} hook(s) registered. (${5 - registered} already existed)`);
  const dataDir = join5(homedir5(), ".claude-memory-hub");
  if (!existsSync5(dataDir)) {
    mkdirSync3(dataDir, { recursive: true, mode: 448 });
    console.log(`
3. Created data directory: ${dataDir}`);
  } else {
    console.log(`
3. Data directory exists: ${dataDir}`);
  }
  console.log(`
========================================`);
  console.log("Installation complete!");
  console.log("");
  console.log("  MCP:   claude-memory-hub");
  console.log("  Hooks: PostToolUse, UserPromptSubmit, PreCompact, PostCompact, Stop");
  console.log("  Data:  ~/.claude-memory-hub/memory.db");
  console.log("  Key:   not needed");
  console.log("");
  console.log("  Restart Claude Code to activate.");
  console.log("========================================");
  const cmDbPath = detectClaudeMemDb();
  if (cmDbPath) {
    console.log(`
[Migration] Detected claude-mem database:`);
    console.log(`  ${cmDbPath}`);
    console.log(`  Migrating data to claude-memory-hub...
`);
    try {
      const stats = migrateFromClaudeMem(cmDbPath);
      printMigrationStats(stats);
    } catch (e) {
      console.error(`  Migration failed: ${e}`);
      console.log("  You can retry later with: npx claude-memory-hub migrate");
    }
  }
}
function uninstall() {
  console.log(`claude-memory-hub \u2014 uninstall
`);
  spawnSync("claude", ["mcp", "remove", "claude-memory-hub", "-s", "user"], {
    stdio: "inherit"
  });
  const settings = loadSettings();
  if (settings.hooks) {
    const hooks = settings.hooks;
    for (const event of Object.keys(hooks)) {
      hooks[event] = hooks[event].filter((e) => !JSON.stringify(e).includes("claude-memory-hub"));
      if (hooks[event].length === 0)
        delete hooks[event];
    }
  }
  if (settings.mcpServers) {
    delete settings.mcpServers["claude-memory-hub"];
  }
  saveSettings(settings);
  console.log("Removed MCP server and hooks from settings.json.");
  console.log("Data at ~/.claude-memory-hub/ preserved. Delete manually if desired.");
}
function status() {
  console.log(`claude-memory-hub \u2014 status
`);
  const settings = loadSettings();
  const hasMcp = !!settings.mcpServers?.["claude-memory-hub"];
  const hookCount = Object.values(settings.hooks ?? {}).flat().filter((e) => JSON.stringify(e).includes("claude-memory-hub")).length;
  const dataDir = join5(homedir5(), ".claude-memory-hub");
  const hasData = existsSync5(join5(dataDir, "memory.db"));
  console.log(`  MCP server:  ${hasMcp ? "registered" : "not registered"}`);
  console.log(`  Hooks:       ${hookCount}/5 registered`);
  console.log(`  Database:    ${hasData ? "exists" : "not created yet"}`);
  if (hasData) {
    const { statSync: statSync2 } = __require("fs");
    const stats = statSync2(join5(dataDir, "memory.db"));
    console.log(`  DB size:     ${(stats.size / 1024).toFixed(1)} KB`);
  }
  if (!hasMcp || hookCount < 5) {
    console.log(`
  Run: npx claude-memory-hub install`);
  } else {
    console.log(`
  Everything looks good.`);
  }
}
function migrate() {
  console.log(`claude-memory-hub \u2014 migrate from claude-mem
`);
  const cmDbPath = detectClaudeMemDb();
  if (!cmDbPath) {
    console.log("  No claude-mem database found at ~/.claude-mem/claude-mem.db");
    console.log("  Nothing to migrate.");
    return;
  }
  console.log(`  Source: ${cmDbPath}`);
  console.log(`  Migrating...
`);
  try {
    const stats = migrateFromClaudeMem(cmDbPath);
    printMigrationStats(stats);
  } catch (e) {
    console.error(`  Migration failed: ${e}`);
    process.exit(1);
  }
}
function printMigrationStats(stats) {
  console.log("  Migration results:");
  console.log(`    Sessions:  ${stats.sessions.migrated}/${stats.sessions.total} migrated, ${stats.sessions.skipped} skipped`);
  console.log(`    Entities:  ${stats.entities.migrated}/${stats.entities.total} migrated, ${stats.entities.skipped} skipped`);
  console.log(`    Notes:     ${stats.notes.migrated} created`);
  console.log(`    Summaries: ${stats.summaries.migrated}/${stats.summaries.total} migrated, ${stats.summaries.skipped} skipped`);
  if (stats.errors.length > 0) {
    console.log(`    Errors:    ${stats.errors.length} (run with DEBUG=1 for details)`);
    if (process.env.DEBUG) {
      for (const err of stats.errors.slice(0, 10)) {
        console.log(`      - ${err}`);
      }
    }
  }
  console.log("");
  console.log("  Migration complete. Your claude-mem data is now available in claude-memory-hub.");
}
var command = process.argv[2];
switch (command) {
  case "install":
    install();
    break;
  case "uninstall":
    uninstall();
    break;
  case "status":
    status();
    break;
  case "migrate":
    migrate();
    break;
  case "viewer":
    Promise.resolve().then(() => (init_viewer(), exports_viewer)).then((m) => m.startViewer());
    break;
  case "health": {
    const { runHealthCheck: runHealthCheck2, formatHealthReport: formatHealthReport3 } = (init_monitor(), __toCommonJS(exports_monitor));
    console.log(formatHealthReport3(runHealthCheck2()));
    break;
  }
  case "reindex": {
    const { reindexAll: reindexAll2 } = (init_vector_search(), __toCommonJS(exports_vector_search));
    console.log("Rebuilding TF-IDF index...");
    reindexAll2();
    console.log("Done.");
    break;
  }
  default:
    console.log(`claude-memory-hub \u2014 persistent memory for Claude Code
`);
    console.log("Commands:");
    console.log("  install     Register MCP server + hooks (auto-migrates claude-mem)");
    console.log("  uninstall   Remove MCP server + hooks");
    console.log("  status      Check installation status");
    console.log("  migrate     Import data from claude-mem");
    console.log("  viewer      Open browser UI at localhost:37888");
    console.log("  health      Run health check");
    console.log("  reindex     Rebuild TF-IDF search index");
    console.log(`
Usage: npx claude-memory-hub <command>`);
    break;
}

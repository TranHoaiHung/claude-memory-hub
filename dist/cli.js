#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
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
var exports_schema = {};
__export(exports_schema, {
  initDatabase: () => initDatabase,
  getDbPath: () => getDbPath,
  getDatabase: () => getDatabase,
  closeDatabase: () => closeDatabase
});
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
  const KNOWN_FTS = new Set(["fts_memories", "fts_messages"]);
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fts_%'").all();
    for (const t of tables) {
      const isKnown = [...KNOWN_FTS].some((k) => t.name === k || t.name.startsWith(`${k}_`));
      if (isKnown)
        continue;
      log.warn("Orphaned FTS table detected, dropping", { table: t.name });
      try {
        db.run(`DROP TABLE IF EXISTS "${t.name}"`);
      } catch {}
    }
  } catch {}
  try {
    healFtsMessages(db);
  } catch (e) {
    log.warn("FTS heal skipped", { error: String(e) });
  }
}
function healFtsMessages(db) {
  const triggerExists = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='fts_messages_insert'").get()?.n ?? 0;
  const tableExists = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='fts_messages'").get()?.n ?? 0;
  const messagesExists = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='messages'").get()?.n ?? 0;
  if (!messagesExists)
    return;
  if (tableExists)
    return;
  if (!triggerExists)
    return;
  log.warn("fts_messages missing but triggers exist \u2014 rebuilding from messages");
  db.run(`
    CREATE VIRTUAL TABLE fts_messages USING fts5(
      session_id UNINDEXED,
      role,
      content,
      tokenize = 'porter unicode61'
    )
  `);
  db.run(`
    INSERT INTO fts_messages(rowid, session_id, role, content)
      SELECT id, session_id, role, content FROM messages
  `);
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
  if (currentVersion < 3) {
    log.info("Applying migration v3: observation entity type + claude_md_registry");
    db.transaction(() => {
      db.run(`
        CREATE TABLE entities_v3 (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          project       TEXT NOT NULL,
          tool_name     TEXT NOT NULL,
          entity_type   TEXT NOT NULL
            CHECK(entity_type IN ('file_read','file_modified','file_created','error','decision','observation')),
          entity_value  TEXT NOT NULL,
          context       TEXT,
          importance    INTEGER NOT NULL DEFAULT 1
            CHECK(importance BETWEEN 1 AND 5),
          created_at    INTEGER NOT NULL,
          prompt_number INTEGER NOT NULL DEFAULT 0,
          discovery_tokens INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.run(`INSERT INTO entities_v3 SELECT * FROM entities`);
      db.run(`DROP TABLE entities`);
      db.run(`ALTER TABLE entities_v3 RENAME TO entities`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_entities_type    ON entities(entity_type)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_entities_value   ON entities(entity_value)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at DESC)`);
      db.run(`
        CREATE TABLE IF NOT EXISTS claude_md_registry (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          path          TEXT NOT NULL UNIQUE,
          project       TEXT NOT NULL,
          content_hash  TEXT NOT NULL,
          sections_json TEXT NOT NULL DEFAULT '[]',
          last_seen     INTEGER NOT NULL,
          token_cost    INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_cmr_project ON claude_md_registry(project)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_cmr_path    ON claude_md_registry(path)`);
    })();
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (3, ?)", [Date.now()]);
    log.info("Migration v3 complete");
  }
  if (currentVersion < 4) {
    log.info("Applying migration v4: embeddings table for semantic search");
    db.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type   TEXT NOT NULL CHECK(doc_type IN ('summary','entity','note')),
        doc_id     INTEGER NOT NULL,
        model      TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
        vector     BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_doc ON embeddings(doc_type, doc_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)`);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (4, ?)", [Date.now()]);
    log.info("Migration v4 complete");
  }
  if (currentVersion < 5) {
    log.info("Applying migration v5: messages table for conversation capture");
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project       TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content       TEXT NOT NULL,
        prompt_number INTEGER NOT NULL DEFAULT 0,
        timestamp     INTEGER NOT NULL,
        uuid          TEXT,
        parent_uuid   TEXT
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, prompt_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_role    ON messages(session_id, role)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid) WHERE uuid IS NOT NULL`);
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
        session_id UNINDEXED,
        role,
        content,
        tokenize = 'porter unicode61'
      )
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS fts_messages_insert
        AFTER INSERT ON messages BEGIN
          INSERT INTO fts_messages(rowid, session_id, role, content)
          VALUES (new.id, new.session_id, new.role, new.content);
        END
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS fts_messages_delete
        AFTER DELETE ON messages BEGIN
          INSERT INTO fts_messages(fts_messages, rowid, session_id, role, content)
          VALUES ('delete', old.id, old.session_id, old.role, old.content);
        END
    `);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (5, ?)", [Date.now()]);
    log.info("Migration v5 complete");
  }
  if (currentVersion < 6) {
    log.info("Applying migration v6: resource_descriptions + relax embeddings doc_type");
    db.run(`
      CREATE TABLE IF NOT EXISTS resource_descriptions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_kind   TEXT NOT NULL CHECK(resource_kind IN ('skill','agent','command','workflow','claude_md')),
        resource_name   TEXT NOT NULL,
        file_path       TEXT NOT NULL,
        embed_text      TEXT NOT NULL,
        content_hash    TEXT NOT NULL,
        embedded_at     INTEGER NOT NULL,
        UNIQUE(resource_kind, resource_name)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_resource_descriptions_kind ON resource_descriptions(resource_kind)`);
    db.run(`
      CREATE TABLE IF NOT EXISTS embeddings_v6 (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type   TEXT NOT NULL CHECK(doc_type IN ('summary','entity','note','resource')),
        doc_id     INTEGER NOT NULL,
        model      TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
        vector     BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.run(`INSERT INTO embeddings_v6 SELECT * FROM embeddings`);
    db.run(`DROP TABLE embeddings`);
    db.run(`ALTER TABLE embeddings_v6 RENAME TO embeddings`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_doc ON embeddings(doc_type, doc_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)`);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (6, ?)", [Date.now()]);
    log.info("Migration v6 complete");
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
function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
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
  formatHealthReport: () => formatHealthReport,
  cleanupOldData: () => cleanupOldData
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
  const dbDir = join4(homedir4(), ".claude-memory-hub");
  const dbPath = join4(dbDir, "memory.db");
  try {
    if (!existsSync4(dbPath)) {
      return { component: "disk", status: "ok", message: "DB not yet created", latency_ms: 0 };
    }
    const dbSize = statSync(dbPath).size;
    let totalSize = dbSize;
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync4(walPath))
      totalSize += statSync(walPath).size;
    if (existsSync4(shmPath))
      totalSize += statSync(shmPath).size;
    const sizeMB = totalSize / (1024 * 1024);
    const status = sizeMB > 500 ? "error" : sizeMB > 200 ? "degraded" : "ok";
    const warning = status !== "ok" ? ` \u2014 consider running cleanup` : "";
    return {
      component: "disk",
      status,
      message: `DB total: ${sizeMB.toFixed(1)}MB (db=${(dbSize / 1024 / 1024).toFixed(1)}MB)${warning}`,
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
function checkEmbeddingsSize(db) {
  const start = performance.now();
  try {
    const row = db.query("SELECT COUNT(*) as c, COALESCE(SUM(LENGTH(vector)), 0) as total_bytes FROM embeddings").get();
    const count = row?.c ?? 0;
    const sizeMB = (row?.total_bytes ?? 0) / (1024 * 1024);
    const status = count > 5000 ? "degraded" : "ok";
    return {
      component: "embeddings",
      status,
      message: `${count} embeddings (~${sizeMB.toFixed(1)}MB)${status === "degraded" ? " \u2014 consider pruning old entries" : ""}`,
      latency_ms: Math.round(performance.now() - start)
    };
  } catch (e) {
    return {
      component: "embeddings",
      status: "error",
      message: `Embeddings check failed: ${e}`,
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
    checkEmbeddingsSize(d),
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
function cleanupOldData(db, retentionDays = 90) {
  const d = db ?? getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = {
    sessions_deleted: 0,
    entities_deleted: 0,
    embeddings_deleted: 0,
    health_checks_deleted: 0,
    resource_usage_deleted: 0
  };
  try {
    d.transaction(() => {
      const oldSessions = d.query("SELECT id FROM sessions WHERE status = 'completed' AND started_at < ?").all(cutoff);
      if (oldSessions.length === 0)
        return;
      const sessionIds = oldSessions.map((s) => s.id);
      const placeholders = sessionIds.map(() => "?").join(",");
      const entRes = d.run(`DELETE FROM entities WHERE session_id IN (${placeholders})`, sessionIds);
      result.entities_deleted = entRes.changes;
      d.run(`DELETE FROM session_notes WHERE session_id IN (${placeholders})`, sessionIds);
      const oldSummaryIds = d.query("SELECT id FROM long_term_summaries WHERE created_at < ?").all(cutoff);
      if (oldSummaryIds.length > 0) {
        const summaryPlaceholders = oldSummaryIds.map(() => "?").join(",");
        const summaryIds = oldSummaryIds.map((s) => s.id);
        const embRes = d.run(`DELETE FROM embeddings WHERE doc_type = 'summary' AND doc_id IN (${summaryPlaceholders})`, summaryIds);
        result.embeddings_deleted = embRes.changes;
        d.run("DELETE FROM long_term_summaries WHERE created_at < ?", [cutoff]);
      }
      const ruRes = d.run(`DELETE FROM resource_usage WHERE session_id IN (${placeholders})`, sessionIds);
      result.resource_usage_deleted = ruRes.changes;
      const sesRes = d.run(`DELETE FROM sessions WHERE id IN (${placeholders})`, sessionIds);
      result.sessions_deleted = sesRes.changes;
      const hcRes = d.run(`DELETE FROM health_checks WHERE id NOT IN (
          SELECT id FROM health_checks ORDER BY checked_at DESC LIMIT 200
        )`);
      result.health_checks_deleted = hcRes.changes;
    })();
    if (result.sessions_deleted > 10) {
      try {
        d.run("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {}
    }
    log2.info("Cleanup complete", { ...result });
  } catch (e) {
    log2.error("Cleanup failed", { error: String(e) });
  }
  return result;
}
var log2;
var init_monitor = __esm(() => {
  init_schema();
  init_logger();
  log2 = createLogger("health");
});

// src/search/embedding-model.ts
var exports_embedding_model = {};
__export(exports_embedding_model, {
  embeddingModel: () => embeddingModel,
  EmbeddingModel: () => EmbeddingModel,
  EMBEDDING_DIM: () => EMBEDDING_DIM
});

class EmbeddingModel {
  pipeline = null;
  loading = null;
  available = true;
  async embed(text) {
    if (!this.available)
      return null;
    await this.ensureLoaded();
    if (!this.pipeline)
      return null;
    try {
      const result = await this.pipeline(text, { pooling: "mean", normalize: true });
      return new Float32Array(result.data);
    } catch (err) {
      log3.error("embed failed", { error: String(err) });
      return null;
    }
  }
  async embedBatch(texts, chunkSize = 8) {
    if (!this.available || texts.length === 0)
      return texts.map(() => null);
    await this.ensureLoaded();
    if (!this.pipeline)
      return texts.map(() => null);
    const results = [];
    for (let i = 0;i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      try {
        const result = await this.pipeline(chunk, { pooling: "mean", normalize: true });
        for (let j = 0;j < chunk.length; j++) {
          const offset = j * 384;
          results.push(new Float32Array(result.data.slice(offset, offset + 384)));
        }
      } catch {
        for (const text of chunk) {
          try {
            const r = await this.pipeline(text, { pooling: "mean", normalize: true });
            results.push(new Float32Array(r.data));
          } catch {
            results.push(null);
          }
        }
      }
    }
    return results;
  }
  get isAvailable() {
    return this.available && this.pipeline !== null;
  }
  get isLoadAttempted() {
    return this.loading !== null;
  }
  async ensureLoaded() {
    if (this.pipeline || !this.available)
      return;
    if (!this.loading)
      this.loading = this.loadModel();
    await this.loading;
  }
  async loadModel() {
    if (process.env["CLAUDE_MEMORY_HUB_EMBEDDINGS"] === "disabled") {
      this.available = false;
      return;
    }
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      const t0 = Date.now();
      this.pipeline = await pipeline("feature-extraction", MODEL_NAME, { dtype: "fp32" });
      log3.info("Embedding model loaded", { model: MODEL_NAME, ms: Date.now() - t0 });
    } catch (err) {
      log3.warn("Embedding model unavailable", { error: String(err) });
      this.available = false;
    }
  }
}
var log3, MODEL_NAME = "Xenova/all-MiniLM-L6-v2", EMBEDDING_DIM = 384, embeddingModel;
var init_embedding_model = __esm(() => {
  init_logger();
  log3 = createLogger("embedding-model");
  embeddingModel = new EmbeddingModel;
});

// src/search/semantic-search.ts
var exports_semantic_search = {};
__export(exports_semantic_search, {
  semanticSearch: () => semanticSearch,
  reindexAllEmbeddings: () => reindexAllEmbeddings,
  indexEmbedding: () => indexEmbedding
});
async function indexEmbedding(docType, docId, text, db) {
  const vector = await embeddingModel.embed(text);
  if (!vector)
    return;
  const d = db ?? getDatabase();
  const blob = Buffer.from(vector.buffer);
  d.run(`INSERT INTO embeddings(doc_type, doc_id, model, vector, created_at)
     VALUES (?, ?, 'all-MiniLM-L6-v2', ?, ?)
     ON CONFLICT(doc_type, doc_id) DO UPDATE SET
       vector = excluded.vector,
       created_at = excluded.created_at`, [docType, docId, blob, Date.now()]);
}
async function semanticSearch(query, limitOrOpts = 10, db) {
  const opts = typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  const limit = opts.limit ?? 10;
  const threshold = opts.threshold ?? 0.2;
  const maxCandidates = opts.maxCandidates ?? 2000;
  const queryVec = await embeddingModel.embed(query);
  if (!queryVec)
    return [];
  const d = db ?? getDatabase();
  let rows;
  if (opts.docType) {
    rows = d.query("SELECT doc_type, doc_id, vector FROM embeddings WHERE doc_type = ? ORDER BY created_at DESC LIMIT ?").all(opts.docType, maxCandidates);
  } else {
    rows = d.query("SELECT doc_type, doc_id, vector FROM embeddings ORDER BY created_at DESC LIMIT ?").all(maxCandidates);
  }
  if (rows.length === 0)
    return [];
  const scored = [];
  for (const row of rows) {
    const docVec = new Float32Array(row.vector.buffer, row.vector.byteOffset, EMBEDDING_DIM);
    const score = cosineSimilarity(queryVec, docVec);
    if (score > threshold) {
      scored.push({ doc_type: row.doc_type, doc_id: row.doc_id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
async function reindexAllEmbeddings(db) {
  if (!embeddingModel.isAvailable && embeddingModel.isLoadAttempted)
    return;
  const d = db ?? getDatabase();
  log4.info("Starting embedding reindex...");
  const summaries = d.query("SELECT id, summary, files_touched, decisions FROM long_term_summaries").all();
  const BATCH_SIZE = 16;
  const summaryTexts = summaries.map((s) => [s.summary, s.files_touched, s.decisions].join(" "));
  const summaryVectors = await embeddingModel.embedBatch(summaryTexts, BATCH_SIZE);
  let indexed = 0;
  for (let i = 0;i < summaries.length; i++) {
    const vector = summaryVectors[i];
    if (!vector)
      continue;
    const blob = Buffer.from(vector.buffer);
    d.run(`INSERT INTO embeddings(doc_type, doc_id, model, vector, created_at)
       VALUES ('summary', ?, 'all-MiniLM-L6-v2', ?, ?)
       ON CONFLICT(doc_type, doc_id) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at`, [summaries[i].id, blob, Date.now()]);
    indexed++;
    if (indexed % 50 === 0)
      log4.info("Embedding reindex progress", { indexed, total: summaries.length });
  }
  const entities = d.query("SELECT id, entity_value, context FROM entities WHERE entity_type IN ('decision', 'error', 'observation')").all();
  const entityTexts = entities.map((e) => [e.entity_value, e.context || ""].join(" "));
  const entityVectors = await embeddingModel.embedBatch(entityTexts, BATCH_SIZE);
  for (let i = 0;i < entities.length; i++) {
    const vector = entityVectors[i];
    if (!vector)
      continue;
    const blob = Buffer.from(vector.buffer);
    d.run(`INSERT INTO embeddings(doc_type, doc_id, model, vector, created_at)
       VALUES ('entity', ?, 'all-MiniLM-L6-v2', ?, ?)
       ON CONFLICT(doc_type, doc_id) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at`, [entities[i].id, blob, Date.now()]);
  }
  log4.info("Embedding reindex complete", { summaries: summaries.length, entities: entities.length });
}
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0;i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
var log4;
var init_semantic_search = __esm(() => {
  init_schema();
  init_embedding_model();
  init_logger();
  log4 = createLogger("semantic-search");
});

// src/search/vector-search.ts
var exports_vector_search = {};
__export(exports_vector_search, {
  vectorSearch: () => vectorSearch,
  tokenize: () => tokenize,
  reindexAll: () => reindexAll,
  rebuildIDF: () => rebuildIDF,
  indexDocument: () => indexDocument
});
function tokenize(text) {
  const tokens = [];
  const camelSplit = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  const words = camelSplit.toLowerCase().replace(/[^a-z0-9_./\-]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word.includes("/") && word.length > 3) {
      const parts = word.split("/").filter((p) => p.length > 1);
      for (const part of parts) {
        const subparts = part.split(".").filter((s) => s.length > 1);
        for (const sp of subparts) {
          if (!STOP_WORDS.has(sp))
            tokens.push(sp);
        }
      }
      continue;
    }
    if (word.includes("_") && word.length > 3) {
      const parts = word.split("_").filter((p) => p.length > 1);
      for (const part of parts) {
        if (!STOP_WORDS.has(part))
          tokens.push(part);
      }
      if (!STOP_WORDS.has(word))
        tokens.push(word);
      continue;
    }
    if (word.length > 1 && !STOP_WORDS.has(word)) {
      tokens.push(word);
    }
  }
  return tokens;
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
    log5.info("IDF rebuilt", { totalDocs });
  } catch (e) {
    log5.error("IDF rebuild failed", { error: String(e) });
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
    log5.error("Vector search failed", { error: String(e) });
    return [];
  }
}
function reindexAll(db) {
  const d = db ?? getDatabase();
  log5.info("Starting full reindex...");
  const summaries = d.query("SELECT id, summary, files_touched, decisions FROM long_term_summaries").all();
  for (const s of summaries) {
    const text = [s.summary, s.files_touched, s.decisions].join(" ");
    indexDocument("summary", s.id, text, d);
  }
  const entities = d.query("SELECT id, entity_value, context FROM entities WHERE entity_type IN ('decision', 'error', 'observation')").all();
  for (const e of entities) {
    const text = [e.entity_value, e.context || ""].join(" ");
    indexDocument("entity", e.id, text, d);
  }
  rebuildIDF(d);
  Promise.resolve().then(() => (init_semantic_search(), exports_semantic_search)).then(({ reindexAllEmbeddings: reindexAllEmbeddings2 }) => reindexAllEmbeddings2(d)).catch(() => {});
  log5.info("Full reindex complete", { summaries: summaries.length, entities: entities.length });
}
var log5, STOP_WORDS;
var init_vector_search = __esm(() => {
  init_schema();
  init_logger();
  log5 = createLogger("vector-search");
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
    "their",
    "const",
    "let",
    "var",
    "function",
    "return",
    "class",
    "new",
    "true",
    "false",
    "null",
    "undefined",
    "void",
    "type",
    "interface",
    "export",
    "import",
    "from",
    "default",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "if",
    "else",
    "for",
    "while",
    "switch",
    "case",
    "break",
    "continue",
    "public",
    "private",
    "protected",
    "static",
    "readonly",
    "extends",
    "implements",
    "super",
    "this",
    "typeof",
    "instanceof",
    "file",
    "line",
    "error",
    "warning",
    "info",
    "debug",
    "log",
    "true",
    "false",
    "yes",
    "no",
    "ok",
    "done",
    "success"
  ]);
});

// src/search/search-workflow.ts
async function searchIndex(query, opts = {}, db) {
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
  try {
    const semResults = await semanticSearch(query, limit, d);
    for (const sr of semResults) {
      const key = `${sr.doc_type}:${sr.doc_id}`;
      if (results.some((r) => `${r.type}:${r.id}` === key))
        continue;
      if (sr.doc_type === "summary") {
        const row = d.prepare("SELECT id, project, SUBSTR(summary, 1, 80) as summary, created_at FROM long_term_summaries WHERE id = ?").get(sr.doc_id);
        if (row) {
          results.push({ id: row.id, type: "summary", title: row.summary, project: row.project, created_at: row.created_at, score: sr.score });
        }
      } else if (sr.doc_type === "entity") {
        const row = d.prepare("SELECT id, project, SUBSTR(entity_value, 1, 80) as entity_value, created_at FROM entities WHERE id = ?").get(sr.doc_id);
        if (row) {
          results.push({ id: row.id, type: "entity", title: row.entity_value, project: row.project, created_at: row.created_at, score: sr.score });
        }
      }
    }
  } catch {}
  const filtered = opts.project ? results.filter((r) => r.project === opts.project) : results;
  const deduped = new Map;
  for (const r of filtered) {
    const key = `${r.type}:${r.id}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { ...r, sourceCount: 1 });
    } else {
      existing.score = Math.max(existing.score, r.score);
      existing.sourceCount++;
    }
  }
  const now = Date.now();
  const merged = [...deduped.values()].map((r) => {
    let score = r.score;
    const ageMs = Math.max(0, now - r.created_at);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7)
      score *= 1.5;
    else if (ageDays < 30)
      score *= 1.2;
    else if (ageDays < 90)
      score *= 1;
    else
      score *= 0.8;
    if (r.sourceCount >= 3)
      score *= 1.4;
    else if (r.sourceCount >= 2)
      score *= 1.2;
    return { ...r, score };
  });
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
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
var log6;
var init_search_workflow = __esm(() => {
  init_schema();
  init_vector_search();
  init_semantic_search();
  init_logger();
  log6 = createLogger("search-workflow");
});

// src/ui/viewer.ts
var exports_viewer = {};
__export(exports_viewer, {
  startViewer: () => startViewer
});
async function handleApi(url) {
  const db = getDatabase();
  const path = url.pathname;
  try {
    if (path === "/api/health") {
      return json(runHealthCheck(db));
    }
    if (path === "/api/stats") {
      const sessions = db.prepare("SELECT COUNT(*) as c FROM sessions").get()?.c ?? 0;
      const entities = db.prepare("SELECT COUNT(*) as c FROM entities").get()?.c ?? 0;
      const summaries = db.prepare("SELECT COUNT(*) as c FROM long_term_summaries").get()?.c ?? 0;
      const notes = db.prepare("SELECT COUNT(*) as c FROM session_notes").get()?.c ?? 0;
      return json({ sessions, entities, summaries, notes });
    }
    if (path === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const project = url.searchParams.get("project");
      return json(await searchIndex(query, { limit, offset, ...project ? { project } : {} }, db));
    }
    if (path === "/api/sessions") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const rows = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json(rows);
    }
    if (path === "/api/summaries") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const rows = db.prepare("SELECT * FROM long_term_summaries ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json(rows);
    }
    if (path === "/api/entities") {
      const sessionId = url.searchParams.get("session_id");
      const limit = parseInt(url.searchParams.get("limit") || "100");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      if (sessionId) {
        const rows2 = db.prepare("SELECT * FROM entities WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(sessionId, limit, offset);
        return json(rows2);
      }
      const rows = db.prepare("SELECT * FROM entities ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json(rows);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    log7.error("API error", { path, error: String(e) });
    return json({ error: String(e) }, 500);
  }
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
      try {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/"))
          return handleApi(url);
        return new Response(HTML, { headers: { "Content-Type": "text/html" } });
      } catch (e) {
        log7.error("Server fetch error", { error: String(e) });
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    },
    error(err) {
      log7.error("Server error", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  console.log(`claude-memory-hub viewer running at http://localhost:${server.port}`);
  log7.info("Viewer started", { port: server.port });
}
var log7, PORT = 37888, HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-memory-hub</title>
<style>
:root {
  --bg: #0a0a0f;
  --surface: #12121a;
  --card: #1a1a26;
  --card-hover: #22222f;
  --border: #2a2a3a;
  --border-light: #3a3a4f;
  --text: #e4e4ef;
  --text-secondary: #9494a8;
  --text-muted: #6a6a80;
  --accent: #7c6bf5;
  --accent-light: #9d8fff;
  --accent-bg: rgba(124,107,245,0.1);
  --green: #4ade80;
  --green-bg: rgba(74,222,128,0.08);
  --yellow: #facc15;
  --yellow-bg: rgba(250,204,21,0.08);
  --red: #f87171;
  --red-bg: rgba(248,113,113,0.08);
  --blue: #60a5fa;
  --blue-bg: rgba(96,165,250,0.08);
  --radius: 12px;
  --radius-sm: 8px;
  --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }

/* Layout */
.app { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }

/* Header */
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.header-left { display: flex; align-items: center; gap: 14px; }
.logo { width: 36px; height: 36px; background: linear-gradient(135deg, var(--accent), #a78bfa); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.header h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
.header h1 span { color: var(--text-muted); font-weight: 400; }
.health-badges { display: flex; gap: 6px; }
.badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.badge-ok { background: var(--green-bg); color: var(--green); }
.badge-degraded { background: var(--yellow-bg); color: var(--yellow); }
.badge-error { background: var(--red-bg); color: var(--red); }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; transition: border-color var(--transition); }
.stat-card:hover { border-color: var(--border-light); }
.stat-value { font-size: 32px; font-weight: 700; background: linear-gradient(135deg, var(--accent-light), var(--blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1.2; }
.stat-label { font-size: 11px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }

/* Search */
.search-wrap { position: relative; margin-bottom: 24px; }
.search-wrap input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 18px 14px 44px; color: var(--text); font-size: 14px; outline: none; transition: all var(--transition); }
.search-wrap input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.search-wrap input::placeholder { color: var(--text-muted); }
.search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 20px; background: var(--surface); border-radius: var(--radius); padding: 4px; border: 1px solid var(--border); }
.tab { flex: 1; background: transparent; border: none; color: var(--text-muted); border-radius: var(--radius-sm); padding: 10px 16px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all var(--transition); }
.tab:hover { color: var(--text-secondary); background: var(--card); }
.tab.active { background: var(--accent); color: #fff; }
.tab .count { font-size: 11px; opacity: 0.7; margin-left: 4px; }

/* Cards */
#results { display: flex; flex-direction: column; gap: 8px; min-height: 200px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; transition: all var(--transition); cursor: default; }
.card:hover { background: var(--card-hover); border-color: var(--border-light); }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.card-type { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; }
.type-summary { background: var(--accent-bg); color: var(--accent-light); }
.type-entity, .type-file_read { background: var(--green-bg); color: var(--green); }
.type-file_modified, .type-file_created { background: var(--blue-bg); color: var(--blue); }
.type-error { background: var(--red-bg); color: var(--red); }
.type-decision { background: var(--yellow-bg); color: var(--yellow); }
.type-session { background: var(--yellow-bg); color: var(--yellow); }
.card-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 12px; flex-wrap: wrap; }
.card-content { font-size: 13.5px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; line-height: 1.65; max-height: 200px; overflow: hidden; position: relative; }
.card-content.expanded { max-height: none; }
.card-expand { background: none; border: none; color: var(--accent); font-size: 12px; cursor: pointer; margin-top: 6px; padding: 0; }

/* Pagination */
.pagination { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 24px; }
.pg-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 8px 18px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all var(--transition); }
.pg-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pg-btn:disabled { opacity: 0.3; cursor: default; }
.pg-info { color: var(--text-muted); font-size: 13px; min-width: 80px; text-align: center; }

/* Empty state */
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-muted); }
.empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }
.empty-text { font-size: 14px; }

/* Responsive */
@media (max-width: 768px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .app { padding: 16px; }
  .header { flex-direction: column; align-items: flex-start; gap: 12px; }
}
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <div class="header-left">
      <div class="logo">M</div>
      <h1>memory-hub <span>viewer</span></h1>
    </div>
    <div class="health-badges" id="health"></div>
  </div>

  <div class="stats" id="stats"></div>

  <div class="search-wrap">
    <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="searchInput" type="text" placeholder="Search memories, files, decisions..." />
  </div>

  <div class="tabs" id="tabsContainer">
    <button class="tab active" data-tab="summaries">Summaries <span class="count" id="cnt-summaries"></span></button>
    <button class="tab" data-tab="sessions">Sessions <span class="count" id="cnt-sessions"></span></button>
    <button class="tab" data-tab="entities">Entities <span class="count" id="cnt-entities"></span></button>
  </div>

  <div id="results"></div>

  <div class="pagination">
    <button class="pg-btn" id="prevBtn" disabled>Previous</button>
    <span class="pg-info" id="pageInfo"></span>
    <button class="pg-btn" id="nextBtn">Next</button>
  </div>
</div>

<script>
(function(){
  var currentTab = "summaries";
  var currentOffset = 0;
  var PAGE_SIZE = 15;

  function api(path) {
    return fetch(path).then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  }

  function fmtDate(epoch) {
    if (!epoch) return "N/A";
    var d = new Date(epoch);
    return d.toLocaleDateString("en-US", {month:"short",day:"numeric"}) + " " + d.toLocaleTimeString("en-US", {hour:"2-digit",minute:"2-digit"});
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

  function updatePagination(count) {
    document.getElementById("prevBtn").disabled = currentOffset === 0;
    document.getElementById("nextBtn").disabled = count < PAGE_SIZE;
    document.getElementById("pageInfo").textContent = "Page " + (Math.floor(currentOffset / PAGE_SIZE) + 1);
  }

  function renderCards(data) {
    if (currentTab === "summaries") {
      return data.map(function(s) {
        var preview = (s.summary || "").slice(0, 400);
        return '<div class="card"><div class="card-header"><span class="card-type type-summary">summary</span><div class="card-meta"><span>' + fmtDate(s.created_at) + '</span><span>' + esc(s.project) + '</span><span>' + esc(s.session_id || "").slice(0,8) + '</span></div></div><div class="card-content">' + esc(preview) + '</div></div>';
      }).join("");
    }
    if (currentTab === "sessions") {
      return data.map(function(s) {
        var cls = s.status === "completed" ? "type-summary" : s.status === "failed" ? "type-error" : "type-session";
        return '<div class="card"><div class="card-header"><span class="card-type ' + cls + '">' + esc(s.status) + '</span><div class="card-meta"><span>' + fmtDate(s.started_at) + '</span><span>' + esc(s.project) + '</span><span>' + esc(s.id || "").slice(0,12) + '</span></div></div><div class="card-content">' + esc(s.user_prompt || "(no prompt)") + '</div></div>';
      }).join("");
    }
    return data.map(function(e) {
      return '<div class="card"><div class="card-header"><span class="card-type type-' + (e.entity_type || "entity") + '">' + esc(e.entity_type) + '</span><div class="card-meta"><span>' + fmtDate(e.created_at) + '</span><span>' + esc(e.tool_name) + '</span><span>imp: ' + e.importance + '</span></div></div><div class="card-content">' + esc(e.entity_value) + (e.context ? "\\n" + esc(e.context) : "") + '</div></div>';
    }).join("");
  }

  function loadTab() {
    var el = document.getElementById("results");
    el.innerHTML = '<div class="empty"><div class="empty-text">Loading...</div></div>';
    api("/api/" + currentTab + "?limit=" + PAGE_SIZE + "&offset=" + currentOffset).then(function(data) {
      if (!data || data.length === 0 || data.error) {
        el.innerHTML = '<div class="empty"><div class="empty-text">' + (data && data.error ? esc(data.error) : "No data yet.") + '</div></div>';
        updatePagination(0);
        return;
      }
      el.innerHTML = renderCards(data);
      updatePagination(data.length);
      el.querySelectorAll(".card-content").forEach(function(c){ c.addEventListener("click", function(){ this.classList.toggle("expanded"); }); });
    });
  }

  function doSearch() {
    var q = document.getElementById("searchInput").value.trim();
    if (!q) { currentOffset = 0; loadTab(); return; }
    var el = document.getElementById("results");
    el.innerHTML = '<div class="empty"><div class="empty-text">Searching...</div></div>';
    api("/api/search?q=" + encodeURIComponent(q) + "&limit=" + PAGE_SIZE).then(function(data) {
      if (!data || data.length === 0) {
        el.innerHTML = '<div class="empty"><div class="empty-text">No results for "' + esc(q) + '"</div></div>';
        return;
      }
      el.innerHTML = data.map(function(r) {
        return '<div class="card"><div class="card-header"><span class="card-type type-' + r.type + '">' + esc(r.type) + "#" + r.id + '</span><div class="card-meta"><span>' + fmtDate(r.created_at) + '</span><span>' + esc(r.project) + '</span><span>score: ' + (r.score || 0).toFixed(2) + '</span></div></div><div class="card-content">' + esc(r.title) + '</div></div>';
      }).join("");
    });
  }

  // Tab click handlers
  document.querySelectorAll("[data-tab]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      currentTab = this.getAttribute("data-tab");
      currentOffset = 0;
      document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
      this.classList.add("active");
      loadTab();
    });
  });

  // Pagination
  document.getElementById("prevBtn").addEventListener("click", function(){ currentOffset = Math.max(0, currentOffset - PAGE_SIZE); loadTab(); });
  document.getElementById("nextBtn").addEventListener("click", function(){ currentOffset += PAGE_SIZE; loadTab(); });

  // Search
  document.getElementById("searchInput").addEventListener("keydown", function(e){ if (e.key === "Enter") doSearch(); });

  // Init
  Promise.all([api("/api/stats"), api("/api/health")]).then(function(res) {
    var stats = res[0], health = res[1];

    document.getElementById("stats").innerHTML = ["sessions","entities","summaries","notes"].map(function(k) {
      return '<div class="stat-card"><div class="stat-value">' + (stats[k] || 0) + '</div><div class="stat-label">' + k + '</div></div>';
    }).join("");

    var cntS = document.getElementById("cnt-summaries"); if(cntS) cntS.textContent = stats.summaries || "";
    var cntSe = document.getElementById("cnt-sessions"); if(cntSe) cntSe.textContent = stats.sessions || "";
    var cntE = document.getElementById("cnt-entities"); if(cntE) cntE.textContent = stats.entities || "";

    if (health && health.checks) {
      document.getElementById("health").innerHTML = health.checks.map(function(c) {
        return '<span class="badge badge-' + c.status + '">' + c.component + '</span>';
      }).join("");
    }

    loadTab();
  });
})();
</script>
</body>
</html>`;
var init_viewer = __esm(() => {
  init_schema();
  init_logger();
  init_monitor();
  init_search_workflow();
  log7 = createLogger("viewer");
});

// src/export/exporter.ts
var exports_exporter = {};
__export(exports_exporter, {
  exportData: () => exportData
});
function exportData(options = {}, db) {
  const d = db ?? getDatabase();
  const since = options.since ?? 0;
  const tables = options.table ? [options.table] : [...EXPORT_TABLES];
  console.log(JSON.stringify({
    __schema_version: SCHEMA_VERSION,
    __exported_at: Date.now(),
    __tables: tables
  }));
  let totalRows = 0;
  for (const table of tables) {
    const timeCol = getTimeColumn(table);
    let sql;
    let params;
    if (since > 0 && timeCol) {
      sql = `SELECT * FROM "${table}" WHERE "${timeCol}" > ? ORDER BY "${timeCol}"`;
      params = [since];
    } else {
      sql = `SELECT * FROM "${table}"`;
      params = [];
    }
    try {
      const stmt = d.prepare(sql);
      const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
      for (const row of rows) {
        const encoded = encodeBlobs(row);
        console.log(JSON.stringify({ __table: table, ...encoded }));
        totalRows++;
      }
    } catch (err) {
      log8.warn(`export skipped table ${table}`, { error: String(err) });
    }
  }
  log8.info("export complete", { tables: tables.length, rows: totalRows });
}
function getTimeColumn(table) {
  const map = {
    sessions: "started_at",
    entities: "created_at",
    session_notes: "created_at",
    long_term_summaries: "created_at",
    embeddings: "created_at"
  };
  return map[table] ?? null;
}
function encodeBlobs(row) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Buffer || value instanceof Uint8Array) {
      result[key] = { $base64: true, encoded: Buffer.from(value).toString("base64") };
    }
  }
  return result;
}
var log8, SCHEMA_VERSION = 5, EXPORT_TABLES;
var init_exporter = __esm(() => {
  init_schema();
  init_logger();
  log8 = createLogger("exporter");
  EXPORT_TABLES = [
    "sessions",
    "entities",
    "session_notes",
    "long_term_summaries",
    "embeddings"
  ];
});

// src/export/importer.ts
var exports_importer = {};
__export(exports_importer, {
  importData: () => importData
});
async function importData(dryRun = false, db) {
  const input = await Bun.stdin.text();
  const lines = input.trim().split(`
`).filter(Boolean);
  const stats = { imported: {}, skipped: 0, errors: 0 };
  if (lines.length === 0) {
    log9.warn("empty input");
    return stats;
  }
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new Error("Invalid JSONL header \u2014 first line must be valid JSON");
  }
  const version = header.__schema_version;
  if (version > MAX_SCHEMA_VERSION) {
    throw new Error(`Schema version ${version} not supported. Max: ${MAX_SCHEMA_VERSION}`);
  }
  const d = dryRun ? null : db ?? getDatabase();
  const importFn = () => {
    for (let i = 1;i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]);
        const table = record.__table;
        if (!table) {
          stats.skipped++;
          continue;
        }
        delete record.__table;
        decodeBlobs(record);
        if (!dryRun && d) {
          upsertRecord(d, table, record);
        }
        stats.imported[table] = (stats.imported[table] ?? 0) + 1;
      } catch (err) {
        stats.errors++;
        log9.warn(`import error at line ${i + 1}`, { error: String(err) });
      }
    }
  };
  if (d) {
    d.transaction(importFn)();
    try {
      reindexAll(d);
    } catch {}
  } else {
    importFn();
  }
  log9.info("import complete", { ...stats });
  return stats;
}
function decodeBlobs(record) {
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object" && !Array.isArray(value) && value.$base64 === true) {
      record[key] = Buffer.from(value.encoded, "base64");
    }
  }
}
function toSql(v) {
  if (v === undefined || v === null)
    return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint" || typeof v === "boolean")
    return v;
  if (v instanceof Buffer || v instanceof Uint8Array)
    return v;
  return String(v);
}
function upsertRecord(db, table, record) {
  const fields = Object.keys(record).filter((k) => k !== "id");
  const values = fields.map((k) => toSql(record[k]));
  switch (table) {
    case "sessions": {
      db.run(`INSERT INTO sessions(id, project, started_at, ended_at, user_prompt, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = COALESCE(excluded.ended_at, ended_at),
           status = excluded.status`, [
        toSql(record.id),
        toSql(record.project),
        toSql(record.started_at),
        toSql(record.ended_at),
        toSql(record.user_prompt),
        toSql(record.status)
      ]);
      break;
    }
    case "long_term_summaries": {
      db.run(`INSERT INTO long_term_summaries(session_id, project, summary, files_touched, decisions, errors_fixed, token_savings, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           summary = excluded.summary,
           files_touched = excluded.files_touched`, [
        toSql(record.session_id),
        toSql(record.project),
        toSql(record.summary),
        toSql(record.files_touched),
        toSql(record.decisions),
        toSql(record.errors_fixed),
        toSql(record.token_savings),
        toSql(record.created_at)
      ]);
      break;
    }
    case "embeddings": {
      db.run(`INSERT INTO embeddings(doc_type, doc_id, model, vector, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(doc_type, doc_id) DO UPDATE SET
           vector = excluded.vector,
           created_at = excluded.created_at`, [toSql(record.doc_type), toSql(record.doc_id), toSql(record.model), toSql(record.vector), toSql(record.created_at)]);
      break;
    }
    default: {
      if (fields.length === 0)
        return;
      const placeholders = fields.map(() => "?").join(", ");
      db.run(`INSERT INTO "${table}"(${fields.join(", ")}) VALUES (${placeholders})`, values);
    }
  }
}
var log9, MAX_SCHEMA_VERSION = 5;
var init_importer = __esm(() => {
  init_schema();
  init_vector_search();
  init_logger();
  log9 = createLogger("importer");
});

// src/cli/doctor-types.ts
import { homedir as homedir5 } from "os";
import { join as join5 } from "path";
var STABLE_DIR, DB_PATH, SETTINGS_PATH, ICON;
var init_doctor_types = __esm(() => {
  STABLE_DIR = join5(homedir5(), ".claude-memory-hub");
  DB_PATH = join5(STABLE_DIR, "memory.db");
  SETTINGS_PATH = join5(homedir5(), ".claude", "settings.json");
  ICON = {
    ok: "[OK]  ",
    warn: "[WARN]",
    fail: "[FAIL]"
  };
});

// src/cli/doctor-checks.ts
import { existsSync as existsSync5, readFileSync, statSync as statSync2 } from "fs";
import { join as join6 } from "path";
import { spawnSync } from "child_process";
function checkDatabase2() {
  if (!existsSync5(DB_PATH)) {
    return {
      name: "database",
      status: "fail",
      detail: `memory.db not found at ${DB_PATH}`,
      fix: "Run: npx claude-memory-hub install"
    };
  }
  try {
    const { runHealthCheck: runHealthCheck2 } = (init_monitor(), __toCommonJS(exports_monitor));
    const report = runHealthCheck2();
    const failed = (report.checks ?? []).filter((c) => c.status !== "ok");
    if (failed.length > 0) {
      return {
        name: "database",
        status: "warn",
        detail: `${failed.length} health check(s) flagged: ${failed.map((c) => c.name).join(", ")}`,
        fix: "Run: claude-memory-hub health (for details)"
      };
    }
    const stats = statSync2(DB_PATH);
    return { name: "database", status: "ok", detail: `${(stats.size / 1024 / 1024).toFixed(1)}MB, integrity OK` };
  } catch (err) {
    return { name: "database", status: "fail", detail: String(err) };
  }
}
function checkEmbeddings() {
  if (process.env["CLAUDE_MEMORY_HUB_EMBEDDINGS"] === "disabled") {
    return { name: "embeddings", status: "warn", detail: "explicitly disabled via CLAUDE_MEMORY_HUB_EMBEDDINGS=disabled" };
  }
  const localTransformers = join6(STABLE_DIR, "node_modules", "@huggingface", "transformers", "package.json");
  const localSharp = join6(STABLE_DIR, "node_modules", "sharp", "package.json");
  if (!existsSync5(localTransformers)) {
    return {
      name: "embeddings",
      status: "warn",
      detail: "@huggingface/transformers not installed (semantic search disabled, FTS5 keyword still works)",
      fix: "Run: claude-memory-hub doctor --fix  (or: cd ~/.claude-memory-hub && npm install)"
    };
  }
  if (!existsSync5(localSharp)) {
    return {
      name: "embeddings",
      status: "warn",
      detail: "sharp not installed (image preprocessing for transformers may fail)",
      fix: "Run: claude-memory-hub doctor --fix"
    };
  }
  const libvipsDir = join6(STABLE_DIR, "node_modules", "@img", "sharp-libvips-darwin-arm64", "lib");
  if (process.platform === "darwin" && process.arch === "arm64" && !existsSync5(libvipsDir)) {
    return {
      name: "embeddings",
      status: "fail",
      detail: "sharp installed but libvips missing \u2014 embeddings will silently fall back",
      fix: "Run: claude-memory-hub doctor --fix"
    };
  }
  return { name: "embeddings", status: "ok", detail: "@huggingface/transformers + sharp present" };
}
function checkHooks() {
  if (!existsSync5(SETTINGS_PATH)) {
    return {
      name: "hooks",
      status: "fail",
      detail: `~/.claude/settings.json not found`,
      fix: "Run: npx claude-memory-hub install"
    };
  }
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    const hooks = settings.hooks ?? {};
    const expected = ["UserPromptSubmit", "PostToolUse", "PreCompact", "PostCompact", "Stop"];
    const found = expected.filter((name) => {
      const entries = hooks[name] ?? [];
      return entries.some((e) => {
        const entry = e;
        return entry.hooks?.some((h) => h.command?.includes(".claude-memory-hub/dist/hooks/"));
      });
    });
    if (found.length === 0) {
      return {
        name: "hooks",
        status: "fail",
        detail: "No memory-hub hooks registered",
        fix: "Run: npx claude-memory-hub install"
      };
    }
    if (found.length < expected.length) {
      return {
        name: "hooks",
        status: "warn",
        detail: `Only ${found.length}/${expected.length} hooks registered: ${found.join(", ")}`,
        fix: "Run: npx claude-memory-hub install (re-registers all hooks)"
      };
    }
    return { name: "hooks", status: "ok", detail: `All 5 lifecycle hooks registered` };
  } catch (err) {
    return { name: "hooks", status: "fail", detail: String(err) };
  }
}
function checkDistFiles() {
  const distDir = join6(STABLE_DIR, "dist");
  const required = [
    "index.js",
    "cli.js",
    "hooks/post-tool-use.js",
    "hooks/user-prompt-submit.js",
    "hooks/session-end.js",
    "hooks/pre-compact.js",
    "hooks/post-compact.js"
  ];
  const missing = required.filter((f) => !existsSync5(join6(distDir, f)));
  if (missing.length > 0) {
    return {
      name: "dist files",
      status: "fail",
      detail: `Missing: ${missing.join(", ")}`,
      fix: "Run: npx claude-memory-hub install"
    };
  }
  return { name: "dist files", status: "ok", detail: `All ${required.length} files present` };
}
function checkBunPath() {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf-8" });
  const path = result.stdout?.trim().split(/\r?\n/)[0]?.trim();
  if (!path || !existsSync5(path)) {
    return {
      name: "bun runtime",
      status: "fail",
      detail: "bun not found in PATH (hooks will fail silently)",
      fix: "Install bun: curl -fsSL https://bun.sh/install | bash"
    };
  }
  return { name: "bun runtime", status: "ok", detail: path };
}
var init_doctor_checks = __esm(() => {
  init_doctor_types();
});

// src/context/resource-tracker.ts
class ResourceTracker {
  db;
  initialized = false;
  constructor(db) {
    this.db = db ?? getDatabase();
  }
  ensureSchema() {
    if (this.initialized)
      return;
    this.db.run(SCHEMA_ADDITIONS);
    this.initialized = true;
  }
  trackUsage(session_id, project, resource_type, resource_name, token_cost = 0) {
    this.ensureSchema();
    const existing = this.db.query("SELECT id, use_count FROM resource_usage WHERE session_id = ? AND resource_name = ?").get(session_id, resource_name);
    if (existing) {
      this.db.run("UPDATE resource_usage SET use_count = use_count + 1 WHERE id = ?", [existing.id]);
    } else {
      this.db.run(`INSERT INTO resource_usage(session_id, project, resource_type, resource_name, use_count, token_cost, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`, [session_id, project, resource_type, resource_name, token_cost, Date.now()]);
    }
  }
  getMostUsedResources(project, resource_type, limit = 10) {
    this.ensureSchema();
    if (resource_type) {
      return this.db.query(`SELECT resource_name, SUM(use_count) as total_uses, AVG(token_cost) as avg_tokens
           FROM resource_usage WHERE project = ? AND resource_type = ?
           GROUP BY resource_name ORDER BY total_uses DESC LIMIT ?`).all(project, resource_type, limit);
    }
    return this.db.query(`SELECT resource_name, SUM(use_count) as total_uses, AVG(token_cost) as avg_tokens
         FROM resource_usage WHERE project = ?
         GROUP BY resource_name ORDER BY total_uses DESC LIMIT ?`).all(project, limit);
  }
  getRecentlyUsedResources(project, lastNSessions = 5) {
    this.ensureSchema();
    return this.db.query(`SELECT resource_type, resource_name, COUNT(DISTINCT session_id) as frequency
         FROM resource_usage
         WHERE project = ?
           AND session_id IN (
             SELECT DISTINCT session_id FROM resource_usage
             WHERE project = ?
             ORDER BY created_at DESC
             LIMIT ?
           )
         GROUP BY resource_type, resource_name
         ORDER BY frequency DESC, resource_type`).all(project, project, lastNSessions);
  }
  estimateTokenBudget(project) {
    this.ensureSchema();
    const rows = this.db.query(`SELECT resource_type, SUM(token_cost) as total_tokens, COUNT(DISTINCT resource_name) as count
         FROM resource_usage
         WHERE project = ?
         GROUP BY resource_type`).all(project);
    const by_type = {};
    let total = 0;
    let count = 0;
    for (const row of rows) {
      by_type[row.resource_type] = row.total_tokens;
      total += row.total_tokens;
      count += row.count;
    }
    return { total_token_cost: total, resource_count: count, by_type };
  }
}
var SCHEMA_ADDITIONS = `
CREATE TABLE IF NOT EXISTS resource_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  project     TEXT NOT NULL,
  resource_type TEXT NOT NULL
    CHECK(resource_type IN ('skill','agent','command','workflow','claude_md','memory','mcp_tool','hook')),
  resource_name TEXT NOT NULL,
  use_count   INTEGER NOT NULL DEFAULT 1,
  token_cost  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_session  ON resource_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_resource_project  ON resource_usage(project);
CREATE INDEX IF NOT EXISTS idx_resource_name     ON resource_usage(resource_name);
CREATE INDEX IF NOT EXISTS idx_resource_type     ON resource_usage(resource_type);
`;
var init_resource_tracker = __esm(() => {
  init_schema();
});

// src/context/resource-registry.ts
import { existsSync as existsSync6, readdirSync, statSync as statSync3, readFileSync as readFileSync2 } from "fs";
import { join as join7, basename, relative } from "path";
import { homedir as homedir6 } from "os";

class ResourceRegistry {
  resources = new Map;
  lastScanAt = 0;
  claudeDir;
  constructor() {
    this.claudeDir = join7(homedir6(), ".claude");
  }
  scan(cwd) {
    if (Date.now() - this.lastScanAt < SCAN_TTL_MS && this.resources.size > 0)
      return;
    this.resources.clear();
    try {
      this.scanSkills(join7(this.claudeDir, "skills"), cwd);
      this.scanFlatAgents(join7(this.claudeDir, "agents"));
      this.scanAgentPackages(this.claudeDir);
      this.scanCommands(join7(this.claudeDir, "commands"), cwd);
      this.scanWorkflows(join7(this.claudeDir, "workflows"));
      this.scanClaudeMd(cwd);
      this.lastScanAt = Date.now();
    } catch (err) {
      log10.error("scan failed", { error: String(err) });
    }
  }
  resolve(kind, name) {
    this.ensureScanned();
    return this.resources.get(`${kind}:${name}`);
  }
  exists(kind, name) {
    return this.resolve(kind, name) !== undefined;
  }
  getAll(kind) {
    this.ensureScanned();
    const all = [...this.resources.values()];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  async getOverheadReport(project, lastNSessions = 10) {
    this.ensureScanned();
    const tracker = new ResourceTracker;
    const recentSkills = tracker.getRecentlyUsedResources(project, lastNSessions).filter((r) => r.resource_type === "skill");
    const recentAgents = tracker.getRecentlyUsedResources(project, lastNSessions).filter((r) => r.resource_type === "agent");
    const allSkills = this.getAll("skill");
    const allAgents = this.getAll("agent");
    const usedSkillNames = new Set(recentSkills.map((r) => r.resource_name));
    const usedAgentNames = new Set(recentAgents.map((r) => r.resource_name));
    const unusedSkills = allSkills.filter((s) => !usedSkillNames.has(s.name));
    const unusedAgents = allAgents.filter((a) => !usedAgentNames.has(a.name));
    const skillListingTokens = allSkills.reduce((sum, s) => sum + s.listing_tokens, 0);
    const agentDescTokens = allAgents.reduce((sum, a) => sum + a.listing_tokens, 0);
    const commandListingTokens = this.getAll("command").reduce((sum, c) => sum + c.listing_tokens, 0);
    const claudeMdTokens = this.getAll("claude_md").reduce((sum, c) => sum + c.full_tokens, 0);
    const unusedSkillListingTokens = unusedSkills.reduce((sum, s) => sum + s.listing_tokens, 0);
    const unusedAgentListingTokens = unusedAgents.reduce((sum, a) => sum + a.listing_tokens, 0);
    const recommendations = [];
    if (unusedSkills.length > 0) {
      recommendations.push(`${unusedSkills.length}/${allSkills.length} skills unused in last ${lastNSessions} sessions (~${unusedSkillListingTokens} listing tokens). Consider project-local or removal.`);
    }
    if (unusedAgents.length > 0) {
      recommendations.push(`${unusedAgents.length}/${allAgents.length} agents unused in last ${lastNSessions} sessions (~${unusedAgentListingTokens} listing tokens).`);
    }
    if (claudeMdTokens > 5000) {
      recommendations.push(`CLAUDE.md chain is ${claudeMdTokens} tokens. Consider consolidating if >5K.`);
    }
    return {
      fixed_overhead: {
        total_tokens: skillListingTokens + agentDescTokens + commandListingTokens + claudeMdTokens,
        skill_listings: skillListingTokens,
        agent_descriptions: agentDescTokens,
        command_listings: commandListingTokens,
        claude_md: claudeMdTokens
      },
      usage_analysis: {
        skills_installed: allSkills.length,
        skills_used_recently: usedSkillNames.size,
        skills_never_used: unusedSkills.map((s) => s.name),
        agents_installed: allAgents.length,
        agents_used_recently: usedAgentNames.size,
        agents_never_used: unusedAgents.map((a) => a.name)
      },
      recommendations,
      potential_savings: {
        if_remove_unused_skills: unusedSkillListingTokens,
        if_remove_unused_agents: unusedAgentListingTokens
      }
    };
  }
  scanSkills(globalDir, cwd) {
    this.scanSkillDir(globalDir, "global");
    if (cwd) {
      const projectDir = join7(cwd, ".claude", "skills");
      if (existsSync6(projectDir)) {
        this.scanSkillDir(projectDir, "project");
      }
    }
  }
  scanSkillDir(dir, source) {
    if (!existsSync6(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory())
          continue;
        const name = entry.name;
        if (!SAFE_NAME_RE.test(name))
          continue;
        const skillDir = join7(dir, name);
        const skillFile = this.findPrimaryFile(skillDir, ["SKILL.md", "README.md"]);
        const listing = this.estimateListingFromSkillDir(skillDir);
        const fullTokens = skillFile ? this.charsToTokens(this.readFileSize(skillFile)) : 0;
        const totalTokens = this.estimateDirTokens(skillDir);
        this.register({
          kind: "skill",
          name,
          path: skillFile ?? skillDir,
          allPaths: this.listMdFiles(skillDir),
          category: "variable",
          listing_tokens: listing,
          full_tokens: fullTokens,
          total_tokens: totalTokens,
          source
        });
      }
    } catch (err) {
      log10.error(`scanSkillDir ${dir}`, { error: String(err) });
    }
  }
  scanFlatAgents(dir) {
    if (!existsSync6(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        if (entry.name === "README.md")
          continue;
        const filePath = join7(dir, entry.name);
        const content = this.readFileHead(filePath, 20);
        const name = this.parseFrontmatterName(content) ?? basename(entry.name, ".md");
        if (!SAFE_NAME_RE.test(name))
          continue;
        const fileSize = this.readFileSize(filePath);
        const listing = this.estimateAgentListingTokens(content);
        this.register({
          kind: "agent",
          name,
          path: filePath,
          allPaths: [filePath],
          category: "variable",
          listing_tokens: listing,
          full_tokens: this.charsToTokens(fileSize),
          total_tokens: this.charsToTokens(fileSize),
          source: "global"
        });
      }
    } catch (err) {
      log10.error(`scanFlatAgents ${dir}`, { error: String(err) });
    }
  }
  scanAgentPackages(claudeDir) {
    if (!existsSync6(claudeDir))
      return;
    try {
      for (const entry of readdirSync(claudeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("agent_"))
          continue;
        const packageDir = join7(claudeDir, entry.name);
        this.scanAgentPackageDir(packageDir);
      }
    } catch (err) {
      log10.error("scanAgentPackages", { error: String(err) });
    }
  }
  scanAgentPackageDir(packageDir) {
    try {
      for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const subDir = join7(packageDir, entry.name);
          const agentFile = join7(subDir, "AGENT.md");
          if (existsSync6(agentFile)) {
            const content = this.readFileHead(agentFile, 20);
            const name = this.parseFrontmatterName(content) ?? entry.name;
            if (!SAFE_NAME_RE.test(name))
              continue;
            const listing = this.estimateAgentListingTokens(content);
            const fullTokens = this.charsToTokens(this.readFileSize(agentFile));
            const totalTokens = this.estimateDirTokens(subDir);
            this.register({
              kind: "agent",
              name,
              path: agentFile,
              allPaths: this.listMdFiles(subDir),
              category: "variable",
              listing_tokens: listing,
              full_tokens: fullTokens,
              total_tokens: totalTokens,
              source: "global"
            });
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          if (entry.name === "README.md" || entry.name === "SKILL.md")
            continue;
          const filePath = join7(packageDir, entry.name);
          const content = this.readFileHead(filePath, 20);
          const name = this.parseFrontmatterName(content) ?? basename(entry.name, ".md");
          if (!SAFE_NAME_RE.test(name))
            continue;
          if (this.resources.has(`agent:${name}`))
            continue;
          const fileSize = this.readFileSize(filePath);
          this.register({
            kind: "agent",
            name,
            path: filePath,
            allPaths: [filePath],
            category: "variable",
            listing_tokens: this.estimateAgentListingTokens(content),
            full_tokens: this.charsToTokens(fileSize),
            total_tokens: this.charsToTokens(fileSize),
            source: "global"
          });
        }
      }
    } catch (err) {
      log10.error(`scanAgentPackageDir ${packageDir}`, { error: String(err) });
    }
  }
  scanCommands(globalDir, cwd) {
    if (existsSync6(globalDir))
      this.scanCommandDir(globalDir, globalDir, "global");
    if (cwd) {
      const projectDir = join7(cwd, ".claude", "commands");
      if (existsSync6(projectDir))
        this.scanCommandDir(projectDir, projectDir, "project");
    }
  }
  scanCommandDir(dir, baseDir, source) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.scanCommandDir(join7(dir, entry.name), baseDir, source);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const filePath = join7(dir, entry.name);
          const name = relative(baseDir, filePath).replace(/\.md$/, "");
          if (!SAFE_COMMAND_NAME_RE.test(name))
            continue;
          const fileSize = this.readFileSize(filePath);
          const content = this.readFileHead(filePath, 3);
          this.register({
            kind: "command",
            name,
            path: filePath,
            allPaths: [filePath],
            category: "variable",
            listing_tokens: this.estimateCommandListingTokens(name, content),
            full_tokens: this.charsToTokens(fileSize),
            total_tokens: this.charsToTokens(fileSize),
            source
          });
        }
      }
    } catch (err) {
      log10.error(`scanCommandDir ${dir}`, { error: String(err) });
    }
  }
  scanWorkflows(dir) {
    if (!existsSync6(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        const filePath = join7(dir, entry.name);
        const name = basename(entry.name, ".md");
        if (!SAFE_NAME_RE.test(name))
          continue;
        const fileSize = this.readFileSize(filePath);
        this.register({
          kind: "workflow",
          name,
          path: filePath,
          allPaths: [filePath],
          category: "variable",
          listing_tokens: 0,
          full_tokens: this.charsToTokens(fileSize),
          total_tokens: this.charsToTokens(fileSize),
          source: "global"
        });
      }
    } catch (err) {
      log10.error(`scanWorkflows ${dir}`, { error: String(err) });
    }
  }
  scanClaudeMd(cwd) {
    const globalFile = join7(this.claudeDir, "CLAUDE.md");
    if (existsSync6(globalFile)) {
      const fileSize = this.readFileSize(globalFile);
      this.register({
        kind: "claude_md",
        name: "global",
        path: globalFile,
        allPaths: [globalFile],
        category: "fixed",
        listing_tokens: 0,
        full_tokens: this.charsToTokens(fileSize),
        total_tokens: this.charsToTokens(fileSize),
        source: "global"
      });
    }
    if (!cwd)
      return;
    const projectFiles = [
      join7(cwd, "CLAUDE.md"),
      join7(cwd, ".claude", "CLAUDE.md")
    ];
    for (const file of projectFiles) {
      if (!existsSync6(file))
        continue;
      const relPath = relative(cwd, file).replace(/[^a-zA-Z0-9_\-:.\/]/g, "_");
      if (!SAFE_COMMAND_NAME_RE.test(relPath))
        continue;
      const name = `project:${relPath}`;
      const fileSize = this.readFileSize(file);
      this.register({
        kind: "claude_md",
        name,
        path: file,
        allPaths: [file],
        category: "fixed",
        listing_tokens: 0,
        full_tokens: this.charsToTokens(fileSize),
        total_tokens: this.charsToTokens(fileSize),
        source: "project"
      });
    }
  }
  ensureScanned() {
    if (this.resources.size === 0 || Date.now() - this.lastScanAt >= SCAN_TTL_MS) {
      this.scan();
    }
  }
  register(resource) {
    const key = `${resource.kind}:${resource.name}`;
    const existing = this.resources.get(key);
    if (existing && existing.source === "global" && resource.source === "project") {
      this.resources.set(key, resource);
    } else if (!existing) {
      this.resources.set(key, resource);
    }
  }
  parseFrontmatterName(content) {
    const lines = content.split(`
`);
    let inFrontmatter = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "---") {
        if (inFrontmatter)
          return;
        inFrontmatter = true;
        continue;
      }
      if (!inFrontmatter)
        continue;
      const m = trimmed.match(/^name:\s*["']?([a-zA-Z0-9_\-]+)["']?/);
      if (m?.[1])
        return m[1];
    }
    return;
  }
  findPrimaryFile(dir, candidates) {
    for (const c of candidates) {
      const p = join7(dir, c);
      if (existsSync6(p))
        return p;
    }
    return;
  }
  readFileHead(filePath, lines) {
    try {
      const content = readFileSync2(filePath, "utf-8");
      return content.split(`
`).slice(0, lines).join(`
`);
    } catch {
      return "";
    }
  }
  readFileSize(filePath) {
    try {
      return statSync3(filePath).size;
    } catch {
      return 0;
    }
  }
  charsToTokens(chars) {
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }
  estimateListingFromSkillDir(dir) {
    const skillFile = this.findPrimaryFile(dir, ["SKILL.md", "README.md"]);
    if (!skillFile)
      return 30;
    const head = this.readFileHead(skillFile, 5);
    const descLine = head.split(`
`).find((l) => l.startsWith("description:") || l.trim() && !l.startsWith("#") && !l.startsWith("---"));
    const descLen = descLine?.slice(0, 80).length ?? 20;
    return Math.ceil((descLen + 30) / CHARS_PER_TOKEN);
  }
  estimateAgentListingTokens(headContent) {
    const lines = headContent.split(`
`);
    for (const line of lines) {
      if (line.startsWith("description:")) {
        const desc = line.slice(12).trim().slice(0, 150);
        return Math.ceil((desc.length + 30) / CHARS_PER_TOKEN);
      }
    }
    return 30;
  }
  estimateCommandListingTokens(name, headContent) {
    const firstLine = headContent.split(`
`).find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
    const descLen = firstLine?.slice(0, 60).length ?? 10;
    return Math.ceil((name.length + descLen + 10) / CHARS_PER_TOKEN);
  }
  listMdFiles(dir) {
    const files = [];
    try {
      const walk = (d, depth) => {
        if (depth > MAX_DIR_WALK_DEPTH)
          return;
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const p = join7(d, entry.name);
          if (entry.isDirectory())
            walk(p, depth + 1);
          else if (entry.isFile() && entry.name.endsWith(".md"))
            files.push(p);
        }
      };
      walk(dir, 0);
    } catch {}
    return files;
  }
  estimateDirTokens(dir) {
    return this.listMdFiles(dir).reduce((sum, f) => sum + this.charsToTokens(this.readFileSize(f)), 0);
  }
}
function getResourceRegistry() {
  if (!_instance)
    _instance = new ResourceRegistry;
  return _instance;
}
var log10, CHARS_PER_TOKEN = 3.75, SCAN_TTL_MS, SAFE_NAME_RE, SAFE_COMMAND_NAME_RE, MAX_DIR_WALK_DEPTH = 5, _instance;
var init_resource_registry = __esm(() => {
  init_logger();
  init_resource_tracker();
  log10 = createLogger("resource-registry");
  SCAN_TTL_MS = 5 * 60 * 1000;
  SAFE_NAME_RE = /^[a-zA-Z0-9_\-:.]+$/;
  SAFE_COMMAND_NAME_RE = /^[a-zA-Z0-9_\-:.\/]+$/;
});

// src/context/resource-description.ts
import { readFileSync as readFileSync3, existsSync as existsSync7, statSync as statSync4 } from "fs";
import { join as join8 } from "path";
function extractDescription(filePath, name) {
  if (!existsSync7(filePath))
    return null;
  let content;
  try {
    content = readFileSync3(filePath, "utf-8").slice(0, MAX_BODY_PEEK);
  } catch {
    return null;
  }
  const fmDesc = parseFrontmatterDescription(content);
  const bodySummary = parseBodyOpening(content);
  const parts = [name];
  if (fmDesc)
    parts.push(fmDesc);
  if (bodySummary && bodySummary !== fmDesc)
    parts.push(bodySummary);
  const embedText = parts.join(". ").slice(0, MAX_DESC_CHARS);
  if (embedText.length < name.length + 5)
    return null;
  return {
    name,
    frontmatter_description: fmDesc,
    body_summary: bodySummary,
    embed_text: embedText,
    content_hash: hashContent(content)
  };
}
function parseFrontmatterDescription(content) {
  const lines = content.split(`
`);
  let inFrontmatter = false;
  let collecting = false;
  const parts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (inFrontmatter)
        break;
      inFrontmatter = true;
      continue;
    }
    if (!inFrontmatter)
      continue;
    if (collecting && /^[a-zA-Z_][a-zA-Z0-9_\-]*:\s*/.test(trimmed) && !trimmed.startsWith("description:")) {
      break;
    }
    if (trimmed.startsWith("description:")) {
      const inline = trimmed.slice("description:".length).trim();
      if (inline)
        parts.push(inline.replace(/^["']|["']$/g, ""));
      collecting = true;
      continue;
    }
    if (collecting && trimmed) {
      parts.push(trimmed);
    }
  }
  return parts.join(" ").slice(0, MAX_DESC_CHARS);
}
function parseBodyOpening(content) {
  let body = content;
  const fmMatch = content.match(/^---[\s\S]*?\n---\n/);
  if (fmMatch)
    body = content.slice(fmMatch[0].length);
  const paragraph = [];
  for (const rawLine of body.split(`
`)) {
    const line = rawLine.trim();
    if (!line) {
      if (paragraph.length > 0)
        break;
      continue;
    }
    if (line.startsWith("#")) {
      if (paragraph.length > 0)
        break;
      continue;
    }
    if (line.startsWith("```"))
      break;
    paragraph.push(line);
    if (paragraph.join(" ").length >= MAX_DESC_CHARS)
      break;
  }
  return paragraph.join(" ").slice(0, MAX_DESC_CHARS);
}
function hashContent(s) {
  let h = 5381;
  for (let i = 0;i < s.length; i++)
    h = h * 33 ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function extractFromDir(dir, name) {
  const candidates = ["SKILL.md", "AGENT.md", "README.md", `${name}.md`];
  for (const c of candidates) {
    const p = join8(dir, c);
    if (existsSync7(p))
      return extractDescription(p, name);
  }
  return null;
}
var MAX_DESC_CHARS = 2000, MAX_BODY_PEEK = 4000;
var init_resource_description = () => {};

// src/context/resource-embedding-search.ts
async function searchResourcesByPrompt(prompt, options = {}) {
  const { limit = 5, threshold = 0.3, kinds, db } = options;
  if (!prompt.trim())
    return [];
  await embeddingModel.embed("warmup");
  if (!embeddingModel.isAvailable)
    return [];
  const queryVec = await embeddingModel.embed(prompt);
  if (!queryVec)
    return [];
  const d = db ?? getDatabase();
  const rows = d.query(`SELECT rd.id, rd.resource_kind as kind, rd.resource_name as name, rd.file_path, e.vector
     FROM resource_descriptions rd
     JOIN embeddings e ON e.doc_type = 'resource' AND e.doc_id = rd.id`).all();
  const scored = [];
  for (const row of rows) {
    if (kinds && !kinds.includes(row.kind))
      continue;
    const docVec = new Float32Array(row.vector.buffer, row.vector.byteOffset, EMBEDDING_DIM);
    const score = cosineSimilarity2(queryVec, docVec);
    if (score >= threshold) {
      scored.push({
        kind: row.kind,
        name: row.name,
        file_path: row.file_path,
        score,
        reason: `${(score * 100).toFixed(0)}% semantic match`
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
function cosineSimilarity2(a, b) {
  let dot = 0;
  for (let i = 0;i < a.length; i++)
    dot += a[i] * b[i];
  return dot;
}
var init_resource_embedding_search = __esm(() => {
  init_schema();
  init_embedding_model();
});

// src/context/resource-embeddings.ts
var exports_resource_embeddings = {};
__export(exports_resource_embeddings, {
  searchResourcesByPrompt: () => searchResourcesByPrompt,
  backfillResourceEmbeddings: () => backfillResourceEmbeddings
});
import { statSync as statSync5 } from "fs";
async function backfillResourceEmbeddings(db) {
  const t0 = Date.now();
  const d = db ?? getDatabase();
  const stats = { scanned: 0, embedded: 0, unchanged: 0, failed: 0, ms: 0 };
  await embeddingModel.embed("warmup");
  if (!embeddingModel.isAvailable) {
    log11.warn("Embedding model unavailable \u2014 skipping resource backfill");
    stats.ms = Date.now() - t0;
    return stats;
  }
  const registry = getResourceRegistry();
  registry.scan();
  const resources = registry.getAll();
  const toEmbed = [];
  for (const r of resources) {
    if (!["skill", "agent", "command", "workflow", "claude_md"].includes(r.kind))
      continue;
    stats.scanned++;
    const desc = extractResource(r.path, r.name, r.kind);
    if (!desc) {
      stats.failed++;
      continue;
    }
    const existing = d.query(`SELECT id, resource_kind, resource_name, file_path, content_hash
       FROM resource_descriptions WHERE resource_kind = ? AND resource_name = ?`).get(r.kind, r.name);
    if (existing && existing.content_hash === desc.content_hash) {
      stats.unchanged++;
      continue;
    }
    toEmbed.push({ desc, kind: r.kind, filePath: r.path });
  }
  if (toEmbed.length === 0) {
    log11.info("Resource backfill: nothing to do", { ...stats });
    stats.ms = Date.now() - t0;
    return stats;
  }
  const texts = toEmbed.map((t) => t.desc.embed_text);
  const vectors = await embeddingModel.embedBatch(texts, 8);
  for (let i = 0;i < toEmbed.length; i++) {
    const { desc, kind, filePath } = toEmbed[i];
    const vector = vectors[i];
    if (!vector) {
      stats.failed++;
      continue;
    }
    d.run(`INSERT INTO resource_descriptions(resource_kind, resource_name, file_path, embed_text, content_hash, embedded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_kind, resource_name)
       DO UPDATE SET file_path = excluded.file_path,
                     embed_text = excluded.embed_text,
                     content_hash = excluded.content_hash,
                     embedded_at = excluded.embedded_at`, [kind, desc.name, filePath, desc.embed_text, desc.content_hash, Date.now()]);
    const row = d.query(`SELECT id FROM resource_descriptions WHERE resource_kind = ? AND resource_name = ?`).get(kind, desc.name);
    if (!row) {
      stats.failed++;
      continue;
    }
    const blob = Buffer.from(vector.buffer);
    d.run(`INSERT INTO embeddings(doc_type, doc_id, model, vector, created_at)
       VALUES ('resource', ?, 'all-MiniLM-L6-v2', ?, ?)
       ON CONFLICT(doc_type, doc_id) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at`, [row.id, blob, Date.now()]);
    stats.embedded++;
  }
  stats.ms = Date.now() - t0;
  log11.info("Resource backfill complete", { ...stats });
  return stats;
}
function extractResource(path, name, kind) {
  try {
    const stat = statSync5(path);
    if (stat.isDirectory())
      return extractFromDir(path, name);
    return extractDescription(path, name);
  } catch {
    return null;
  }
}
var log11;
var init_resource_embeddings = __esm(() => {
  init_schema();
  init_embedding_model();
  init_resource_registry();
  init_resource_description();
  init_logger();
  init_resource_embedding_search();
  log11 = createLogger("resource-embeddings");
});

// src/cli/doctor-actions.ts
import { existsSync as existsSync8, writeFileSync } from "fs";
import { join as join9 } from "path";
import { spawnSync as spawnSync2 } from "child_process";
function attemptFix() {
  console.log(`
--- Attempting auto-fix ---`);
  const pkgPath = join9(STABLE_DIR, "package.json");
  if (!existsSync8(pkgPath)) {
    console.log("Creating package.json for runtime deps...");
    const pkg = {
      name: "claude-memory-hub-runtime",
      version: "1.0.0",
      private: true,
      dependencies: {
        sharp: "^0.34.5",
        "@huggingface/transformers": "^3.0.0"
      }
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  }
  console.log("Installing sharp + @huggingface/transformers (this may take a minute)...");
  const bunResult = spawnSync2("bun", ["install", "--no-save"], {
    cwd: STABLE_DIR,
    stdio: "inherit"
  });
  if (bunResult.status !== 0) {
    console.log("bun install failed, trying npm...");
    const npmResult = spawnSync2("npm", ["install"], {
      cwd: STABLE_DIR,
      stdio: "inherit"
    });
    if (npmResult.status !== 0) {
      console.log("Auto-fix failed. Please run manually:");
      console.log(`  cd ${STABLE_DIR} && npm install`);
      return false;
    }
  }
  console.log(`
[OK] Runtime deps installed.`);
  return true;
}
async function runBackfill() {
  console.log(`
--- Backfilling embeddings ---`);
  try {
    const { reindexAllEmbeddings: reindexAllEmbeddings2 } = (init_semantic_search(), __toCommonJS(exports_semantic_search));
    const { backfillResourceEmbeddings: backfillResourceEmbeddings2 } = (init_resource_embeddings(), __toCommonJS(exports_resource_embeddings));
    const { embeddingModel: embeddingModel2 } = (init_embedding_model(), __toCommonJS(exports_embedding_model));
    await embeddingModel2.embed("warmup");
    if (!embeddingModel2.isAvailable) {
      console.log("[FAIL] Embedding model unavailable. Run --fix first to install deps.");
      return;
    }
    const t0 = Date.now();
    console.log("  > Summaries + entities ...");
    await reindexAllEmbeddings2();
    console.log("  > Skills + agents + commands (resource descriptions) ...");
    const resourceStats = await backfillResourceEmbeddings2();
    console.log(`    scanned: ${resourceStats.scanned}, embedded: ${resourceStats.embedded}, ` + `unchanged: ${resourceStats.unchanged}, failed: ${resourceStats.failed}`);
    const ms = Date.now() - t0;
    const { getDatabase: getDatabase2 } = (init_schema(), __toCommonJS(exports_schema));
    const db = getDatabase2();
    const count = db.query("SELECT COUNT(*) as n FROM embeddings").get().n;
    console.log(`[OK] Backfill complete in ${ms}ms \u2014 ${count} embeddings stored total.`);
  } catch (err) {
    console.log(`[FAIL] Backfill error: ${String(err).slice(0, 300)}`);
  }
}
var init_doctor_actions = __esm(() => {
  init_doctor_types();
});

// src/cli/doctor.ts
var exports_doctor = {};
__export(exports_doctor, {
  runDoctor: () => runDoctor
});
async function runDoctor(args) {
  const shouldFix = args.includes("--fix");
  const shouldBackfill = args.includes("--backfill");
  console.log(`claude-memory-hub doctor \u2014 installation health check
`);
  const checks = [
    checkDatabase2(),
    checkDistFiles(),
    checkHooks(),
    checkBunPath(),
    checkEmbeddings()
  ];
  for (const c of checks) {
    console.log(`  ${ICON[c.status]} ${c.name.padEnd(15)} \u2014 ${c.detail}`);
    if (c.fix && c.status !== "ok") {
      console.log(`           fix: ${c.fix}`);
    }
  }
  const hasFailures = checks.some((c) => c.status === "fail");
  const hasWarnings = checks.some((c) => c.status === "warn");
  const fixableEmbeddings = checks.find((c) => c.name === "embeddings" && c.status !== "ok");
  console.log("");
  let didFix = false;
  if (shouldFix && fixableEmbeddings) {
    didFix = attemptFix();
    if (didFix)
      console.log(`
Deps installed.`);
    else
      process.exitCode = 1;
  }
  if (shouldBackfill) {
    if (fixableEmbeddings && !didFix) {
      console.log("[SKIP] Backfill requires embedding deps. Re-run with `--fix --backfill`.");
      process.exitCode = 1;
    } else {
      await runBackfill();
    }
    return;
  }
  if (didFix) {
    console.log("Re-run `claude-memory-hub doctor --backfill` to embed existing data.");
    return;
  }
  if (!hasFailures && !hasWarnings) {
    console.log("All checks passed. Memory hub is healthy.");
    return;
  }
  if (hasFailures) {
    console.log("Some checks failed. Re-run with --fix to attempt auto-repair.");
    process.exitCode = 1;
  } else {
    console.log("Warnings present. Re-run with --fix to install optional embedding deps.");
    console.log("After install, run `--backfill` to embed existing summaries.");
  }
}
var init_doctor = __esm(() => {
  init_doctor_types();
  init_doctor_checks();
  init_doctor_actions();
});

// src/cli/stats.ts
var exports_stats = {};
__export(exports_stats, {
  runStats: () => runStats
});
function runStats() {
  const db = getDatabase();
  const since = Date.now() - 30 * DAY_MS;
  console.log("Memory Health Report \u2014 last 30 days");
  console.log("\u2500".repeat(48));
  const sessions = db.query("SELECT COUNT(*) n FROM sessions WHERE started_at > ?").get(since)?.n ?? 0;
  const summaries = db.query("SELECT COUNT(*) n FROM long_term_summaries WHERE created_at > ?").get(since)?.n ?? 0;
  const totalEmbeds = db.query("SELECT COUNT(*) n FROM embeddings").get()?.n ?? 0;
  const resourceEmbeds = db.query("SELECT COUNT(*) n FROM embeddings WHERE doc_type='resource'").get()?.n ?? 0;
  const totalSummaries = db.query("SELECT COUNT(*) n FROM long_term_summaries").get()?.n ?? 0;
  const avgPerDay = (sessions / 30).toFixed(1);
  console.log(`Sessions:            ${sessions}  (avg ${avgPerDay}/day)`);
  console.log(`Summaries (30d):     ${summaries}`);
  console.log(`Summaries (total):   ${totalSummaries}`);
  console.log(`Embeddings:          ${totalEmbeds}  (${resourceEmbeds} for skills/agents)`);
  console.log("");
  const projects = db.query("SELECT project, COUNT(*) cnt FROM long_term_summaries WHERE created_at > ? GROUP BY project ORDER BY cnt DESC LIMIT 5").all(since);
  if (projects.length > 0) {
    console.log("Top projects:");
    for (const p of projects)
      console.log(`  ${p.project.padEnd(30)} ${p.cnt} summaries`);
    console.log("");
  }
  const hotFiles = db.query(`SELECT entity_value, COUNT(*) cnt FROM entities
     WHERE entity_type IN ('file_modified','file_read') AND created_at > ?
     GROUP BY entity_value ORDER BY cnt DESC LIMIT 5`).all(since);
  if (hotFiles.length > 0) {
    console.log("Most-edited files:");
    for (const f of hotFiles) {
      const short = f.entity_value.length > 70 ? "\u2026" + f.entity_value.slice(-65) : f.entity_value;
      console.log(`  ${short.padEnd(70)} ${f.cnt} touches`);
    }
    console.log("");
  }
  const decisions = db.query(`SELECT entity_value, COUNT(*) cnt FROM entities
     WHERE entity_type='decision' AND created_at > ?
     GROUP BY entity_value ORDER BY cnt DESC LIMIT 5`).all(since);
  if (decisions.length > 0) {
    console.log("Most-referenced decisions:");
    for (const d of decisions) {
      const short = d.entity_value.length > 70 ? d.entity_value.slice(0, 67) + "\u2026" : d.entity_value;
      console.log(`  "${short}" (\xD7${d.cnt})`);
    }
    console.log("");
  }
  const warnings = [];
  const lowQuality = db.query(`SELECT COUNT(*) n FROM long_term_summaries
     WHERE length(summary) < 50 OR summary LIKE '%Session worked on%'`).get()?.n ?? 0;
  if (lowQuality > 0)
    warnings.push(`${lowQuality} low-quality summaries \u2014 run \`claude-memory-hub prune\``);
  const summaryEmbeds = db.query("SELECT COUNT(*) n FROM embeddings WHERE doc_type='summary'").get()?.n ?? 0;
  const missingEmbeds = totalSummaries - summaryEmbeds;
  if (missingEmbeds > 0)
    warnings.push(`${missingEmbeds} summaries lack embeddings \u2014 run \`claude-memory-hub doctor --backfill\``);
  if (resourceEmbeds === 0)
    warnings.push(`No resource embeddings (skill/agent semantic match disabled) \u2014 run \`claude-memory-hub doctor --fix --backfill\``);
  if (warnings.length > 0) {
    console.log("Issues detected:");
    for (const w of warnings)
      console.log(`  ! ${w}`);
  } else {
    console.log("No issues detected.");
  }
}
var DAY_MS = 86400000;
var init_stats = __esm(() => {
  init_schema();
});

// src/cli/main.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync2, readdirSync as readdirSync2, unlinkSync } from "fs";
import { homedir as homedir7 } from "os";
import { join as join10, resolve, dirname } from "path";

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
import { spawnSync as spawnSync3 } from "child_process";
var CLAUDE_DIR = join10(homedir7(), ".claude");
var SETTINGS_PATH2 = join10(CLAUDE_DIR, "settings.json");
var COMMANDS_DIR = join10(CLAUDE_DIR, "commands");
var PKG_DIR = resolve(dirname(import.meta.dir));
var STABLE_DIR2 = join10(homedir7(), ".claude-memory-hub");
function shellPath(p) {
  const normalized = p.replace(/\\/g, "/");
  return normalized.includes(" ") ? `"${normalized}"` : normalized;
}
function getBunPath() {
  const result = spawnSync3(process.platform === "win32" ? "where" : "which", ["bun"], {
    encoding: "utf-8"
  });
  const resolved = result.stdout?.trim().split(/\r?\n/)[0]?.trim();
  if (resolved && existsSync9(resolved))
    return shellPath(resolved);
  const candidates = [
    join10(homedir7(), ".bun", "bin", "bun"),
    join10(homedir7(), ".bun", "bin", "bun.exe")
  ];
  for (const c of candidates) {
    if (existsSync9(c))
      return shellPath(c);
  }
  return "bun";
}
function copyDistToStableDir() {
  const srcDist = join10(PKG_DIR, "dist");
  const destDist = join10(STABLE_DIR2, "dist");
  if (!existsSync9(srcDist)) {
    throw new Error(`dist/ not found at ${srcDist}. Run 'bun run build:all' first.`);
  }
  const destHooks = join10(destDist, "hooks");
  mkdirSync3(destHooks, { recursive: true });
  for (const file of readdirSync2(srcDist)) {
    if (file.endsWith(".js")) {
      const src = join10(srcDist, file);
      const dest = join10(destDist, file);
      writeFileSync2(dest, readFileSync4(src));
    }
  }
  const srcHooks = join10(srcDist, "hooks");
  if (existsSync9(srcHooks)) {
    for (const file of readdirSync2(srcHooks)) {
      if (file.endsWith(".js")) {
        const src = join10(srcHooks, file);
        const dest = join10(destHooks, file);
        writeFileSync2(dest, readFileSync4(src));
      }
    }
  }
  const srcCmds = join10(PKG_DIR, "commands");
  if (existsSync9(srcCmds)) {
    const destCmds = join10(STABLE_DIR2, "commands");
    mkdirSync3(destCmds, { recursive: true });
    for (const file of readdirSync2(srcCmds)) {
      if (file.endsWith(".md")) {
        writeFileSync2(join10(destCmds, file), readFileSync4(join10(srcCmds, file)));
      }
    }
  }
}
function getHookPath(hookName) {
  return shellPath(join10(STABLE_DIR2, "dist", "hooks", `${hookName}.js`));
}
function getMcpServerPath() {
  return shellPath(join10(STABLE_DIR2, "dist", "index.js"));
}
function loadSettings() {
  if (!existsSync9(SETTINGS_PATH2))
    return {};
  try {
    return JSON.parse(readFileSync4(SETTINGS_PATH2, "utf-8"));
  } catch {
    return {};
  }
}
function saveSettings(settings) {
  if (!existsSync9(CLAUDE_DIR))
    mkdirSync3(CLAUDE_DIR, { recursive: true });
  writeFileSync2(SETTINGS_PATH2, JSON.stringify(settings, null, 2) + `
`);
}
var CLAUDE_JSON_PATH = join10(homedir7(), ".claude.json");
function loadClaudeJson() {
  if (!existsSync9(CLAUDE_JSON_PATH))
    return {};
  try {
    return JSON.parse(readFileSync4(CLAUDE_JSON_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function saveClaudeJson(data) {
  writeFileSync2(CLAUDE_JSON_PATH, JSON.stringify(data, null, 2) + `
`);
}
function registerMcpInClaudeJson(bunBin, mcpPath) {
  try {
    const claudeJson = loadClaudeJson();
    const servers = claudeJson.mcpServers ?? {};
    servers["claude-memory-hub"] = {
      type: "stdio",
      command: bunBin,
      args: ["run", mcpPath]
    };
    claudeJson.mcpServers = servers;
    saveClaudeJson(claudeJson);
  } catch {
    console.log("   Warning: could not register in ~/.claude.json \u2014 register manually:");
    console.log(`   claude mcp add claude-memory-hub -s user -- ${bunBin} run ${mcpPath}`);
  }
}
function unregisterMcpFromClaudeJson() {
  try {
    const claudeJson = loadClaudeJson();
    const servers = claudeJson.mcpServers ?? {};
    delete servers["claude-memory-hub"];
    claudeJson.mcpServers = servers;
    saveClaudeJson(claudeJson);
  } catch {}
}
function installCommands() {
  let srcCommands = join10(PKG_DIR, "commands");
  if (!existsSync9(srcCommands))
    srcCommands = join10(STABLE_DIR2, "commands");
  if (!existsSync9(srcCommands))
    return 0;
  mkdirSync3(COMMANDS_DIR, { recursive: true });
  let count = 0;
  for (const file of readdirSync2(srcCommands)) {
    if (!file.endsWith(".md"))
      continue;
    const src = join10(srcCommands, file);
    const dest = join10(COMMANDS_DIR, file);
    writeFileSync2(dest, readFileSync4(src));
    count++;
  }
  return count;
}
function uninstallCommands() {
  const memCommands = ["mem-search.md", "mem-status.md", "mem-save.md"];
  for (const file of memCommands) {
    const p = join10(COMMANDS_DIR, file);
    try {
      if (existsSync9(p))
        unlinkSync(p);
    } catch {}
  }
}
function install() {
  console.log(`claude-memory-hub \u2014 install
`);
  console.log("0. Copying dist/ to ~/.claude-memory-hub/dist/...");
  try {
    copyDistToStableDir();
    console.log("   Files copied to stable location.");
  } catch (e) {
    console.error(`   Failed to copy dist/: ${e}`);
    console.error("   Hooks will reference package location (may break after bunx cleanup).");
  }
  console.log(`
1. Registering MCP server...`);
  const mcpPath = getMcpServerPath();
  const bunBin = getBunPath();
  const result = spawnSync3("claude", ["mcp", "add", "claude-memory-hub", "-s", "user", "--", bunBin, "run", mcpPath], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.log("   claude CLI not available \u2014 registering directly");
  }
  const settingsForMcp = loadSettings();
  settingsForMcp.mcpServers ??= {};
  settingsForMcp.mcpServers["claude-memory-hub"] = {
    command: bunBin,
    args: ["run", mcpPath]
  };
  saveSettings(settingsForMcp);
  registerMcpInClaudeJson(bunBin, mcpPath);
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
    hooks[event] = hooks[event].filter((e) => !JSON.stringify(e).includes("claude-memory-hub"));
    hooks[event].push({
      matcher: "",
      hooks: [{ type: "command", command: `${bunBin} run ${scriptPath}` }]
    });
    registered++;
  }
  saveSettings(settings);
  console.log(`   ${registered} hook(s) registered. (${5 - registered} already existed)`);
  const dataDir = join10(homedir7(), ".claude-memory-hub");
  if (!existsSync9(dataDir)) {
    mkdirSync3(dataDir, { recursive: true, mode: 448 });
    console.log(`
3. Created data directory: ${dataDir}`);
  } else {
    console.log(`
3. Data directory exists: ${dataDir}`);
  }
  console.log(`
4. Installing slash commands...`);
  const cmdCount = installCommands();
  console.log(`   ${cmdCount} command(s) installed to ~/.claude/commands/`);
  console.log(`
========================================`);
  console.log("Installation complete!");
  console.log("");
  console.log("  MCP:      claude-memory-hub");
  console.log("  Hooks:    PostToolUse, UserPromptSubmit, PreCompact, PostCompact, Stop");
  console.log("  Commands: /mem-search, /mem-status, /mem-save");
  console.log("  Data:     ~/.claude-memory-hub/memory.db");
  console.log("  Key:      not needed");
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
  uninstallCommands();
  console.log("Removed slash commands from ~/.claude/commands/");
  unregisterMcpFromClaudeJson();
  spawnSync3("claude", ["mcp", "remove", "claude-memory-hub", "-s", "user"], {
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
  const dataDir = join10(homedir7(), ".claude-memory-hub");
  const hasData = existsSync9(join10(dataDir, "memory.db"));
  console.log(`  MCP server:  ${hasMcp ? "registered" : "not registered"}`);
  console.log(`  Hooks:       ${hookCount}/5 registered`);
  console.log(`  Database:    ${hasData ? "exists" : "not created yet"}`);
  if (hasData) {
    const { statSync: statSync6 } = __require("fs");
    const stats = statSync6(join10(dataDir, "memory.db"));
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
    const { runHealthCheck: runHealthCheck2, formatHealthReport: formatHealthReport2 } = (init_monitor(), __toCommonJS(exports_monitor));
    console.log(formatHealthReport2(runHealthCheck2()));
    break;
  }
  case "reindex": {
    const { reindexAll: reindexAll2 } = (init_vector_search(), __toCommonJS(exports_vector_search));
    console.log("Rebuilding TF-IDF index...");
    reindexAll2();
    console.log("Done.");
    break;
  }
  case "export": {
    const { exportData: exportData2 } = (init_exporter(), __toCommonJS(exports_exporter));
    const sinceIdx = process.argv.indexOf("--since");
    const tableIdx = process.argv.indexOf("--table");
    const since = sinceIdx > -1 ? Number(process.argv[sinceIdx + 1]) : undefined;
    const table = tableIdx > -1 ? process.argv[tableIdx + 1] : undefined;
    exportData2({ since, table });
    break;
  }
  case "import": {
    const { importData: importData2 } = (init_importer(), __toCommonJS(exports_importer));
    const dryRun = process.argv.includes("--dry-run");
    importData2(dryRun).then((stats) => {
      const total = Object.values(stats.imported).reduce((a, b) => a + b, 0);
      console.error(`Imported: ${total} records, Skipped: ${stats.skipped}, Errors: ${stats.errors}`);
      if (dryRun)
        console.error("(dry run \u2014 no data written)");
      for (const [table, count] of Object.entries(stats.imported)) {
        console.error(`  ${table}: ${count}`);
      }
      process.exit(stats.errors > 0 ? 1 : 0);
    }).catch((err) => {
      console.error(`Import failed: ${err.message}`);
      process.exit(2);
    });
    break;
  }
  case "cleanup": {
    const { cleanupOldData: cleanupOldData2 } = (init_monitor(), __toCommonJS(exports_monitor));
    const daysIdx = process.argv.indexOf("--days");
    const days = daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : 90;
    console.log(`Cleaning up data older than ${days} days...`);
    const result = cleanupOldData2(undefined, days);
    console.log(`Deleted: ${result.sessions_deleted} sessions, ${result.entities_deleted} entities, ${result.embeddings_deleted} embeddings`);
    break;
  }
  case "doctor": {
    const { runDoctor: runDoctor2 } = (init_doctor(), __toCommonJS(exports_doctor));
    await runDoctor2(process.argv.slice(3));
    break;
  }
  case "stats": {
    const { runStats: runStats2 } = (init_stats(), __toCommonJS(exports_stats));
    runStats2();
    break;
  }
  case "prune": {
    const { getDatabase: getDatabase2 } = (init_schema(), __toCommonJS(exports_schema));
    const db = getDatabase2();
    const dryRun = process.argv.includes("--dry-run");
    console.log(`claude-memory-hub \u2014 prune low-quality summaries${dryRun ? " (dry run)" : ""}
`);
    const garbage = db.query(`SELECT id, session_id, summary FROM long_term_summaries
       WHERE length(summary) < 50
          OR summary LIKE '%Session worked on%'
          OR summary LIKE '%Session in project%'
          OR summary LIKE '%<ide_%'
          OR summary LIKE '%<system-reminder>%'
          OR (files_touched = '[]' AND decisions = '[]' AND errors_fixed = '[]' AND length(summary) < 100)`).all();
    if (garbage.length === 0) {
      console.log("  No low-quality summaries found. Database is clean.");
      break;
    }
    console.log(`  Found ${garbage.length} low-quality summaries:`);
    for (const g of garbage.slice(0, 10)) {
      console.log(`    [${g.id}] "${g.summary.slice(0, 80)}${g.summary.length > 80 ? "..." : ""}"`);
    }
    if (garbage.length > 10)
      console.log(`    ... and ${garbage.length - 10} more`);
    if (dryRun) {
      console.log(`
  Dry run \u2014 no changes made. Remove --dry-run to delete.`);
    } else {
      const ids = garbage.map((g) => g.id);
      const placeholders = ids.map(() => "?").join(",");
      db.run(`DELETE FROM long_term_summaries WHERE id IN (${placeholders})`, ids);
      db.run(`DELETE FROM embeddings WHERE doc_type = 'summary' AND doc_id IN (${placeholders})`, ids.map(String));
      console.log(`
  Deleted ${garbage.length} summaries + related embeddings.`);
    }
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
    console.log("  doctor      Diagnose installation + auto-fix embeddings (--fix --backfill)");
    console.log("  stats       Memory health report (sessions, top projects, hot files)");
    console.log("  reindex     Rebuild TF-IDF search index");
    console.log("  export      Export data as JSONL (--since T, --table T)");
    console.log("  import      Import JSONL from stdin (--dry-run)");
    console.log("  cleanup     Remove old data (--days N, default 90)");
    console.log("  prune       Remove low-quality summaries (--dry-run)");
    console.log(`
Usage: npx claude-memory-hub <command>`);
    break;
}

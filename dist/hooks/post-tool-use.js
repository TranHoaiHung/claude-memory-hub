#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __require = import.meta.require;

// src/db/schema.ts
import { Database } from "bun:sqlite";
import { existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";

// src/logger/index.ts
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var LOG_DIR = join(homedir(), ".claude-memory-hub", "logs");
var LOG_FILE = join(LOG_DIR, "memory-hub.log");
var MAX_LOG_SIZE = 5 * 1024 * 1024;
var _minLevel = process.env.CMH_LOG_LEVEL || "info";
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
var logger = createLogger("core");

// src/db/schema.ts
var log = createLogger("schema");
function getDbPath() {
  const dir = join2(homedir2(), ".claude-memory-hub");
  if (!existsSync2(dir)) {
    mkdirSync2(dir, { recursive: true, mode: 448 });
  }
  return join2(dir, "memory.db");
}
var CREATE_TABLES = `
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
`;
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
var _db = null;
function getDatabase() {
  if (!_db) {
    const path = getDbPath();
    _db = new Database(path);
    initDatabase(_db);
  }
  return _db;
}

// src/db/session-store.ts
class SessionStore {
  db;
  constructor(db) {
    this.db = db ?? getDatabase();
  }
  upsertSession(session) {
    this.db.run(`INSERT INTO sessions(id, project, started_at, ended_at, user_prompt, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ended_at    = excluded.ended_at,
         user_prompt = COALESCE(excluded.user_prompt, user_prompt),
         status      = excluded.status`, [
      session.id,
      session.project,
      session.started_at,
      session.ended_at ?? null,
      session.user_prompt ?? null,
      session.status
    ]);
  }
  getSession(id) {
    return this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) ?? null;
  }
  completeSession(id) {
    this.db.run("UPDATE sessions SET status = 'completed', ended_at = ? WHERE id = ?", [Date.now(), id]);
  }
  insertEntity(entity) {
    if (entity.entity_type === "decision" || entity.entity_type === "observation") {
      const existing = this.db.query("SELECT COUNT(*) as c FROM entities WHERE session_id = ? AND entity_type = ? AND entity_value = ?").get(entity.session_id, entity.entity_type, entity.entity_value);
      if (existing && existing.c > 0)
        return -1;
    }
    const result = this.db.run(`INSERT INTO entities(session_id, project, tool_name, entity_type, entity_value, context, importance, created_at, prompt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      entity.session_id,
      entity.project,
      entity.tool_name,
      entity.entity_type,
      entity.entity_value,
      entity.context ?? null,
      entity.importance,
      entity.created_at,
      entity.prompt_number
    ]);
    return Number(result.lastInsertRowid);
  }
  getSessionEntities(session_id) {
    return this.db.query("SELECT * FROM entities WHERE session_id = ? ORDER BY created_at ASC").all(session_id);
  }
  getSessionErrors(session_id) {
    return this.db.query("SELECT * FROM entities WHERE session_id = ? AND entity_type = 'error' ORDER BY importance DESC").all(session_id);
  }
  getSessionDecisions(session_id) {
    return this.db.query("SELECT * FROM entities WHERE session_id = ? AND entity_type = 'decision' ORDER BY importance DESC").all(session_id);
  }
  getSessionObservations(session_id) {
    return this.db.query("SELECT * FROM entities WHERE session_id = ? AND entity_type = 'observation' ORDER BY importance DESC").all(session_id);
  }
  getSessionFiles(session_id) {
    return this.db.query(`SELECT DISTINCT entity_value FROM entities
         WHERE session_id = ? AND entity_type IN ('file_read','file_modified','file_created')
         ORDER BY importance DESC, created_at DESC`).all(session_id).map((r) => r.entity_value);
  }
  hasModifiedFiles(session_id) {
    const row = this.db.query(`SELECT COUNT(*) as c FROM entities
         WHERE session_id = ? AND entity_type IN ('file_modified','file_created') LIMIT 1`).get(session_id);
    return (row?.c ?? 0) > 0;
  }
  insertNote(note) {
    this.db.run("INSERT INTO session_notes(session_id, content, created_at) VALUES (?, ?, ?)", [note.session_id, note.content, note.created_at]);
  }
  getSessionNotes(session_id) {
    return this.db.query("SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at ASC").all(session_id);
  }
  insertMessage(msg) {
    if (msg.uuid) {
      const existing = this.db.query("SELECT COUNT(*) as c FROM messages WHERE uuid = ?").get(msg.uuid);
      if (existing && existing.c > 0)
        return -1;
    }
    const result = this.db.run(`INSERT INTO messages(session_id, project, role, content, prompt_number, timestamp, uuid, parent_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      msg.session_id,
      msg.project,
      msg.role,
      msg.content,
      msg.prompt_number,
      msg.timestamp,
      msg.uuid ?? null,
      msg.parent_uuid ?? null
    ]);
    return Number(result.lastInsertRowid);
  }
  insertMessages(msgs) {
    let count = 0;
    const db = this.db;
    db.transaction(() => {
      for (const msg of msgs) {
        const id = this.insertMessage(msg);
        if (id !== -1)
          count++;
      }
    })();
    return count;
  }
  getSessionMessages(session_id, role) {
    if (role) {
      return this.db.query("SELECT * FROM messages WHERE session_id = ? AND role = ? ORDER BY prompt_number ASC, timestamp ASC").all(session_id, role);
    }
    return this.db.query("SELECT * FROM messages WHERE session_id = ? ORDER BY prompt_number ASC, timestamp ASC").all(session_id);
  }
  getMessageCount(session_id, role) {
    if (role) {
      const row2 = this.db.query("SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND role = ?").get(session_id, role);
      return row2?.c ?? 0;
    }
    const row = this.db.query("SELECT COUNT(*) as c FROM messages WHERE session_id = ?").get(session_id);
    return row?.c ?? 0;
  }
  searchMessages(query, limit = 10) {
    if (!query.trim())
      return [];
    const words = query.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => `"${w.replace(/["*^()]/g, "")}"`);
    if (words.length === 0)
      return [];
    const ftsQuery = words.join(" ");
    try {
      return this.db.query(`SELECT m.*, rank FROM fts_messages
           JOIN messages m ON m.id = fts_messages.rowid
           WHERE fts_messages MATCH ?
           ORDER BY rank LIMIT ?`).all(ftsQuery, limit);
    } catch {
      const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
      return this.db.query("SELECT * FROM messages WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?").all(pattern, limit);
    }
  }
}

// src/db/long-term-store.ts
class LongTermStore {
  db;
  constructor(db) {
    this.db = db ?? getDatabase();
  }
  upsertSummary(summary) {
    this.db.run(`INSERT INTO long_term_summaries(session_id, project, summary, files_touched, decisions, errors_fixed, token_savings, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         summary       = excluded.summary,
         files_touched = excluded.files_touched,
         decisions     = excluded.decisions,
         errors_fixed  = excluded.errors_fixed,
         token_savings = excluded.token_savings`, [
      summary.session_id,
      summary.project,
      summary.summary,
      summary.files_touched,
      summary.decisions,
      summary.errors_fixed,
      summary.token_savings,
      summary.created_at
    ]);
  }
  getSummary(session_id) {
    return this.db.query("SELECT * FROM long_term_summaries WHERE session_id = ?").get(session_id) ?? null;
  }
  getRecentSummaries(project, limit = 5) {
    return this.db.query("SELECT * FROM long_term_summaries WHERE project = ? ORDER BY created_at DESC LIMIT ?").all(project, limit);
  }
  search(query, limit = 5) {
    if (!query.trim())
      return [];
    const safeQuery = sanitizeFtsQuery(query);
    if (!safeQuery)
      return [];
    try {
      return this.db.query(`SELECT lts.session_id, lts.project, lts.summary,
                  lts.files_touched, lts.decisions, lts.errors_fixed,
                  lts.created_at, rank
           FROM fts_memories
           JOIN long_term_summaries lts ON lts.id = fts_memories.rowid
           WHERE fts_memories MATCH ?
           ORDER BY rank
           LIMIT ?`).all(safeQuery, limit);
    } catch {
      return this.fallbackSearch(query, limit);
    }
  }
  fallbackSearch(query, limit) {
    const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
    return this.db.query(`SELECT session_id, project, summary, files_touched, decisions, errors_fixed, created_at
         FROM long_term_summaries
         WHERE summary LIKE ? OR files_touched LIKE ? OR decisions LIKE ?
         ORDER BY created_at DESC LIMIT ?`).all(pattern, pattern, pattern, limit);
  }
  countSummaries(project) {
    if (project) {
      const row2 = this.db.query("SELECT COUNT(*) as c FROM long_term_summaries WHERE project = ?").get(project);
      return row2?.c ?? 0;
    }
    const row = this.db.query("SELECT COUNT(*) as c FROM long_term_summaries").get();
    return row?.c ?? 0;
  }
  getRecentSummariesAll(limit = 5) {
    return this.db.query("SELECT * FROM long_term_summaries ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  findByFile(filePath, limit = 10) {
    const escaped = filePath.replace(/[%_]/g, "\\$&");
    return this.db.query(`SELECT session_id, project, summary, files_touched, decisions, errors_fixed, created_at
         FROM long_term_summaries
         WHERE files_touched LIKE ?
         ORDER BY created_at DESC LIMIT ?`).all(`%${escaped}%`, limit);
  }
}
function sanitizeFtsQuery(query) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/["*^()]/g, "")).filter((w) => w.length > 1);
  if (words.length === 0)
    return "";
  const head = words.slice(0, -1).map((w) => `"${w}"`);
  const last = words[words.length - 1];
  return [...head, `"${last}"*`].join(" ");
}

// src/capture/context-enricher.ts
var CONTEXT_MAX_LENGTH = 500;
function enrichEntityContext(entity, hook) {
  const response = hook.tool_response;
  if (!response)
    return entity;
  switch (entity.entity_type) {
    case "file_read":
      return enrichFileReadContext(entity, hook);
    case "file_modified":
    case "file_created":
      return enrichFileWriteContext(entity, hook);
    case "error":
      return enrichErrorContext(entity, hook);
    default:
      return entity;
  }
}
function enrichFileReadContext(entity, hook) {
  const output = getResponseText(hook);
  if (!output)
    return entity;
  const firstLines = output.split(`
`).slice(0, 5).join(`
`);
  const patterns = extractCodePatterns(output);
  const contextParts = [];
  if (firstLines.trim()) {
    contextParts.push(`Head: ${firstLines.slice(0, 200)}`);
  }
  if (patterns.length > 0) {
    contextParts.push(`Contains: ${patterns.slice(0, 5).join(", ")}`);
  }
  return contextParts.length > 0 ? { ...entity, context: contextParts.join(" | ").slice(0, CONTEXT_MAX_LENGTH) } : entity;
}
function enrichFileWriteContext(entity, hook) {
  const input = hook.tool_input;
  const contextParts = [];
  if (hook.tool_name === "Edit" || hook.tool_name === "MultiEdit") {
    const oldStr = stringField(input, "old_string");
    const newStr = stringField(input, "new_string");
    if (oldStr && newStr) {
      contextParts.push(`Changed: "${oldStr.slice(0, 80)}" \u2192 "${newStr.slice(0, 80)}"`);
    }
  }
  if (hook.tool_name === "Write") {
    const content = stringField(input, "content");
    if (content) {
      const lines = content.split(`
`).length;
      const first = content.split(`
`).slice(0, 3).join(`
`);
      contextParts.push(`Wrote ${lines} lines: ${first.slice(0, 150)}`);
    }
  }
  return contextParts.length > 0 ? { ...entity, context: contextParts.join(" | ").slice(0, CONTEXT_MAX_LENGTH) } : entity;
}
function enrichErrorContext(entity, hook) {
  const stderr = stringField(hook.tool_response, "stderr");
  const stdout = stringField(hook.tool_response, "stdout");
  const cmd = stringField(hook.tool_input, "command");
  const contextParts = [];
  if (cmd)
    contextParts.push(`Cmd: ${cmd.slice(0, 120)}`);
  if (stderr)
    contextParts.push(`Stderr: ${stderr.slice(0, 200)}`);
  else if (stdout)
    contextParts.push(`Output: ${stdout.slice(0, 200)}`);
  return contextParts.length > 0 ? { ...entity, context: contextParts.join(" | ").slice(0, CONTEXT_MAX_LENGTH) } : entity;
}
function getResponseText(hook) {
  const r = hook.tool_response;
  return stringField(r, "output") ?? stringField(r, "stdout") ?? undefined;
}
function stringField(obj, key) {
  if (!obj)
    return;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function extractCodePatterns(content) {
  const patterns = [];
  const lines = content.split(`
`).slice(0, 50);
  for (const line of lines) {
    const defMatch = line.match(/(?:export\s+)?(?:function|class|interface|type|const|enum)\s+(\w+)/);
    if (defMatch?.[1]) {
      patterns.push(defMatch[1]);
      continue;
    }
    const importMatch = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/);
    if (importMatch?.[1]) {
      patterns.push(`import:${importMatch[1]}`);
    }
  }
  return [...new Set(patterns)];
}

// src/capture/privacy-filter.ts
var log2 = createLogger("privacy-filter");
var DEFAULT_PRIVACY_CONFIG = {
  tag_stripping: true,
  auto_detect_secrets: true,
  ignored_paths: [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.credentials",
    "credentials.*",
    "**/secrets/**",
    "**/.secrets/**",
    "**/private/**"
  ],
  custom_patterns: []
};
var PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;
function stripPrivateTags(text) {
  return text.replace(PRIVATE_TAG_RE, "[REDACTED]");
}
var SECRET_PATTERNS = [
  /(?:api[_-]?key|api[_-]?secret|access[_-]?key)\s*[:=]\s*['"]?[\w\-./+]{8,}['"]?/gi,
  /(?:sk-|pk_|pk-|ghp_|gho_|ghr_|ghs_|ghv_|xox[bsrap]-|hf_|glpat-)[\w\-]{20,}/g,
  /Bearer\s+[\w\-./+=]{20,}/g,
  /(?:password|passwd|secret|token|credential)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /(?:secret|token|key|password|auth)\s*[:=]\s*['"]?[a-f0-9]{32,}['"]?/gi
];
function redactSecrets(text) {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(12, match.length));
      return `${prefix}[REDACTED]`;
    });
  }
  return result;
}
function isIgnoredPath(filePath, config = DEFAULT_PRIVACY_CONFIG) {
  if (!filePath)
    return false;
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of config.ignored_paths) {
    if (matchGlob(normalized, pattern)) {
      log2.debug("Path ignored by privacy filter", { path: filePath, pattern });
      return true;
    }
  }
  return false;
}
function matchGlob(path, pattern) {
  const pathBasename = path.split("/").pop() || "";
  if (!pattern.includes("/") && !pattern.includes("**")) {
    return matchSimple(pathBasename, pattern);
  }
  const re = globToRegex(pattern);
  return re.test(path);
}
function matchSimple(name, pattern) {
  if (name === pattern)
    return true;
  if (pattern.includes(".*")) {
    const base = pattern.replace(".*", "");
    if (name === base || name.startsWith(base + "."))
      return true;
  }
  if (pattern.startsWith("*")) {
    const ext = pattern.slice(1);
    if (name.endsWith(ext))
      return true;
  }
  return false;
}
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "___DOUBLESTAR___").replace(/\*/g, "[^/]*").replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`(?:^|/)${escaped}(?:$|/)`, "i");
}
var compiledCustomCache = new Map;
function getCustomPatterns(config) {
  const results = [];
  for (const p of config.custom_patterns) {
    let compiled = compiledCustomCache.get(p);
    if (!compiled) {
      try {
        compiled = new RegExp(p, "gi");
        compiledCustomCache.set(p, compiled);
      } catch {
        log2.warn("Invalid custom privacy pattern", { pattern: p });
        continue;
      }
    }
    results.push(compiled);
  }
  return results;
}
function sanitize(text, config = DEFAULT_PRIVACY_CONFIG) {
  if (!text)
    return text;
  let result = text;
  if (config.tag_stripping) {
    result = stripPrivateTags(result);
  }
  if (config.auto_detect_secrets) {
    result = redactSecrets(result);
  }
  const customPatterns = getCustomPatterns(config);
  for (const pattern of customPatterns) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
function loadPrivacyConfig() {
  try {
    const { existsSync: existsSync3, readFileSync } = __require("fs");
    const { join: join3 } = __require("path");
    const { homedir: homedir3 } = __require("os");
    const configPath = join3(homedir3(), ".claude-memory-hub", "privacy.json");
    if (!existsSync3(configPath))
      return DEFAULT_PRIVACY_CONFIG;
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      tag_stripping: raw.tag_stripping ?? DEFAULT_PRIVACY_CONFIG.tag_stripping,
      auto_detect_secrets: raw.auto_detect_secrets ?? DEFAULT_PRIVACY_CONFIG.auto_detect_secrets,
      ignored_paths: Array.isArray(raw.ignored_paths) ? [...DEFAULT_PRIVACY_CONFIG.ignored_paths, ...raw.ignored_paths] : DEFAULT_PRIVACY_CONFIG.ignored_paths,
      custom_patterns: Array.isArray(raw.custom_patterns) ? raw.custom_patterns : []
    };
  } catch {
    return DEFAULT_PRIVACY_CONFIG;
  }
}

// src/capture/observation-extractor.ts
var TOOL_OUTPUT_HEURISTICS = [
  { pattern: /\b(IMPORTANT|CRITICAL|WARNING|BREAKING)\b/i, importance: 4, label: "important" },
  { pattern: /\b(DEPRECATED|SECURITY|VULNERABILITY)\b/i, importance: 4, label: "security" },
  { pattern: /\b(migration failed|data loss|corrupt)/i, importance: 4, label: "data-risk" },
  { pattern: /\b(decision:|decided to|NOTE:|conclusion:)/i, importance: 3, label: "decision-note" },
  { pattern: /\b(discovered|found that|learned|realized|root cause)\b/i, importance: 3, label: "discovery" },
  { pattern: /\b(workaround:|alternative:|instead of|switched to)/i, importance: 3, label: "approach-change" },
  { pattern: /\b(refactored?|migrated?|upgraded?|replaced)\b/i, importance: 3, label: "refactor" },
  { pattern: /\b(installed|added dependency|npm install|bun add)\b/i, importance: 2, label: "dependency" },
  { pattern: /\b(TODO:|FIXME:|HACK:|WORKAROUND:)/i, importance: 2, label: "todo-note" },
  { pattern: /\b(performance:|bottleneck|slow|timeout|OOM)/i, importance: 2, label: "performance" },
  { pattern: /\b(created|scaffolded|initialized|bootstrapped)\b/i, importance: 2, label: "creation" },
  { pattern: /\b(tests? (?:pass|fail)|coverage|assertion)/i, importance: 2, label: "test-result" },
  { pattern: /\b(deployed|published|released|pushed to)\b/i, importance: 2, label: "deployment" },
  { pattern: /^>\s+.{10,}/m, importance: 2, label: "quoted" }
];
var PROMPT_HEURISTICS = [
  { pattern: /\b(IMPORTANT|CRITICAL|MUST)\b/i, importance: 4, label: "user-important" },
  { pattern: /\b(remember that|note that|I decided|we should|keep in mind)\b/i, importance: 3, label: "user-note" },
  { pattern: /\b(don't|do not|never|avoid|stop)\b/i, importance: 3, label: "user-constraint" },
  { pattern: /\b(fix|debug|investigate|analyze|resolve)\b/i, importance: 2, label: "user-task" },
  { pattern: /\b(prefer|always use|convention is|pattern is)\b/i, importance: 2, label: "user-preference" },
  { pattern: /\b(implement|build|create|add feature|integrate)\b/i, importance: 2, label: "user-feature" }
];
var MAX_VALUE_LENGTH = 500;
var MIN_INPUT_LENGTH = 20;
function extractObservationFromOutput(output, sessionId, project, toolName, promptNumber) {
  if (!output || output.length < MIN_INPUT_LENGTH)
    return;
  const clean = sanitize(output, loadPrivacyConfig());
  return matchHeuristics(clean, TOOL_OUTPUT_HEURISTICS, sessionId, project, toolName, promptNumber);
}
function extractObservationFromPrompt(prompt, sessionId, project, promptNumber) {
  if (!prompt || prompt.length < MIN_INPUT_LENGTH)
    return;
  const clean = sanitize(prompt, loadPrivacyConfig());
  return matchHeuristics(clean, PROMPT_HEURISTICS, sessionId, project, "UserPrompt", promptNumber);
}
function matchHeuristics(text, heuristics, sessionId, project, toolName, promptNumber) {
  let bestMatch;
  for (const h of heuristics) {
    const m = h.pattern.exec(text);
    if (!m)
      continue;
    if (bestMatch && h.importance <= bestMatch.importance)
      continue;
    const value = extractSurroundingText(text, m.index, m[0].length);
    bestMatch = { importance: h.importance, value, label: h.label };
  }
  if (!bestMatch)
    return;
  return {
    session_id: sessionId,
    project,
    tool_name: toolName,
    entity_type: "observation",
    entity_value: `[${bestMatch.label}] ${bestMatch.value}`,
    importance: bestMatch.importance,
    created_at: Date.now(),
    prompt_number: promptNumber
  };
}
function extractSurroundingText(text, matchIndex, matchLength) {
  const before = 50;
  const after = 100;
  const start = Math.max(0, matchIndex - before);
  const end = Math.min(text.length, matchIndex + matchLength + after);
  let snippet = text.slice(start, end).trim();
  snippet = snippet.replace(/\s+/g, " ");
  if (snippet.length > MAX_VALUE_LENGTH) {
    snippet = snippet.slice(0, MAX_VALUE_LENGTH - 3) + "...";
  }
  return snippet;
}

// src/capture/entity-extractor.ts
function extractEntities(hook, promptNumber = 0) {
  const { tool_name, tool_input, tool_response, session_id } = hook;
  const project = deriveProject(hook);
  const now = Date.now();
  const raw = [];
  const privacyConfig = loadPrivacyConfig();
  switch (tool_name) {
    case "Read": {
      const path = stringField2(tool_input, "file_path");
      if (path && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_read", path, 1, now, promptNumber));
      }
      break;
    }
    case "Write": {
      const path = stringField2(tool_input, "file_path");
      if (path && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_created", path, 4, now, promptNumber));
      }
      break;
    }
    case "Edit":
    case "MultiEdit": {
      const path = stringField2(tool_input, "file_path");
      if (path && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_modified", path, 4, now, promptNumber));
      }
      break;
    }
    case "Bash": {
      const cmd = stringField2(tool_input, "command") ?? "";
      const exitCode = tool_response?.exit_code;
      const stdout = stringField2(tool_response, "stdout") ?? "";
      const stderr = stringField2(tool_response, "stderr") ?? "";
      if (typeof exitCode === "number" && exitCode !== 0) {
        const errorCtx = [stderr, stdout].filter(Boolean).join(`
`).slice(0, 300);
        raw.push(makeEntity(session_id, project, tool_name, "error", `[exit ${exitCode}] ${cmd.slice(0, 120)}`, exitCode > 0 ? 3 : 5, now, promptNumber, errorCtx || undefined));
      }
      const writtenFile = extractFileFromBashCmd(cmd);
      if (writtenFile && (exitCode === 0 || exitCode === undefined)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_modified", writtenFile, 2, now, promptNumber));
      }
      break;
    }
    case "TodoWrite": {
      const todos = tool_input["todos"];
      if (Array.isArray(todos) && todos.length > 0) {
        const summary = todos.slice(0, 3).map((t) => typeof t === "object" && t !== null ? String(t["content"] ?? "") : "").filter(Boolean).join("; ");
        if (summary) {
          raw.push(makeEntity(session_id, project, tool_name, "decision", summary, 3, now, promptNumber));
        }
      }
      break;
    }
    case "Agent": {
      const subagentType = stringField2(tool_input, "subagent_type") ?? "general-purpose";
      const prompt = stringField2(tool_input, "prompt") ?? "";
      const agentResult = extractAgentResult(tool_response);
      raw.push(makeEntity(session_id, project, tool_name, "decision", `agent:${subagentType}: ${prompt.slice(0, 200)}`, 3, now, promptNumber, agentResult || undefined));
      break;
    }
    case "Skill": {
      const skillName = stringField2(tool_input, "skill") ?? "unknown";
      const args = stringField2(tool_input, "args") ?? "";
      const skillResult = extractAgentResult(tool_response);
      raw.push(makeEntity(session_id, project, tool_name, "decision", `skill:${skillName} ${args.slice(0, 120)}`.trim(), 2, now, promptNumber, skillResult || undefined));
      break;
    }
    default:
      break;
  }
  const enriched = raw.map((e) => enrichEntityContext(e, hook));
  const output = getResponseText2(tool_response);
  if (output) {
    const obs = extractObservationFromOutput(output, session_id, project, tool_name, promptNumber);
    if (obs)
      enriched.push(obs);
  }
  for (const e of enriched) {
    e.entity_value = sanitize(e.entity_value, privacyConfig);
    if (e.context)
      e.context = sanitize(e.context, privacyConfig);
  }
  return enriched;
}
function makeEntity(session_id, project, tool_name, entity_type, entity_value, importance, created_at, prompt_number, context) {
  const base = { session_id, project, tool_name, entity_type, entity_value, importance, created_at, prompt_number };
  return context !== undefined ? { ...base, context } : base;
}
function getResponseText2(response) {
  return stringField2(response, "output") ?? stringField2(response, "stdout") ?? undefined;
}
function stringField2(obj, key) {
  if (!obj)
    return;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function deriveProject(hook) {
  return "unknown";
}
function extractAgentResult(response) {
  if (!response)
    return;
  const r = response;
  const text = typeof r === "string" ? r : stringField2(r, "result") ?? stringField2(r, "output") ?? stringField2(r, "content") ?? stringField2(r, "text");
  if (!text)
    return;
  return text.length > 800 ? text.slice(0, 797) + "..." : text;
}
function extractFileFromBashCmd(cmd) {
  const patterns = [
    /(?:cp|mv)\s+\S+\s+(\S+\.[\w]+)/,
    /(?:touch|truncate)\s+(\S+\.[\w]+)/,
    />\s*(\S+\.[\w]+)/
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1] && !m[1].startsWith("-"))
      return m[1] ?? undefined;
  }
  return;
}

// src/context/resource-tracker.ts
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

// src/context/resource-registry.ts
import { existsSync as existsSync3, readdirSync, statSync, readFileSync } from "fs";
import { join as join3, basename, relative } from "path";
import { homedir as homedir3 } from "os";
var log3 = createLogger("resource-registry");
var CHARS_PER_TOKEN = 3.75;
var SCAN_TTL_MS = 5 * 60 * 1000;
var SAFE_NAME_RE = /^[a-zA-Z0-9_\-:.]+$/;
var SAFE_COMMAND_NAME_RE = /^[a-zA-Z0-9_\-:.\/]+$/;
var MAX_DIR_WALK_DEPTH = 5;

class ResourceRegistry {
  resources = new Map;
  lastScanAt = 0;
  claudeDir;
  constructor() {
    this.claudeDir = join3(homedir3(), ".claude");
  }
  scan(cwd) {
    if (Date.now() - this.lastScanAt < SCAN_TTL_MS && this.resources.size > 0)
      return;
    this.resources.clear();
    try {
      this.scanSkills(join3(this.claudeDir, "skills"), cwd);
      this.scanFlatAgents(join3(this.claudeDir, "agents"));
      this.scanAgentPackages(this.claudeDir);
      this.scanCommands(join3(this.claudeDir, "commands"), cwd);
      this.scanWorkflows(join3(this.claudeDir, "workflows"));
      this.scanClaudeMd(cwd);
      this.lastScanAt = Date.now();
    } catch (err) {
      log3.error("scan failed", { error: String(err) });
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
      const projectDir = join3(cwd, ".claude", "skills");
      if (existsSync3(projectDir)) {
        this.scanSkillDir(projectDir, "project");
      }
    }
  }
  scanSkillDir(dir, source) {
    if (!existsSync3(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory())
          continue;
        const name = entry.name;
        if (!SAFE_NAME_RE.test(name))
          continue;
        const skillDir = join3(dir, name);
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
      log3.error(`scanSkillDir ${dir}`, { error: String(err) });
    }
  }
  scanFlatAgents(dir) {
    if (!existsSync3(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        if (entry.name === "README.md")
          continue;
        const filePath = join3(dir, entry.name);
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
      log3.error(`scanFlatAgents ${dir}`, { error: String(err) });
    }
  }
  scanAgentPackages(claudeDir) {
    if (!existsSync3(claudeDir))
      return;
    try {
      for (const entry of readdirSync(claudeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("agent_"))
          continue;
        const packageDir = join3(claudeDir, entry.name);
        this.scanAgentPackageDir(packageDir);
      }
    } catch (err) {
      log3.error("scanAgentPackages", { error: String(err) });
    }
  }
  scanAgentPackageDir(packageDir) {
    try {
      for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const subDir = join3(packageDir, entry.name);
          const agentFile = join3(subDir, "AGENT.md");
          if (existsSync3(agentFile)) {
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
          const filePath = join3(packageDir, entry.name);
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
      log3.error(`scanAgentPackageDir ${packageDir}`, { error: String(err) });
    }
  }
  scanCommands(globalDir, cwd) {
    if (existsSync3(globalDir))
      this.scanCommandDir(globalDir, globalDir, "global");
    if (cwd) {
      const projectDir = join3(cwd, ".claude", "commands");
      if (existsSync3(projectDir))
        this.scanCommandDir(projectDir, projectDir, "project");
    }
  }
  scanCommandDir(dir, baseDir, source) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.scanCommandDir(join3(dir, entry.name), baseDir, source);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const filePath = join3(dir, entry.name);
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
      log3.error(`scanCommandDir ${dir}`, { error: String(err) });
    }
  }
  scanWorkflows(dir) {
    if (!existsSync3(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        const filePath = join3(dir, entry.name);
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
      log3.error(`scanWorkflows ${dir}`, { error: String(err) });
    }
  }
  scanClaudeMd(cwd) {
    const globalFile = join3(this.claudeDir, "CLAUDE.md");
    if (existsSync3(globalFile)) {
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
      join3(cwd, "CLAUDE.md"),
      join3(cwd, ".claude", "CLAUDE.md")
    ];
    for (const file of projectFiles) {
      if (!existsSync3(file))
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
      const p = join3(dir, c);
      if (existsSync3(p))
        return p;
    }
    return;
  }
  readFileHead(filePath, lines) {
    try {
      const content = readFileSync(filePath, "utf-8");
      return content.split(`
`).slice(0, lines).join(`
`);
    } catch {
      return "";
    }
  }
  readFileSize(filePath) {
    try {
      return statSync(filePath).size;
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
          const p = join3(d, entry.name);
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
var _instance;
function getResourceRegistry() {
  if (!_instance)
    _instance = new ResourceRegistry;
  return _instance;
}

// src/context/smart-resource-loader.ts
var DEFAULT_TOKEN_BUDGET = 30000;

class SmartResourceLoader {
  tracker;
  ltStore;
  registry;
  constructor(registry) {
    this.tracker = new ResourceTracker;
    this.ltStore = new LongTermStore;
    this.registry = registry ?? getResourceRegistry();
  }
  buildContextPlan(project, userPrompt, tokenBudget = DEFAULT_TOKEN_BUDGET, cwd) {
    this.registry.scan(cwd);
    const recommendations = [];
    const recent = this.tracker.getRecentlyUsedResources(project, 5);
    for (const r of recent) {
      const tokenCost = this.getTokenCost(r.resource_type, r.resource_name);
      if (tokenCost === 0)
        continue;
      recommendations.push({
        resource_type: r.resource_type,
        resource_name: r.resource_name,
        score: Math.min(100, r.frequency * 20),
        token_cost: tokenCost,
        reason: `used in ${r.frequency}/5 recent sessions`
      });
    }
    if (userPrompt.trim()) {
      const searchResults = this.ltStore.search(userPrompt, 3);
      for (const result of searchResults) {
        const files = safeJson(result.files_touched, []);
        for (const file of files.slice(0, 5)) {
          const existing = recommendations.find((r) => r.resource_name === file && r.resource_type === "claude_md");
          if (!existing) {
            recommendations.push({
              resource_type: "claude_md",
              resource_name: file,
              score: 40,
              token_cost: this.getTokenCost("claude_md", file),
              reason: "touched in similar past session"
            });
          }
        }
      }
    }
    recommendations.sort((a, b) => b.score - a.score);
    let usedTokens = 0;
    const included = [];
    const skipped = [];
    for (const r of recommendations) {
      if (usedTokens + r.token_cost <= tokenBudget) {
        included.push(r);
        usedTokens += r.token_cost;
      } else {
        skipped.push(r);
      }
    }
    return {
      recommendations: included,
      total_tokens: usedTokens,
      budget_remaining: tokenBudget - usedTokens,
      skipped
    };
  }
  formatContextAdvice(plan) {
    if (plan.recommendations.length === 0 && plan.skipped.length === 0)
      return "";
    const lines = [];
    if (plan.recommendations.length > 0) {
      lines.push("**Frequently-used resources in this project:**");
      for (const r of plan.recommendations.slice(0, 5)) {
        lines.push(`  - ${r.resource_type}:${r.resource_name} (${r.reason})`);
      }
    }
    if (plan.skipped.length > 0) {
      const totalSkippedTokens = plan.skipped.reduce((sum, s) => sum + s.token_cost, 0);
      lines.push(`${plan.skipped.length} resource(s) rarely used (~${totalSkippedTokens} tokens overhead).`);
    }
    return lines.join(`
`);
  }
  getTokenCost(resourceType, resourceName) {
    const kind = resourceTypeToKind(resourceType);
    if (!kind)
      return 500;
    const resource = this.registry.resolve(kind, resourceName);
    return resource?.full_tokens ?? 0;
  }
}
function resourceTypeToKind(type) {
  const mapping = {
    skill: "skill",
    agent: "agent",
    command: "command",
    workflow: "workflow",
    claude_md: "claude_md",
    mcp_tool: "mcp_tool",
    hook: "hook",
    memory: "memory"
  };
  return mapping[type];
}
function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// src/context/injection-validator.ts
var log4 = createLogger("injection-validator");
var MAX_CHARS = 8000;

class InjectionValidator {
  registry;
  constructor(registry) {
    this.registry = registry;
  }
  validate(rawContext, recommendations) {
    try {
      if (!rawContext)
        return "";
      let text = rawContext;
      text = text.replace(/<!--[\s\S]*?-->/g, "");
      text = text.replace(/<\/?system-reminder>/gi, "");
      text = text.replace(/<\/?instructions>/gi, "");
      text = text.trim();
      if (text.length > MAX_CHARS) {
        text = text.slice(0, MAX_CHARS) + `
[...truncated for token efficiency]`;
      }
      return text;
    } catch (err) {
      log4.error("validation failed, returning empty", { error: String(err) });
      return "";
    }
  }
  filterAliveRecommendations(recommendations) {
    return recommendations.filter((r) => {
      const kind = mapResourceTypeToKind(r.resource_type);
      if (!kind)
        return true;
      const alive = this.registry.exists(kind, r.resource_name);
      if (!alive) {
        log4.warn(`filtered dead resource: ${r.resource_type}:${r.resource_name}`);
      }
      return alive;
    });
  }
}
function mapResourceTypeToKind(type) {
  const mapping = {
    skill: "skill",
    agent: "agent",
    command: "command",
    workflow: "workflow",
    claude_md: "claude_md",
    mcp_tool: "mcp_tool",
    hook: "hook",
    memory: "memory"
  };
  return mapping[type];
}

// src/context/claude-md-tracker.ts
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4, dirname, basename as basename2 } from "path";
var log5 = createLogger("claude-md-tracker");
var MAX_WALK_DEPTH = 20;
var CHARS_PER_TOKEN2 = 3.75;
var STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

class ClaudeMdTracker {
  db;
  constructor(db) {
    this.db = db ?? getDatabase();
  }
  scanAndUpdate(cwd, project) {
    const paths = this.walkToRoot(cwd);
    const entries = [];
    for (const filePath of paths) {
      try {
        const content = readFileSync2(filePath, "utf-8");
        const hash = this.computeHash(content);
        const existing = this.db.query("SELECT content_hash, sections_json, token_cost FROM claude_md_registry WHERE path = ?").get(filePath);
        if (existing && existing.content_hash === hash) {
          this.db.run("UPDATE claude_md_registry SET last_seen = ? WHERE path = ?", [Date.now(), filePath]);
          entries.push({
            path: filePath,
            project,
            contentHash: hash,
            sections: safeJson2(existing.sections_json, []),
            tokenCost: existing.token_cost
          });
        } else {
          const sections = this.extractSections(content);
          const tokenCost = Math.ceil(content.length / CHARS_PER_TOKEN2);
          const sectionsJson = JSON.stringify(sections);
          this.db.run(`INSERT INTO claude_md_registry(path, project, content_hash, sections_json, last_seen, token_cost)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
               project = excluded.project,
               content_hash = excluded.content_hash,
               sections_json = excluded.sections_json,
               last_seen = excluded.last_seen,
               token_cost = excluded.token_cost`, [filePath, project, hash, sectionsJson, Date.now(), tokenCost]);
          entries.push({ path: filePath, project, contentHash: hash, sections, tokenCost });
        }
      } catch (err) {
        log5.error(`Failed to process ${filePath}`, { error: String(err) });
      }
    }
    return entries;
  }
  getRegistryForProject(project) {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const rows = this.db.query("SELECT path, project, content_hash, sections_json, token_cost FROM claude_md_registry WHERE project = ? AND last_seen > ?").all(project, cutoff);
    return rows.map((r) => ({
      path: r.path,
      project: r.project,
      contentHash: r.content_hash,
      sections: safeJson2(r.sections_json, []),
      tokenCost: r.token_cost
    }));
  }
  filterNonRedundant(entries, cwd) {
    if (entries.length === 0 || !cwd)
      return entries;
    const homeClaudeMd = join4(homedir4(), ".claude", "CLAUDE.md");
    let projectRootClaudeMd;
    let dir = cwd;
    while (true) {
      const candidate = entries.find((e) => dirname(e.path) === dir);
      if (candidate) {
        projectRootClaudeMd = candidate.path;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
    return entries.filter((e) => {
      if (e.path === homeClaudeMd)
        return false;
      if (e.path === projectRootClaudeMd)
        return false;
      return true;
    });
  }
  formatForInjection(entries, maxChars) {
    if (entries.length === 0)
      return "";
    const minimal = `CLAUDE.md: ${entries.map((e) => basename2(dirname(e.path)) + "/" + basename2(e.path)).join(", ")}`;
    if (maxChars !== undefined && maxChars < 200)
      return minimal;
    const compactLines = ["**Active CLAUDE.md rules:**"];
    for (const e of entries) {
      compactLines.push(`- ${basename2(dirname(e.path))}/${basename2(e.path)} (~${e.tokenCost} tok)`);
    }
    const compact = compactLines.join(`
`);
    if (maxChars !== undefined && maxChars < 500)
      return compact;
    const fullLines = ["**Active CLAUDE.md rules:**"];
    for (const e of entries) {
      const headings = e.sections.map((s) => s.heading).join(", ");
      fullLines.push(`- ${basename2(dirname(e.path))}/${basename2(e.path)} (~${e.tokenCost} tok): ${headings || "no sections"}`);
    }
    return fullLines.join(`
`);
  }
  computeHash(content) {
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(content);
    return hasher.digest("hex");
  }
  extractSections(content) {
    const sections = [];
    const lines = content.split(`
`);
    let currentHeading;
    let currentBody = [];
    const flush = () => {
      if (currentHeading) {
        const body = currentBody.join(`
`).trim().slice(0, 200);
        sections.push({ heading: currentHeading, preview: body });
      }
    };
    for (const line of lines) {
      const m = line.match(/^## (.+)$/);
      if (m) {
        flush();
        currentHeading = m[1].trim();
        currentBody = [];
      } else if (currentHeading) {
        currentBody.push(line);
      }
    }
    flush();
    return sections;
  }
  walkToRoot(startDir) {
    const paths = [];
    let current = startDir;
    let depth = 0;
    while (depth < MAX_WALK_DEPTH) {
      const file = join4(current, "CLAUDE.md");
      if (existsSync4(file))
        paths.push(file);
      const dotClaudeFile = join4(current, ".claude", "CLAUDE.md");
      if (existsSync4(dotClaudeFile))
        paths.push(dotClaudeFile);
      const parent = dirname(current);
      if (parent === current)
        break;
      current = parent;
      depth++;
    }
    return paths;
  }
}
function safeJson2(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// src/context/prompt-analyzer.ts
import { existsSync as existsSync5, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join5 } from "path";
var INTENT_PATTERNS = [
  { intent: "debug", re: /\b(bug|error|crash|fail|broken|not work|fix|debug|exception|stack ?trace|loi|s\u1EEDa|sua|hong|loi)\b/i },
  { intent: "design", re: /\b(design|ui|ux|layout|figma|component|wireframe|mockup|style|color|theme|thiet ke|thi\u1EBFt k\u1EBF)\b/i },
  { intent: "refactor", re: /\b(refactor|clean ?up|simplify|reorganize|rename|extract|inline|optimize|tach|toi uu|t\u1ED1i \u01B0u)\b/i },
  { intent: "implement", re: /\b(add|create|build|implement|write|tao|t\u1EA1o|viet|vi\u1EBFt|code|l\u00E0m|lam|trien khai|tri\u1EC3n khai)\b/i },
  { intent: "question", re: /\b(how|what|why|when|where|which|l\u00E0m sao|t\u1EA1i sao|l\u00E0 g\u00EC|la gi|lam sao|tai sao)\b|\?/i }
];
var VIETNAMESE_RE = /[\u0103\u00E2\u0111\u00EA\u00F4\u01A1\u01B0]|[\u00E1\u00E0\u1EA3\u00E3\u1EA1]|[\u00E9\u00E8\u1EBB\u1EBD\u1EB9]|[\u00ED\u00EC\u1EC9\u0129\u1ECB]|[\u00F3\u00F2\u1ECF\u00F5\u1ECD]|[\u00FA\u00F9\u1EE7\u0169\u1EE5]|[\u00FD\u1EF3\u1EF7\u1EF9\u1EF5]|[\u00C0-\u1EF9]/i;
var STOP_WORDS = new Set([
  "the",
  "is",
  "at",
  "of",
  "in",
  "on",
  "and",
  "or",
  "but",
  "for",
  "with",
  "to",
  "a",
  "an",
  "t\xF4i",
  "toi",
  "b\u1EA1n",
  "ban",
  "c\xF3",
  "co",
  "kh\xF4ng",
  "khong",
  "l\xE0",
  "la",
  "n\xE0y",
  "nay",
  "the",
  "this",
  "that",
  "what",
  "when",
  "where",
  "how",
  "why"
]);
function analyzePrompt(prompt, cwd) {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  return {
    intent: detectIntent(lower),
    keywords: extractKeywords(text),
    language: detectLanguage(text),
    has_error_context: /(traceback|stack ?trace|error[: ]|exception|panic:|^\s+at\s)/im.test(text),
    has_code_block: /```|\bfunction\b|\bclass\b|\bdef\b|=>|\bimport\b/.test(text),
    is_command_invocation: text.startsWith("/"),
    cwd_signals: scanCwdSignals(cwd)
  };
}
function detectIntent(lower) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(lower))
      return intent;
  }
  return "general";
}
function detectLanguage(text) {
  const hasVi = VIETNAMESE_RE.test(text);
  const hasEn = /[a-zA-Z]{4,}/.test(text);
  if (hasVi && hasEn)
    return "mixed";
  if (hasVi)
    return "vi";
  return "en";
}
function extractKeywords(text) {
  const tokens = text.toLowerCase().replace(/[^\w\u00C0-\u1EF9\-_./]+/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  return [...new Set(tokens)].slice(0, 20);
}
var CWD_CACHE = new Map;
var CWD_TTL_MS = 60000;
function scanCwdSignals(cwd) {
  const cached = CWD_CACHE.get(cwd);
  if (cached && Date.now() - cached.ts < CWD_TTL_MS)
    return cached.signals;
  const signals = {
    has_swift: false,
    has_kotlin: false,
    has_react_native: false,
    has_flutter: false,
    has_python: false,
    has_go: false,
    has_rust: false,
    has_typescript: false,
    has_java: false,
    has_csharp: false,
    has_figma: false,
    is_mobile: false,
    primary_language: null
  };
  if (!cwd || !existsSync5(cwd)) {
    CWD_CACHE.set(cwd, { signals, ts: Date.now() });
    return signals;
  }
  detectFromManifest(cwd, signals);
  detectFromExtensions(cwd, signals);
  signals.is_mobile = signals.has_swift || signals.has_kotlin || signals.has_react_native || signals.has_flutter;
  signals.primary_language = pickPrimary(signals);
  CWD_CACHE.set(cwd, { signals, ts: Date.now() });
  return signals;
}
function detectFromManifest(cwd, s) {
  const has = (rel) => existsSync5(join5(cwd, rel));
  if (has("package.json")) {
    s.has_typescript = has("tsconfig.json") || has("tsconfig.base.json");
    try {
      const pkg = JSON.parse(__require("fs").readFileSync(join5(cwd, "package.json"), "utf-8"));
      const deps = { ...pkg.dependencies ?? {}, ...pkg.devDependencies ?? {} };
      if (deps["react-native"] || deps["expo"])
        s.has_react_native = true;
      if (Object.keys(deps).some((k) => k.startsWith("@figma/") || k === "figma-api"))
        s.has_figma = true;
    } catch {}
  }
  if (has("Podfile") || has("*.xcodeproj"))
    s.has_swift = true;
  if (has("build.gradle") || has("build.gradle.kts") || has("settings.gradle"))
    s.has_kotlin = true;
  if (has("pubspec.yaml"))
    s.has_flutter = true;
  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py"))
    s.has_python = true;
  if (has("go.mod"))
    s.has_go = true;
  if (has("Cargo.toml"))
    s.has_rust = true;
  if (has("pom.xml") || has("build.gradle"))
    s.has_java = true;
  if (has("global.json") || hasGlob(cwd, /\.csproj$/))
    s.has_csharp = true;
}
function detectFromExtensions(cwd, s) {
  let entries = [];
  try {
    entries = readdirSync2(cwd);
  } catch {
    return;
  }
  let scanned = 0;
  for (const name of entries) {
    if (scanned > 100)
      break;
    if (name.startsWith("."))
      continue;
    const p = join5(cwd, name);
    try {
      const stat = statSync2(p);
      if (stat.isFile()) {
        scanned++;
        if (name.endsWith(".swift"))
          s.has_swift = true;
        else if (name.endsWith(".kt") || name.endsWith(".kts"))
          s.has_kotlin = true;
        else if (name.endsWith(".dart"))
          s.has_flutter = true;
        else if (name.endsWith(".py"))
          s.has_python = true;
        else if (name.endsWith(".go"))
          s.has_go = true;
        else if (name.endsWith(".rs"))
          s.has_rust = true;
        else if (name.endsWith(".ts") || name.endsWith(".tsx"))
          s.has_typescript = true;
        else if (name.endsWith(".java"))
          s.has_java = true;
        else if (name.endsWith(".cs"))
          s.has_csharp = true;
      }
    } catch {}
  }
}
function hasGlob(cwd, re) {
  try {
    return readdirSync2(cwd).some((n) => re.test(n));
  } catch {
    return false;
  }
}
function pickPrimary(s) {
  if (s.has_swift)
    return "swift";
  if (s.has_kotlin)
    return "kotlin";
  if (s.has_flutter)
    return "dart";
  if (s.has_react_native)
    return "react-native";
  if (s.has_typescript)
    return "typescript";
  if (s.has_python)
    return "python";
  if (s.has_go)
    return "go";
  if (s.has_rust)
    return "rust";
  if (s.has_java)
    return "java";
  if (s.has_csharp)
    return "csharp";
  return null;
}

// src/search/embedding-model.ts
var log6 = createLogger("embedding-model");
var MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
var EMBEDDING_DIM = 384;
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
      log6.error("embed failed", { error: String(err) });
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
      log6.info("Embedding model loaded", { model: MODEL_NAME, ms: Date.now() - t0 });
    } catch (err) {
      log6.warn("Embedding model unavailable", { error: String(err) });
      this.available = false;
    }
  }
}
var embeddingModel = new EmbeddingModel;

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
    const score = cosineSimilarity(queryVec, docVec);
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
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0;i < a.length; i++)
    dot += a[i] * b[i];
  return dot;
}

// src/context/resource-matcher.ts
var log7 = createLogger("resource-matcher");
var CONTEXT_BOOSTS = [
  { when: (s) => s.has_swift, names: ["ios-developer", "swift", "swiftui"] },
  { when: (s) => s.has_kotlin, names: ["android-developer", "kotlin", "compose"] },
  { when: (s) => s.has_react_native, names: ["react-native-developer", "expo"] },
  { when: (s) => s.has_flutter, names: ["flutter-developer", "dart", "riverpod"] },
  { when: (s) => s.has_typescript, names: ["web-developer", "react", "nextjs", "frontend"] },
  { when: (s) => s.has_python, names: ["python", "fastapi", "django"] },
  { when: (s) => s.has_figma, names: ["figma-ui-mcp", "ui-ux-pro-max", "ui-ux-designer"] },
  { when: (s) => s.is_mobile, names: ["mobile-development", "mobile-development-skill"] }
];
var KIND_ORDER = {
  skill: 0,
  agent: 1,
  command: 2,
  workflow: 3,
  claude_md: 4
};
async function matchResourcesForPrompt(prompt, analysis, opts) {
  const t0 = Date.now();
  const { project, threshold = 0.3, limit = 5, semantic_threshold = 0.15 } = opts;
  const semantic = await searchResourcesByPrompt(prompt, {
    limit: 30,
    threshold: semantic_threshold
  });
  const tracker = new ResourceTracker;
  const recent = tracker.getRecentlyUsedResources(project, 5);
  const freqMap = new Map;
  for (const r of recent) {
    const key = `${r.resource_type}::${r.resource_name}`;
    freqMap.set(key, r.frequency);
  }
  const recencyMap = new Map;
  for (const r of recent) {
    const key = `${r.resource_type}::${r.resource_name}`;
    recencyMap.set(key, r.frequency >= 1 ? 1 : 0);
  }
  const seen = new Map;
  for (const m of semantic) {
    const key = `${m.kind}::${m.name}`;
    seen.set(key, buildScored(m, analysis, freqMap, recencyMap));
  }
  const registry = getResourceRegistry();
  registry.scan();
  for (const [key, freq] of freqMap.entries()) {
    if (seen.has(key))
      continue;
    if (freq < 2)
      continue;
    const [kind, name] = key.split("::");
    const reg = registry.resolve(kind, name);
    if (!reg)
      continue;
    const stub = {
      kind,
      name,
      score: 0,
      reason: "frequently used",
      file_path: reg.path
    };
    seen.set(key, buildScored(stub, analysis, freqMap, recencyMap));
  }
  const all = [...seen.values()];
  const filtered = all.filter((r) => r.score >= threshold);
  filtered.sort((a, b) => {
    if (b.score !== a.score)
      return b.score - a.score;
    return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  });
  log7.info("matched resources", {
    candidates: all.length,
    above_threshold: filtered.length,
    ms: Date.now() - t0
  });
  return filtered.slice(0, limit);
}
function buildScored(m, analysis, freqMap, recencyMap) {
  const semantic = m.score;
  const freq = computeFrequencyScore(freqMap.get(`${m.kind}::${m.name}`) ?? 0);
  const ctx = computeProjectContextScore(m.name, analysis);
  const rec = computeRecencyScore(recencyMap.get(`${m.kind}::${m.name}`) ?? 0);
  const final = clamp01(0.5 * semantic + 0.2 * freq + 0.2 * ctx + 0.1 * rec);
  return {
    kind: m.kind,
    name: m.name,
    file_path: m.file_path,
    score: final,
    semantic_score: semantic,
    frequency_score: freq,
    project_context_score: ctx,
    recency_score: rec,
    reason: buildReason(semantic, freq, ctx)
  };
}
function buildReason(semantic, freq, ctx) {
  const parts = [];
  if (semantic >= 0.5)
    parts.push(`${(semantic * 100).toFixed(0)}% match`);
  else if (semantic >= 0.3)
    parts.push(`weak semantic match`);
  if (freq >= 0.4)
    parts.push(`used in this project`);
  if (ctx >= 0.5)
    parts.push(`fits cwd`);
  return parts.join(", ") || "candidate";
}
function computeFrequencyScore(usageCount) {
  if (usageCount === 0)
    return 0;
  return clamp01(0.4 + (usageCount - 1) * 0.3);
}
function computeProjectContextScore(name, analysis) {
  const lname = name.toLowerCase();
  for (const rule of CONTEXT_BOOSTS) {
    if (!rule.when(analysis.cwd_signals))
      continue;
    if (rule.names.some((n) => lname === n || lname.includes(n)))
      return 1;
  }
  return 0;
}
function computeRecencyScore(daysAgo) {
  if (daysAgo === 0)
    return 0;
  if (daysAgo <= 1)
    return 1;
  if (daysAgo <= 7)
    return 0.6;
  if (daysAgo <= 30)
    return 0.3;
  return 0;
}
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// src/context/history-intent.ts
var HISTORY_EXEMPLARS = [
  "what was the last message we exchanged",
  "what did we work on previously",
  "show me our previous conversation",
  "what were we discussing before",
  "tin nh\u1EAFn g\u1EA7n nh\u1EA5t l\xE0 g\xEC",
  "l\u1EA7n tr\u01B0\u1EDBc ch\xFAng ta \u0111\xE3 l\xE0m g\xEC",
  "c\xF4ng vi\u1EC7c tr\u01B0\u1EDBc \u0111\xF3 c\u1EE7a b\u1EA1n l\xE0 g\xEC",
  "cu\u1ED9c tr\xF2 chuy\u1EC7n tr\u01B0\u1EDBc \u0111\xE2y",
  "l\u1ECBch s\u1EED chat c\u1EE7a t\xF4i",
  "what was I working on"
];
var SIMILARITY_THRESHOLD = 0.55;
var cachedExemplarVectors = null;
var cachedExemplarsLoading = null;
async function ensureExemplarsLoaded() {
  if (cachedExemplarVectors)
    return;
  if (!cachedExemplarsLoading) {
    cachedExemplarsLoading = (async () => {
      const vecs = await embeddingModel.embedBatch(HISTORY_EXEMPLARS, 8);
      cachedExemplarVectors = vecs;
    })();
  }
  await cachedExemplarsLoading;
}
async function detectHistoryIntent(prompt) {
  if (!prompt || prompt.length < 6)
    return { match: false, score: 0 };
  await embeddingModel.embed("warmup");
  if (!embeddingModel.isAvailable)
    return { match: false, score: 0 };
  const queryVec = await embeddingModel.embed(prompt);
  if (!queryVec)
    return { match: false, score: 0 };
  await ensureExemplarsLoaded();
  if (!cachedExemplarVectors)
    return { match: false, score: 0 };
  let bestScore = 0;
  for (const ev of cachedExemplarVectors) {
    if (!ev)
      continue;
    const score = cosine(queryVec, ev);
    if (score > bestScore)
      bestScore = score;
  }
  return { match: bestScore >= SIMILARITY_THRESHOLD, score: bestScore };
}
function cosine(a, b) {
  let dot = 0;
  for (let i = 0;i < EMBEDDING_DIM; i++)
    dot += a[i] * b[i];
  return dot;
}

// src/context/conversation-injector.ts
var MAX_MESSAGES_PER_SECTION = 6;
var PER_MESSAGE_PREVIEW_CHARS = 240;
function buildRecentConversationSection(currentSessionId, project, injectedDb) {
  const db = injectedDb ?? getDatabase();
  const store = new SessionStore(db);
  const sameSession = store.getSessionMessages(currentSessionId);
  if (sameSession.length >= 2) {
    const recent = sameSession.slice(-MAX_MESSAGES_PER_SECTION);
    return formatSection("Recent messages in this session", recent.map((m) => ({
      role: m.role,
      prompt_number: m.prompt_number,
      content: m.content,
      timestamp: m.timestamp,
      session_id: m.session_id
    })));
  }
  const priorSessionId = db.query(`SELECT id FROM sessions
       WHERE project = ? AND id != ?
       ORDER BY started_at DESC LIMIT 1`).get(project, currentSessionId)?.id;
  if (!priorSessionId)
    return "";
  const priorMessages = db.query(`SELECT role, prompt_number, content, timestamp, session_id
       FROM messages WHERE session_id = ?
       ORDER BY timestamp DESC LIMIT ?`).all(priorSessionId, MAX_MESSAGES_PER_SECTION).reverse();
  if (priorMessages.length === 0)
    return "";
  return formatSection(`Recent messages in your previous session in project "${project}"`, priorMessages);
}
function formatSection(heading, messages) {
  const lines = [`**${heading}:**`];
  for (const m of messages) {
    const date = new Date(m.timestamp).toISOString().slice(0, 16).replace("T", " ");
    const tag = m.role === "user" ? "\uD83E\uDDD1" : "\uD83E\uDD16";
    const preview = compactWhitespace(m.content).slice(0, PER_MESSAGE_PREVIEW_CHARS);
    const truncated = m.content.length > PER_MESSAGE_PREVIEW_CHARS ? "\u2026" : "";
    lines.push(`  ${tag} [${date}] ${m.role}#${m.prompt_number}: ${preview}${truncated}`);
  }
  lines.push("_For full transcript, call `memory_conversation` with session_id, " + "or `memory_conversation` with `search` for cross-session lookup._");
  return lines.join(`
`);
}
function compactWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

// src/capture/smart-truncate.ts
var MIN_USEFUL_RATIO = 0.8;
var MARKER = `
[truncated]`;
function smartTruncate(text, maxChars) {
  if (text.length <= maxChars)
    return text;
  const reserveForMarker = MARKER.length;
  const sliceLimit = maxChars - reserveForMarker;
  const slice = text.slice(0, sliceLimit);
  const minBoundary = Math.floor(sliceLimit * MIN_USEFUL_RATIO);
  const candidates = [
    slice.lastIndexOf(`

`),
    slice.lastIndexOf(`
`),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! ")
  ];
  const cutAt = Math.max(...candidates);
  if (cutAt >= minBoundary) {
    return slice.slice(0, cutAt + 1) + MARKER;
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= minBoundary) {
    return slice.slice(0, lastSpace) + MARKER;
  }
  return slice + MARKER;
}
var ROLE_CAPS = {
  user: 2000,
  assistant: 4000
};
function capForRole(role) {
  return ROLE_CAPS[role];
}

// src/capture/hook-handler.ts
import { basename as basename3 } from "path";
function stripIdeTags(prompt) {
  return prompt.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}
async function handlePostToolUse(hook, project) {
  const store = new SessionStore;
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    status: "active"
  });
  const entities = extractEntities(hook);
  for (const entity of entities) {
    store.insertEntity({ ...entity, project });
  }
  const tracker = new ResourceTracker;
  const registry = getResourceRegistry();
  if (hook.tool_name === "Skill") {
    const skillName = stringField3(hook.tool_input, "skill");
    if (skillName) {
      const resource = registry.resolve("skill", skillName);
      tracker.trackUsage(hook.session_id, project, "skill", skillName, resource?.full_tokens ?? 0);
    }
  }
  if (hook.tool_name === "Agent") {
    const agentType = stringField3(hook.tool_input, "subagent_type");
    if (agentType) {
      const resource = registry.resolve("agent", agentType);
      tracker.trackUsage(hook.session_id, project, "agent", agentType, resource?.full_tokens ?? 0);
    }
  }
  if (hook.tool_name.startsWith("mcp__")) {
    tracker.trackUsage(hook.session_id, project, "mcp_tool", hook.tool_name);
  }
}
async function handleUserPromptSubmit(hook, project) {
  const store = new SessionStore;
  const ltStore = new LongTermStore;
  const privacyConfig = loadPrivacyConfig();
  const cleanPrompt = sanitize(stripIdeTags(hook.prompt), privacyConfig);
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    user_prompt: cleanPrompt.slice(0, 500) || hook.prompt.slice(0, 500),
    status: "active"
  });
  const promptText = cleanPrompt || hook.prompt;
  if (promptText.length > 5) {
    const promptNum = store.getMessageCount(hook.session_id, "user");
    store.insertMessage({
      session_id: hook.session_id,
      project,
      role: "user",
      content: smartTruncate(promptText, capForRole("user")),
      prompt_number: promptNum,
      timestamp: Date.now()
    });
  }
  const promptObs = extractObservationFromPrompt(cleanPrompt || hook.prompt, hook.session_id, project, 0);
  if (promptObs)
    store.insertEntity({ ...promptObs, project });
  let results = ltStore.search(hook.prompt, 3);
  let memoryHint = "";
  if (results.length === 0) {
    const recent = ltStore.getRecentSummariesAll(3);
    if (recent.length > 0) {
      results = recent.map((r) => ({
        session_id: r.session_id,
        project: r.project,
        summary: r.summary,
        files_touched: r.files_touched,
        decisions: r.decisions,
        errors_fixed: r.errors_fixed,
        created_at: r.created_at,
        rank: 0
      }));
      const total = ltStore.countSummaries();
      memoryHint = `(showing ${recent.length} most recent of ${total} stored sessions \u2014 use \`memory_search\` with technical keywords for targeted retrieval)`;
    }
  }
  const registry = getResourceRegistry();
  registry.scan(hook.cwd);
  const validator = new InjectionValidator(registry);
  const loader = new SmartResourceLoader(registry);
  const plan = loader.buildContextPlan(project, hook.prompt, 30000, hook.cwd);
  plan.recommendations = validator.filterAliveRecommendations(plan.recommendations);
  plan.skipped = validator.filterAliveRecommendations(plan.skipped);
  const advice = loader.formatContextAdvice(plan);
  let mdSummary = "";
  if (hook.cwd) {
    try {
      const mdTracker = new ClaudeMdTracker;
      const mdEntries = mdTracker.scanAndUpdate(hook.cwd, project);
      const tracker = new ResourceTracker;
      for (const entry of mdEntries) {
        tracker.trackUsage(hook.session_id, project, "claude_md", entry.path, entry.tokenCost);
      }
      const injectableEntries = mdTracker.filterNonRedundant(mdEntries, hook.cwd);
      mdSummary = mdTracker.formatForInjection(injectableEntries);
    } catch {}
  }
  let smartMatchSection = "";
  try {
    const analysis = analyzePrompt(hook.prompt ?? "", hook.cwd ?? "");
    if (!analysis.is_command_invocation && (hook.prompt?.length ?? 0) >= 10) {
      const matches = await matchResourcesForPrompt(hook.prompt ?? "", analysis, {
        project,
        threshold: 0.3,
        limit: 5
      });
      if (matches.length > 0)
        smartMatchSection = formatSmartMatch(matches);
    }
  } catch {}
  let recentConvoSection = "";
  try {
    if ((hook.prompt?.length ?? 0) >= 6) {
      const intent = await detectHistoryIntent(hook.prompt ?? "");
      if (intent.match) {
        recentConvoSection = buildRecentConversationSection(hook.session_id, project);
      }
    }
  } catch {}
  let overheadWarning = "";
  try {
    const overhead = await registry.getOverheadReport(project);
    const unusedTokens = overhead.potential_savings.if_remove_unused_skills + overhead.potential_savings.if_remove_unused_agents;
    if (unusedTokens > 1e4) {
      const unusedCount = overhead.usage_analysis.skills_never_used.length + overhead.usage_analysis.agents_never_used.length;
      overheadWarning = `Note: ${unusedCount} unused resources (~${unusedTokens} listing tok overhead). Run \`memory_context_budget\` for details.`;
    }
  } catch {}
  const memorySection = buildMemorySection(results, memoryHint);
  const safeContext = validator.validate(fitWithinBudget(memorySection, recentConvoSection, mdSummary, smartMatchSection, advice, overheadWarning));
  return { additionalContext: safeContext };
}
function formatSmartMatch(matches) {
  const lines = ["**Suggested resources for this prompt:**"];
  for (const m of matches) {
    const pct = (m.score * 100).toFixed(0);
    const kind = m.kind === "claude_md" ? "CLAUDE.md" : m.kind;
    lines.push(`  - ${kind}: \`${m.name}\` (${pct}% \u2014 ${m.reason})`);
  }
  lines.push("Invoke or reference the most relevant ones if applicable.");
  return lines.join(`
`);
}
function fitWithinBudget(memoryText, recentConvoText, mdText, smartMatchText, adviceText, overheadText) {
  const MAX_CHARS2 = 8000;
  const sections = [
    { text: recentConvoText || "", priority: 1, minChars: 400 },
    { text: memoryText || "", priority: 2, minChars: 500 },
    { text: smartMatchText || "", priority: 3, minChars: 100 },
    { text: mdText || "", priority: 4, minChars: 200 },
    { text: adviceText || "", priority: 5, minChars: 0 },
    { text: overheadText || "", priority: 6, minChars: 0 }
  ].filter((s) => s.text.length > 0);
  const totalNeeded = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (totalNeeded <= MAX_CHARS2) {
    return sections.map((s) => s.text).join(`

`);
  }
  let remaining = MAX_CHARS2;
  const allocated = [];
  sections.sort((a, b) => a.priority - b.priority);
  for (const section of sections) {
    if (remaining <= 0)
      break;
    if (section.text.length <= remaining) {
      allocated.push(section.text);
      remaining -= section.text.length + 2;
    } else if (remaining >= section.minChars) {
      allocated.push(section.text.slice(0, remaining));
      remaining = 0;
    }
  }
  return allocated.join(`

`);
}
function buildMemorySection(results, hint = "") {
  if (results.length === 0)
    return "";
  const lines = ["**Past session context:**"];
  for (const r of results) {
    const date = new Date(r.created_at).toLocaleDateString();
    const files = safeJson3(r.files_touched, []);
    lines.push(`- [${date}, ${r.project}] ${r.summary.slice(0, 400)}`);
    if (files.length > 0)
      lines.push(`  Files: ${files.slice(0, 5).join(", ")}`);
  }
  if (hint)
    lines.push(`
_${hint}_`);
  return lines.join(`
`);
}
async function handleSessionEnd(hook, _project) {
  const store = new SessionStore;
  store.completeSession(hook.session_id);
}
function stringField3(obj, key) {
  if (!obj)
    return;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function safeJson3(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function projectFromCwd(cwd) {
  if (!cwd)
    return "unknown";
  return basename3(cwd);
}

// src/capture/batch-queue.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync, appendFileSync as appendFileSync2, unlinkSync, statSync as statSync3 } from "fs";
import { join as join6 } from "path";
import { homedir as homedir5 } from "os";
var log8 = createLogger("batch-queue");
var DATA_DIR = join6(homedir5(), ".claude-memory-hub");
var BATCH_DIR = join6(DATA_DIR, "batch");
var QUEUE_PATH = join6(BATCH_DIR, "queue.jsonl");
var LOCK_PATH = join6(BATCH_DIR, "queue.lock");
var MAX_QUEUE_SIZE = 100 * 1024;
var LOCK_STALE_MS = 30000;
function enqueueEvent(event) {
  try {
    ensureBatchDir();
    const line = JSON.stringify(event) + `
`;
    appendFileSync2(QUEUE_PATH, line, "utf-8");
  } catch (err) {
    log8.error("enqueue failed", { error: String(err) });
    throw err;
  }
}
function tryFlush() {
  try {
    if (!existsSync6(QUEUE_PATH))
      return false;
    const stat = statSync3(QUEUE_PATH);
    if (stat.size === 0)
      return false;
    if (!tryAcquireLock())
      return false;
    try {
      flushQueue();
      return true;
    } finally {
      releaseLock();
    }
  } catch (err) {
    log8.error("flush failed", { error: String(err) });
    return false;
  }
}
function flushQueue() {
  const content = readFileSync3(QUEUE_PATH, "utf-8").trim();
  if (!content)
    return;
  const events = [];
  for (const line of content.split(`
`)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      log8.warn("skipping malformed queue line");
    }
  }
  if (events.length === 0)
    return;
  const store = new SessionStore;
  const tracker = new ResourceTracker;
  const registry = getResourceRegistry();
  const db = store["db"];
  db.transaction(() => {
    for (const event of events) {
      store.upsertSession({
        id: event.session.id,
        project: event.session.project,
        started_at: event.session.started_at,
        status: "active"
      });
      for (const entity of event.entities) {
        store.insertEntity({ ...entity, project: event.session.project });
      }
      if (event.resources) {
        for (const r of event.resources) {
          const resource = registry.resolve(r.type, r.name);
          tracker.trackUsage(event.session.id, event.session.project, r.type, r.name, r.tokenCost ?? resource?.full_tokens ?? 0);
        }
      }
    }
  })();
  writeFileSync(QUEUE_PATH, "", "utf-8");
  log8.info("batch flushed", { events: events.length });
}
function tryAcquireLock() {
  try {
    if (existsSync6(LOCK_PATH)) {
      const lockContent = readFileSync3(LOCK_PATH, "utf-8").trim();
      const [pidStr, timestampStr] = lockContent.split(":");
      const lockTime = Number(timestampStr);
      if (Date.now() - lockTime < LOCK_STALE_MS) {
        const pid = Number(pidStr);
        try {
          process.kill(pid, 0);
          return false;
        } catch {}
      }
    }
    writeFileSync(LOCK_PATH, `${process.pid}:${Date.now()}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}
function releaseLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {}
}
function ensureBatchDir() {
  if (!existsSync6(BATCH_DIR)) {
    mkdirSync3(BATCH_DIR, { recursive: true, mode: 448 });
  }
}
function isBatchEnabled() {
  const mode = process.env["CLAUDE_MEMORY_HUB_BATCH"] ?? "auto";
  return mode !== "disabled";
}

// src/retrieval/proactive-retrieval.ts
import { existsSync as existsSync7, readFileSync as readFileSync4, writeFileSync as writeFileSync2, mkdirSync as mkdirSync4 } from "fs";
import { join as join7 } from "path";
import { homedir as homedir6 } from "os";
var log9 = createLogger("proactive-retrieval");
var DATA_DIR2 = join7(homedir6(), ".claude-memory-hub");
var PROACTIVE_DIR = join7(DATA_DIR2, "proactive");
var TOOL_CALL_INTERVAL = 15;
var MAX_INJECTION_CHARS = 3000;
function evaluateProactiveInjection(sessionId, toolName, toolInput, toolResponse) {
  const state = loadState(sessionId);
  state.toolCallCount++;
  const filePath = extractFilePath(toolName, toolInput);
  if (filePath) {
    state.recentFiles = [...new Set([filePath, ...state.recentFiles])].slice(0, 20);
  }
  const shouldTrigger = state.toolCallCount % TOOL_CALL_INTERVAL === 0 || toolName === "Bash" && typeof toolResponse.exit_code === "number" && toolResponse.exit_code !== 0 && state.toolCallCount > 5;
  if (!shouldTrigger) {
    saveState(sessionId, state);
    return { shouldInject: false };
  }
  const currentTopic = detectTopic(state.recentFiles);
  if (!currentTopic || state.injectedTopics.includes(currentTopic)) {
    saveState(sessionId, state);
    return { shouldInject: false };
  }
  const ltStore = new LongTermStore;
  const results = ltStore.search(currentTopic, 2);
  if (results.length === 0) {
    state.injectedTopics.push(currentTopic);
    saveState(sessionId, state);
    return { shouldInject: false };
  }
  const lines = [`**Relevant past context** (topic: ${currentTopic}):`];
  for (const r of results) {
    const date = new Date(r.created_at).toLocaleDateString();
    lines.push(`- [${date}] ${r.summary.slice(0, 400)}`);
    const files = safeJson4(r.files_touched, []);
    if (files.length > 0)
      lines.push(`  Files: ${files.slice(0, 3).join(", ")}`);
  }
  let context = lines.join(`
`);
  if (context.length > MAX_INJECTION_CHARS) {
    context = context.slice(0, MAX_INJECTION_CHARS) + `
[...truncated]`;
  }
  state.injectedTopics.push(currentTopic);
  state.lastInjectionAt = Date.now();
  saveState(sessionId, state);
  log9.info("proactive injection triggered", { sessionId, topic: currentTopic, results: results.length });
  return { shouldInject: true, additionalContext: context };
}
function cleanupProactiveState(sessionId) {
  const path = statePath(sessionId);
  try {
    if (existsSync7(path)) {
      const { unlinkSync: unlinkSync2 } = __require("fs");
      unlinkSync2(path);
    }
  } catch {}
}
function detectTopic(recentFiles) {
  if (recentFiles.length < 3)
    return null;
  const dirs = recentFiles.map((f) => f.split("/").slice(0, -1).join("/")).filter(Boolean);
  const dirCounts = new Map;
  for (const d of dirs) {
    const parts = d.split("/").filter(Boolean);
    const leaf = parts[parts.length - 1];
    if (leaf && leaf !== "src" && leaf !== "lib" && leaf !== "utils") {
      dirCounts.set(leaf, (dirCounts.get(leaf) ?? 0) + 1);
    }
  }
  let bestTopic = null;
  let bestCount = 0;
  for (const [topic, count] of dirCounts) {
    if (count > bestCount) {
      bestTopic = topic;
      bestCount = count;
    }
  }
  const fileNames = recentFiles.map((f) => f.split("/").pop() ?? "").filter(Boolean);
  const keywords = ["auth", "payment", "user", "api", "database", "config", "test", "migration", "deploy", "search"];
  for (const kw of keywords) {
    const matches = fileNames.filter((f) => f.toLowerCase().includes(kw));
    if (matches.length >= 2)
      return kw;
  }
  return bestTopic;
}
function statePath(sessionId) {
  return join7(PROACTIVE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}
function loadState(sessionId) {
  const path = statePath(sessionId);
  try {
    if (existsSync7(path)) {
      return JSON.parse(readFileSync4(path, "utf-8"));
    }
  } catch {}
  return { toolCallCount: 0, lastInjectionAt: 0, injectedTopics: [], recentFiles: [] };
}
function saveState(sessionId, state) {
  try {
    if (!existsSync7(PROACTIVE_DIR)) {
      mkdirSync4(PROACTIVE_DIR, { recursive: true, mode: 448 });
    }
    writeFileSync2(statePath(sessionId), JSON.stringify(state), "utf-8");
  } catch {}
}
function extractFilePath(toolName, toolInput) {
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const fp = toolInput.file_path;
    return typeof fp === "string" ? fp : undefined;
  }
  return;
}
function safeJson4(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// src/hooks-entry/post-tool-use.ts
async function main() {
  if (process.env["CLAUDE_MEMORY_HUB_SKIP_HOOKS"] === "1")
    return;
  const raw = await Bun.stdin.text();
  if (!raw.trim())
    return;
  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return;
  }
  const project = projectFromCwd(process.env["CLAUDE_CWD"] ?? process.cwd());
  if (isBatchEnabled()) {
    try {
      const entities = extractEntities(hook);
      const resources = [];
      if (hook.tool_name === "Skill") {
        const skill = typeof hook.tool_input?.skill === "string" ? hook.tool_input.skill : undefined;
        if (skill)
          resources.push({ type: "skill", name: skill });
      }
      if (hook.tool_name === "Agent") {
        const agent = typeof hook.tool_input?.subagent_type === "string" ? hook.tool_input.subagent_type : undefined;
        if (agent)
          resources.push({ type: "agent", name: agent });
      }
      if (hook.tool_name.startsWith("mcp__")) {
        resources.push({ type: "mcp_tool", name: hook.tool_name });
      }
      enqueueEvent({
        session: { id: hook.session_id, project, started_at: Date.now() },
        entities,
        resources: resources.length > 0 ? resources : undefined,
        timestamp: Date.now()
      });
      tryFlush();
    } catch {
      await handlePostToolUse(hook, project);
    }
  } else {
    await handlePostToolUse(hook, project);
  }
  try {
    const result = evaluateProactiveInjection(hook.session_id, hook.tool_name, hook.tool_input ?? {}, hook.tool_response ?? {});
    if (result.shouldInject && result.additionalContext) {
      process.stdout.write(JSON.stringify({ additionalContext: result.additionalContext }) + `
`);
    }
  } catch {}
}
main().catch(() => {}).finally(() => process.exit(0));

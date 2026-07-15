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
  const override = process.env["CLAUDE_MEMORY_HUB_DB"];
  if (override)
    return override;
  if (process.env["NODE_ENV"] === "test") {
    const { tmpdir } = __require("os");
    return join2(tmpdir(), `cmh-test-${process.pid}.db`);
  }
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
  const KNOWN_FTS = new Set(["fts_memories", "fts_messages", "fts_curated"]);
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
  try {
    healFtsCurated(db);
  } catch (e) {
    log.warn("fts_curated heal skipped", { error: String(e) });
  }
}
function healFtsCurated(db) {
  const count = (name, type) => db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type = ? AND name = ?").get(type, name)?.n ?? 0;
  if (!count("curated_notes", "table"))
    return;
  if (count("fts_curated", "table"))
    return;
  if (!count("fts_curated_insert", "trigger"))
    return;
  log.warn("fts_curated missing but triggers exist \u2014 rebuilding from curated_notes");
  db.run(`
    CREATE VIRTUAL TABLE fts_curated USING fts5(
      path UNINDEXED,
      project UNINDEXED,
      title,
      content,
      tokenize = 'porter unicode61'
    )
  `);
  db.run(`
    INSERT INTO fts_curated(rowid, path, project, title, content)
      SELECT id, path, project, title, content FROM curated_notes
  `);
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
          DELETE FROM fts_messages WHERE rowid = old.id;
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
  if (currentVersion < 7) {
    log.info("Applying migration v7: injection_log table for telemetry");
    db.run(`
      CREATE TABLE IF NOT EXISTS injection_log (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id              TEXT NOT NULL,
        project                 TEXT NOT NULL,
        intent                  TEXT,
        language                TEXT,
        prompt_length           INTEGER NOT NULL DEFAULT 0,
        smart_match_count       INTEGER NOT NULL DEFAULT 0,
        smart_match_top_score   REAL    NOT NULL DEFAULT 0,
        memory_section_chars    INTEGER NOT NULL DEFAULT 0,
        claude_md_chars         INTEGER NOT NULL DEFAULT 0,
        recent_convo_chars      INTEGER NOT NULL DEFAULT 0,
        awareness_hint_chars    INTEGER NOT NULL DEFAULT 0,
        total_injection_chars   INTEGER NOT NULL DEFAULT 0,
        history_intent_matched  INTEGER NOT NULL DEFAULT 0,
        timestamp               INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_injection_log_session ON injection_log(session_id, timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_injection_log_project ON injection_log(project, timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_injection_log_intent  ON injection_log(intent, timestamp)`);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (7, ?)", [Date.now()]);
    log.info("Migration v7 complete");
  }
  if (currentVersion < 8) {
    log.info("Applying migration v8: entity dedup + touch_count, injection source tracking");
    db.transaction(() => {
      db.run(`DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE project = 'p' OR id LIKE 'compact-test-%' OR id LIKE 'test-%')`);
      db.run(`DELETE FROM long_term_summaries WHERE session_id IN (SELECT id FROM sessions WHERE project = 'p' OR id LIKE 'compact-test-%' OR id LIKE 'test-%')`);
      db.run(`DELETE FROM sessions WHERE project = 'p' OR id LIKE 'compact-test-%' OR id LIKE 'test-%'`);
      try {
        db.run("ALTER TABLE entities ADD COLUMN touch_count INTEGER NOT NULL DEFAULT 1");
      } catch {}
      db.run(`
        CREATE TEMP TABLE entity_dedup AS
          SELECT MIN(id) AS keep_id, COUNT(*) AS c, MAX(importance) AS max_imp, MAX(created_at) AS last_seen
          FROM entities GROUP BY session_id, entity_type, entity_value
      `);
      db.run(`
        UPDATE entities SET
          touch_count = (SELECT c FROM entity_dedup WHERE keep_id = entities.id),
          importance  = (SELECT max_imp FROM entity_dedup WHERE keep_id = entities.id),
          created_at  = (SELECT last_seen FROM entity_dedup WHERE keep_id = entities.id)
        WHERE id IN (SELECT keep_id FROM entity_dedup WHERE c > 1)
      `);
      db.run(`DELETE FROM entities WHERE id NOT IN (SELECT keep_id FROM entity_dedup)`);
      db.run(`DROP TABLE entity_dedup`);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_dedup ON entities(session_id, entity_type, entity_value)`);
      try {
        db.run("ALTER TABLE injection_log ADD COLUMN injected_at TEXT NOT NULL DEFAULT 'prompt'");
      } catch {}
      try {
        db.run("ALTER TABLE injection_log ADD COLUMN dedup_skipped INTEGER NOT NULL DEFAULT 0");
      } catch {}
    })();
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (8, ?)", [Date.now()]);
    log.info("Migration v8 complete");
  }
  if (currentVersion < 9) {
    log.info("Applying migration v9: graph_edges for entity/code graph");
    db.run(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project    TEXT NOT NULL,
        src_type   TEXT NOT NULL CHECK(src_type IN ('file','error','decision','session')),
        src_key    TEXT NOT NULL,
        dst_type   TEXT NOT NULL CHECK(dst_type IN ('file','error','decision','session')),
        dst_key    TEXT NOT NULL,
        rel        TEXT NOT NULL CHECK(rel IN ('co_edited','error_in','decided_about','session_touched','imports')),
        weight     REAL NOT NULL DEFAULT 1,
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        UNIQUE(project, src_type, src_key, dst_type, dst_key, rel)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_graph_src ON graph_edges(project, src_key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_graph_dst ON graph_edges(project, dst_key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_graph_rel ON graph_edges(rel)`);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (9, ?)", [Date.now()]);
    log.info("Migration v9 complete");
  }
  if (currentVersion < 10) {
    log.info("Applying migration v10: injection effectiveness feedback");
    try {
      db.run("ALTER TABLE injection_log ADD COLUMN memory_tool_used INTEGER NOT NULL DEFAULT 0");
    } catch {}
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (10, ?)", [Date.now()]);
    log.info("Migration v10 complete");
  }
  if (currentVersion < 11) {
    log.info("Applying migration v11: fix fts_messages delete trigger");
    db.run("DROP TRIGGER IF EXISTS fts_messages_delete");
    db.run(`
      CREATE TRIGGER fts_messages_delete
        AFTER DELETE ON messages BEGIN
          DELETE FROM fts_messages WHERE rowid = old.id;
        END
    `);
    try {
      db.run("INSERT INTO fts_messages(fts_messages) VALUES('rebuild')");
    } catch {}
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (11, ?)", [Date.now()]);
    log.info("Migration v11 complete");
  }
  if (currentVersion < 12) {
    log.info("Applying migration v12: curated_notes (Obsidian read-back)");
    db.transaction(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS curated_notes (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          path         TEXT NOT NULL UNIQUE,
          project      TEXT,
          title        TEXT NOT NULL,
          content      TEXT NOT NULL,
          origin       TEXT NOT NULL CHECK(origin IN ('user','edited')),
          mtime        INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          indexed_at   INTEGER NOT NULL
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_curated_project ON curated_notes(project)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_curated_mtime   ON curated_notes(mtime DESC)`);
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_curated USING fts5(
          path UNINDEXED,
          project UNINDEXED,
          title,
          content,
          tokenize = 'porter unicode61'
        )
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS fts_curated_insert
          AFTER INSERT ON curated_notes BEGIN
            INSERT INTO fts_curated(rowid, path, project, title, content)
            VALUES (new.id, new.path, new.project, new.title, new.content);
          END
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS fts_curated_update
          AFTER UPDATE ON curated_notes BEGIN
            DELETE FROM fts_curated WHERE rowid = old.id;
            INSERT INTO fts_curated(rowid, path, project, title, content)
            VALUES (new.id, new.path, new.project, new.title, new.content);
          END
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS fts_curated_delete
          AFTER DELETE ON curated_notes BEGIN
            DELETE FROM fts_curated WHERE rowid = old.id;
          END
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS embeddings_v12 (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_type   TEXT NOT NULL CHECK(doc_type IN ('summary','entity','note','resource','curated')),
          doc_id     INTEGER NOT NULL,
          model      TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
          vector     BLOB NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      db.run(`INSERT INTO embeddings_v12 SELECT * FROM embeddings`);
      db.run(`DROP TABLE embeddings`);
      db.run(`ALTER TABLE embeddings_v12 RENAME TO embeddings`);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_doc ON embeddings(doc_type, doc_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)`);
    })();
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (12, ?)", [Date.now()]);
    log.info("Migration v12 complete");
  }
  if (currentVersion < 13) {
    log.info("Applying migration v13: curated_chars telemetry column");
    try {
      db.run("ALTER TABLE injection_log ADD COLUMN curated_chars INTEGER NOT NULL DEFAULT 0");
    } catch {}
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (13, ?)", [Date.now()]);
    log.info("Migration v13 complete");
  }
  if (currentVersion < 14) {
    log.info("Applying migration v14: summary tier column");
    try {
      db.run("ALTER TABLE long_term_summaries ADD COLUMN tier TEXT NOT NULL DEFAULT 'unknown'");
    } catch {}
    db.run(`UPDATE long_term_summaries SET tier = 'compact'
            WHERE tier = 'unknown' AND (summary LIKE '%Primary Request%' OR summary LIKE '<summary>%')`);
    db.run(`UPDATE long_term_summaries SET tier = 'rule-based'
            WHERE tier = 'unknown' AND (summary LIKE 'Task:%' OR summary LIKE 'Session in project%')`);
    db.run(`UPDATE long_term_summaries SET tier = 'cli' WHERE tier = 'unknown'`);
    db.run("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (14, ?)", [Date.now()]);
    log.info("Migration v14 complete");
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, entity_type, entity_value) DO UPDATE SET
         touch_count = touch_count + 1,
         created_at  = excluded.created_at,
         importance  = MAX(entities.importance, excluded.importance),
         context     = COALESCE(excluded.context, entities.context)`, [
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
      const live = this.db.query(`SELECT id FROM messages
           WHERE session_id = ? AND role = ? AND uuid IS NULL
             AND substr(content, 1, 200) = substr(?, 1, 200)
           ORDER BY id ASC LIMIT 1`).get(msg.session_id, msg.role, msg.content);
      if (live) {
        this.db.run("UPDATE messages SET uuid = ?, parent_uuid = ? WHERE id = ?", [msg.uuid, msg.parent_uuid ?? null, live.id]);
        return -1;
      }
    } else {
      const recent = this.db.query(`SELECT COUNT(*) c FROM messages
           WHERE session_id = ? AND role = ? AND content = ? AND timestamp > ?`).get(msg.session_id, msg.role, msg.content, msg.timestamp - 120000);
      if (recent && recent.c > 0)
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
var init_session_store = __esm(() => {
  init_schema();
});

// src/db/long-term-store.ts
class LongTermStore {
  db;
  constructor(db) {
    this.db = db ?? getDatabase();
  }
  upsertSummary(summary) {
    this.db.run(`INSERT INTO long_term_summaries(session_id, project, summary, files_touched, decisions, errors_fixed, token_savings, created_at, tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         summary       = excluded.summary,
         files_touched = excluded.files_touched,
         decisions     = excluded.decisions,
         errors_fixed  = excluded.errors_fixed,
         token_savings = excluded.token_savings,
         tier          = excluded.tier`, [
      summary.session_id,
      summary.project,
      summary.summary,
      summary.files_touched,
      summary.decisions,
      summary.errors_fixed,
      summary.token_savings,
      summary.created_at,
      summary.tier ?? "unknown"
    ]);
  }
  getRuleBasedSummaries(days, limit) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.db.query("SELECT * FROM long_term_summaries WHERE tier = 'rule-based' AND created_at > ? ORDER BY created_at DESC LIMIT ?").all(cutoff, limit);
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
      const candidates = this.db.query(`SELECT lts.session_id, lts.project, lts.summary,
                  lts.files_touched, lts.decisions, lts.errors_fixed,
                  lts.created_at, rank
           FROM fts_memories
           JOIN long_term_summaries lts ON lts.id = fts_memories.rowid
           WHERE fts_memories MATCH ?
           ORDER BY rank
           LIMIT ?`).all(safeQuery, Math.max(limit * 3, 9));
      return candidates.map((r) => ({ ...r, rank: (r.rank ?? 0) * recencyBoost(r.created_at) })).sort((a, b) => a.rank - b.rank).slice(0, limit);
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
function recencyBoost(createdAt) {
  const ageDays = (Date.now() - createdAt) / 86400000;
  if (ageDays < 7)
    return 1.5;
  if (ageDays < 30)
    return 1.2;
  if (ageDays < 90)
    return 1;
  return 0.8;
}
function sanitizeFtsQuery(query) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/["*^()]/g, "")).filter((w) => w.length > 1);
  if (words.length === 0)
    return "";
  const head = words.slice(0, -1).map((w) => `"${w}"`);
  const last = words[words.length - 1];
  return [...head, `"${last}"*`].join(" ");
}
var init_long_term_store = __esm(() => {
  init_schema();
});

// src/capture/context-enricher.ts
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
var CONTEXT_MAX_LENGTH = 500;

// src/capture/error-detector.ts
function detectToolError(toolName, toolInput, toolResponse) {
  if (typeof toolResponse === "string") {
    const text = toolResponse.trim();
    if (/^Error/i.test(text) || text.includes("tool_use_error")) {
      const firstLine = text.replace(/<\/?tool_use_error>/g, "").split(`
`)[0] ?? text;
      return {
        value: `${toolName} failed: ${firstLine.slice(0, 140)}`,
        context: text.slice(0, 500),
        importance: 3
      };
    }
    return null;
  }
  if (!toolResponse || typeof toolResponse !== "object")
    return null;
  const r = toolResponse;
  const exitCode = typeof r["exit_code"] === "number" ? r["exit_code"] : typeof r["exitCode"] === "number" ? r["exitCode"] : undefined;
  const errField = typeof r["error"] === "string" && r["error"].length > 0 ? r["error"] : undefined;
  const isError = r["is_error"] === true || r["isError"] === true;
  const cmd = toolName === "Bash" && typeof toolInput?.["command"] === "string" ? toolInput["command"] : "";
  if (typeof exitCode === "number" && exitCode !== 0 || isError || errField) {
    const stderr = typeof r["stderr"] === "string" ? r["stderr"] : "";
    const stdout = typeof r["stdout"] === "string" ? r["stdout"] : "";
    const ctx = [errField, stderr, stdout].filter(Boolean).join(`
`).slice(0, 500);
    return {
      value: exitCode !== undefined ? `[exit ${exitCode}] ${(cmd || toolName).slice(0, 140)}` : `${toolName} failed: ${(errField ?? cmd ?? "").slice(0, 140)}`,
      context: ctx,
      importance: 4
    };
  }
  if (toolName === "Bash") {
    const stdout = typeof r["stdout"] === "string" ? r["stdout"] : "";
    const stderr = typeof r["stderr"] === "string" ? r["stderr"] : "";
    const combined = (stdout + `
` + stderr).slice(-2000);
    for (const p of BASH_ERROR_PATTERNS) {
      const match = combined.match(p.re);
      if (match?.index !== undefined) {
        const excerpt = excerptAround(combined, match.index);
        return {
          value: `[${p.label}] ${cmd.slice(0, 140)}`,
          context: excerpt,
          importance: p.importance
        };
      }
    }
  }
  return null;
}
function excerptAround(text, index) {
  const lineStart = text.lastIndexOf(`
`, index) + 1;
  const lines = text.slice(lineStart).split(`
`).slice(0, 3);
  return lines.join(`
`).slice(0, 400);
}
var BASH_ERROR_PATTERNS;
var init_error_detector = __esm(() => {
  BASH_ERROR_PATTERNS = [
    { re: /exited with code \d+/, label: "exit", importance: 4 },
    { re: /Traceback \(most recent call last\)/, label: "python", importance: 4 },
    { re: /npm ERR!/, label: "npm", importance: 4 },
    { re: /(?:^|\n)fatal: /, label: "git", importance: 4 },
    { re: /command not found/, label: "not-found", importance: 3 },
    { re: /error TS\d+/, label: "tsc", importance: 3 },
    { re: /(?:^|\n)\s*(?:error|ERROR)[: ]/, label: "error", importance: 3 },
    { re: /Build failed|Compilation failed|FAILED \(|Tests? failed/i, label: "build", importance: 3 }
  ];
});

// src/capture/privacy-filter.ts
function stripPrivateTags(text) {
  return text.replace(PRIVATE_TAG_RE, "[REDACTED]");
}
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
  const pathBasename = path.split(/[\\/]/).pop() || "";
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
var log2, DEFAULT_PRIVACY_CONFIG, PRIVATE_TAG_RE, SECRET_PATTERNS, compiledCustomCache;
var init_privacy_filter = __esm(() => {
  init_logger();
  log2 = createLogger("privacy-filter");
  DEFAULT_PRIVACY_CONFIG = {
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
  PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;
  SECRET_PATTERNS = [
    /(?:api[_-]?key|api[_-]?secret|access[_-]?key)\s*[:=]\s*['"]?[\w\-./+]{8,}['"]?/gi,
    /(?:sk-|pk_|pk-|ghp_|gho_|ghr_|ghs_|ghv_|xox[bsrap]-|hf_|glpat-)[\w\-]{20,}/g,
    /Bearer\s+[\w\-./+=]{20,}/g,
    /(?:password|passwd|secret|token|credential)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
    /(?:secret|token|key|password|auth)\s*[:=]\s*['"]?[a-f0-9]{32,}['"]?/gi
  ];
  compiledCustomCache = new Map;
});

// src/capture/observation-extractor.ts
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
var TOOL_OUTPUT_HEURISTICS, PROMPT_HEURISTICS, MAX_VALUE_LENGTH = 500, MIN_INPUT_LENGTH = 20;
var init_observation_extractor = __esm(() => {
  init_privacy_filter();
  TOOL_OUTPUT_HEURISTICS = [
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
  PROMPT_HEURISTICS = [
    { pattern: /\b(IMPORTANT|CRITICAL|MUST)\b/i, importance: 4, label: "user-important" },
    { pattern: /\b(remember that|note that|I decided|we should|keep in mind)\b/i, importance: 3, label: "user-note" },
    { pattern: /\b(don't|do not|never|avoid|stop)\b/i, importance: 3, label: "user-constraint" },
    { pattern: /\b(fix|debug|investigate|analyze|resolve)\b/i, importance: 2, label: "user-task" },
    { pattern: /\b(prefer|always use|convention is|pattern is)\b/i, importance: 2, label: "user-preference" },
    { pattern: /\b(implement|build|create|add feature|integrate)\b/i, importance: 2, label: "user-feature" }
  ];
});

// src/capture/entity-extractor.ts
function extractEntities(hook, promptNumber = 0) {
  const { tool_name, tool_input, tool_response, session_id } = hook;
  const project = deriveProject(hook);
  const now = Date.now();
  const raw = [];
  const privacyConfig = loadPrivacyConfig();
  const toolError = detectToolError(tool_name, tool_input, tool_response);
  if (toolError) {
    raw.push(makeEntity(session_id, project, tool_name, "error", toolError.value, toolError.importance, now, promptNumber, toolError.context || undefined));
  }
  switch (tool_name) {
    case "Read": {
      const path = stringField2(tool_input, "file_path");
      if (path && !toolError && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_read", path, 1, now, promptNumber));
      }
      break;
    }
    case "Write": {
      const path = stringField2(tool_input, "file_path");
      if (path && !toolError && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_created", path, 4, now, promptNumber));
      }
      break;
    }
    case "Edit":
    case "MultiEdit": {
      const path = stringField2(tool_input, "file_path");
      if (path && !toolError && !isIgnoredPath(path, privacyConfig)) {
        raw.push(makeEntity(session_id, project, tool_name, "file_modified", path, 4, now, promptNumber));
      }
      break;
    }
    case "Bash": {
      const cmd = stringField2(tool_input, "command") ?? "";
      const writtenFile = extractFileFromBashCmd(cmd);
      if (writtenFile && !toolError) {
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
      raw.push(makeEntity(session_id, project, tool_name, "observation", `agent:${subagentType}: ${prompt.slice(0, 200)}`, 3, now, promptNumber, agentResult || undefined));
      break;
    }
    case "Skill": {
      const skillName = stringField2(tool_input, "skill") ?? "unknown";
      const args = stringField2(tool_input, "args") ?? "";
      const skillResult = extractAgentResult(tool_response);
      raw.push(makeEntity(session_id, project, tool_name, "observation", `skill:${skillName} ${args.slice(0, 120)}`.trim(), 2, now, promptNumber, skillResult || undefined));
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
  if (typeof response !== "object" || response === null)
    return;
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
var init_entity_extractor = __esm(() => {
  init_error_detector();
  init_observation_extractor();
  init_privacy_filter();
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
import { existsSync as existsSync3, readdirSync, statSync, readFileSync } from "fs";
import { join as join3, basename, relative } from "path";
import { homedir as homedir3 } from "os";

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
function getResourceRegistry() {
  if (!_instance)
    _instance = new ResourceRegistry;
  return _instance;
}
var log3, CHARS_PER_TOKEN = 3.75, SCAN_TTL_MS, SAFE_NAME_RE, SAFE_COMMAND_NAME_RE, MAX_DIR_WALK_DEPTH = 5, _instance;
var init_resource_registry = __esm(() => {
  init_logger();
  init_resource_tracker();
  log3 = createLogger("resource-registry");
  SCAN_TTL_MS = 5 * 60 * 1000;
  SAFE_NAME_RE = /^[a-zA-Z0-9_\-:.]+$/;
  SAFE_COMMAND_NAME_RE = /^[a-zA-Z0-9_\-:.\/]+$/;
});

// src/context/smart-resource-loader.ts
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
var DEFAULT_TOKEN_BUDGET = 30000;
var init_smart_resource_loader = __esm(() => {
  init_resource_tracker();
  init_long_term_store();
  init_resource_registry();
});

// src/context/injection-validator.ts
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
var log4, MAX_CHARS = 8000;
var init_injection_validator = __esm(() => {
  init_logger();
  log4 = createLogger("injection-validator");
});

// src/context/claude-md-tracker.ts
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4, dirname, basename as basename2 } from "path";

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
var log5, MAX_WALK_DEPTH = 20, CHARS_PER_TOKEN2 = 3.75, STALE_THRESHOLD_MS;
var init_claude_md_tracker = __esm(() => {
  init_schema();
  init_logger();
  log5 = createLogger("claude-md-tracker");
  STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
});

// src/context/prompt-analyzer.ts
import { existsSync as existsSync5, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join5 } from "path";
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
var INTENT_PATTERNS, VIETNAMESE_RE, STOP_WORDS, CWD_CACHE, CWD_TTL_MS = 60000;
var init_prompt_analyzer = __esm(() => {
  INTENT_PATTERNS = [
    { intent: "debug", re: /\b(bug|error|crash|fail|broken|not work|fix|debug|exception|stack ?trace|loi|s\u1EEDa|sua|hong|loi)\b/i },
    { intent: "design", re: /\b(design|ui|ux|layout|figma|component|wireframe|mockup|style|color|theme|thiet ke|thi\u1EBFt k\u1EBF)\b/i },
    { intent: "refactor", re: /\b(refactor|clean ?up|simplify|reorganize|rename|extract|inline|optimize|tach|toi uu|t\u1ED1i \u01B0u)\b/i },
    { intent: "implement", re: /\b(add|create|build|implement|write|tao|t\u1EA1o|viet|vi\u1EBFt|code|l\u00E0m|lam|trien khai|tri\u1EC3n khai)\b/i },
    { intent: "question", re: /\b(how|what|why|when|where|which|l\u00E0m sao|t\u1EA1i sao|l\u00E0 g\u00EC|la gi|lam sao|tai sao)\b|\?/i }
  ];
  VIETNAMESE_RE = /[\u0103\u00E2\u0111\u00EA\u00F4\u01A1\u01B0]|[\u00E1\u00E0\u1EA3\u00E3\u1EA1]|[\u00E9\u00E8\u1EBB\u1EBD\u1EB9]|[\u00ED\u00EC\u1EC9\u0129\u1ECB]|[\u00F3\u00F2\u1ECF\u00F5\u1ECD]|[\u00FA\u00F9\u1EE7\u0169\u1EE5]|[\u00FD\u1EF3\u1EF7\u1EF9\u1EF5]|[\u00C0-\u1EF9]/i;
  STOP_WORDS = new Set([
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
  CWD_CACHE = new Map;
});

// src/search/embedding-model.ts
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
var log6, MODEL_NAME = "Xenova/all-MiniLM-L6-v2", EMBEDDING_DIM = 384, embeddingModel;
var init_embedding_model = __esm(() => {
  init_logger();
  log6 = createLogger("embedding-model");
  embeddingModel = new EmbeddingModel;
});

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
var init_resource_embedding_search = __esm(() => {
  init_schema();
  init_embedding_model();
});

// src/context/resource-matcher.ts
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
var log7, CONTEXT_BOOSTS, KIND_ORDER;
var init_resource_matcher = __esm(() => {
  init_resource_embedding_search();
  init_resource_tracker();
  init_resource_registry();
  init_logger();
  log7 = createLogger("resource-matcher");
  CONTEXT_BOOSTS = [
    { when: (s) => s.has_swift, names: ["ios-developer", "swift", "swiftui"] },
    { when: (s) => s.has_kotlin, names: ["android-developer", "kotlin", "compose"] },
    { when: (s) => s.has_react_native, names: ["react-native-developer", "expo"] },
    { when: (s) => s.has_flutter, names: ["flutter-developer", "dart", "riverpod"] },
    { when: (s) => s.has_typescript, names: ["web-developer", "react", "nextjs", "frontend"] },
    { when: (s) => s.has_python, names: ["python", "fastapi", "django"] },
    { when: (s) => s.has_figma, names: ["figma-ui-mcp", "ui-ux-pro-max", "ui-ux-designer"] },
    { when: (s) => s.is_mobile, names: ["mobile-development", "mobile-development-skill"] }
  ];
  KIND_ORDER = {
    skill: 0,
    agent: 1,
    command: 2,
    workflow: 3,
    claude_md: 4
  };
});

// src/context/history-intent.ts
function hasHistoryCue(prompt) {
  const lower = prompt.toLowerCase();
  return TEMPORAL_CUES.some((cue) => lower.includes(cue));
}
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
  if (!hasHistoryCue(prompt))
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
var HISTORY_EXEMPLARS, SIMILARITY_THRESHOLD = 0.55, TEMPORAL_CUES, cachedExemplarVectors = null, cachedExemplarsLoading = null;
var init_history_intent = __esm(() => {
  init_embedding_model();
  HISTORY_EXEMPLARS = [
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
  TEMPORAL_CUES = [
    "l\u1EA7n tr\u01B0\u1EDBc",
    "phi\xEAn tr\u01B0\u1EDBc",
    "bu\u1ED5i tr\u01B0\u1EDBc",
    "tr\u01B0\u1EDBc \u0111\xF3",
    "tr\u01B0\u1EDBc \u0111\xE2y",
    "g\u1EA7n nh\u1EA5t",
    "v\u1EEBa r\u1ED3i",
    "v\u1EEBa n\xE3y",
    "l\xFAc n\xE3y",
    "h\xF4m qua",
    "h\xF4m tr\u01B0\u1EDBc",
    "tu\u1EA7n tr\u01B0\u1EDBc",
    "l\u1ECBch s\u1EED",
    "\u0111\xE3 l\xE0m g\xEC",
    "phi\xEAn c\u0169",
    "\u0111\u1EE3t tr\u01B0\u1EDBc",
    "khi n\xE3y",
    "previous",
    "last time",
    "last message",
    "last session",
    "earlier",
    "did before",
    "history",
    "recently",
    "yesterday",
    "what did we",
    "worked on",
    "we discussed",
    "last chat"
  ];
});

// src/context/conversation-injector.ts
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
var MAX_MESSAGES_PER_SECTION = 6, PER_MESSAGE_PREVIEW_CHARS = 240;
var init_conversation_injector = __esm(() => {
  init_session_store();
  init_schema();
});

// src/context/awareness-hint.ts
function buildAwarenessHint(options) {
  if (options.isCommandInvocation)
    return "";
  const db = options.db ?? getDatabase();
  const stats = collectStats(db, options.project);
  if (stats.summaries === 0 && stats.messages === 0)
    return "";
  if (options.hasMemoryInjected || options.hasRecentConvoInjected) {
    return shortHint(stats);
  }
  return fullHint(stats);
}
function shortHint(s) {
  return [
    "**\uD83E\uDDE0 Memory hub:** " + `${s.summaries} sessions, ${s.messages} messages stored. ` + "Call `memory_search` or `memory_conversation` for more."
  ].join(`
`);
}
function fullHint(s) {
  const lines = [
    "**\uD83E\uDDE0 Memory hub active**",
    `_Stored: ${s.summaries} summaries, ${s.messages} messages, ${s.resources} indexed resources` + (s.project_summaries > 0 ? ` (${s.project_summaries} for current project)._` : `._`),
    "_Before answering questions about prior work, files, decisions, or chat history, " + "call one of:_",
    "  - `memory_recall` \u2014 search summaries by keyword",
    "  - `memory_search` \u2014 3-layer progressive search (use for technical terms)",
    "  - `memory_conversation` \u2014 retrieve raw user/assistant messages",
    "  - `memory_resources_for_prompt` \u2014 find best skill/agent for the task",
    `_Do not say "I don't have access to previous chats" \u2014 query first._`
  ];
  return lines.join(`
`);
}
function collectStats(db, project) {
  const summaries = db.query("SELECT COUNT(*) n FROM long_term_summaries").get()?.n ?? 0;
  const messages = db.query("SELECT COUNT(*) n FROM messages").get()?.n ?? 0;
  const resources = db.query("SELECT COUNT(*) n FROM resource_descriptions").get()?.n ?? 0;
  const projectSummaries = db.query("SELECT COUNT(*) n FROM long_term_summaries WHERE project = ?").get(project)?.n ?? 0;
  return {
    summaries,
    messages,
    resources,
    project_summaries: projectSummaries
  };
}
var init_awareness_hint = __esm(() => {
  init_schema();
});

// src/db/injection-telemetry.ts
function logInjection(entry, db) {
  if (process.env["CLAUDE_MEMORY_HUB_TELEMETRY"] === "disabled")
    return;
  try {
    const d = db ?? getDatabase();
    d.run(`INSERT INTO injection_log(
         session_id, project, intent, language,
         prompt_length,
         smart_match_count, smart_match_top_score,
         memory_section_chars, claude_md_chars,
         recent_convo_chars, awareness_hint_chars,
         total_injection_chars,
         history_intent_matched, injected_at, dedup_skipped, curated_chars, timestamp
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      entry.session_id,
      entry.project,
      entry.intent,
      entry.language,
      entry.prompt_length,
      entry.smart_match_count,
      entry.smart_match_top_score,
      entry.memory_section_chars,
      entry.claude_md_chars,
      entry.recent_convo_chars,
      entry.awareness_hint_chars,
      entry.total_injection_chars,
      entry.history_intent_matched ? 1 : 0,
      entry.injected_at ?? "prompt",
      entry.dedup_skipped ?? 0,
      entry.curated_chars ?? 0,
      Date.now()
    ]);
  } catch (err) {
    log8.warn("logInjection failed", { error: String(err) });
  }
}
function pruneInjectionLog(olderThanDays = 90, db) {
  const d = db ?? getDatabase();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const result = d.run(`DELETE FROM injection_log WHERE timestamp < ?`, [cutoff]);
  return result.changes;
}
var log8;
var init_injection_telemetry = __esm(() => {
  init_schema();
  init_logger();
  log8 = createLogger("injection-telemetry");
});

// src/capture/smart-truncate.ts
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
function capForRole(role) {
  return ROLE_CAPS[role];
}
function isSyntheticUserMessage(content) {
  const head = content.trimStart();
  return head.startsWith("[Request interrupted") || head.startsWith("Base directory for this skill:") || head.startsWith("<command-name>") || head.startsWith("<local-command-") || head.startsWith("<task-notification>");
}
var MIN_USEFUL_RATIO = 0.8, MARKER = `
[truncated]`, ROLE_CAPS;
var init_smart_truncate = __esm(() => {
  ROLE_CAPS = {
    user: 4000,
    assistant: 4000
  };
});

// src/context/injection-state.ts
import { existsSync as existsSync6, readFileSync as readFileSync3, writeFileSync, mkdirSync as mkdirSync3, unlinkSync } from "fs";
import { join as join6 } from "path";
import { homedir as homedir5 } from "os";
function statePath(sessionId) {
  return join6(STATE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}-inject.json`);
}
function loadInjectionState(sessionId) {
  try {
    const path = statePath(sessionId);
    if (existsSync6(path)) {
      const parsed = JSON.parse(readFileSync3(path, "utf-8"));
      return {
        baselineInjected: parsed.baselineInjected === true,
        injectedSummaryIds: Array.isArray(parsed.injectedSummaryIds) ? parsed.injectedSummaryIds : [],
        injectedCuratedIds: Array.isArray(parsed.injectedCuratedIds) ? parsed.injectedCuratedIds : []
      };
    }
  } catch {}
  return { baselineInjected: false, injectedSummaryIds: [], injectedCuratedIds: [] };
}
function saveInjectionState(sessionId, state) {
  try {
    if (!existsSync6(STATE_DIR)) {
      mkdirSync3(STATE_DIR, { recursive: true, mode: 448 });
    }
    writeFileSync(statePath(sessionId), JSON.stringify(state), "utf-8");
  } catch {}
}
function cleanupInjectionState(sessionId) {
  try {
    const path = statePath(sessionId);
    if (existsSync6(path))
      unlinkSync(path);
  } catch {}
}
var STATE_DIR;
var init_injection_state = __esm(() => {
  STATE_DIR = join6(homedir5(), ".claude-memory-hub", "proactive");
});

// src/context/curated-injector.ts
function getCuratedBaseline(project, limit = 3, db) {
  const d = db ?? getDatabase();
  try {
    return d.query(`SELECT id, path, project, title, content, origin, mtime FROM curated_notes
       WHERE project = ?1 OR project IS NULL
       ORDER BY (project = ?1) DESC, mtime DESC
       LIMIT ?2`).all(project, limit);
  } catch {
    return [];
  }
}
function searchCuratedNotes(prompt, project, limit = 2, db) {
  const d = db ?? getDatabase();
  const query = toFtsQuery(prompt);
  if (!query)
    return [];
  try {
    return d.query(`SELECT cn.id, cn.path, cn.project, cn.title, cn.content, cn.origin, cn.mtime
       FROM fts_curated
       JOIN curated_notes cn ON cn.id = fts_curated.rowid
       WHERE fts_curated MATCH ?1 AND (cn.project = ?2 OR cn.project IS NULL)
       ORDER BY rank
       LIMIT ?3`).all(query, project, limit);
  } catch {
    return [];
  }
}
function buildCuratedSection(notes) {
  if (notes.length === 0)
    return "";
  const lines = ["**Curated notes (user-maintained, Obsidian vault \u2014 treat as authoritative):**"];
  for (const n of notes) {
    const scope = n.project ? n.project : "global";
    const flat = n.content.replace(/\s+/g, " ").trim();
    let body = flat;
    if (flat.length > NOTE_INJECT_CHARS) {
      const cut = flat.slice(0, NOTE_INJECT_CHARS);
      body = cut.slice(0, Math.max(cut.lastIndexOf(" "), NOTE_INJECT_CHARS - 80)) + " \u2026";
    }
    lines.push(`- [${scope}] ${n.title}: ${body}`);
  }
  return lines.join(`
`);
}
function toFtsQuery(text) {
  const words = text.trim().split(/\s+/).map((w) => w.replace(/["*^():{}[\]]/g, "").trim()).filter((w) => w.length > 1).slice(0, 12);
  if (words.length === 0)
    return "";
  return words.map((w) => `"${w}"`).join(" OR ");
}
var NOTE_INJECT_CHARS = 700;
var init_curated_injector = __esm(() => {
  init_schema();
});

// src/capture/hook-handler.ts
import { basename as basename3 } from "path";
function stripIdeTags(prompt) {
  return prompt.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/g, "").trim();
}
async function handlePostToolUse(hook, project) {
  const store = new SessionStore;
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    status: "active"
  });
  const promptNum = Math.max(0, store.getMessageCount(hook.session_id, "user") - 1);
  const entities = extractEntities(hook, promptNum);
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
function markMemoryToolUsed(sessionId) {
  try {
    getDatabase().run(`UPDATE injection_log SET memory_tool_used = 1
       WHERE id = (SELECT id FROM injection_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1)`, [sessionId]);
  } catch {}
}
async function handleUserPromptSubmit(hook, project) {
  const store = new SessionStore;
  const ltStore = new LongTermStore;
  const privacyConfig = loadPrivacyConfig();
  const cleanPrompt = sanitize(stripIdeTags(hook.prompt), privacyConfig);
  const sessionPrompt = cleanPrompt && !isSyntheticUserMessage(cleanPrompt) ? cleanPrompt.slice(0, 500) : undefined;
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    ...sessionPrompt ? { user_prompt: sessionPrompt } : {},
    status: "active"
  });
  const promptText = cleanPrompt || hook.prompt;
  const promptNum = store.getMessageCount(hook.session_id, "user");
  if (promptText.trim().length > 0 && !isSyntheticUserMessage(promptText)) {
    store.insertMessage({
      session_id: hook.session_id,
      project,
      role: "user",
      content: smartTruncate(promptText, capForRole("user")),
      prompt_number: promptNum,
      timestamp: Date.now()
    });
  }
  const promptObs = extractObservationFromPrompt(cleanPrompt || hook.prompt, hook.session_id, project, promptNum);
  if (promptObs)
    store.insertEntity({ ...promptObs, project });
  const state = loadInjectionState(hook.session_id);
  const baselineDone = state.baselineInjected;
  const promptAnalysis = analyzePrompt(hook.prompt ?? "", hook.cwd ?? "");
  let recentConvoSection = "";
  let historyIntentMatched = false;
  try {
    if ((hook.prompt?.length ?? 0) >= 6) {
      const intent = await detectHistoryIntent(hook.prompt ?? "");
      historyIntentMatched = intent.match;
      if (intent.match) {
        recentConvoSection = buildRecentConversationSection(hook.session_id, project);
      }
    }
  } catch {}
  let results = [];
  let memoryHint = "";
  let dedupSkipped = 0;
  if (!baselineDone || historyIntentMatched) {
    results = ltStore.search(hook.prompt, 3);
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
    const beforeDedup = results.length;
    results = results.filter((r) => !state.injectedSummaryIds.includes(r.session_id));
    dedupSkipped = beforeDedup - results.length;
  }
  const registry = getResourceRegistry();
  let advice = "";
  let mdSummary = "";
  let overheadWarning = "";
  const validator = new InjectionValidator(registry);
  if (!baselineDone) {
    registry.scan(hook.cwd);
    const loader = new SmartResourceLoader(registry);
    const plan = loader.buildContextPlan(project, hook.prompt, 30000, hook.cwd);
    plan.recommendations = validator.filterAliveRecommendations(plan.recommendations);
    plan.skipped = validator.filterAliveRecommendations(plan.skipped);
    advice = loader.formatContextAdvice(plan);
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
    try {
      const overhead = await registry.getOverheadReport(project);
      const unusedTokens = overhead.potential_savings.if_remove_unused_skills + overhead.potential_savings.if_remove_unused_agents;
      if (unusedTokens > 1e4) {
        const unusedCount = overhead.usage_analysis.skills_never_used.length + overhead.usage_analysis.agents_never_used.length;
        overheadWarning = `Note: ${unusedCount} unused resources (~${unusedTokens} listing tok overhead). Run \`memory_context_budget\` for details.`;
      }
    } catch {}
  }
  let curatedNotes = [];
  let curatedSection = "";
  try {
    if ((hook.prompt?.length ?? 0) >= 6) {
      curatedNotes = searchCuratedNotes(hook.prompt ?? "", project, 2).filter((n) => !state.injectedCuratedIds.includes(n.id));
    }
    if (!baselineDone) {
      const baseline = getCuratedBaseline(project, 3).filter((n) => !state.injectedCuratedIds.includes(n.id) && !curatedNotes.some((c) => c.id === n.id));
      curatedNotes = [...curatedNotes, ...baseline].slice(0, 3);
    }
    curatedSection = buildCuratedSection(curatedNotes);
  } catch {}
  let smartMatchSection = "";
  let smartMatchCount = 0;
  let smartMatchTopScore = 0;
  try {
    if (!promptAnalysis.is_command_invocation && (hook.prompt?.length ?? 0) >= 10) {
      const matches = await matchResourcesForPrompt(hook.prompt ?? "", promptAnalysis, {
        project,
        threshold: 0.3,
        limit: 5
      });
      smartMatchCount = matches.length;
      smartMatchTopScore = matches[0]?.score ?? 0;
      if (matches.length > 0)
        smartMatchSection = formatSmartMatch(matches);
    }
  } catch {}
  const memorySection = buildMemorySection(results, memoryHint);
  let awarenessHint = "";
  if (!baselineDone || historyIntentMatched) {
    try {
      awarenessHint = buildAwarenessHint({
        project,
        isCommandInvocation: promptAnalysis.is_command_invocation,
        hasMemoryInjected: memorySection.length > 0,
        hasRecentConvoInjected: recentConvoSection.length > 0
      });
    } catch {}
  }
  const safeContext = validator.validate(fitWithinBudget(memorySection, recentConvoSection, awarenessHint, mdSummary, smartMatchSection, advice, overheadWarning, curatedSection));
  state.baselineInjected = true;
  if (results.length > 0) {
    state.injectedSummaryIds = [...new Set([...state.injectedSummaryIds, ...results.map((r) => r.session_id)])];
  }
  if (curatedNotes.length > 0) {
    state.injectedCuratedIds = [...new Set([...state.injectedCuratedIds, ...curatedNotes.map((n) => n.id)])];
  }
  saveInjectionState(hook.session_id, state);
  try {
    logInjection({
      session_id: hook.session_id,
      project,
      intent: promptAnalysis.intent,
      language: promptAnalysis.language,
      prompt_length: hook.prompt?.length ?? 0,
      smart_match_count: smartMatchCount,
      smart_match_top_score: smartMatchTopScore,
      memory_section_chars: memorySection.length,
      claude_md_chars: mdSummary.length,
      recent_convo_chars: recentConvoSection.length,
      awareness_hint_chars: awarenessHint.length,
      total_injection_chars: safeContext.length,
      history_intent_matched: historyIntentMatched,
      injected_at: baselineDone ? "prompt" : "first_prompt",
      dedup_skipped: dedupSkipped,
      curated_chars: curatedSection.length
    });
  } catch {}
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
function fitWithinBudget(memoryText, recentConvoText, awarenessHintText, mdText, smartMatchText, adviceText, overheadText, curatedText = "") {
  const MAX_CHARS2 = 8000;
  const sections = [
    { text: recentConvoText || "", priority: 1, minChars: 400 },
    { text: awarenessHintText || "", priority: 1, minChars: 100 },
    { text: curatedText || "", priority: 2, minChars: 300 },
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
var init_hook_handler = __esm(() => {
  init_session_store();
  init_long_term_store();
  init_schema();
  init_entity_extractor();
  init_resource_tracker();
  init_smart_resource_loader();
  init_resource_registry();
  init_injection_validator();
  init_observation_extractor();
  init_claude_md_tracker();
  init_prompt_analyzer();
  init_resource_matcher();
  init_history_intent();
  init_conversation_injector();
  init_awareness_hint();
  init_injection_telemetry();
  init_smart_truncate();
  init_privacy_filter();
  init_injection_state();
  init_curated_injector();
});

// src/export/obsidian-notes.ts
function safeName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "unknown";
}
function slug(text, maxWords = 7) {
  const words = text.replace(/[`'"\u2018\u2019\u201C\u201D]/g, "").split(/[^\p{L}\p{N}.]+/u).filter(Boolean).slice(0, maxWords);
  return safeName(words.join(" ").toLowerCase()).slice(0, 60).trim() || "note";
}
function fileNoteName(filePath) {
  const base = safeName(filePath.split(/[\\/]/).pop() ?? "file");
  return `${base}-${hash8(filePath)}.md`;
}
function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function hash8(text) {
  let h = 5381;
  for (let i = 0;i < text.length; i++) {
    h = (h << 5) + h + text.charCodeAt(i) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function renderSessionNote(row, d) {
  const files = parseJson(row.files_touched, []);
  const decisions = parseJson(row.decisions, []);
  const errors = parseJson(row.errors_fixed, []);
  const lines = [
    "---",
    `type: session`,
    `project: "${row.project}"`,
    `session_id: ${row.session_id}`,
    `date: ${isoDate(row.created_at)}`,
    `tags: [memory-hub, session]`,
    "---",
    "",
    `# Session ${isoDate(row.created_at)} \u2014 [[${safeName(row.project)}]]`,
    "",
    row.summary,
    ""
  ];
  if (files.length > 0) {
    lines.push("## Files touched");
    for (const f of files.slice(0, 15))
      lines.push(`- ${fileLink(f, d)}`);
    lines.push("");
  }
  if (decisions.length > 0) {
    lines.push("## Decisions");
    for (const dec of decisions.slice(0, 10))
      lines.push(`- ${dec}`);
    lines.push("");
  }
  if (errors.length > 0) {
    lines.push("## Errors fixed");
    for (const e of errors.slice(0, 10))
      lines.push(`- ${e}`);
    lines.push("");
  }
  return lines.join(`
`);
}
function renderDecisionNote(row) {
  return [
    "---",
    `type: decision`,
    `project: "${row.project}"`,
    `importance: ${row.importance}`,
    `date: ${isoDate(row.created_at)}`,
    `session_id: ${row.session_id}`,
    `tags: [memory-hub, decision]`,
    "---",
    "",
    `# ${row.entity_value.slice(0, 120)}`,
    "",
    `Project: [[${safeName(row.project)}]]`,
    "",
    row.entity_value,
    row.context ? `
> ${row.context}` : "",
    ""
  ].join(`
`);
}
function renderFileNote(f, d) {
  const lines = [
    "---",
    `type: file`,
    `project: "${f.project}"`,
    `path: "${f.entity_value}"`,
    `touches: ${f.touches}`,
    `tags: [memory-hub, file]`,
    "---",
    "",
    `# ${f.entity_value.split(/[\\/]/).pop()}`,
    "",
    `\`${f.entity_value}\``,
    "",
    `Project: [[${safeName(f.project)}]] \xB7 edited ${f.touches}\xD7 \xB7 last ${isoDate(f.last_seen)}`,
    ""
  ];
  const edges = d.query(`SELECT src_key, dst_key, weight FROM graph_edges
     WHERE rel = 'co_edited' AND (src_key = ? OR dst_key = ?)
     ORDER BY weight DESC LIMIT 8`).all(f.entity_value, f.entity_value);
  if (edges.length > 0) {
    lines.push("## Usually edited together with");
    for (const e of edges) {
      const other = e.src_key === f.entity_value ? e.dst_key : e.src_key;
      lines.push(`- [[${fileNoteName(other).replace(/\.md$/, "")}]] (${e.weight.toFixed(1)})`);
    }
    lines.push("");
  }
  const errors = d.query(`SELECT src_key FROM graph_edges WHERE rel = 'error_in' AND dst_key = ? ORDER BY weight DESC LIMIT 5`).all(f.entity_value);
  if (errors.length > 0) {
    lines.push("## Past errors here");
    for (const e of errors)
      lines.push(`- ${e.src_key}`);
    lines.push("");
  }
  return lines.join(`
`);
}
function renderProjectMoc(project, d) {
  const recent = d.query(`SELECT session_id, summary, created_at FROM long_term_summaries
     WHERE project = ? ORDER BY created_at DESC LIMIT 20`).all(project);
  const lines = [
    "---",
    `type: project`,
    `tags: [memory-hub, project]`,
    "---",
    "",
    `# ${project}`,
    "",
    "## Recent sessions"
  ];
  for (const s of recent) {
    lines.push(`- [[${isoDate(s.created_at)} ${s.session_id.slice(0, 8)}]] \u2014 ${s.summary.slice(0, 100).replace(/\n/g, " ")}`);
  }
  lines.push("", `[[Home]]`);
  return lines.join(`
`);
}
function renderHome(projects) {
  const lines = [
    "---",
    `tags: [memory-hub, moc]`,
    "---",
    "",
    "# \uD83E\uDDE0 Memory Hub",
    "",
    "Knowledge exported from Claude Code sessions \u2014 and read back:",
    "notes you write in [[Notes/README|Notes/]] and any exported note you edit",
    "become **curated memory** that Claude Code recalls in future sessions.",
    "",
    "## Projects"
  ];
  for (const p of projects) {
    lines.push(`- [[${safeName(p.project)}]] (${p.sessions} sessions)`);
  }
  return lines.join(`
`);
}
function fileLink(filePath, d) {
  try {
    const hot = d.query(`SELECT COUNT(*) c FROM graph_edges WHERE rel = 'co_edited' AND (src_key = ? OR dst_key = ?)`).get(filePath, filePath);
    if ((hot?.c ?? 0) > 0)
      return `[[${fileNoteName(filePath).replace(/\.md$/, "")}]]`;
  } catch {}
  return `\`${filePath}\``;
}

// src/export/obsidian-exporter.ts
var exports_obsidian_exporter = {};
__export(exports_obsidian_exporter, {
  syncObsidianVault: () => syncObsidianVault,
  saveSyncState: () => saveSyncState,
  loadSyncState: () => loadSyncState,
  getVaultRoot: () => getVaultRoot,
  getMemoryHubRoot: () => getMemoryHubRoot,
  contentHash: () => contentHash
});
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
import { join as join7 } from "path";
import { homedir as homedir6 } from "os";
function getVaultRoot() {
  return process.env["CLAUDE_MEMORY_HUB_OBSIDIAN_VAULT"] ?? DEFAULT_VAULT;
}
function getMemoryHubRoot() {
  return join7(getVaultRoot(), SUBFOLDER);
}
function contentHash(text) {
  return Bun.hash(text).toString(16);
}
function syncObsidianVault(options = {}) {
  const d = options.db ?? getDatabase();
  const root = getMemoryHubRoot();
  ensureDir(root);
  ensureDir(join7(root, "_meta"));
  ensureNotesFolder(root);
  const state = loadSyncState(root);
  const result = {
    vault: root,
    sessions_exported: 0,
    decisions_exported: 0,
    file_notes_exported: 0,
    projects: 0,
    preserved_user_edits: 0
  };
  const write = (relPath, content) => {
    const ok = writeNoteGuarded(root, state, relPath, content);
    if (!ok)
      result.preserved_user_edits++;
    return ok;
  };
  const summaryRows = d.query(`SELECT session_id, project, summary, files_touched, decisions, errors_fixed, created_at
     FROM long_term_summaries
     WHERE created_at > ?${options.project ? " AND project = ?" : ""}
     ORDER BY created_at ASC`).all(...options.project ? [state.last_summary_at, options.project] : [state.last_summary_at]);
  for (const row of summaryRows) {
    const dir = join7("Projects", safeName(row.project), "Sessions");
    ensureDir(join7(root, dir));
    write(join7(dir, `${isoDate(row.created_at)} ${row.session_id.slice(0, 8)}.md`), renderSessionNote(row, d));
    result.sessions_exported++;
    state.last_summary_at = Math.max(state.last_summary_at, row.created_at);
  }
  saveSyncState(root, state);
  const decisionRows = d.query(`SELECT id, project, entity_value, context, importance, created_at, session_id
     FROM entities
     WHERE entity_type IN ('decision','observation') AND importance >= 3 AND created_at > ?
       ${options.project ? "AND project = ?" : ""}
     ORDER BY created_at ASC LIMIT 500`).all(...options.project ? [state.last_decision_at, options.project] : [state.last_decision_at]);
  for (const row of decisionRows) {
    const dir = join7("Projects", safeName(row.project), "Decisions");
    ensureDir(join7(root, dir));
    write(join7(dir, `${slug(row.entity_value)} (${row.id}).md`), renderDecisionNote(row));
    result.decisions_exported++;
    state.last_decision_at = Math.max(state.last_decision_at, row.created_at);
  }
  saveSyncState(root, state);
  const hotFiles = d.query(`SELECT project, entity_value, SUM(touch_count) touches, MAX(created_at) last_seen
     FROM entities
     WHERE entity_type IN ('file_modified','file_created')
       ${options.project ? "AND project = ?" : ""}
     GROUP BY project, entity_value
     HAVING touches >= ?
     ORDER BY touches DESC LIMIT 300`).all(...options.project ? [options.project, FILE_NOTE_MIN_TOUCHES] : [FILE_NOTE_MIN_TOUCHES]);
  for (const f of hotFiles) {
    const dir = join7("Files", safeName(f.project));
    ensureDir(join7(root, dir));
    write(join7(dir, fileNoteName(f.entity_value)), renderFileNote(f, d));
    result.file_notes_exported++;
  }
  saveSyncState(root, state);
  const projects = d.query(`SELECT project, COUNT(*) sessions FROM long_term_summaries GROUP BY project ORDER BY MAX(created_at) DESC`).all();
  result.projects = projects.length;
  for (const p of projects) {
    if (options.project && p.project !== options.project)
      continue;
    const dir = join7(root, "Projects", safeName(p.project));
    if (!existsSync7(dir))
      continue;
    write(join7("Projects", safeName(p.project), `${safeName(p.project)}.md`), renderProjectMoc(p.project, d));
  }
  write("Home.md", renderHome(projects));
  saveSyncState(root, state);
  log9.info("obsidian sync complete", { ...result });
  return result;
}
function writeNoteGuarded(root, state, relPath, content) {
  const abs = join7(root, relPath);
  const newHash = contentHash(content);
  const recorded = state.written[relPath];
  if (existsSync7(abs)) {
    const currentHash = contentHash(readFileSync4(abs, "utf-8"));
    if (recorded !== undefined && currentHash !== recorded)
      return false;
    if (currentHash === newHash) {
      state.written[relPath] = newHash;
      return true;
    }
  }
  writeFileSync2(abs, content, "utf-8");
  state.written[relPath] = newHash;
  return true;
}
function ensureNotesFolder(root) {
  const dir = join7(root, "Notes");
  if (existsSync7(dir))
    return;
  ensureDir(dir);
  writeFileSync2(join7(dir, "README.md"), [
    "---",
    "tags: [memory-hub]",
    "---",
    "",
    "# \uD83D\uDCDD Notes \u2014 your knowledge, read back into Claude Code",
    "",
    "Every `.md` you create in this folder is indexed as **curated memory** \u2014",
    "the highest-trust source. Claude Code sees the relevant ones at session",
    "start and whenever a prompt matches.",
    "",
    '- Add `project: "<name>"` in frontmatter to scope a note to one project (folder name of the repo). Notes without it are global.',
    "- Editing any auto-generated note elsewhere in this vault also marks it curated \u2014 the hub never overwrites your edits.",
    "- This README itself is not indexed.",
    ""
  ].join(`
`), "utf-8");
}
function loadSyncState(root) {
  try {
    const parsed = JSON.parse(readFileSync4(join7(root, "_meta", "sync-state.json"), "utf-8"));
    return {
      last_summary_at: parsed.last_summary_at ?? 0,
      last_decision_at: parsed.last_decision_at ?? 0,
      written: parsed.written && typeof parsed.written === "object" ? parsed.written : {}
    };
  } catch {
    return { last_summary_at: 0, last_decision_at: 0, written: {} };
  }
}
function saveSyncState(root, state) {
  ensureDir(join7(root, "_meta"));
  writeFileSync2(join7(root, "_meta", "sync-state.json"), JSON.stringify(state, null, 2), "utf-8");
}
function ensureDir(dir) {
  if (!existsSync7(dir))
    mkdirSync4(dir, { recursive: true });
}
var log9, DEFAULT_VAULT, SUBFOLDER = "MemoryHub", FILE_NOTE_MIN_TOUCHES = 3;
var init_obsidian_exporter = __esm(() => {
  init_schema();
  init_logger();
  log9 = createLogger("obsidian-exporter");
  DEFAULT_VAULT = join7(homedir6(), "Documents", "ObsidianVault");
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
    const score = cosineSimilarity2(queryVec, docVec);
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
  log10.info("Starting embedding reindex...");
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
      log10.info("Embedding reindex progress", { indexed, total: summaries.length });
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
  log10.info("Embedding reindex complete", { summaries: summaries.length, entities: entities.length });
}
function cosineSimilarity2(a, b) {
  let dot = 0;
  for (let i = 0;i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
var log10;
var init_semantic_search = __esm(() => {
  init_schema();
  init_embedding_model();
  init_logger();
  log10 = createLogger("semantic-search");
});

// src/export/obsidian-readback.ts
var exports_obsidian_readback = {};
__export(exports_obsidian_readback, {
  syncVaultReadback: () => syncVaultReadback
});
import { existsSync as existsSync8, readFileSync as readFileSync5, readdirSync as readdirSync3, statSync as statSync3 } from "fs";
import { join as join8 } from "path";
function syncVaultReadback(options = {}) {
  const result = { scanned: 0, indexed: 0, removed: 0 };
  const root = getMemoryHubRoot();
  if (!existsSync8(root))
    return result;
  const d = options.db ?? getDatabase();
  const state = loadSyncState(root);
  const privacy = loadPrivacyConfig();
  let stateDirty = false;
  const known = new Map;
  for (const row of d.query("SELECT id, path, mtime FROM curated_notes").all()) {
    known.set(row.path, { id: row.id, mtime: row.mtime });
  }
  const seen = new Set;
  for (const relPath of walkMarkdown(root)) {
    if (relPath === "Home.md" || relPath === join8("Notes", "README.md"))
      continue;
    result.scanned++;
    seen.add(relPath);
    const mtime = Math.floor(statSync3(join8(root, relPath)).mtimeMs);
    const existing = known.get(relPath);
    if (existing && existing.mtime === mtime)
      continue;
    const raw = readFileSync5(join8(root, relPath), "utf-8");
    const hash = contentHash(raw);
    const isUserNote = relPath.startsWith("Notes/") || relPath.startsWith("Notes\\");
    let origin;
    if (isUserNote) {
      origin = "user";
    } else {
      const written = state.written[relPath];
      if (written === undefined) {
        state.written[relPath] = hash;
        stateDirty = true;
        continue;
      }
      if (written === hash)
        continue;
      origin = "edited";
    }
    const note = parseNote(relPath, raw);
    const content = sanitize(note.body, privacy).slice(0, MAX_CONTENT_CHARS);
    const row = d.query(`INSERT INTO curated_notes(path, project, title, content, origin, mtime, content_hash, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         project = excluded.project, title = excluded.title, content = excluded.content,
         origin = excluded.origin, mtime = excluded.mtime,
         content_hash = excluded.content_hash, indexed_at = excluded.indexed_at
       RETURNING id`).get(relPath, note.project, note.title, content, origin, mtime, hash, Date.now());
    result.indexed++;
    if (row?.id) {
      Promise.resolve().then(() => (init_semantic_search(), exports_semantic_search)).then((m) => m.indexEmbedding("curated", row.id, `${note.title} ${content}`, d)).catch(() => {});
    }
  }
  for (const [path, row] of known) {
    if (seen.has(path))
      continue;
    d.run("DELETE FROM curated_notes WHERE id = ?", [row.id]);
    result.removed++;
  }
  if (stateDirty)
    saveSyncState(root, state);
  if (result.indexed > 0 || result.removed > 0) {
    log11.info("vault read-back complete", { ...result });
  }
  return result;
}
function parseNote(relPath, raw) {
  let body = raw;
  let project = null;
  if (raw.startsWith(`---
`)) {
    const end = raw.indexOf(`
---`, 4);
    if (end > 0) {
      const fm = raw.slice(4, end);
      body = raw.slice(end + 4).replace(/^\n+/, "");
      const m = fm.match(/^project:\s*["']?([^"'\n]+)["']?\s*$/m);
      if (m?.[1])
        project = m[1].trim();
    }
  }
  if (!project) {
    const parts = relPath.split(/[\\/]/);
    if ((parts[0] === "Projects" || parts[0] === "Files") && parts.length > 2) {
      project = parts[1] ?? null;
    }
  }
  const heading = body.match(/^#\s+(.+)$/m);
  const fileTitle = (relPath.split(/[\\/]/).pop() ?? relPath).replace(/\.md$/, "");
  const title = (heading?.[1] ?? fileTitle).trim().slice(0, 150);
  return { title, project, body };
}
function* walkMarkdown(root, rel = "") {
  const dir = join8(root, rel);
  let entries;
  try {
    entries = readdirSync3(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "_meta")
      continue;
    const childRel = rel ? join8(rel, e.name) : e.name;
    if (e.isDirectory())
      yield* walkMarkdown(root, childRel);
    else if (e.name.endsWith(".md"))
      yield childRel;
  }
}
var log11, MAX_CONTENT_CHARS = 8000;
var init_obsidian_readback = __esm(() => {
  init_schema();
  init_privacy_filter();
  init_logger();
  init_obsidian_exporter();
  log11 = createLogger("obsidian-readback");
});

// src/capture/session-start-handler.ts
async function handleSessionStart(hook, project) {
  if (hook.source === "compact")
    return { additionalContext: "" };
  if (loadInjectionState(hook.session_id).baselineInjected) {
    return { additionalContext: "" };
  }
  const store = new SessionStore;
  const ltStore = new LongTermStore;
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    status: "active"
  });
  if (process.env["CLAUDE_MEMORY_HUB_OBSIDIAN"] === "1") {
    try {
      const { syncVaultReadback: syncVaultReadback2 } = await Promise.resolve().then(() => (init_obsidian_readback(), exports_obsidian_readback));
      syncVaultReadback2();
    } catch {}
  }
  let curatedSection = "";
  let curatedIds = [];
  try {
    const curated = getCuratedBaseline(project, 3);
    curatedSection = buildCuratedSection(curated);
    curatedIds = curated.map((n) => n.id);
  } catch {}
  let recent = ltStore.getRecentSummaries(project, 3);
  if (recent.length === 0)
    recent = ltStore.getRecentSummariesAll(3);
  let memoryHint = "";
  const total = ltStore.countSummaries();
  if (recent.length > 0 && total > recent.length) {
    memoryHint = `(showing ${recent.length} most recent of ${total} stored sessions \u2014 use \`memory_search\` with technical keywords for targeted retrieval)`;
  }
  const memorySection = buildMemorySection(recent, memoryHint);
  const registry = getResourceRegistry();
  const validator = new InjectionValidator(registry);
  let advice = "";
  let mdSummary = "";
  let overheadWarning = "";
  try {
    registry.scan(hook.cwd);
    const loader = new SmartResourceLoader(registry);
    const plan = loader.buildContextPlan(project, "", 30000, hook.cwd);
    plan.recommendations = validator.filterAliveRecommendations(plan.recommendations);
    plan.skipped = validator.filterAliveRecommendations(plan.skipped);
    advice = loader.formatContextAdvice(plan);
  } catch {}
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
  try {
    const overhead = await registry.getOverheadReport(project);
    const unusedTokens = overhead.potential_savings.if_remove_unused_skills + overhead.potential_savings.if_remove_unused_agents;
    if (unusedTokens > 1e4) {
      const unusedCount = overhead.usage_analysis.skills_never_used.length + overhead.usage_analysis.agents_never_used.length;
      overheadWarning = `Note: ${unusedCount} unused resources (~${unusedTokens} listing tok overhead). Run \`memory_context_budget\` for details.`;
    }
  } catch {}
  let awarenessHint = "";
  try {
    awarenessHint = buildAwarenessHint({
      project,
      isCommandInvocation: false,
      hasMemoryInjected: memorySection.length > 0,
      hasRecentConvoInjected: false
    });
  } catch {}
  const safeContext = validator.validate(fitWithinBudget(memorySection, "", awarenessHint, mdSummary, "", advice, overheadWarning, curatedSection));
  const state = loadInjectionState(hook.session_id);
  state.baselineInjected = true;
  state.injectedSummaryIds = [
    ...new Set([...state.injectedSummaryIds, ...recent.map((r) => r.session_id)])
  ];
  state.injectedCuratedIds = [...new Set([...state.injectedCuratedIds, ...curatedIds])];
  saveInjectionState(hook.session_id, state);
  try {
    logInjection({
      session_id: hook.session_id,
      project,
      intent: "session_start",
      language: null,
      prompt_length: 0,
      smart_match_count: 0,
      smart_match_top_score: 0,
      memory_section_chars: memorySection.length,
      claude_md_chars: mdSummary.length,
      recent_convo_chars: 0,
      awareness_hint_chars: awarenessHint.length,
      total_injection_chars: safeContext.length,
      history_intent_matched: false,
      injected_at: "session_start",
      dedup_skipped: 0,
      curated_chars: curatedSection.length
    });
  } catch {}
  return { additionalContext: safeContext };
}
var init_session_start_handler = __esm(() => {
  init_session_store();
  init_long_term_store();
  init_resource_registry();
  init_injection_validator();
  init_smart_resource_loader();
  init_claude_md_tracker();
  init_resource_tracker();
  init_awareness_hint();
  init_injection_state();
  init_injection_telemetry();
  init_curated_injector();
  init_hook_handler();
});

// src/capture/batch-queue.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync5, readFileSync as readFileSync6, writeFileSync as writeFileSync3, appendFileSync as appendFileSync2, unlinkSync as unlinkSync2, statSync as statSync4 } from "fs";
import { join as join9 } from "path";
import { homedir as homedir7 } from "os";
function enqueueEvent(event) {
  try {
    ensureBatchDir();
    const line = JSON.stringify(event) + `
`;
    appendFileSync2(QUEUE_PATH, line, "utf-8");
  } catch (err) {
    log12.error("enqueue failed", { error: String(err) });
    throw err;
  }
}
function tryFlush() {
  try {
    if (!existsSync9(QUEUE_PATH))
      return false;
    const stat = statSync4(QUEUE_PATH);
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
    log12.error("flush failed", { error: String(err) });
    return false;
  }
}
function flushQueue() {
  const content = readFileSync6(QUEUE_PATH, "utf-8").trim();
  if (!content)
    return;
  const events = [];
  for (const line of content.split(`
`)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      log12.warn("skipping malformed queue line");
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
  writeFileSync3(QUEUE_PATH, "", "utf-8");
  log12.info("batch flushed", { events: events.length });
}
function tryAcquireLock() {
  try {
    if (existsSync9(LOCK_PATH)) {
      const lockContent = readFileSync6(LOCK_PATH, "utf-8").trim();
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
    writeFileSync3(LOCK_PATH, `${process.pid}:${Date.now()}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}
function releaseLock() {
  try {
    unlinkSync2(LOCK_PATH);
  } catch {}
}
function ensureBatchDir() {
  if (!existsSync9(BATCH_DIR)) {
    mkdirSync5(BATCH_DIR, { recursive: true, mode: 448 });
  }
}
function isBatchEnabled() {
  const mode = process.env["CLAUDE_MEMORY_HUB_BATCH"] ?? "auto";
  return mode !== "disabled";
}
var log12, DATA_DIR, BATCH_DIR, QUEUE_PATH, LOCK_PATH, MAX_QUEUE_SIZE, LOCK_STALE_MS = 30000;
var init_batch_queue = __esm(() => {
  init_session_store();
  init_resource_tracker();
  init_resource_registry();
  init_logger();
  log12 = createLogger("batch-queue");
  DATA_DIR = join9(homedir7(), ".claude-memory-hub");
  BATCH_DIR = join9(DATA_DIR, "batch");
  QUEUE_PATH = join9(BATCH_DIR, "queue.jsonl");
  LOCK_PATH = join9(BATCH_DIR, "queue.lock");
  MAX_QUEUE_SIZE = 100 * 1024;
});

// src/retrieval/proactive-retrieval.ts
import { existsSync as existsSync10, readFileSync as readFileSync7, writeFileSync as writeFileSync4, mkdirSync as mkdirSync6 } from "fs";
import { join as join10 } from "path";
import { homedir as homedir8 } from "os";
function evaluateProactiveInjection(sessionId, toolName, toolInput, toolResponse) {
  const state = loadState(sessionId);
  state.toolCallCount++;
  const filePath = extractFilePath(toolName, toolInput);
  if (filePath) {
    state.recentFiles = [...new Set([filePath, ...state.recentFiles])].slice(0, 20);
  }
  const shouldTrigger = state.toolCallCount % TOOL_CALL_INTERVAL === 0 || detectToolError(toolName, toolInput, toolResponse) !== null && state.toolCallCount > 5;
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
  log13.info("proactive injection triggered", { sessionId, topic: currentTopic, results: results.length });
  return { shouldInject: true, additionalContext: context };
}
function cleanupProactiveState(sessionId) {
  const path = statePath2(sessionId);
  try {
    if (existsSync10(path)) {
      const { unlinkSync: unlinkSync3 } = __require("fs");
      unlinkSync3(path);
    }
  } catch {}
}
function detectTopic(recentFiles) {
  if (recentFiles.length < 3)
    return null;
  const dirs = recentFiles.map((f) => f.split(/[\\/]/).slice(0, -1).join("/")).filter(Boolean);
  const dirCounts = new Map;
  for (const d of dirs) {
    const parts = d.split(/[\\/]/).filter(Boolean);
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
  const fileNames = recentFiles.map((f) => f.split(/[\\/]/).pop() ?? "").filter(Boolean);
  const keywords = ["auth", "payment", "user", "api", "database", "config", "test", "migration", "deploy", "search"];
  for (const kw of keywords) {
    const matches = fileNames.filter((f) => f.toLowerCase().includes(kw));
    if (matches.length >= 2)
      return kw;
  }
  return bestTopic;
}
function statePath2(sessionId) {
  return join10(PROACTIVE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}
function loadState(sessionId) {
  const path = statePath2(sessionId);
  try {
    if (existsSync10(path)) {
      return JSON.parse(readFileSync7(path, "utf-8"));
    }
  } catch {}
  return { toolCallCount: 0, lastInjectionAt: 0, injectedTopics: [], recentFiles: [] };
}
function saveState(sessionId, state) {
  try {
    if (!existsSync10(PROACTIVE_DIR)) {
      mkdirSync6(PROACTIVE_DIR, { recursive: true, mode: 448 });
    }
    writeFileSync4(statePath2(sessionId), JSON.stringify(state), "utf-8");
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
var log13, DATA_DIR2, PROACTIVE_DIR, TOOL_CALL_INTERVAL = 15, MAX_INJECTION_CHARS = 3000;
var init_proactive_retrieval = __esm(() => {
  init_long_term_store();
  init_error_detector();
  init_logger();
  log13 = createLogger("proactive-retrieval");
  DATA_DIR2 = join10(homedir8(), ".claude-memory-hub");
  PROACTIVE_DIR = join10(DATA_DIR2, "proactive");
});

// src/capture/transcript-parser.ts
import { createReadStream, existsSync as existsSync11, statSync as statSync5 } from "fs";
import { createInterface } from "readline";
async function parseTranscript(transcriptPath, sessionId, project) {
  if (!transcriptPath || !existsSync11(transcriptPath)) {
    log14.info("Transcript not found, skipping", { path: transcriptPath });
    return [];
  }
  try {
    const stat = statSync5(transcriptPath);
    if (stat.size > MAX_FILE_SIZE) {
      log14.warn("Transcript too large, skipping", { size: stat.size, max: MAX_FILE_SIZE });
      return [];
    }
  } catch {
    return [];
  }
  const messages = [];
  let promptNumber = 0;
  try {
    const rl = createInterface({
      input: createReadStream(transcriptPath, { encoding: "utf-8" }),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (messages.length >= MAX_MESSAGES)
        break;
      if (!line.trim())
        continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "user" && entry.type !== "assistant")
        continue;
      if (!entry.message)
        continue;
      const role = entry.type;
      const content = extractTextContent(entry.message.content);
      if (!content || content.trim().length === 0)
        continue;
      if (role === "user" && isSyntheticUserMessage(content))
        continue;
      if (role === "user" && messages.length > 0)
        promptNumber++;
      const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
      const msg = {
        session_id: sessionId,
        project,
        role,
        content: smartTruncate(content, capForRole(role)),
        prompt_number: promptNumber,
        timestamp
      };
      if (entry.uuid)
        msg.uuid = entry.uuid;
      if (entry.parentUuid)
        msg.parent_uuid = entry.parentUuid;
      messages.push(msg);
    }
  } catch (err) {
    log14.error("Transcript parse failed", { error: String(err) });
    return [];
  }
  const privacyConfig = loadPrivacyConfig();
  for (const msg of messages) {
    msg.content = sanitize(msg.content, privacyConfig);
  }
  log14.info("Transcript parsed", {
    path: transcriptPath,
    total: messages.length,
    user: messages.filter((m) => m.role === "user").length,
    assistant: messages.filter((m) => m.role === "assistant").length
  });
  return messages;
}
function extractTextContent(content) {
  if (!content)
    return;
  if (typeof content === "string") {
    return stripNoiseTags(content);
  }
  if (!Array.isArray(content))
    return;
  const textParts = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    }
  }
  const joined = textParts.join(`
`).trim();
  return joined ? stripNoiseTags(joined) : undefined;
}
function stripNoiseTags(text) {
  return text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").replace(/<local-command-[\w-]*>[\s\S]*?<\/local-command-[\w-]*>\s*/g, "").replace(/<command-[\w-]*>[\s\S]*?<\/command-[\w-]*>\s*/g, "").trim();
}
var log14, MAX_FILE_SIZE, MAX_MESSAGES = 500;
var init_transcript_parser = __esm(() => {
  init_logger();
  init_privacy_filter();
  init_smart_truncate();
  log14 = createLogger("transcript-parser");
  MAX_FILE_SIZE = 50 * 1024 * 1024;
});

// src/summarizer/summarizer-prompts.ts
function stripNoiseTags2(text) {
  return text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g, "").replace(/<command-name>[\s\S]*?<\/command-name>\s*/g, "").replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, "").replace(/<command-args>[\s\S]*?<\/command-args>\s*/g, "").replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, "").replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/g, "").replace(/<(?:task-notification|system-reminder)>[\s\S]*$/, "").trim();
}
function buildRuleBasedSummary(session, files, errors, decisions, notes = []) {
  const parts = [];
  if (session.user_prompt) {
    const cleanPrompt = stripNoiseTags2(session.user_prompt);
    if (cleanPrompt) {
      parts.push(`Task: ${cleanPrompt.slice(0, 500)}.`);
    }
  }
  if (files.length > 0) {
    const listed = files.slice(0, 15).join(", ");
    parts.push(`Files (${files.length}): ${listed}${files.length > 15 ? ` (+${files.length - 15} more)` : ""}.`);
  }
  if (decisions.length > 0) {
    const listed = decisions.slice(0, 5).map((d) => {
      const base = d.entity_value.slice(0, 150);
      const ctx = d.context ? ` \u2192 ${d.context.slice(0, 200)}` : "";
      return base + ctx;
    }).join("; ");
    parts.push(`Decisions: ${listed}.`);
  }
  if (errors.length > 0) {
    const errorLines = errors.slice(0, 5).map((e) => {
      const ctx = e.context ? ` (${e.context.slice(0, 100)})` : "";
      return `${e.entity_value.slice(0, 150)}${ctx}`;
    });
    parts.push(`Errors (${errors.length}): ${errorLines.join("; ")}.`);
  }
  if (notes.length > 0) {
    parts.push(`Notes: ${notes.slice(-5).join("; ").slice(0, 500)}.`);
  }
  return parts.join(" ") || `Session in project ${session.project}.`;
}

// src/summarizer/cli-summarizer.ts
function isClaudeCliAvailable() {
  if (_cliAvailable === false && Date.now() - _cliCheckedAt > CLI_CHECK_TTL_MS) {
    _cliAvailable = undefined;
  }
  if (_cliAvailable !== undefined)
    return _cliAvailable;
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const proc = Bun.spawnSync([finder, "claude"]);
    _cliAvailable = proc.exitCode === 0;
  } catch {
    _cliAvailable = false;
  }
  _cliCheckedAt = Date.now();
  return _cliAvailable;
}
function stripNoise(text) {
  return text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").replace(/<local-command-[\w-]+>[\s\S]*?<\/local-command-[\w-]+>\s*/g, "").replace(/<command-[\w-]+>[\s\S]*?<\/command-[\w-]+>\s*/g, "").replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/g, "").replace(/<(?:task-notification|system-reminder)>[\s\S]*$/, "").trim();
}
function buildCliPrompt(ctx) {
  const sections = [
    "Summarize this coding session in 5-10 plain sentences \u2014 scale length to how much actually happened. No markdown, no headers, no code blocks.",
    "Cover: (1) what was accomplished and why, (2) key decisions with their reasons, (3) errors hit and how they were resolved, (4) anything left unfinished or planned next.",
    "Write in English, but preserve Vietnamese feature names, domain terms, and user requirements VERBATIM in quotes.",
    "Include exact file names, function names, and error identifiers so keyword search can find this session later.",
    "State only what the context below supports \u2014 never invent work that is not evidenced.",
    "",
    `Project: ${ctx.project}`
  ];
  if (ctx.conversation && ctx.conversation.length > 0) {
    sections.push(`Conversation (chronological): ${ctx.conversation.map(stripNoise).join(" | ")}`);
  }
  if (ctx.files.length > 0) {
    sections.push(`Files modified: ${ctx.files.slice(0, 15).join(", ")}`);
  }
  if (ctx.errors.length > 0) {
    sections.push(`Errors resolved: ${ctx.errors.slice(0, 5).map(stripNoise).join("; ")}`);
  }
  if (ctx.decisions.length > 0) {
    sections.push(`Decisions: ${ctx.decisions.slice(0, 8).map(stripNoise).join("; ")}`);
  }
  if (ctx.notes.length > 0) {
    sections.push(`Notes: ${ctx.notes.slice(0, 5).map(stripNoise).join("; ")}`);
  }
  if (ctx.observations.length > 0) {
    sections.push(`Key observations: ${ctx.observations.slice(0, 5).map(stripNoise).join("; ")}`);
  }
  let prompt = sections.join(`
`);
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS - 3) + "...";
  }
  return prompt;
}
function capAtSentence(text, max) {
  if (text.length <= max)
    return text;
  const cut = text.slice(0, max);
  const lastEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(`.
`), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastEnd > max * 0.6 ? cut.slice(0, lastEnd + 1) : cut;
}
function consumeDailyBudget() {
  const max = Number(process.env["CLAUDE_MEMORY_HUB_LLM_DAILY_MAX"]) || DEFAULT_DAILY_MAX;
  const { existsSync: existsSync12, readFileSync: readFileSync8, writeFileSync: writeFileSync5 } = __require("fs");
  const { join: join11 } = __require("path");
  const { homedir: homedir9 } = __require("os");
  const path = join11(homedir9(), ".claude-memory-hub", "cli-summary-budget.json");
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  try {
    if (existsSync12(path)) {
      const parsed = JSON.parse(readFileSync8(path, "utf-8"));
      if (parsed.date === today && typeof parsed.count === "number")
        count = parsed.count;
    }
  } catch {}
  if (count >= max)
    return false;
  try {
    writeFileSync5(path, JSON.stringify({ date: today, count: count + 1 }), "utf-8");
  } catch {}
  return true;
}
async function tryCliSummary(ctx, timeoutMs) {
  const envTimeout = Number(process.env["CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS"]) || DEFAULT_TIMEOUT_MS;
  const timeout = timeoutMs ?? envTimeout;
  if (!isClaudeCliAvailable()) {
    log15.info("claude CLI not found, skipping Tier 2");
    return;
  }
  if (!consumeDailyBudget()) {
    log15.warn("Tier 2 daily budget exhausted, falling back to rule-based");
    return;
  }
  const prompt = buildCliPrompt(ctx);
  for (let attempt = 1;attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptCliCall(prompt, timeout, attempt, attempt === 1);
    if (result)
      return result;
    if (attempt < MAX_RETRIES)
      await new Promise((r) => setTimeout(r, 1000));
  }
  log15.warn("Tier 2 CLI summary exhausted retries", { retries: MAX_RETRIES });
  return;
}
async function attemptCliCall(prompt, timeout, attempt, pinModel) {
  try {
    const model = process.env["CLAUDE_MEMORY_HUB_LLM_MODEL"] || DEFAULT_MODEL;
    const modelArgs = pinModel ? ["--model", model] : [];
    const argv = process.platform === "win32" ? ["cmd", "/c", "claude", ...modelArgs, "-p"] : ["claude", ...modelArgs, "-p"];
    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: {
        ...process.env,
        CLAUDE_MEMORY_HUB_SKIP_HOOKS: "1"
      }
    });
    proc.stdin.write(prompt);
    await proc.stdin.end();
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve(undefined);
      }, timeout);
    });
    const outputPromise = (async () => {
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        log15.warn("claude CLI exited with non-zero", { exitCode, attempt });
        return;
      }
      const text = output.trim();
      if (!text || text.length < 10) {
        log15.warn("claude CLI returned empty or too short output", { attempt });
        return;
      }
      const cleaned = text.replace(/^#+\s+.*/gm, "").replace(/```[\s\S]*?```/g, "").replace(/\n{2,}/g, " ").trim();
      return capAtSentence(cleaned, MAX_OUTPUT_CHARS);
    })();
    const result = await Promise.race([outputPromise, timeoutPromise]);
    if (result) {
      log15.info("Tier 2 CLI summary generated", { length: result.length, attempt });
    } else {
      log15.warn("Tier 2 CLI attempt failed or timed out", { attempt });
    }
    return result;
  } catch (err) {
    log15.error("Tier 2 CLI attempt error", { error: String(err), attempt });
    return;
  }
}
var log15, MAX_PROMPT_CHARS = 16000, MAX_OUTPUT_CHARS = 3000, DEFAULT_TIMEOUT_MS = 90000, DEFAULT_MODEL = "haiku", _cliAvailable, _cliCheckedAt = 0, CLI_CHECK_TTL_MS, MAX_RETRIES = 2, DEFAULT_DAILY_MAX = 20;
var init_cli_summarizer = __esm(() => {
  init_logger();
  log15 = createLogger("cli-summarizer");
  CLI_CHECK_TTL_MS = 5 * 60 * 1000;
});

// src/summarizer/session-summarizer.ts
class SessionSummarizer {
  sessionStore;
  ltStore;
  constructor() {
    this.sessionStore = new SessionStore;
    this.ltStore = new LongTermStore;
  }
  async summarize(session_id, project, opts) {
    const session = this.sessionStore.getSession(session_id);
    if (!session)
      return;
    if (!opts?.upgradeOnly && this.ltStore.getSummary(session_id))
      return;
    const files = this.sessionStore.getSessionFiles(session_id);
    const errors = this.sessionStore.getSessionErrors(session_id);
    const decisions = this.sessionStore.getSessionDecisions(session_id);
    const observations = this.sessionStore.getSessionObservations(session_id);
    const notes = this.sessionStore.getSessionNotes(session_id).map((n) => n.content);
    const messages = this.sessionStore.getSessionMessages(session_id);
    if (files.length === 0 && errors.length === 0 && notes.length === 0 && messages.length === 0)
      return;
    const hasModified = this.sessionStore.hasModifiedFiles(session_id);
    if (!hasModified && errors.length === 0 && decisions.length === 0 && notes.length === 0 && observations.length === 0 && messages.length === 0)
      return;
    const userMsgs = messages.filter((m) => m.role === "user" && !isSyntheticUserMessage(m.content));
    const userChars = userMsgs.reduce((n, m) => n + m.content.trim().length, 0);
    if (!hasModified && errors.length === 0 && decisions.length === 0 && notes.length === 0 && observations.length === 0 && userChars < 300)
      return;
    const arc = userMsgs.length <= 10 ? userMsgs : [...userMsgs.slice(0, 5), ...userMsgs.slice(-5)];
    const arcNote = userMsgs.length > 10 ? ` (${userMsgs.length} total, first 5 + last 5)` : "";
    const userPrompts = arc.map((m) => m.content.slice(0, 250));
    const outcome = messages.filter((m) => m.role === "assistant").slice(-2).map((m) => m.content.slice(0, 400));
    const conversationDigest = userPrompts.length > 0 ? `User requests${arcNote}: ${userPrompts.join("; ")}` : "";
    const obsValues = observations.slice(0, 8).map((o) => {
      const ctx = o.context ? ` \u2192 ${o.context.slice(0, 200)}` : "";
      return o.entity_value.slice(0, 150) + ctx;
    });
    let summaryText;
    let tier = "rule-based";
    const llmMode = process.env["CLAUDE_MEMORY_HUB_LLM"] ?? "auto";
    if (llmMode !== "rule-based" && llmMode !== "disabled") {
      const decisionDetails = decisions.slice(0, 8).map((d) => {
        const ctx2 = d.context ? ` \u2192 ${d.context.slice(0, 200)}` : "";
        return d.entity_value.slice(0, 150) + ctx2;
      });
      const conversation = [];
      if (conversationDigest)
        conversation.push(conversationDigest);
      if (outcome.length > 0)
        conversation.push(`Final assistant output: ${outcome.join(" \u2026 ")}`);
      const ctx = {
        sessionId: session_id,
        project,
        files,
        errors: errors.slice(0, 5).map((e) => e.entity_value.slice(0, 150)),
        decisions: decisionDetails,
        notes: notes.slice(0, 5),
        observations: obsValues.slice(0, 5),
        conversation
      };
      summaryText = await tryCliSummary(ctx);
      if (summaryText)
        tier = "cli";
    }
    if (opts?.upgradeOnly && tier !== "cli")
      return;
    if (!summaryText) {
      const allNotes = [...notes, ...obsValues];
      if (conversationDigest)
        allNotes.push(conversationDigest);
      summaryText = buildRuleBasedSummary(session, files, errors, decisions, allNotes);
    }
    log16.info("Summary generated", { session_id, tier, length: summaryText.length });
    const existing = opts?.upgradeOnly ? this.ltStore.getSummary(session_id) : null;
    const ltSummary = {
      session_id,
      project,
      tier,
      summary: summaryText,
      files_touched: JSON.stringify(files.slice(0, 50)),
      decisions: JSON.stringify(decisions.slice(0, 20).map((d) => d.entity_value)),
      errors_fixed: JSON.stringify(errors.slice(0, 10).map((e) => e.entity_value.slice(0, 100))),
      token_savings: estimateTokenSavings(files.length, errors.length, notes.length),
      created_at: existing?.created_at ?? Date.now()
    };
    this.ltStore.upsertSummary(ltSummary);
  }
}
function estimateTokenSavings(fileCount, errorCount, noteCount) {
  return fileCount * 500 + errorCount * 100 + noteCount * 50;
}
var log16;
var init_session_summarizer = __esm(() => {
  init_session_store();
  init_long_term_store();
  init_cli_summarizer();
  init_smart_truncate();
  init_logger();
  log16 = createLogger("session-summarizer");
});

// src/health/auto-cleanup.ts
import { existsSync as existsSync12, readFileSync as readFileSync8, writeFileSync as writeFileSync5 } from "fs";
import { join as join11 } from "path";
import { homedir as homedir9 } from "os";
function maybeRunAutoCleanup() {
  try {
    if (!isDue())
      return;
    const db = getDatabase();
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    const entities = db.run(`DELETE FROM entities
       WHERE created_at < ? AND importance <= 1 AND entity_type = 'file_read'`, [cutoff]).changes;
    const injections = pruneInjectionLog(RETENTION_DAYS, db);
    const healthChecks = db.run(`DELETE FROM health_checks WHERE checked_at < ?`, [cutoff]).changes;
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    writeFileSync5(MARKER_PATH, JSON.stringify({ last_run: Date.now() }), "utf-8");
    log17.info("auto-cleanup complete", { entities, injections, healthChecks });
  } catch (err) {
    log17.warn("auto-cleanup failed", { error: String(err) });
  }
}
function isDue() {
  try {
    if (!existsSync12(MARKER_PATH))
      return true;
    const parsed = JSON.parse(readFileSync8(MARKER_PATH, "utf-8"));
    const last = typeof parsed.last_run === "number" ? parsed.last_run : 0;
    return Date.now() - last > CADENCE_DAYS * 86400000;
  } catch {
    return true;
  }
}
var log17, CADENCE_DAYS = 7, RETENTION_DAYS = 90, MARKER_PATH;
var init_auto_cleanup = __esm(() => {
  init_schema();
  init_injection_telemetry();
  init_logger();
  log17 = createLogger("auto-cleanup");
  MARKER_PATH = join11(homedir9(), ".claude-memory-hub", "last-cleanup.json");
});

// src/graph/edge-builder.ts
var exports_edge_builder = {};
__export(exports_edge_builder, {
  buildSessionEdges: () => buildSessionEdges,
  backfillAllSessions: () => backfillAllSessions
});
function buildSessionEdges(sessionId, project, db) {
  const d = db ?? getDatabase();
  let edges = 0;
  const entities = d.query("SELECT * FROM entities WHERE session_id = ? ORDER BY prompt_number ASC, created_at ASC").all(sessionId);
  if (entities.length === 0)
    return { edges: 0 };
  const upsert = d.prepare(`INSERT INTO graph_edges(project, src_type, src_key, dst_type, dst_key, rel, weight, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project, src_type, src_key, dst_type, dst_key, rel) DO UPDATE SET
       weight    = weight + excluded.weight,
       last_seen = excluded.last_seen`);
  const now = Date.now();
  const modified = entities.filter((e) => e.entity_type === "file_modified" || e.entity_type === "file_created").sort((a, b) => (b.touch_count ?? 1) - (a.touch_count ?? 1)).slice(0, MAX_FILES_PER_SESSION);
  d.transaction(() => {
    for (let i = 0;i < modified.length; i++) {
      for (let j = i + 1;j < modified.length; j++) {
        const a = modified[i];
        const b = modified[j];
        if (a.entity_value === b.entity_value)
          continue;
        const dist = Math.abs(a.prompt_number - b.prompt_number);
        if (dist > PROMPT_WINDOW)
          continue;
        const [src, dst] = a.entity_value < b.entity_value ? [a.entity_value, b.entity_value] : [b.entity_value, a.entity_value];
        upsert.run(project, "file", key(src), "file", key(dst), "co_edited", 1 / (1 + dist), now, now);
        edges++;
      }
    }
    const errors = entities.filter((e) => e.entity_type === "error");
    for (const err of errors) {
      const target = [...modified].filter((f) => f.prompt_number <= err.prompt_number).sort((x, y) => y.prompt_number - x.prompt_number)[0];
      if (!target)
        continue;
      upsert.run(project, "error", key(err.entity_value), "file", key(target.entity_value), "error_in", 1, now, now);
      edges++;
    }
    const decisions = entities.filter((e) => (e.entity_type === "decision" || e.entity_type === "observation") && e.importance >= 3).filter((e) => !e.entity_value.startsWith("agent:") && !e.entity_value.startsWith("skill:")).slice(0, 10);
    for (const dec of decisions) {
      let linked = 0;
      for (const f of modified) {
        if (Math.abs(f.prompt_number - dec.prompt_number) > 1)
          continue;
        if (++linked > 5)
          break;
        upsert.run(project, "decision", key(dec.entity_value), "file", key(f.entity_value), "decided_about", 1, now, now);
        edges++;
      }
    }
    const touched = entities.filter((e) => e.entity_type.startsWith("file_"));
    for (const f of touched) {
      upsert.run(project, "session", sessionId, "file", key(f.entity_value), "session_touched", f.touch_count ?? 1, now, now);
      edges++;
    }
  })();
  return { edges };
}
function backfillAllSessions(db) {
  const d = db ?? getDatabase();
  const sessions = d.query("SELECT id, project FROM sessions").all();
  let total = 0;
  for (const s of sessions) {
    try {
      total += buildSessionEdges(s.id, s.project, d).edges;
    } catch (err) {
      log18.warn("edge build failed for session", { session: s.id, error: String(err) });
    }
  }
  log18.info("graph backfill complete", { sessions: sessions.length, edges: total });
  return { sessions: sessions.length, edges: total };
}
function key(value) {
  return value.length <= KEY_MAX_CHARS ? value : value.slice(0, KEY_MAX_CHARS);
}
var log18, PROMPT_WINDOW = 3, MAX_FILES_PER_SESSION = 40, KEY_MAX_CHARS = 160;
var init_edge_builder = __esm(() => {
  init_schema();
  init_logger();
  log18 = createLogger("edge-builder");
});

// src/worker/session-end-pipeline.ts
var exports_session_end_pipeline = {};
__export(exports_session_end_pipeline, {
  runSessionEnd: () => runSessionEnd
});
async function runSessionEnd(hook, project) {
  await handleSessionEnd(hook, project);
  try {
    tryFlush();
  } catch {}
  cleanupProactiveState(hook.session_id);
  cleanupInjectionState(hook.session_id);
  if (hook.transcript_path) {
    try {
      const store2 = new SessionStore;
      const messages = await parseTranscript(hook.transcript_path, hook.session_id, project);
      if (messages.length > 0) {
        store2.insertMessages(messages);
      }
    } catch {}
  }
  const store = new SessionStore;
  if (store.getSession(hook.session_id)) {
    await new SessionSummarizer().summarize(hook.session_id, project).catch(() => {});
    const ltStore = new LongTermStore;
    const summary = ltStore.getSummary(hook.session_id);
    if (summary?.id) {
      const text = [summary.summary, summary.files_touched, summary.decisions].join(" ");
      indexEmbedding("summary", summary.id, text).catch(() => {});
    }
    try {
      const { buildSessionEdges: buildSessionEdges2 } = await Promise.resolve().then(() => (init_edge_builder(), exports_edge_builder));
      buildSessionEdges2(hook.session_id, project);
    } catch {}
    if (process.env["CLAUDE_MEMORY_HUB_OBSIDIAN"] === "1") {
      try {
        const { syncObsidianVault: syncObsidianVault2 } = await Promise.resolve().then(() => (init_obsidian_exporter(), exports_obsidian_exporter));
        syncObsidianVault2({ project });
        const { syncVaultReadback: syncVaultReadback2 } = await Promise.resolve().then(() => (init_obsidian_readback(), exports_obsidian_readback));
        syncVaultReadback2();
      } catch {}
    }
  }
  maybeRunAutoCleanup();
}
var init_session_end_pipeline = __esm(() => {
  init_hook_handler();
  init_transcript_parser();
  init_session_summarizer();
  init_session_store();
  init_long_term_store();
  init_semantic_search();
  init_proactive_retrieval();
  init_injection_state();
  init_auto_cleanup();
  init_batch_queue();
});

// src/compact/compact-interceptor.ts
var exports_compact_interceptor = {};
__export(exports_compact_interceptor, {
  prependCompactLead: () => prependCompactLead,
  handlePreCompact: () => handlePreCompact,
  handlePostCompact: () => handlePostCompact
});
async function handlePreCompact(hook, project) {
  const store = new SessionStore;
  const session = store.getSession(hook.session_id);
  if (!session)
    return "";
  const entities = store.getSessionEntities(hook.session_id);
  if (entities.length === 0)
    return "";
  const now = Date.now();
  const scored = entities.map((e) => ({
    ...e,
    score: e.importance * recencyWeight(e.created_at, now)
  })).sort((a, b) => b.score - a.score);
  const lines = [
    "## Memory Hub Priority Items",
    "",
    "The following items are CRITICAL \u2014 ensure they appear in the summary:",
    ""
  ];
  const modifiedFiles = scored.filter((e) => e.entity_type === "file_modified" || e.entity_type === "file_created").slice(0, 15);
  if (modifiedFiles.length > 0) {
    lines.push("### Files Modified (MUST include)");
    for (const f of modifiedFiles) {
      lines.push(`- ${f.entity_value}`);
    }
    lines.push("");
  }
  const decisions = scored.filter((e) => e.entity_type === "decision").slice(0, 5);
  if (decisions.length > 0) {
    lines.push("### Decisions Made (MUST include)");
    for (const d of decisions) {
      lines.push(`- ${d.entity_value}`);
    }
    lines.push("");
  }
  const errors = scored.filter((e) => e.entity_type === "error").slice(0, 5);
  if (errors.length > 0) {
    lines.push("### Errors Encountered (include if space allows)");
    for (const e of errors) {
      lines.push(`- ${e.entity_value.slice(0, 150)}`);
      if (e.context)
        lines.push(`  Context: ${e.context.slice(0, 100)}`);
    }
    lines.push("");
  }
  const notes = store.getSessionNotes(hook.session_id);
  if (notes.length > 0) {
    lines.push("### Session Notes (MUST include)");
    for (const n of notes.slice(-3)) {
      lines.push(`- ${n.content.slice(0, 200)}`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}
async function handlePostCompact(hook, project) {
  const store = new SessionStore;
  const ltStore = new LongTermStore;
  const files = store.getSessionFiles(hook.session_id);
  const decisions = store.getSessionDecisions(hook.session_id);
  const errors = store.getSessionErrors(hook.session_id);
  const stripped = hook.compact_summary.replace(/<analysis>[\s\S]*?<\/analysis>/g, "").replace(/^\s*<analysis>\s*/, "").replace(/<\/?summary>/g, "").trim();
  const cleaned = stripped.length >= 200 ? stripped : hook.compact_summary;
  const withLead = prependCompactLead(cleaned);
  const MAX_COMPACT_SUMMARY = 5500;
  const summary = withLead.length > MAX_COMPACT_SUMMARY ? withLead.slice(0, MAX_COMPACT_SUMMARY - 20) + `

[truncated]` : withLead;
  ltStore.upsertSummary({
    session_id: hook.session_id,
    project,
    tier: "compact",
    summary,
    files_touched: JSON.stringify(files.slice(0, 50)),
    decisions: JSON.stringify(decisions.slice(0, 20).map((d) => d.entity_value)),
    errors_fixed: JSON.stringify(errors.slice(0, 10).map((e) => e.entity_value.slice(0, 100))),
    token_savings: estimateTokenSavings2(hook.compact_summary.length, files.length),
    created_at: Date.now()
  });
  const summarizer = new SessionSummarizer;
  await summarizer.summarize(hook.session_id, project).catch(() => {});
}
function extractCompactSection(text, names) {
  for (const name of names) {
    const re = new RegExp(`\\d+\\.\\s*${name}[^:\\n]*:\\s*([\\s\\S]*?)(?=\\n\\s*\\d+\\.\\s|$)`, "i");
    const m = text.match(re);
    if (m?.[1]?.trim())
      return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}
function prependCompactLead(summary) {
  const intent = extractCompactSection(summary, ["Primary Request and Intent", "Primary Request"]);
  if (!intent)
    return summary;
  let lead = intent.slice(0, 500);
  const current = extractCompactSection(summary, ["Current Work", "Current State", "Current work"]);
  if (current)
    lead += ` Currently: ${current.slice(0, 300)}`;
  return `${lead}

${summary}`;
}
function recencyWeight(createdAt, now) {
  const hoursAgo = (now - createdAt) / (1000 * 60 * 60);
  return Math.max(0.1, 1 / (1 + hoursAgo));
}
function estimateTokenSavings2(summaryLength, fileCount) {
  return fileCount * 500 + summaryLength / 4;
}
var init_compact_interceptor = __esm(() => {
  init_session_store();
  init_long_term_store();
  init_session_summarizer();
});

// src/worker/hook-dispatch.ts
var exports_hook_dispatch = {};
__export(exports_hook_dispatch, {
  dispatchHookEvent: () => dispatchHookEvent
});
function resolveProject(sessionId, cwd) {
  if (sessionId) {
    try {
      const row = getDatabase().query("SELECT project FROM sessions WHERE id = ?").get(sessionId);
      if (row?.project)
        return row.project;
    } catch {}
  }
  return projectFromCwd(cwd);
}
async function dispatchHookEvent(event, raw, cwd, options = {}) {
  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!hook || typeof hook !== "object")
    return "";
  switch (event) {
    case "session-start": {
      const h = hook;
      const project = projectFromCwd(h.cwd ?? cwd);
      const { additionalContext } = await handleSessionStart(h, project);
      if (!additionalContext)
        return "";
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext }
      }) + `
`;
    }
    case "user-prompt-submit": {
      const h = hook;
      const project = resolveProject(h.session_id, h.cwd ?? cwd);
      const { additionalContext } = await handleUserPromptSubmit(h, project);
      return additionalContext ? JSON.stringify({ additionalContext }) + `
` : "";
    }
    case "post-tool-use":
      return runPostToolUse(hook, cwd, options.inWorker === true);
    case "session-end": {
      const h = hook;
      const { runSessionEnd: runSessionEnd2 } = await Promise.resolve().then(() => (init_session_end_pipeline(), exports_session_end_pipeline));
      await runSessionEnd2(h, resolveProject(h.session_id, h.cwd ?? cwd));
      return "";
    }
    case "pre-compact": {
      const { handlePreCompact: handlePreCompact2 } = await Promise.resolve().then(() => (init_compact_interceptor(), exports_compact_interceptor));
      const h = hook;
      const instructions = await handlePreCompact2(hook, resolveProject(h.session_id, cwd));
      return instructions.trim() ? instructions : "";
    }
    case "post-compact": {
      const { handlePostCompact: handlePostCompact2 } = await Promise.resolve().then(() => (init_compact_interceptor(), exports_compact_interceptor));
      const h = hook;
      await handlePostCompact2(hook, resolveProject(h.session_id, cwd));
      return `Memory Hub: context preserved.
`;
    }
  }
}
async function runPostToolUse(hook, cwd, inWorker) {
  const project = resolveProject(hook.session_id, cwd);
  if (!inWorker && isBatchEnabled()) {
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
  if (hook.tool_name.startsWith("mcp__claude-memory-hub__")) {
    markMemoryToolUsed(hook.session_id);
  }
  try {
    const result = evaluateProactiveInjection(hook.session_id, hook.tool_name, hook.tool_input ?? {}, hook.tool_response ?? {});
    if (result.shouldInject && result.additionalContext) {
      return JSON.stringify({ additionalContext: result.additionalContext }) + `
`;
    }
  } catch {}
  return "";
}
var init_hook_dispatch = __esm(() => {
  init_hook_handler();
  init_session_start_handler();
  init_schema();
  init_entity_extractor();
  init_batch_queue();
  init_proactive_retrieval();
});

// src/worker/worker-client.ts
import { existsSync as existsSync13, readFileSync as readFileSync9, unlinkSync as unlinkSync3, writeFileSync as writeFileSync6 } from "fs";
import { join as join13 } from "path";
import { homedir as homedir11 } from "os";

// src/worker/worker-server.ts
init_logger();
init_hook_dispatch();
import { join as join12 } from "path";
import { homedir as homedir10 } from "os";
var log19 = createLogger("worker");
var DEFAULT_WORKER_PORT = 37889;
var IDLE_EXIT_MS = 6 * 60 * 60 * 1000;
var PID_PATH = join12(homedir10(), ".claude-memory-hub", "worker.pid");
var VALID_EVENTS = new Set([
  "session-start",
  "user-prompt-submit",
  "post-tool-use",
  "session-end",
  "pre-compact",
  "post-compact"
]);
function getWorkerPort() {
  return Number(process.env["CLAUDE_MEMORY_HUB_WORKER_PORT"]) || DEFAULT_WORKER_PORT;
}

// src/worker/worker-client.ts
var HOOK_TIMEOUT_MS = 4000;
var SPAWN_THROTTLE_MS = 30000;
var HUNG_KILL_THRESHOLD = 2;
var STABLE_DIR = join13(homedir11(), ".claude-memory-hub");
var SPAWN_MARKER = join13(STABLE_DIR, "worker-spawn.json");
var TIMEOUT_MARKER = join13(STABLE_DIR, "worker-timeouts.json");
var PID_PATH2 = join13(STABLE_DIR, "worker.pid");
async function callWorkerHook(event, raw, cwd) {
  if (process.env["CLAUDE_MEMORY_HUB_WORKER"] === "disabled")
    return;
  try {
    const res = await fetch(`http://127.0.0.1:${getWorkerPort()}/hook/${event}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, cwd }),
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS)
    });
    if (!res.ok)
      return;
    const data = await res.json();
    clearTimeoutStreak();
    return typeof data.out === "string" ? data.out : "";
  } catch (err) {
    if (isTimeout(err))
      recordTimeoutAndMaybeKill();
    else
      ensureWorkerSpawned();
    return;
  }
}
function isTimeout(err) {
  const name = err?.name ?? "";
  return name === "TimeoutError" || name === "AbortError";
}
function clearTimeoutStreak() {
  try {
    if (existsSync13(TIMEOUT_MARKER))
      unlinkSync3(TIMEOUT_MARKER);
  } catch {}
}
function recordTimeoutAndMaybeKill() {
  try {
    let count = 0;
    try {
      if (existsSync13(TIMEOUT_MARKER)) {
        count = Number(JSON.parse(readFileSync9(TIMEOUT_MARKER, "utf-8")).count) || 0;
      }
    } catch {}
    count++;
    writeFileSync6(TIMEOUT_MARKER, JSON.stringify({ count, at: Date.now() }), "utf-8");
    if (count >= HUNG_KILL_THRESHOLD && existsSync13(PID_PATH2)) {
      const pid = Number(readFileSync9(PID_PATH2, "utf-8"));
      if (pid > 1) {
        try {
          process.kill(pid);
        } catch {}
      }
      clearTimeoutStreak();
      ensureWorkerSpawned();
    }
  } catch {}
}
function ensureWorkerSpawned() {
  try {
    if (process.env["CLAUDE_MEMORY_HUB_WORKER"] === "disabled")
      return;
    try {
      if (existsSync13(SPAWN_MARKER)) {
        const parsed = JSON.parse(readFileSync9(SPAWN_MARKER, "utf-8"));
        if (typeof parsed.at === "number" && Date.now() - parsed.at < SPAWN_THROTTLE_MS)
          return;
      }
    } catch {}
    writeFileSync6(SPAWN_MARKER, JSON.stringify({ at: Date.now() }), "utf-8");
    const entry = join13(STABLE_DIR, "dist", "worker.js");
    if (!existsSync13(entry))
      return;
    const proc = Bun.spawn([process.execPath, "run", entry], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, CLAUDE_MEMORY_HUB_SKIP_HOOKS: "" }
    });
    proc.unref();
  } catch {}
}

// src/hooks-entry/pre-compact.ts
async function main() {
  if (process.env["CLAUDE_MEMORY_HUB_SKIP_HOOKS"] === "1")
    return;
  const raw = await Bun.stdin.text();
  if (!raw.trim())
    return;
  const cwd = process.env["CLAUDE_CWD"] ?? process.cwd();
  const viaWorker = await callWorkerHook("pre-compact", raw, cwd);
  if (viaWorker !== undefined) {
    if (viaWorker)
      process.stdout.write(viaWorker);
    return;
  }
  const { dispatchHookEvent: dispatchHookEvent2 } = await Promise.resolve().then(() => (init_hook_dispatch(), exports_hook_dispatch));
  const out = await dispatchHookEvent2("pre-compact", raw, cwd);
  if (out)
    process.stdout.write(out);
}
main().catch(() => {}).finally(() => process.exit(0));

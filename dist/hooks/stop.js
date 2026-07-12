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
      log2.error("scan failed", { error: String(err) });
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
      log2.error(`scanSkillDir ${dir}`, { error: String(err) });
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
      log2.error(`scanFlatAgents ${dir}`, { error: String(err) });
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
      log2.error("scanAgentPackages", { error: String(err) });
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
      log2.error(`scanAgentPackageDir ${packageDir}`, { error: String(err) });
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
      log2.error(`scanCommandDir ${dir}`, { error: String(err) });
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
      log2.error(`scanWorkflows ${dir}`, { error: String(err) });
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
var log2, CHARS_PER_TOKEN = 3.75, SCAN_TTL_MS, SAFE_NAME_RE, SAFE_COMMAND_NAME_RE, MAX_DIR_WALK_DEPTH = 5, _instance;
var init_resource_registry = __esm(() => {
  init_logger();
  init_resource_tracker();
  log2 = createLogger("resource-registry");
  SCAN_TTL_MS = 5 * 60 * 1000;
  SAFE_NAME_RE = /^[a-zA-Z0-9_\-:.]+$/;
  SAFE_COMMAND_NAME_RE = /^[a-zA-Z0-9_\-:.\/]+$/;
});

// src/capture/batch-queue.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync2, writeFileSync, appendFileSync as appendFileSync2, unlinkSync, statSync as statSync2 } from "fs";
import { join as join4 } from "path";
import { homedir as homedir4 } from "os";
function enqueueEvent(event) {
  try {
    ensureBatchDir();
    const line = JSON.stringify(event) + `
`;
    appendFileSync2(QUEUE_PATH, line, "utf-8");
  } catch (err) {
    log3.error("enqueue failed", { error: String(err) });
    throw err;
  }
}
function tryFlush() {
  try {
    if (!existsSync4(QUEUE_PATH))
      return false;
    const stat = statSync2(QUEUE_PATH);
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
    log3.error("flush failed", { error: String(err) });
    return false;
  }
}
function flushQueue() {
  const content = readFileSync2(QUEUE_PATH, "utf-8").trim();
  if (!content)
    return;
  const events = [];
  for (const line of content.split(`
`)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      log3.warn("skipping malformed queue line");
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
  log3.info("batch flushed", { events: events.length });
}
function tryAcquireLock() {
  try {
    if (existsSync4(LOCK_PATH)) {
      const lockContent = readFileSync2(LOCK_PATH, "utf-8").trim();
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
  if (!existsSync4(BATCH_DIR)) {
    mkdirSync3(BATCH_DIR, { recursive: true, mode: 448 });
  }
}
function isBatchEnabled() {
  const mode = process.env["CLAUDE_MEMORY_HUB_BATCH"] ?? "auto";
  return mode !== "disabled";
}
var log3, DATA_DIR, BATCH_DIR, QUEUE_PATH, LOCK_PATH, MAX_QUEUE_SIZE, LOCK_STALE_MS = 30000;
var init_batch_queue = __esm(() => {
  init_session_store();
  init_resource_tracker();
  init_resource_registry();
  init_logger();
  log3 = createLogger("batch-queue");
  DATA_DIR = join4(homedir4(), ".claude-memory-hub");
  BATCH_DIR = join4(DATA_DIR, "batch");
  QUEUE_PATH = join4(BATCH_DIR, "queue.jsonl");
  LOCK_PATH = join4(BATCH_DIR, "queue.lock");
  MAX_QUEUE_SIZE = 100 * 1024;
});

// src/hooks-entry/stop.ts
init_batch_queue();
async function main() {
  if (process.env["CLAUDE_MEMORY_HUB_SKIP_HOOKS"] === "1")
    return;
  await Bun.stdin.text();
  try {
    tryFlush();
  } catch {}
}
main().catch(() => {}).finally(() => process.exit(0));

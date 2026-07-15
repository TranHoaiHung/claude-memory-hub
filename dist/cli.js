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
    const { existsSync: existsSync4, readFileSync } = __require("fs");
    const { join: join4 } = __require("path");
    const { homedir: homedir4 } = __require("os");
    const configPath = join4(homedir4(), ".claude-memory-hub", "privacy.json");
    if (!existsSync4(configPath))
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
import { existsSync as existsSync4, readdirSync, statSync, readFileSync } from "fs";
import { join as join4, basename, relative } from "path";
import { homedir as homedir4 } from "os";

class ResourceRegistry {
  resources = new Map;
  lastScanAt = 0;
  claudeDir;
  constructor() {
    this.claudeDir = join4(homedir4(), ".claude");
  }
  scan(cwd) {
    if (Date.now() - this.lastScanAt < SCAN_TTL_MS && this.resources.size > 0)
      return;
    this.resources.clear();
    try {
      this.scanSkills(join4(this.claudeDir, "skills"), cwd);
      this.scanFlatAgents(join4(this.claudeDir, "agents"));
      this.scanAgentPackages(this.claudeDir);
      this.scanCommands(join4(this.claudeDir, "commands"), cwd);
      this.scanWorkflows(join4(this.claudeDir, "workflows"));
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
      const projectDir = join4(cwd, ".claude", "skills");
      if (existsSync4(projectDir)) {
        this.scanSkillDir(projectDir, "project");
      }
    }
  }
  scanSkillDir(dir, source) {
    if (!existsSync4(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory())
          continue;
        const name = entry.name;
        if (!SAFE_NAME_RE.test(name))
          continue;
        const skillDir = join4(dir, name);
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
    if (!existsSync4(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        if (entry.name === "README.md")
          continue;
        const filePath = join4(dir, entry.name);
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
    if (!existsSync4(claudeDir))
      return;
    try {
      for (const entry of readdirSync(claudeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("agent_"))
          continue;
        const packageDir = join4(claudeDir, entry.name);
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
          const subDir = join4(packageDir, entry.name);
          const agentFile = join4(subDir, "AGENT.md");
          if (existsSync4(agentFile)) {
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
          const filePath = join4(packageDir, entry.name);
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
    if (existsSync4(globalDir))
      this.scanCommandDir(globalDir, globalDir, "global");
    if (cwd) {
      const projectDir = join4(cwd, ".claude", "commands");
      if (existsSync4(projectDir))
        this.scanCommandDir(projectDir, projectDir, "project");
    }
  }
  scanCommandDir(dir, baseDir, source) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.scanCommandDir(join4(dir, entry.name), baseDir, source);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const filePath = join4(dir, entry.name);
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
    if (!existsSync4(dir))
      return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
          continue;
        const filePath = join4(dir, entry.name);
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
    const globalFile = join4(this.claudeDir, "CLAUDE.md");
    if (existsSync4(globalFile)) {
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
      join4(cwd, "CLAUDE.md"),
      join4(cwd, ".claude", "CLAUDE.md")
    ];
    for (const file of projectFiles) {
      if (!existsSync4(file))
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
      const p = join4(dir, c);
      if (existsSync4(p))
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
          const p = join4(d, entry.name);
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
import { existsSync as existsSync5, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir5 } from "os";
import { join as join5, dirname, basename as basename2 } from "path";

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
    const homeClaudeMd = join5(homedir5(), ".claude", "CLAUDE.md");
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
      const file = join5(current, "CLAUDE.md");
      if (existsSync5(file))
        paths.push(file);
      const dotClaudeFile = join5(current, ".claude", "CLAUDE.md");
      if (existsSync5(dotClaudeFile))
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
import { existsSync as existsSync6, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join6 } from "path";
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
  if (!cwd || !existsSync6(cwd)) {
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
  const has = (rel) => existsSync6(join6(cwd, rel));
  if (has("package.json")) {
    s.has_typescript = has("tsconfig.json") || has("tsconfig.base.json");
    try {
      const pkg = JSON.parse(__require("fs").readFileSync(join6(cwd, "package.json"), "utf-8"));
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
    const p = join6(cwd, name);
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
function aggregateInjections(options = {}) {
  const since = options.sinceMs ?? SINCE_LAST_30D();
  const d = options.db ?? getDatabase();
  const totals = d.query(`SELECT
        COUNT(*)                                     as n,
        AVG(total_injection_chars)                   as avg_total,
        AVG(memory_section_chars)                    as avg_memory,
        AVG(smart_match_count)                       as avg_match_count,
        AVG(smart_match_top_score)                   as avg_top_score,
        SUM(CASE WHEN smart_match_count   > 0 THEN 1 ELSE 0 END) as with_match,
        SUM(CASE WHEN history_intent_matched = 1 THEN 1 ELSE 0 END) as with_history,
        SUM(CASE WHEN awareness_hint_chars > 0 THEN 1 ELSE 0 END) as with_hint,
        AVG(curated_chars)                           as avg_curated,
        SUM(CASE WHEN curated_chars > 0 THEN 1 ELSE 0 END) as with_curated
     FROM injection_log WHERE timestamp >= ?`).get(since);
  const total = totals?.n ?? 0;
  const toolUse = d.query(`SELECT COUNT(DISTINCT session_id) as sessions,
            COUNT(DISTINCT CASE WHEN memory_tool_used = 1 THEN session_id END) as used
     FROM injection_log WHERE timestamp >= ?`).get(since);
  const byIntent = d.query(`SELECT intent, COUNT(*) count,
            AVG(total_injection_chars) avg_total,
            AVG(memory_section_chars)  avg_memory,
            AVG(claude_md_chars)       avg_claude_md
     FROM injection_log WHERE timestamp >= ?
     GROUP BY intent ORDER BY count DESC`).all(since);
  return {
    total_injections: total,
    avg_total_chars: Math.round(totals?.avg_total ?? 0),
    avg_memory_chars: Math.round(totals?.avg_memory ?? 0),
    avg_smart_match_count: Number((totals?.avg_match_count ?? 0).toFixed(2)),
    avg_top_score: Number((totals?.avg_top_score ?? 0).toFixed(3)),
    prompts_with_match: totals?.with_match ?? 0,
    prompts_with_match_pct: total > 0 ? Number(((totals?.with_match ?? 0) / total * 100).toFixed(1)) : 0,
    history_intent_count: totals?.with_history ?? 0,
    awareness_hint_count: totals?.with_hint ?? 0,
    avg_curated_chars: Math.round(totals?.avg_curated ?? 0),
    curated_shown_count: totals?.with_curated ?? 0,
    sessions_with_memory_tool_use: toolUse?.used ?? 0,
    memory_tool_hit_rate_pct: (toolUse?.sessions ?? 0) > 0 ? Number(((toolUse?.used ?? 0) / (toolUse?.sessions ?? 1) * 100).toFixed(1)) : 0,
    by_intent: byIntent.map((b) => ({
      intent: b.intent ?? "unknown",
      count: b.count,
      avg_total_chars: Math.round(b.avg_total ?? 0),
      avg_memory_chars: Math.round(b.avg_memory ?? 0),
      avg_claude_md_chars: Math.round(b.avg_claude_md ?? 0)
    }))
  };
}
function pruneInjectionLog(olderThanDays = 90, db) {
  const d = db ?? getDatabase();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const result = d.run(`DELETE FROM injection_log WHERE timestamp < ?`, [cutoff]);
  return result.changes;
}
var log8, SINCE_LAST_30D = () => Date.now() - 30 * 86400000;
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
import { existsSync as existsSync7, readFileSync as readFileSync3, writeFileSync, mkdirSync as mkdirSync3, unlinkSync } from "fs";
import { join as join7 } from "path";
import { homedir as homedir6 } from "os";
function statePath(sessionId) {
  return join7(STATE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}-inject.json`);
}
function loadInjectionState(sessionId) {
  try {
    const path = statePath(sessionId);
    if (existsSync7(path)) {
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
    if (!existsSync7(STATE_DIR)) {
      mkdirSync3(STATE_DIR, { recursive: true, mode: 448 });
    }
    writeFileSync(statePath(sessionId), JSON.stringify(state), "utf-8");
  } catch {}
}
function cleanupInjectionState(sessionId) {
  try {
    const path = statePath(sessionId);
    if (existsSync7(path))
      unlinkSync(path);
  } catch {}
}
var STATE_DIR;
var init_injection_state = __esm(() => {
  STATE_DIR = join7(homedir6(), ".claude-memory-hub", "proactive");
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
import { existsSync as existsSync8, mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
import { join as join8 } from "path";
import { homedir as homedir7 } from "os";
function getVaultRoot() {
  return process.env["CLAUDE_MEMORY_HUB_OBSIDIAN_VAULT"] ?? DEFAULT_VAULT;
}
function getMemoryHubRoot() {
  return join8(getVaultRoot(), SUBFOLDER);
}
function contentHash(text) {
  return Bun.hash(text).toString(16);
}
function syncObsidianVault(options = {}) {
  const d = options.db ?? getDatabase();
  const root = getMemoryHubRoot();
  ensureDir(root);
  ensureDir(join8(root, "_meta"));
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
    const dir = join8("Projects", safeName(row.project), "Sessions");
    ensureDir(join8(root, dir));
    write(join8(dir, `${isoDate(row.created_at)} ${row.session_id.slice(0, 8)}.md`), renderSessionNote(row, d));
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
    const dir = join8("Projects", safeName(row.project), "Decisions");
    ensureDir(join8(root, dir));
    write(join8(dir, `${slug(row.entity_value)} (${row.id}).md`), renderDecisionNote(row));
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
    const dir = join8("Files", safeName(f.project));
    ensureDir(join8(root, dir));
    write(join8(dir, fileNoteName(f.entity_value)), renderFileNote(f, d));
    result.file_notes_exported++;
  }
  saveSyncState(root, state);
  const projects = d.query(`SELECT project, COUNT(*) sessions FROM long_term_summaries GROUP BY project ORDER BY MAX(created_at) DESC`).all();
  result.projects = projects.length;
  for (const p of projects) {
    if (options.project && p.project !== options.project)
      continue;
    const dir = join8(root, "Projects", safeName(p.project));
    if (!existsSync8(dir))
      continue;
    write(join8("Projects", safeName(p.project), `${safeName(p.project)}.md`), renderProjectMoc(p.project, d));
  }
  write("Home.md", renderHome(projects));
  saveSyncState(root, state);
  log9.info("obsidian sync complete", { ...result });
  return result;
}
function writeNoteGuarded(root, state, relPath, content) {
  const abs = join8(root, relPath);
  const newHash = contentHash(content);
  const recorded = state.written[relPath];
  if (existsSync8(abs)) {
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
  const dir = join8(root, "Notes");
  if (existsSync8(dir))
    return;
  ensureDir(dir);
  writeFileSync2(join8(dir, "README.md"), [
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
    const parsed = JSON.parse(readFileSync4(join8(root, "_meta", "sync-state.json"), "utf-8"));
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
  ensureDir(join8(root, "_meta"));
  writeFileSync2(join8(root, "_meta", "sync-state.json"), JSON.stringify(state, null, 2), "utf-8");
}
function ensureDir(dir) {
  if (!existsSync8(dir))
    mkdirSync4(dir, { recursive: true });
}
var log9, DEFAULT_VAULT, SUBFOLDER = "MemoryHub", FILE_NOTE_MIN_TOUCHES = 3;
var init_obsidian_exporter = __esm(() => {
  init_schema();
  init_logger();
  log9 = createLogger("obsidian-exporter");
  DEFAULT_VAULT = join8(homedir7(), "Documents", "ObsidianVault");
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
import { existsSync as existsSync9, readFileSync as readFileSync5, readdirSync as readdirSync3, statSync as statSync3 } from "fs";
import { join as join9 } from "path";
function syncVaultReadback(options = {}) {
  const result = { scanned: 0, indexed: 0, removed: 0 };
  const root = getMemoryHubRoot();
  if (!existsSync9(root))
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
    if (relPath === "Home.md" || relPath === join9("Notes", "README.md"))
      continue;
    result.scanned++;
    seen.add(relPath);
    const mtime = Math.floor(statSync3(join9(root, relPath)).mtimeMs);
    const existing = known.get(relPath);
    if (existing && existing.mtime === mtime)
      continue;
    const raw = readFileSync5(join9(root, relPath), "utf-8");
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
  const dir = join9(root, rel);
  let entries;
  try {
    entries = readdirSync3(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "_meta")
      continue;
    const childRel = rel ? join9(rel, e.name) : e.name;
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
import { existsSync as existsSync10, mkdirSync as mkdirSync5, readFileSync as readFileSync6, writeFileSync as writeFileSync3, appendFileSync as appendFileSync2, unlinkSync as unlinkSync2, statSync as statSync4 } from "fs";
import { join as join10 } from "path";
import { homedir as homedir8 } from "os";
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
    if (!existsSync10(QUEUE_PATH))
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
    if (existsSync10(LOCK_PATH)) {
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
  if (!existsSync10(BATCH_DIR)) {
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
  DATA_DIR = join10(homedir8(), ".claude-memory-hub");
  BATCH_DIR = join10(DATA_DIR, "batch");
  QUEUE_PATH = join10(BATCH_DIR, "queue.jsonl");
  LOCK_PATH = join10(BATCH_DIR, "queue.lock");
  MAX_QUEUE_SIZE = 100 * 1024;
});

// src/retrieval/proactive-retrieval.ts
import { existsSync as existsSync11, readFileSync as readFileSync7, writeFileSync as writeFileSync4, mkdirSync as mkdirSync6 } from "fs";
import { join as join11 } from "path";
import { homedir as homedir9 } from "os";
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
    if (existsSync11(path)) {
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
  return join11(PROACTIVE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}
function loadState(sessionId) {
  const path = statePath2(sessionId);
  try {
    if (existsSync11(path)) {
      return JSON.parse(readFileSync7(path, "utf-8"));
    }
  } catch {}
  return { toolCallCount: 0, lastInjectionAt: 0, injectedTopics: [], recentFiles: [] };
}
function saveState(sessionId, state) {
  try {
    if (!existsSync11(PROACTIVE_DIR)) {
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
  DATA_DIR2 = join11(homedir9(), ".claude-memory-hub");
  PROACTIVE_DIR = join11(DATA_DIR2, "proactive");
});

// src/capture/transcript-parser.ts
import { createReadStream, existsSync as existsSync12, statSync as statSync5 } from "fs";
import { createInterface } from "readline";
async function parseTranscript(transcriptPath, sessionId, project) {
  if (!transcriptPath || !existsSync12(transcriptPath)) {
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
  const { existsSync: existsSync13, readFileSync: readFileSync8, writeFileSync: writeFileSync5 } = __require("fs");
  const { join: join12 } = __require("path");
  const { homedir: homedir10 } = __require("os");
  const path = join12(homedir10(), ".claude-memory-hub", "cli-summary-budget.json");
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  try {
    if (existsSync13(path)) {
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
var exports_session_summarizer = {};
__export(exports_session_summarizer, {
  upgradeRuleBasedSummaries: () => upgradeRuleBasedSummaries,
  SessionSummarizer: () => SessionSummarizer
});

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
async function upgradeRuleBasedSummaries(days = 7, max = 5) {
  const ltStore = new LongTermStore;
  const summarizer = new SessionSummarizer;
  const candidates = ltStore.getRuleBasedSummaries(days, max);
  let upgraded = 0;
  for (const c of candidates) {
    await summarizer.summarize(c.session_id, c.project, { upgradeOnly: true }).catch(() => {});
    if (ltStore.getSummary(c.session_id)?.tier === "cli")
      upgraded++;
  }
  return upgraded;
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
import { existsSync as existsSync13, readFileSync as readFileSync8, writeFileSync as writeFileSync5 } from "fs";
import { join as join12 } from "path";
import { homedir as homedir10 } from "os";
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
    if (!existsSync13(MARKER_PATH))
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
  MARKER_PATH = join12(homedir10(), ".claude-memory-hub", "last-cleanup.json");
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

// src/worker/worker-server.ts
var exports_worker_server = {};
__export(exports_worker_server, {
  startWorker: () => startWorker,
  getWorkerPort: () => getWorkerPort,
  DEFAULT_WORKER_PORT: () => DEFAULT_WORKER_PORT
});
import { existsSync as existsSync14, mkdirSync as mkdirSync7, statSync as statSync6, unlinkSync as unlinkSync3, writeFileSync as writeFileSync6 } from "fs";
import { join as join13 } from "path";
import { homedir as homedir11 } from "os";
function getWorkerPort() {
  return Number(process.env["CLAUDE_MEMORY_HUB_WORKER_PORT"]) || DEFAULT_WORKER_PORT;
}
function startWorker() {
  const port = getWorkerPort();
  const startedAt = Date.now();
  let lastRequestAt = Date.now();
  const entryPath = join13(homedir11(), ".claude-memory-hub", "dist", "worker.js");
  const entryMtime = safeMtime(entryPath);
  let exitScheduled = false;
  const maybeScheduleRestart = () => {
    if (exitScheduled || entryMtime === null)
      return;
    if (safeMtime(entryPath) !== entryMtime) {
      exitScheduled = true;
      log19.info("worker entry changed on disk \u2014 restarting after response");
      setTimeout(() => {
        try {
          unlinkSync3(PID_PATH);
        } catch {}
        process.exit(0);
      }, 250);
    }
  };
  let server;
  try {
    server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      async fetch(req) {
        lastRequestAt = Date.now();
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return json({
            ok: true,
            pid: process.pid,
            uptime_s: Math.round((Date.now() - startedAt) / 1000)
          });
        }
        if (req.method === "POST" && url.pathname.startsWith("/hook/")) {
          const event = url.pathname.slice("/hook/".length);
          if (!VALID_EVENTS.has(event))
            return json({ error: "unknown event" }, 404);
          try {
            const body = await req.json();
            const out = await dispatchHookEvent(event, body.raw ?? "", body.cwd ?? process.cwd(), { inWorker: true });
            maybeScheduleRestart();
            return json({ out });
          } catch (err) {
            log19.error("worker dispatch failed", { event, error: String(err) });
            return json({ error: String(err) }, 500);
          }
        }
        return json({ error: "not found" }, 404);
      }
    });
  } catch (err) {
    log19.info("worker not started (port in use)", { port, error: String(err) });
    return null;
  }
  try {
    const dir = join13(homedir11(), ".claude-memory-hub");
    if (!existsSync14(dir))
      mkdirSync7(dir, { recursive: true, mode: 448 });
    writeFileSync6(PID_PATH, String(process.pid), "utf-8");
  } catch {}
  const idleTimer = setInterval(() => {
    if (Date.now() - lastRequestAt > IDLE_EXIT_MS) {
      log19.info("worker idle timeout, exiting");
      try {
        unlinkSync3(PID_PATH);
      } catch {}
      server.stop();
      process.exit(0);
    }
  }, 10 * 60 * 1000);
  if (typeof idleTimer.unref === "function")
    idleTimer.unref();
  log19.info("worker started", { port, pid: process.pid });
  console.log(`claude-memory-hub worker on http://127.0.0.1:${port} (pid ${process.pid})`);
  return server;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function safeMtime(path) {
  try {
    return statSync6(path).mtimeMs;
  } catch {
    return null;
  }
}
var log19, DEFAULT_WORKER_PORT = 37889, IDLE_EXIT_MS, PID_PATH, VALID_EVENTS;
var init_worker_server = __esm(() => {
  init_logger();
  init_hook_dispatch();
  log19 = createLogger("worker");
  IDLE_EXIT_MS = 6 * 60 * 60 * 1000;
  PID_PATH = join13(homedir11(), ".claude-memory-hub", "worker.pid");
  VALID_EVENTS = new Set([
    "session-start",
    "user-prompt-submit",
    "post-tool-use",
    "session-end",
    "pre-compact",
    "post-compact"
  ]);
});

// src/worker/worker-client.ts
var exports_worker_client = {};
__export(exports_worker_client, {
  workerHealth: () => workerHealth,
  ensureWorkerSpawned: () => ensureWorkerSpawned,
  callWorkerHook: () => callWorkerHook
});
import { existsSync as existsSync15, readFileSync as readFileSync9, unlinkSync as unlinkSync4, writeFileSync as writeFileSync7 } from "fs";
import { join as join14 } from "path";
import { homedir as homedir12 } from "os";
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
    if (existsSync15(TIMEOUT_MARKER))
      unlinkSync4(TIMEOUT_MARKER);
  } catch {}
}
function recordTimeoutAndMaybeKill() {
  try {
    let count = 0;
    try {
      if (existsSync15(TIMEOUT_MARKER)) {
        count = Number(JSON.parse(readFileSync9(TIMEOUT_MARKER, "utf-8")).count) || 0;
      }
    } catch {}
    count++;
    writeFileSync7(TIMEOUT_MARKER, JSON.stringify({ count, at: Date.now() }), "utf-8");
    if (count >= HUNG_KILL_THRESHOLD && existsSync15(PID_PATH2)) {
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
      if (existsSync15(SPAWN_MARKER)) {
        const parsed = JSON.parse(readFileSync9(SPAWN_MARKER, "utf-8"));
        if (typeof parsed.at === "number" && Date.now() - parsed.at < SPAWN_THROTTLE_MS)
          return;
      }
    } catch {}
    writeFileSync7(SPAWN_MARKER, JSON.stringify({ at: Date.now() }), "utf-8");
    const entry = join14(STABLE_DIR, "dist", "worker.js");
    if (!existsSync15(entry))
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
async function workerHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${getWorkerPort()}/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok)
      return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}
var HOOK_TIMEOUT_MS = 4000, SPAWN_THROTTLE_MS = 30000, HUNG_KILL_THRESHOLD = 2, STABLE_DIR, SPAWN_MARKER, TIMEOUT_MARKER, PID_PATH2;
var init_worker_client = __esm(() => {
  init_worker_server();
  STABLE_DIR = join14(homedir12(), ".claude-memory-hub");
  SPAWN_MARKER = join14(STABLE_DIR, "worker-spawn.json");
  TIMEOUT_MARKER = join14(STABLE_DIR, "worker-timeouts.json");
  PID_PATH2 = join14(STABLE_DIR, "worker.pid");
});

// src/health/monitor.ts
var exports_monitor = {};
__export(exports_monitor, {
  runHealthCheck: () => runHealthCheck,
  formatHealthReport: () => formatHealthReport,
  cleanupOldData: () => cleanupOldData
});
import { existsSync as existsSync16, statSync as statSync7 } from "fs";
import { homedir as homedir13 } from "os";
import { join as join15 } from "path";
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
  const dbDir = join15(homedir13(), ".claude-memory-hub");
  const dbPath = join15(dbDir, "memory.db");
  try {
    if (!existsSync16(dbPath)) {
      return { component: "disk", status: "ok", message: "DB not yet created", latency_ms: 0 };
    }
    const dbSize = statSync7(dbPath).size;
    let totalSize = dbSize;
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync16(walPath))
      totalSize += statSync7(walPath).size;
    if (existsSync16(shmPath))
      totalSize += statSync7(shmPath).size;
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
    log20.warn("Failed to persist health check", { error: String(e) });
  }
  const report = { overall, checks, checked_at: now };
  if (overall !== "ok") {
    log20.warn("Health check degraded", { overall, checks: checks.filter((c) => c.status !== "ok") });
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
    log20.info("Cleanup complete", { ...result });
  } catch (e) {
    log20.error("Cleanup failed", { error: String(e) });
  }
  return result;
}
var log20;
var init_monitor = __esm(() => {
  init_schema();
  init_logger();
  log20 = createLogger("health");
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
          if (!STOP_WORDS2.has(sp))
            tokens.push(sp);
        }
      }
      continue;
    }
    if (word.includes("_") && word.length > 3) {
      const parts = word.split("_").filter((p) => p.length > 1);
      for (const part of parts) {
        if (!STOP_WORDS2.has(part))
          tokens.push(part);
      }
      if (!STOP_WORDS2.has(word))
        tokens.push(word);
      continue;
    }
    if (word.length > 1 && !STOP_WORDS2.has(word)) {
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
    log21.info("IDF rebuilt", { totalDocs });
  } catch (e) {
    log21.error("IDF rebuild failed", { error: String(e) });
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
    log21.error("Vector search failed", { error: String(e) });
    return [];
  }
}
function reindexAll(db) {
  const d = db ?? getDatabase();
  log21.info("Starting full reindex...");
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
  log21.info("Full reindex complete", { summaries: summaries.length, entities: entities.length });
}
var log21, STOP_WORDS2;
var init_vector_search = __esm(() => {
  init_schema();
  init_logger();
  log21 = createLogger("vector-search");
  STOP_WORDS2 = new Set([
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
    const safeQuery = sanitizeFtsQuery2(query);
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
  try {
    const safeQuery = sanitizeFtsQuery2(query);
    if (safeQuery) {
      const curatedResults = d.prepare(`SELECT cn.id, cn.project, SUBSTR(cn.title || ' \u2014 ' || cn.content, 1, 80) as title, cn.mtime
         FROM fts_curated
         JOIN curated_notes cn ON cn.id = fts_curated.rowid
         WHERE fts_curated MATCH ?1
         ORDER BY rank
         LIMIT ?2`).all(safeQuery, limit);
      for (const r of curatedResults) {
        results.push({
          id: r.id,
          type: "curated",
          title: r.title,
          project: r.project ?? "global",
          created_at: r.mtime,
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
      const key2 = `${sr.doc_type}:${sr.doc_id}`;
      if (results.some((r) => `${r.type}:${r.id}` === key2))
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
      } else if (sr.doc_type === "curated") {
        const row = d.prepare("SELECT id, project, SUBSTR(title || ' \u2014 ' || content, 1, 80) as title, mtime FROM curated_notes WHERE id = ?").get(sr.doc_id);
        if (row) {
          results.push({ id: row.id, type: "curated", title: row.title, project: row.project ?? "global", created_at: row.mtime, score: sr.score });
        }
      }
    }
  } catch {}
  const filtered = opts.project ? results.filter((r) => r.project === opts.project) : results;
  const deduped = new Map;
  for (const r of filtered) {
    const key2 = `${r.type}:${r.id}`;
    const existing = deduped.get(key2);
    if (!existing) {
      deduped.set(key2, { ...r, sourceCount: 1 });
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
    if (r.type === "curated")
      score *= 1.3;
    return { ...r, score };
  });
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}
function sanitizeFtsQuery2(query) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/["*^():{}[\]]/g, "").trim()).filter((w) => w.length > 1);
  if (words.length === 0)
    return "";
  if (words.length === 1)
    return words[0] + "*";
  const head = words.slice(0, -1).map((w) => `"${w}"`);
  const last = words[words.length - 1];
  return [...head, `"${last}"*`].join(" ");
}
var log22;
var init_search_workflow = __esm(() => {
  init_schema();
  init_vector_search();
  init_semantic_search();
  init_logger();
  log22 = createLogger("search-workflow");
});

// src/ui/graph-api.ts
function buildGraphPayload(url) {
  const db = getDatabase();
  const project = url.searchParams.get("project");
  const relsParam = url.searchParams.get("rels");
  const rels = relsParam ? relsParam.split(",").filter((r) => ALL_RELS.includes(r)) : ALL_RELS;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_EDGE_LIMIT)), MAX_EDGE_LIMIT);
  if (rels.length === 0)
    return { nodes: [], edges: [], total_edges: 0, shown_edges: 0 };
  const relPlaceholders = rels.map(() => "?").join(",");
  const conditions = [`rel IN (${relPlaceholders})`];
  const params = [...rels];
  if (project) {
    conditions.push("project = ?");
    params.push(project);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM graph_edges WHERE ${conditions.join(" AND ")}`).get(...params)?.c ?? 0;
  params.push(limit);
  const rows = db.prepare(`SELECT src_type, src_key, dst_type, dst_key, rel, weight
     FROM graph_edges WHERE ${conditions.join(" AND ")}
     ORDER BY weight DESC LIMIT ?`).all(...params);
  const nodeIndex = new Map;
  const nodes = [];
  const edges = [];
  const intern = (type, key2) => {
    const id = `${type}:${key2}`;
    const existing = nodeIndex.get(id);
    if (existing !== undefined) {
      nodes[existing].degree++;
      return existing;
    }
    const idx = nodes.length;
    nodeIndex.set(id, idx);
    nodes.push({ id: key2, type, label: nodeLabel(type, key2), degree: 1 });
    return idx;
  };
  for (const r of rows) {
    edges.push({
      s: intern(r.src_type, r.src_key),
      d: intern(r.dst_type, r.dst_key),
      rel: r.rel,
      w: Math.round(r.weight * 100) / 100
    });
  }
  return { nodes, edges, total_edges: total, shown_edges: edges.length };
}
function nodeLabel(type, key2) {
  if (type === "file")
    return key2.split(/[\\/]/).pop() ?? key2;
  if (type === "session")
    return key2.slice(0, 8);
  return key2.length > 42 ? key2.slice(0, 39) + "\u2026" : key2;
}
var DEFAULT_EDGE_LIMIT = 400, MAX_EDGE_LIMIT = 1200, ALL_RELS;
var init_graph_api = __esm(() => {
  init_schema();
  ALL_RELS = ["co_edited", "imports", "session_touched", "error_in", "decided_about"];
});

// src/ui/viewer-page.ts
var VIEWER_HTML = `<!DOCTYPE html>
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
.app { max-width: 1180px; margin: 0 auto; padding: 32px 24px; }

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

/* Graph view */
#graphView { display: none; }

/* Obsidian tab */
#obsidianView { display: none; }
.obs-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.obs-flow { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 20px; font-size: 13px; color: var(--text-secondary); line-height: 1.8; }
.obs-flow b { color: var(--text); }
.obs-flow .arrow { color: var(--accent-light); font-weight: 600; }
.obs-kv { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.obs-kv:last-child { border-bottom: none; }
.obs-kv .k { color: var(--text-muted); }
.obs-kv .v { color: var(--text); text-align: right; word-break: break-all; }
.obs-pill { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.obs-pill.user { background: var(--green-bg); color: var(--green); }
.obs-pill.edited { background: var(--blue-bg); color: var(--blue); }
.graph-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.graph-controls select, .graph-controls input[type=text] { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 8px 12px; font-size: 13px; outline: none; }
.graph-controls select:focus, .graph-controls input[type=text]:focus { border-color: var(--accent); }
.graph-controls input[type=text] { width: 180px; }
.rel-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); color: var(--text-muted); background: var(--surface); transition: all var(--transition); user-select: none; }
.rel-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
.rel-chip.on { color: var(--text); border-color: var(--border-light); background: var(--card); }
.rel-chip.on .dot.co_edited { background: var(--blue); }
.rel-chip.on .dot.imports { background: var(--accent-light); }
.rel-chip.on .dot.session_touched { background: var(--yellow); }
.rel-chip.on .dot.error_in { background: var(--red); }
.rel-chip.on .dot.decided_about { background: var(--green); }
.graph-meta { font-size: 12px; color: var(--text-muted); margin-left: auto; }
.graph-wrap { position: relative; background: radial-gradient(ellipse at 50% 40%, #12121c 0%, var(--bg) 75%); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
#gCanvas { display: block; width: 100%; height: 620px; cursor: grab; }
#gCanvas.dragging { cursor: grabbing; }
.graph-legend { position: absolute; left: 14px; bottom: 12px; display: flex; gap: 14px; font-size: 11px; color: var(--text-muted); pointer-events: none; }
.graph-legend span { display: inline-flex; align-items: center; gap: 5px; }
.graph-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.graph-hint { position: absolute; right: 14px; bottom: 12px; font-size: 11px; color: var(--text-muted); pointer-events: none; }
.graph-panel { position: absolute; top: 12px; right: 12px; width: 320px; max-height: calc(100% - 24px); overflow-y: auto; background: rgba(18,18,26,0.94); border: 1px solid var(--border-light); border-radius: var(--radius); padding: 16px; backdrop-filter: blur(8px); }
.graph-panel h3 { font-size: 13px; font-weight: 600; word-break: break-all; margin-bottom: 4px; }
.graph-panel .gp-path { font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 10px; }
.graph-panel h4 { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 0 6px; }
.graph-panel ul { list-style: none; }
.graph-panel li { font-size: 12px; color: var(--text-secondary); padding: 3px 0; word-break: break-all; }
.graph-panel li.clickable { cursor: pointer; }
.graph-panel li.clickable:hover { color: var(--accent-light); }
.graph-panel .gp-close { position: absolute; top: 10px; right: 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; }
.graph-panel .gp-w { color: var(--text-muted); font-size: 11px; }

/* Responsive */
@media (max-width: 768px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .app { padding: 16px; }
  .header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .graph-panel { width: calc(100% - 24px); }
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

  <div class="search-wrap" id="searchWrap">
    <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="searchInput" type="text" placeholder="Search memories, files, decisions..." />
  </div>

  <div class="tabs" id="tabsContainer">
    <button class="tab active" data-tab="summaries">Summaries <span class="count" id="cnt-summaries"></span></button>
    <button class="tab" data-tab="sessions">Sessions <span class="count" id="cnt-sessions"></span></button>
    <button class="tab" data-tab="entities">Entities <span class="count" id="cnt-entities"></span></button>
    <button class="tab" data-tab="graph">Graph <span class="count" id="cnt-graph"></span></button>
    <button class="tab" data-tab="obsidian">Obsidian <span class="count" id="cnt-obsidian"></span></button>
  </div>

  <div id="results"></div>

  <div class="pagination" id="pagination">
    <button class="pg-btn" id="prevBtn" disabled>Previous</button>
    <span class="pg-info" id="pageInfo"></span>
    <button class="pg-btn" id="nextBtn">Next</button>
  </div>

  <div id="graphView">
    <div class="graph-controls">
      <select id="gProject"><option value="">All projects</option></select>
      <span class="rel-chip on" data-rel="co_edited"><i class="dot co_edited"></i>co-edited</span>
      <span class="rel-chip on" data-rel="imports"><i class="dot imports"></i>imports</span>
      <span class="rel-chip on" data-rel="error_in"><i class="dot error_in"></i>errors</span>
      <span class="rel-chip on" data-rel="decided_about"><i class="dot decided_about"></i>decisions</span>
      <span class="rel-chip" data-rel="session_touched"><i class="dot session_touched"></i>sessions</span>
      <input id="gFilter" type="text" placeholder="Highlight nodes..." />
      <span class="graph-meta" id="gMeta"></span>
    </div>
    <div class="graph-wrap">
      <canvas id="gCanvas"></canvas>
      <div class="graph-legend">
        <span><i style="background:#60a5fa"></i>file</span>
        <span><i style="background:#facc15"></i>session</span>
        <span><i style="background:#4ade80"></i>decision</span>
        <span><i style="background:#f87171"></i>error</span>
      </div>
      <div class="graph-hint">drag to pan &middot; scroll to zoom &middot; click a node &middot; double-click to fit</div>
      <div class="graph-panel" id="gPanel" hidden></div>
    </div>
  </div>

  <div id="obsidianView"></div>
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
      return '<div class="card"><div class="card-header"><span class="card-type type-' + (e.entity_type || "entity") + '">' + esc(e.entity_type) + '</span><div class="card-meta"><span>' + fmtDate(e.created_at) + '</span><span>' + esc(e.tool_name) + '</span><span>imp: ' + e.importance + '</span><span>touches: ' + (e.touch_count || 1) + '</span></div></div><div class="card-content">' + esc(e.entity_value) + (e.context ? "\\n" + esc(e.context) : "") + '</div></div>';
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

  // ==========================================================================
  // Graph tab \u2014 Obsidian-style force-directed canvas (zero dependencies)
  // ==========================================================================

  var G = {
    nodes: [], edges: [], alpha: 0,
    tx: 0, ty: 0, k: 1,
    drag: null, panStart: null, moved: false,
    hover: -1, sel: -1,
    raf: 0, inited: false,
    colors: { file: "#60a5fa", session: "#facc15", decision: "#4ade80", error: "#f87171" },
    edgeColors: { co_edited: "96,165,250", imports: "157,143,255", session_touched: "250,204,21", error_in: "248,113,113", decided_about: "74,222,128" }
  };

  function gCanvas() { return document.getElementById("gCanvas"); }

  function gResize() {
    var c = gCanvas(), dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function activeRels() {
    var rels = [];
    document.querySelectorAll(".rel-chip.on").forEach(function(ch){ rels.push(ch.getAttribute("data-rel")); });
    return rels;
  }

  function gLoad() {
    var proj = document.getElementById("gProject").value;
    var rels = activeRels();
    document.getElementById("gMeta").textContent = "loading...";
    api("/api/graph?limit=400&rels=" + rels.join(",") + (proj ? "&project=" + encodeURIComponent(proj) : "")).then(function(data) {
      if (!data || !data.nodes) { document.getElementById("gMeta").textContent = "no data"; return; }
      var c = gCanvas(), w = c.clientWidth, h = c.clientHeight;
      G.nodes = data.nodes.map(function(n, i) {
        var angle = (i / data.nodes.length) * Math.PI * 2;
        var r = Math.min(w, h) * 0.32 * (0.4 + Math.random() * 0.6);
        return { id: n.id, type: n.type, label: n.label, degree: n.degree,
                 x: w/2 + Math.cos(angle) * r, y: h/2 + Math.sin(angle) * r, vx: 0, vy: 0 };
      });
      G.edges = data.edges;
      G.alpha = 1; G.sel = -1; G.hover = -1;
      G.tx = 0; G.ty = 0; G.k = 1;
      G.pendingFit = true;
      document.getElementById("gPanel").hidden = true;
      document.getElementById("gMeta").textContent = data.nodes.length + " nodes / " + data.shown_edges + " of " + data.total_edges + " edges";
      if (!G.raf) gLoop();
    });
  }

  function gTick() {
    var nodes = G.nodes, edges = G.edges, n = nodes.length;
    if (n === 0) return;
    var c = gCanvas(), cx = c.clientWidth / 2, cy = c.clientHeight / 2;
    var i, j, dx, dy, d2, d, f;

    // Repulsion (capped O(n^2) \u2014 payload limits nodes to a few hundred)
    for (i = 0; i < n; i++) {
      var a = nodes[i];
      for (j = i + 1; j < n; j++) {
        var b = nodes[j];
        dx = a.x - b.x; dy = a.y - b.y;
        d2 = dx*dx + dy*dy;
        if (d2 > 40000) continue;
        if (d2 < 1) { d2 = 1; dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); }
        f = 320 / d2 * G.alpha;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    // Springs along edges
    for (i = 0; i < edges.length; i++) {
      var e = edges[i], s = nodes[e.s], t = nodes[e.d];
      dx = t.x - s.x; dy = t.y - s.y;
      d = Math.sqrt(dx*dx + dy*dy) || 1;
      var rest = 55;
      f = (d - rest) / d * 0.012 * Math.min(e.w, 4) * G.alpha * 8;
      s.vx += dx * f; s.vy += dy * f;
      t.vx -= dx * f; t.vy -= dy * f;
    }
    // Gravity + integrate (velocity clamped so nodes never get ejected)
    for (i = 0; i < n; i++) {
      var p = nodes[i];
      p.vx += (cx - p.x) * 0.009 * G.alpha;
      p.vy += (cy - p.y) * 0.009 * G.alpha;
      if (G.drag && G.drag.idx === i) { p.vx = 0; p.vy = 0; continue; }
      p.vx = Math.max(-6, Math.min(6, p.vx * 0.85));
      p.vy = Math.max(-6, Math.min(6, p.vy * 0.85));
      p.x += p.vx; p.y += p.vy;
    }
    G.alpha *= 0.99;
    // Fit once the layout has roughly formed, well before the sim fully cools
    if (G.pendingFit && G.alpha < 0.25) { G.pendingFit = false; gFitView(); }
    if (G.alpha < 0.005) G.alpha = 0;
  }

  // Fit all nodes into the visible canvas (called once the layout settles)
  function gFitView() {
    var nodes = G.nodes;
    if (nodes.length === 0) return;
    var c = gCanvas(), w = c.clientWidth, h = c.clientHeight;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < nodes.length; i++) {
      var p = nodes[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    var pad = 60;
    var spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    G.k = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY, 2.2);
    G.tx = w / 2 - (minX + spanX / 2) * G.k;
    G.ty = h / 2 - (minY + spanY / 2) * G.k;
  }

  function gDraw() {
    var c = gCanvas(), ctx = c.getContext("2d");
    var w = c.clientWidth, h = c.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(G.tx, G.ty);
    ctx.scale(G.k, G.k);

    var filter = document.getElementById("gFilter").value.trim().toLowerCase();
    var nodes = G.nodes, edges = G.edges, i;

    // Edges
    for (i = 0; i < edges.length; i++) {
      var e = edges[i], s = nodes[e.s], t = nodes[e.d];
      var emph = (G.sel === e.s || G.sel === e.d || G.hover === e.s || G.hover === e.d);
      ctx.strokeStyle = "rgba(" + (G.edgeColors[e.rel] || "148,148,168") + "," + (emph ? 0.55 : 0.16) + ")";
      ctx.lineWidth = Math.min(0.5 + Math.sqrt(e.w) * 0.35, 2.5) * (emph ? 1.4 : 1);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }

    // Nodes
    for (i = 0; i < nodes.length; i++) {
      var p = nodes[i];
      var r = 2.5 + Math.sqrt(p.degree) * 1.2;
      var dim = filter && p.label.toLowerCase().indexOf(filter) === -1 && p.id.toLowerCase().indexOf(filter) === -1;
      var active = (i === G.hover || i === G.sel) || (filter && !dim);
      ctx.globalAlpha = dim ? 0.12 : 1;
      if (active) { ctx.shadowColor = G.colors[p.type] || "#9494a8"; ctx.shadowBlur = 14; }
      ctx.fillStyle = G.colors[p.type] || "#9494a8";
      ctx.beginPath(); ctx.arc(p.x, p.y, i === G.sel ? r + 2 : r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      var showLabel = active || p.degree >= 8 || G.k > 1.5;
      if (showLabel && !dim) {
        ctx.font = (i === G.sel || i === G.hover ? "600 " : "") + "10px Inter, sans-serif";
        ctx.fillStyle = i === G.sel || i === G.hover ? "#e4e4ef" : "rgba(148,148,168,0.85)";
        ctx.fillText(p.label, p.x + r + 4, p.y + 3);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function gLoop() {
    gTick();
    gDraw();
    G.raf = requestAnimationFrame(gLoop);
  }

  function gToWorld(mx, my) {
    return { x: (mx - G.tx) / G.k, y: (my - G.ty) / G.k };
  }

  function gHit(mx, my) {
    var p = gToWorld(mx, my);
    for (var i = G.nodes.length - 1; i >= 0; i--) {
      var n = G.nodes[i];
      var r = 2.5 + Math.sqrt(n.degree) * 1.2 + 3;
      var dx = n.x - p.x, dy = n.y - p.y;
      if (dx*dx + dy*dy <= r*r) return i;
    }
    return -1;
  }

  function gShowPanel(idx) {
    var n = G.nodes[idx];
    var panel = document.getElementById("gPanel");
    var head = '<button class="gp-close" id="gpClose">&times;</button>' +
      '<span class="card-type type-' + (n.type === "file" ? "file_modified" : n.type) + '">' + n.type + '</span>' +
      '<h3 style="margin-top:8px">' + esc(n.label) + '</h3>' +
      '<div class="gp-path">' + esc(n.id) + '</div>' +
      '<div class="gp-w">' + n.degree + ' connections</div>';
    panel.innerHTML = head;
    panel.hidden = false;

    if (n.type === "file") {
      api("/api/impact?file=" + encodeURIComponent(n.id)).then(function(imp) {
        if (!imp || imp.error) return;
        var html = "";
        function section(title, items, fmt) {
          if (!items || items.length === 0) return "";
          return "<h4>" + title + "</h4><ul>" + items.slice(0, 8).map(fmt).join("") + "</ul>";
        }
        html += section("Usually edited with", imp.co_edited, function(x){ return '<li class="clickable" data-goto="' + esc(x.file) + '">' + esc(x.file.split("/").pop()) + ' <span class="gp-w">(' + x.weight + ')</span></li>'; });
        html += section("Past errors here", imp.errors, function(x){ return "<li>" + esc(x.error) + "</li>"; });
        html += section("Decisions", imp.decisions, function(x){ return "<li>" + esc(x.decision) + "</li>"; });
        html += section("Imports", imp.imports, function(x){ return "<li>" + esc(x.split("/").pop()) + "</li>"; });
        html += section("Imported by", imp.imported_by, function(x){ return "<li>" + esc(x.split("/").pop()) + "</li>"; });
        html += section("Calls (codegraph)", imp.calls, function(x){ return "<li>" + esc(x) + "</li>"; });
        html += section("Called by (codegraph)", imp.called_by, function(x){ return "<li>" + esc(x) + "</li>"; });
        html += section("Sessions", imp.sessions, function(x){ return "<li>" + esc(x.session_id.slice(0, 8)) + ' <span class="gp-w">(' + x.weight + ' touches)</span></li>'; });
        panel.innerHTML = head + html;
        panel.querySelectorAll("[data-goto]").forEach(function(li) {
          li.addEventListener("click", function() {
            var target = this.getAttribute("data-goto");
            for (var i = 0; i < G.nodes.length; i++) {
              if (G.nodes[i].id === target) { G.sel = i; gShowPanel(i); gCenterOn(i); return; }
            }
          });
        });
        bindClose();
      });
    }
    bindClose();
    function bindClose() {
      var btn = document.getElementById("gpClose");
      if (btn) btn.addEventListener("click", function(){ panel.hidden = true; G.sel = -1; });
    }
  }

  function gCenterOn(idx) {
    var c = gCanvas(), n = G.nodes[idx];
    G.tx = c.clientWidth / 2 - n.x * G.k;
    G.ty = c.clientHeight / 2 - n.y * G.k;
  }

  function initGraph() {
    if (G.inited) return;
    G.inited = true;
    gResize();
    window.addEventListener("resize", gResize);

    api("/api/graph/projects").then(function(projects) {
      var sel = document.getElementById("gProject");
      (projects || []).forEach(function(p) {
        var opt = document.createElement("option");
        opt.value = p.project; opt.textContent = p.project + " (" + p.edges + ")";
        sel.appendChild(opt);
      });
    });

    var c = gCanvas();
    c.addEventListener("mousedown", function(ev) {
      var rect = c.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var idx = gHit(mx, my);
      G.moved = false;
      if (idx >= 0) { G.drag = { idx: idx }; G.alpha = Math.max(G.alpha, 0.25); }
      else { G.panStart = { mx: mx, my: my, tx: G.tx, ty: G.ty }; }
      c.classList.add("dragging");
    });
    c.addEventListener("mousemove", function(ev) {
      var rect = c.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      if (G.drag) {
        var p = gToWorld(mx, my);
        G.nodes[G.drag.idx].x = p.x; G.nodes[G.drag.idx].y = p.y;
        G.alpha = Math.max(G.alpha, 0.2); G.moved = true;
      } else if (G.panStart) {
        G.tx = G.panStart.tx + (mx - G.panStart.mx);
        G.ty = G.panStart.ty + (my - G.panStart.my);
        if (Math.abs(mx - G.panStart.mx) + Math.abs(my - G.panStart.my) > 4) G.moved = true;
      } else {
        G.hover = gHit(mx, my);
        c.style.cursor = G.hover >= 0 ? "pointer" : "grab";
      }
    });
    window.addEventListener("mouseup", function(ev) {
      var rect = c.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      if (!G.moved) {
        var idx = gHit(mx, my);
        if (idx >= 0) { G.sel = idx; gShowPanel(idx); }
        else if (G.drag === null && G.panStart !== null) { G.sel = -1; document.getElementById("gPanel").hidden = true; }
      }
      G.drag = null; G.panStart = null;
      c.classList.remove("dragging");
    });
    c.addEventListener("dblclick", function() { gFitView(); });
    c.addEventListener("wheel", function(ev) {
      ev.preventDefault();
      var rect = c.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var factor = ev.deltaY < 0 ? 1.12 : 0.89;
      var nk = Math.min(Math.max(G.k * factor, 0.25), 5);
      // Zoom around cursor
      G.tx = mx - (mx - G.tx) * (nk / G.k);
      G.ty = my - (my - G.ty) * (nk / G.k);
      G.k = nk;
    }, { passive: false });

    document.getElementById("gProject").addEventListener("change", gLoad);
    document.querySelectorAll(".rel-chip").forEach(function(ch) {
      ch.addEventListener("click", function() { this.classList.toggle("on"); gLoad(); });
    });

    gLoad();
  }

  // ==========================================================================
  // Obsidian tab \u2014 two-way vault status: WHEN it synced, WHAT flows each way,
  // and whether curated notes are actually reaching injections.
  // ==========================================================================
  function loadObsidian() {
    var el = document.getElementById("obsidianView");
    el.innerHTML = '<div class="empty"><div class="empty-text">Loading...</div></div>';
    api("/api/obsidian").then(function(o) {
      if (!o || o.error) {
        el.innerHTML = '<div class="empty"><div class="empty-text">' + esc((o && o.error) || "No data") + '</div></div>';
        return;
      }
      var html = '';
      html += '<div class="obs-flow">'
        + '<b>Two-way vault</b> \u2014 notes are plain Markdown, written for <b>you</b> to read in Obsidian; the AI reads back only what you curate.<br>'
        + '<span class="arrow">Hub &rarr; vault:</span> session summaries + decisions exported as readable notes (auto, at session end / nightly 03:30).<br>'
        + '<span class="arrow">Vault &rarr; AI:</span> anything in <b>Notes/</b> or any exported note <b>you edit</b> becomes "curated" \u2014 injected as highest-trust memory at session start and on matching prompts.'
        + '</div>';

      var pills = [
        { v: o.exported_notes, l: 'exported notes (for you)' },
        { v: o.curated_user, l: 'curated: your notes' },
        { v: o.curated_edited, l: 'curated: your edits' },
        { v: o.injected_30d, l: 'prompts injected (30d)' },
      ];
      html += '<div class="obs-grid">' + pills.map(function(p) {
        return '<div class="stat-card"><div class="stat-value">' + p.v + '</div><div class="stat-label">' + p.l + '</div></div>';
      }).join('') + '</div>';

      html += '<div class="card"><div class="card-content expanded">'
        + '<div class="obs-kv"><span class="k">Vault</span><span class="v">' + esc(o.vault) + (o.vault_exists ? '' : ' <span class="obs-pill edited">missing</span>') + '</span></div>'
        + '<div class="obs-kv"><span class="k">Last export sync (Hub &rarr; vault)</span><span class="v">' + fmtDate(o.last_sync_at) + '</span></div>'
        + '<div class="obs-kv"><span class="k">Last read-back (vault &rarr; AI)</span><span class="v">' + fmtDate(o.last_readback_at) + '</span></div>'
        + '<div class="obs-kv"><span class="k">Avg curated chars per injection (30d)</span><span class="v">' + o.injected_avg_chars + '</span></div>'
        + (o.daemon_installed === null ? '' : '<div class="obs-kv"><span class="k">Nightly daemon (03:30)</span><span class="v">' + (o.daemon_installed ? 'installed' : 'not installed \u2014 run: claude-memory-hub install-daemon') + '</span></div>')
        + '</div></div>';

      if (o.recent_curated && o.recent_curated.length) {
        html += o.recent_curated.map(function(n) {
          return '<div class="card"><div class="card-header"><span class="obs-pill ' + esc(n.origin) + '">' + (n.origin === 'user' ? 'your note' : 'your edit') + '</span><div class="card-meta"><span>' + fmtDate(n.mtime) + '</span><span>' + esc(n.project || 'global') + '</span></div></div><div class="card-content">' + esc(n.title) + ' &mdash; ' + esc(n.path) + '</div></div>';
        }).join('');
      } else {
        html += '<div class="empty"><div class="empty-text">No curated notes yet \u2014 write one in the vault\\'s Notes/ folder (add a "project:" frontmatter to scope it) and it becomes the AI\\'s highest-trust memory.</div></div>';
      }
      el.innerHTML = html;
    });
  }

  // Tab click handlers
  document.querySelectorAll("[data-tab]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      currentTab = this.getAttribute("data-tab");
      currentOffset = 0;
      document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
      this.classList.add("active");
      var isGraph = currentTab === "graph";
      var isObs = currentTab === "obsidian";
      var isList = !isGraph && !isObs;
      document.getElementById("results").style.display = isList ? "flex" : "none";
      document.getElementById("pagination").style.display = isList ? "flex" : "none";
      document.getElementById("searchWrap").style.display = isList ? "block" : "none";
      document.getElementById("graphView").style.display = isGraph ? "block" : "none";
      document.getElementById("obsidianView").style.display = isObs ? "block" : "none";
      if (isGraph) { initGraph(); gResize(); }
      else if (isObs) loadObsidian();
      else loadTab();
    });
  });

  // Pagination
  document.getElementById("prevBtn").addEventListener("click", function(){ currentOffset = Math.max(0, currentOffset - PAGE_SIZE); loadTab(); });
  document.getElementById("nextBtn").addEventListener("click", function(){ currentOffset += PAGE_SIZE; loadTab(); });

  // Search
  document.getElementById("searchInput").addEventListener("keydown", function(e){ if (e.key === "Enter") doSearch(); });

  // Init
  Promise.all([api("/api/stats"), api("/api/health"), api("/api/graph/projects")]).then(function(res) {
    var stats = res[0], health = res[1], gprojects = res[2];

    document.getElementById("stats").innerHTML = ["sessions","entities","summaries","notes"].map(function(k) {
      return '<div class="stat-card"><div class="stat-value">' + (stats[k] || 0) + '</div><div class="stat-label">' + k + '</div></div>';
    }).join("");

    var cntS = document.getElementById("cnt-summaries"); if(cntS) cntS.textContent = stats.summaries || "";
    var cntSe = document.getElementById("cnt-sessions"); if(cntSe) cntSe.textContent = stats.sessions || "";
    var cntE = document.getElementById("cnt-entities"); if(cntE) cntE.textContent = stats.entities || "";
    var cntO = document.getElementById("cnt-obsidian");
    if (cntO) api("/api/obsidian").then(function(o){ if (o && !o.error) cntO.textContent = ((o.curated_user || 0) + (o.curated_edited || 0)) || ""; });
    var cntG = document.getElementById("cnt-graph");
    if (cntG && gprojects && gprojects.length) {
      var totalEdges = 0;
      gprojects.forEach(function(p){ totalEdges += p.edges; });
      cntG.textContent = totalEdges;
    }

    if (health && health.checks) {
      document.getElementById("health").innerHTML = health.checks.map(function(c) {
        return '<span class="badge badge-' + c.status + '">' + c.component + '</span>';
      }).join("");
    }

    // Deep link: /#graph opens the graph tab directly
    if (location.hash === "#graph") {
      var gtab = document.querySelector('[data-tab="graph"]');
      if (gtab) { gtab.click(); return; }
    }

    loadTab();
  });
})();
</script>
</body>
</html>`;

// src/graph/codegraph-bridge.ts
var exports_codegraph_bridge = {};
__export(exports_codegraph_bridge, {
  getCodegraphCalls: () => getCodegraphCalls,
  findCodegraphDb: () => findCodegraphDb
});
import { existsSync as existsSync17 } from "fs";
import { dirname as dirname2, isAbsolute, join as join16 } from "path";
import { Database as Database3 } from "bun:sqlite";
function findCodegraphDb(startDir) {
  let dir = startDir;
  for (let i = 0;i < WALK_UP_LEVELS; i++) {
    const candidate = join16(dir, ".codegraph", "codegraph.db");
    if (existsSync17(candidate))
      return candidate;
    const parent = dirname2(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return null;
}
function getCodegraphCalls(filePath) {
  if (!isAbsolute(filePath))
    return null;
  const dbPath = findCodegraphDb(dirname2(filePath));
  if (!dbPath)
    return null;
  try {
    const db = new Database3(dbPath, { readonly: true });
    try {
      const schema = resolveSchema(dbPath, db);
      if (!schema)
        return null;
      const like = `%${filePath.split(/[\\/]/).slice(-3).join("/")}`;
      const norm = (col) => `REPLACE(${col}, '\\', '/')`;
      const kindFilter = schema.edgeKind ? `AND e.${schema.edgeKind} IN ('calls','call','CALLS')` : "";
      const calls = db.prepare(`SELECT DISTINCT d.${schema.symName} as name, d.${schema.symFile} as file
         FROM ${schema.edgeTable} e
         JOIN ${schema.symbolTable} s ON s.${schema.symId} = e.${schema.edgeSrc}
         JOIN ${schema.symbolTable} d ON d.${schema.symId} = e.${schema.edgeDst}
         WHERE ${norm(`s.${schema.symFile}`)} LIKE ? ${kindFilter}
           AND ${norm(`d.${schema.symFile}`)} NOT LIKE ?
         LIMIT ?`).all(like, like, MAX_RESULTS);
      const calledBy = db.prepare(`SELECT DISTINCT s.${schema.symName} as name, s.${schema.symFile} as file
         FROM ${schema.edgeTable} e
         JOIN ${schema.symbolTable} s ON s.${schema.symId} = e.${schema.edgeSrc}
         JOIN ${schema.symbolTable} d ON d.${schema.symId} = e.${schema.edgeDst}
         WHERE ${norm(`d.${schema.symFile}`)} LIKE ? ${kindFilter}
           AND ${norm(`s.${schema.symFile}`)} NOT LIKE ?
         LIMIT ?`).all(like, like, MAX_RESULTS);
      if (calls.length === 0 && calledBy.length === 0)
        return null;
      const fmt = (r) => `${r.name} (${(r.file || "").split(/[\\/]/).pop()})`;
      return { calls: calls.map(fmt), called_by: calledBy.map(fmt) };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
function resolveSchema(dbPath, db) {
  const cached = schemaCache.get(dbPath);
  if (cached !== undefined)
    return cached;
  const result = introspect(db);
  schemaCache.set(dbPath, result);
  return result;
}
function introspect(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  const symbolTable = pick(tables, ["symbols", "symbol", "nodes", "definitions"]);
  const edgeTable = pick(tables, ["edges", "edge", "refs", "references", "relationships", "calls"]);
  if (!symbolTable || !edgeTable)
    return null;
  const symCols = columns(db, symbolTable);
  const edgeCols = columns(db, edgeTable);
  const symId = pick(symCols, ["id", "symbol_id", "rowid"]);
  const symName = pick(symCols, ["name", "symbol", "identifier"]);
  const symFile = pick(symCols, ["file", "path", "file_path", "filepath"]);
  const edgeSrc = pick(edgeCols, ["src", "source", "from_id", "source_id", "caller_id", "from"]);
  const edgeDst = pick(edgeCols, ["dst", "target", "to_id", "target_id", "callee_id", "to"]);
  const edgeKind = pick(edgeCols, ["kind", "type", "edge_type", "rel"]);
  if (!symId || !symName || !symFile || !edgeSrc || !edgeDst)
    return null;
  return { symbolTable, symId, symName, symFile, edgeTable, edgeSrc, edgeDst, edgeKind: edgeKind ?? null };
}
function columns(db, table) {
  return db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
}
function pick(available, candidates) {
  const lower = new Map(available.map((a) => [a.toLowerCase(), a]));
  for (const c of candidates) {
    const hit = lower.get(c);
    if (hit)
      return hit;
  }
  return null;
}
var MAX_RESULTS = 15, WALK_UP_LEVELS = 12, schemaCache;
var init_codegraph_bridge = __esm(() => {
  schemaCache = new Map;
});

// src/graph/graph-queries.ts
var exports_graph_queries = {};
__export(exports_graph_queries, {
  getNeighbors: () => getNeighbors,
  getFileImpact: () => getFileImpact,
  countEdges: () => countEdges
});
import { isAbsolute as isAbsolute2 } from "path";
function getNeighbors(node, options = {}) {
  const d = options.db ?? getDatabase();
  const limit = Math.min(options.limit ?? 20, 100);
  const pattern = `%${node.replace(/[%_]/g, "\\$&")}%`;
  const conditions = ["(src_key LIKE ? OR dst_key LIKE ?)"];
  const params = [pattern, pattern];
  if (options.rel) {
    conditions.push("rel = ?");
    params.push(options.rel);
  }
  if (options.project) {
    conditions.push("project = ?");
    params.push(options.project);
  }
  params.push(limit);
  return d.query(`SELECT project, src_type, src_key, dst_type, dst_key, rel, weight, last_seen
     FROM graph_edges
     WHERE ${conditions.join(" AND ")}
     ORDER BY weight DESC, last_seen DESC
     LIMIT ?`).all(...params);
}
function getFileImpact(file, db) {
  const d = db ?? getDatabase();
  const pattern = `%${file.replace(/[%_]/g, "\\$&")}%`;
  const rows = d.query(`SELECT project, src_type, src_key, dst_type, dst_key, rel, weight, last_seen
     FROM graph_edges
     WHERE src_key LIKE ? OR dst_key LIKE ?
     ORDER BY weight DESC
     LIMIT 200`).all(pattern, pattern);
  const report = {
    file,
    co_edited: [],
    errors: [],
    decisions: [],
    sessions: [],
    imports: [],
    imported_by: [],
    calls: [],
    called_by: []
  };
  const isTarget = (k) => k.includes(file);
  for (const e of rows) {
    switch (e.rel) {
      case "co_edited": {
        const other = isTarget(e.src_key) ? e.dst_key : e.src_key;
        if (report.co_edited.length < 10)
          report.co_edited.push({ file: other, weight: round(e.weight) });
        break;
      }
      case "error_in":
        if (isTarget(e.dst_key) && report.errors.length < 10) {
          report.errors.push({ error: e.src_key, weight: round(e.weight) });
        }
        break;
      case "decided_about":
        if (isTarget(e.dst_key) && report.decisions.length < 10) {
          report.decisions.push({ decision: e.src_key, weight: round(e.weight) });
        }
        break;
      case "session_touched":
        if (isTarget(e.dst_key) && report.sessions.length < 10) {
          report.sessions.push({ session_id: e.src_key, weight: round(e.weight) });
        }
        break;
      case "imports":
        if (isTarget(e.src_key) && report.imports.length < 15)
          report.imports.push(e.dst_key);
        else if (isTarget(e.dst_key) && report.imported_by.length < 15)
          report.imported_by.push(e.src_key);
        break;
    }
  }
  try {
    const anchor = isAbsolute2(file) ? file : rows.map((e) => [e.src_key, e.dst_key]).flat().find((k) => isAbsolute2(k) && k.includes(file));
    if (anchor) {
      const { getCodegraphCalls: getCodegraphCalls2 } = (init_codegraph_bridge(), __toCommonJS(exports_codegraph_bridge));
      const cg = getCodegraphCalls2(anchor);
      if (cg) {
        report.calls = cg.calls;
        report.called_by = cg.called_by;
      }
    }
  } catch {}
  return report;
}
function countEdges(db) {
  const d = db ?? getDatabase();
  return d.query("SELECT COUNT(*) c FROM graph_edges").get()?.c ?? 0;
}
function round(n) {
  return Math.round(n * 100) / 100;
}
var init_graph_queries = __esm(() => {
  init_schema();
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
      return json2(runHealthCheck(db));
    }
    if (path === "/api/stats") {
      const sessions = db.prepare("SELECT COUNT(*) as c FROM sessions").get()?.c ?? 0;
      const entities = db.prepare("SELECT COUNT(*) as c FROM entities").get()?.c ?? 0;
      const summaries = db.prepare("SELECT COUNT(*) as c FROM long_term_summaries").get()?.c ?? 0;
      const notes = db.prepare("SELECT COUNT(*) as c FROM session_notes").get()?.c ?? 0;
      return json2({ sessions, entities, summaries, notes });
    }
    if (path === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const project = url.searchParams.get("project");
      return json2(await searchIndex(query, { limit, offset, ...project ? { project } : {} }, db));
    }
    if (path === "/api/sessions") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const rows = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json2(rows);
    }
    if (path === "/api/summaries") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const rows = db.prepare("SELECT * FROM long_term_summaries ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json2(rows);
    }
    if (path === "/api/entities") {
      const sessionId = url.searchParams.get("session_id");
      const limit = parseInt(url.searchParams.get("limit") || "100");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      if (sessionId) {
        const rows2 = db.prepare("SELECT * FROM entities WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(sessionId, limit, offset);
        return json2(rows2);
      }
      const rows = db.prepare("SELECT * FROM entities ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return json2(rows);
    }
    if (path === "/api/graph/projects") {
      const rows = db.prepare("SELECT project, COUNT(*) as edges FROM graph_edges GROUP BY project ORDER BY edges DESC LIMIT 60").all();
      return json2(rows);
    }
    if (path === "/api/graph") {
      return json2(buildGraphPayload(url));
    }
    if (path === "/api/impact") {
      const file = url.searchParams.get("file") || "";
      if (!file)
        return json2({ error: "file param required" }, 400);
      const { getFileImpact: getFileImpact2 } = await Promise.resolve().then(() => (init_graph_queries(), exports_graph_queries));
      return json2(getFileImpact2(file, db));
    }
    if (path === "/api/obsidian") {
      const { getMemoryHubRoot: getMemoryHubRoot2, loadSyncState: loadSyncState2 } = await Promise.resolve().then(() => (init_obsidian_exporter(), exports_obsidian_exporter));
      const { existsSync: existsSync18, statSync: statSync8 } = await import("fs");
      const { join: join17 } = await import("path");
      const { homedir: homedir14 } = await import("os");
      const root = getMemoryHubRoot2();
      const vaultExists = existsSync18(root);
      let lastSyncAt = null;
      let exportedNotes = 0;
      if (vaultExists) {
        try {
          const statePath3 = join17(root, "_meta", "sync-state.json");
          if (existsSync18(statePath3)) {
            lastSyncAt = Math.round(statSync8(statePath3).mtimeMs);
            exportedNotes = Object.keys(loadSyncState2(root).written ?? {}).length;
          }
        } catch {}
      }
      const curated = db.prepare("SELECT origin, COUNT(*) as c FROM curated_notes GROUP BY origin").all();
      const recentCurated = db.prepare("SELECT id, path, project, title, origin, mtime FROM curated_notes ORDER BY mtime DESC LIMIT 10").all();
      const injected = db.prepare("SELECT COUNT(*) as c, COALESCE(AVG(curated_chars),0) as avg_chars FROM injection_log WHERE curated_chars > 0 AND timestamp > ?").get(Date.now() - 2592000000);
      const lastReadback = db.prepare("SELECT MAX(indexed_at) as t FROM curated_notes").get()?.t ?? null;
      const daemonInstalled = process.platform === "darwin" ? existsSync18(join17(homedir14(), "Library", "LaunchAgents", "com.kihutech.claude-memory-hub.plist")) : null;
      return json2({
        vault: root,
        vault_exists: vaultExists,
        last_sync_at: lastSyncAt,
        last_readback_at: lastReadback,
        exported_notes: exportedNotes,
        curated_user: curated.find((x) => x.origin === "user")?.c ?? 0,
        curated_edited: curated.find((x) => x.origin === "edited")?.c ?? 0,
        injected_30d: injected?.c ?? 0,
        injected_avg_chars: Math.round(injected?.avg_chars ?? 0),
        daemon_installed: daemonInstalled,
        recent_curated: recentCurated
      });
    }
    return json2({ error: "Not found" }, 404);
  } catch (e) {
    log23.error("API error", { path, error: String(e) });
    return json2({ error: String(e) }, 500);
  }
}
function json2(data, status = 200) {
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
        return new Response(VIEWER_HTML, { headers: { "Content-Type": "text/html" } });
      } catch (e) {
        log23.error("Server fetch error", { error: String(e) });
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    },
    error(err) {
      log23.error("Server error", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  console.log(`claude-memory-hub viewer running at http://localhost:${server.port}`);
  log23.info("Viewer started", { port: server.port });
}
var log23, PORT = 37888;
var init_viewer = __esm(() => {
  init_schema();
  init_logger();
  init_monitor();
  init_search_workflow();
  init_graph_api();
  log23 = createLogger("viewer");
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
      log24.warn(`export skipped table ${table}`, { error: String(err) });
    }
  }
  log24.info("export complete", { tables: tables.length, rows: totalRows });
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
  for (const [key2, value] of Object.entries(result)) {
    if (value instanceof Buffer || value instanceof Uint8Array) {
      result[key2] = { $base64: true, encoded: Buffer.from(value).toString("base64") };
    }
  }
  return result;
}
var log24, SCHEMA_VERSION = 5, EXPORT_TABLES;
var init_exporter = __esm(() => {
  init_schema();
  init_logger();
  log24 = createLogger("exporter");
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
    log25.warn("empty input");
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
        log25.warn(`import error at line ${i + 1}`, { error: String(err) });
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
  log25.info("import complete", { ...stats });
  return stats;
}
function decodeBlobs(record) {
  for (const [key2, value] of Object.entries(record)) {
    if (value && typeof value === "object" && !Array.isArray(value) && value.$base64 === true) {
      record[key2] = Buffer.from(value.encoded, "base64");
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
var log25, MAX_SCHEMA_VERSION = 5;
var init_importer = __esm(() => {
  init_schema();
  init_vector_search();
  init_logger();
  log25 = createLogger("importer");
});

// src/cli/doctor-types.ts
import { homedir as homedir14 } from "os";
import { join as join17 } from "path";
var STABLE_DIR2, DB_PATH, SETTINGS_PATH, ICON;
var init_doctor_types = __esm(() => {
  STABLE_DIR2 = join17(homedir14(), ".claude-memory-hub");
  DB_PATH = join17(STABLE_DIR2, "memory.db");
  SETTINGS_PATH = join17(homedir14(), ".claude", "settings.json");
  ICON = {
    ok: "[OK]  ",
    warn: "[WARN]",
    fail: "[FAIL]"
  };
});

// src/cli/doctor-checks.ts
import { existsSync as existsSync18, readFileSync as readFileSync10, statSync as statSync8 } from "fs";
import { join as join18 } from "path";
import { spawnSync } from "child_process";
function checkDatabase2() {
  if (!existsSync18(DB_PATH)) {
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
    const stats = statSync8(DB_PATH);
    return { name: "database", status: "ok", detail: `${(stats.size / 1024 / 1024).toFixed(1)}MB, integrity OK` };
  } catch (err) {
    return { name: "database", status: "fail", detail: String(err) };
  }
}
function checkEmbeddings() {
  if (process.env["CLAUDE_MEMORY_HUB_EMBEDDINGS"] === "disabled") {
    return { name: "embeddings", status: "warn", detail: "explicitly disabled via CLAUDE_MEMORY_HUB_EMBEDDINGS=disabled" };
  }
  const localTransformers = join18(STABLE_DIR2, "node_modules", "@huggingface", "transformers", "package.json");
  const localSharp = join18(STABLE_DIR2, "node_modules", "sharp", "package.json");
  if (!existsSync18(localTransformers)) {
    return {
      name: "embeddings",
      status: "warn",
      detail: "@huggingface/transformers not installed (semantic search disabled, FTS5 keyword still works)",
      fix: "Run: claude-memory-hub doctor --fix  (or: cd ~/.claude-memory-hub && npm install)"
    };
  }
  if (!existsSync18(localSharp)) {
    return {
      name: "embeddings",
      status: "warn",
      detail: "sharp not installed (image preprocessing for transformers may fail)",
      fix: "Run: claude-memory-hub doctor --fix"
    };
  }
  const libvipsDir = join18(STABLE_DIR2, "node_modules", "@img", "sharp-libvips-darwin-arm64", "lib");
  if (process.platform === "darwin" && process.arch === "arm64" && !existsSync18(libvipsDir)) {
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
  if (!existsSync18(SETTINGS_PATH)) {
    return {
      name: "hooks",
      status: "fail",
      detail: `~/.claude/settings.json not found`,
      fix: "Run: npx claude-memory-hub install"
    };
  }
  try {
    const settings = JSON.parse(readFileSync10(SETTINGS_PATH, "utf-8"));
    const hooks = settings.hooks ?? {};
    const expected = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PreCompact", "PostCompact", "Stop", "SessionEnd"];
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
      const missing = expected.filter((e) => !found.includes(e));
      return {
        name: "hooks",
        status: "warn",
        detail: `Only ${found.length}/${expected.length} hooks registered \u2014 missing: ${missing.join(", ")}`,
        fix: "Run: npx claude-memory-hub install (re-registers all hooks)"
      };
    }
    return { name: "hooks", status: "ok", detail: `All ${expected.length} lifecycle hooks registered` };
  } catch (err) {
    return { name: "hooks", status: "fail", detail: String(err) };
  }
}
function checkDistFiles() {
  const distDir = join18(STABLE_DIR2, "dist");
  const required = [
    "index.js",
    "cli.js",
    "hooks/post-tool-use.js",
    "hooks/user-prompt-submit.js",
    "hooks/session-start.js",
    "hooks/stop.js",
    "hooks/session-end.js",
    "hooks/pre-compact.js",
    "hooks/post-compact.js"
  ];
  const missing = required.filter((f) => !existsSync18(join18(distDir, f)));
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
  if (!path || !existsSync18(path)) {
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

// src/context/resource-description.ts
import { readFileSync as readFileSync11, existsSync as existsSync19, statSync as statSync9 } from "fs";
import { join as join19 } from "path";
function extractDescription(filePath, name) {
  if (!existsSync19(filePath))
    return null;
  let content;
  try {
    content = readFileSync11(filePath, "utf-8").slice(0, MAX_BODY_PEEK);
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
    const p = join19(dir, c);
    if (existsSync19(p))
      return extractDescription(p, name);
  }
  return null;
}
var MAX_DESC_CHARS = 2000, MAX_BODY_PEEK = 4000;
var init_resource_description = () => {};

// src/context/resource-embeddings.ts
var exports_resource_embeddings = {};
__export(exports_resource_embeddings, {
  searchResourcesByPrompt: () => searchResourcesByPrompt,
  backfillResourceEmbeddings: () => backfillResourceEmbeddings
});
import { statSync as statSync10 } from "fs";
async function backfillResourceEmbeddings(db) {
  const t0 = Date.now();
  const d = db ?? getDatabase();
  const stats = { scanned: 0, embedded: 0, unchanged: 0, failed: 0, ms: 0 };
  await embeddingModel.embed("warmup");
  if (!embeddingModel.isAvailable) {
    log26.warn("Embedding model unavailable \u2014 skipping resource backfill");
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
    log26.info("Resource backfill: nothing to do", { ...stats });
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
  log26.info("Resource backfill complete", { ...stats });
  return stats;
}
function extractResource(path, name, kind) {
  try {
    const stat = statSync10(path);
    if (stat.isDirectory())
      return extractFromDir(path, name);
    return extractDescription(path, name);
  } catch {
    return null;
  }
}
var log26;
var init_resource_embeddings = __esm(() => {
  init_schema();
  init_embedding_model();
  init_resource_registry();
  init_resource_description();
  init_logger();
  init_resource_embedding_search();
  log26 = createLogger("resource-embeddings");
});

// src/cli/doctor-actions.ts
import { existsSync as existsSync20, writeFileSync as writeFileSync8 } from "fs";
import { join as join20 } from "path";
import { spawnSync as spawnSync2 } from "child_process";
function attemptFix() {
  console.log(`
--- Attempting auto-fix ---`);
  const pkgPath = join20(STABLE_DIR2, "package.json");
  if (!existsSync20(pkgPath)) {
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
    writeFileSync8(pkgPath, JSON.stringify(pkg, null, 2));
  }
  console.log("Installing sharp + @huggingface/transformers (this may take a minute)...");
  const bunResult = spawnSync2("bun", ["install", "--no-save"], {
    cwd: STABLE_DIR2,
    stdio: "inherit"
  });
  if (bunResult.status !== 0) {
    console.log("bun install failed, trying npm...");
    const npmResult = spawnSync2("npm", ["install"], {
      cwd: STABLE_DIR2,
      stdio: "inherit"
    });
    if (npmResult.status !== 0) {
      console.log("Auto-fix failed. Please run manually:");
      console.log(`  cd ${STABLE_DIR2} && npm install`);
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

// src/cli/daemon.ts
var exports_daemon = {};
__export(exports_daemon, {
  runMaintenance: () => runMaintenance,
  installDaemon: () => installDaemon
});
import { existsSync as existsSync21, mkdirSync as mkdirSync8, writeFileSync as writeFileSync9 } from "fs";
import { join as join21 } from "path";
import { homedir as homedir15 } from "os";
import { spawnSync as spawnSync3 } from "child_process";
async function runMaintenance() {
  console.log("claude-memory-hub maintenance");
  maybeRunAutoCleanup();
  console.log("  \u2713 retention check (7-day cadence)");
  try {
    getDatabase().run("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log("  \u2713 WAL checkpoint");
  } catch (err) {
    console.log(`  \u2717 WAL checkpoint: ${err}`);
  }
  try {
    const { upgradeRuleBasedSummaries: upgradeRuleBasedSummaries2 } = await Promise.resolve().then(() => (init_session_summarizer(), exports_session_summarizer));
    const n = await upgradeRuleBasedSummaries2();
    console.log(`  \u2713 summary upgrade (${n} rule-based summaries re-summarized via CLI)`);
  } catch (err) {
    console.log(`  \u2717 summary upgrade: ${err}`);
  }
  try {
    const r = syncObsidianVault({});
    console.log(`  \u2713 obsidian sync \u2192 ${r.vault} (${r.sessions_exported} new sessions, ${r.decisions_exported} decisions)`);
    const rb = syncVaultReadback();
    console.log(`  \u2713 obsidian read-back (${rb.indexed} curated indexed, ${rb.removed} removed)`);
  } catch (err) {
    console.log(`  \u2717 obsidian sync: ${err}`);
  }
}
function installDaemon(bunBin) {
  if (process.platform === "win32") {
    installWindowsTask(bunBin);
    return;
  }
  if (process.platform !== "darwin") {
    const cliPath = join21(STABLE_DIR3, "dist", "cli.js");
    console.log("install-daemon supports macOS (launchd) and Windows (Task Scheduler).");
    console.log("On Linux, add this line via `crontab -e`:");
    console.log(`  30 3 * * * ${bunBin} run ${cliPath} maintenance >> ${join21(STABLE_DIR3, "logs", "maintenance.log")} 2>&1`);
    return;
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunBin}</string>
    <string>run</string>
    <string>${join21(STABLE_DIR3, "dist", "cli.js")}</string>
    <string>maintenance</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>${join21(STABLE_DIR3, "logs", "maintenance.log")}</string>
  <key>StandardErrorPath</key><string>${join21(STABLE_DIR3, "logs", "maintenance.log")}</string>
</dict>
</plist>
`;
  const dir = join21(homedir15(), "Library", "LaunchAgents");
  if (!existsSync21(dir))
    mkdirSync8(dir, { recursive: true });
  writeFileSync9(PLIST_PATH, plist, "utf-8");
  spawnSync3("launchctl", ["unload", PLIST_PATH], { encoding: "utf-8" });
  const load = spawnSync3("launchctl", ["load", PLIST_PATH], { encoding: "utf-8" });
  if (load.status === 0) {
    console.log(`Daemon installed: ${PLIST_PATH}`);
    console.log(`Runs daily at 03:30 \u2014 retention, WAL checkpoint, Obsidian sync (vault: ${getVaultRoot()}).`);
    console.log("Remove with: launchctl unload " + PLIST_PATH);
  } else {
    console.log(`launchctl load failed: ${load.stderr || load.stdout}`);
  }
}
function installWindowsTask(bunBin) {
  const cliPath = join21(STABLE_DIR3, "dist", "cli.js");
  const taskRun = `"${bunBin.replace(/"/g, "")}" run "${cliPath}" maintenance`;
  const r = spawnSync3("schtasks", ["/Create", "/F", "/SC", "DAILY", "/ST", "03:30", "/TN", LABEL, "/TR", taskRun], { encoding: "utf-8" });
  if (r.status === 0) {
    console.log(`Scheduled task installed: ${LABEL}`);
    console.log(`Runs daily at 03:30 \u2014 retention, WAL checkpoint, Obsidian sync (vault: ${getVaultRoot()}).`);
    console.log(`Remove with: schtasks /Delete /TN ${LABEL} /F`);
  } else {
    console.log(`schtasks failed: ${r.stderr || r.stdout}`);
    console.log(`Create manually: schtasks /Create /SC DAILY /ST 03:30 /TN ${LABEL} /TR '${taskRun}'`);
  }
}
var LABEL = "com.kihutech.claude-memory-hub", PLIST_PATH, STABLE_DIR3;
var init_daemon = __esm(() => {
  init_schema();
  init_auto_cleanup();
  init_obsidian_exporter();
  init_obsidian_readback();
  PLIST_PATH = join21(homedir15(), "Library", "LaunchAgents", `${LABEL}.plist`);
  STABLE_DIR3 = join21(homedir15(), ".claude-memory-hub");
});

// src/graph/code-scanner.ts
var exports_code_scanner = {};
__export(exports_code_scanner, {
  scanRepoImports: () => scanRepoImports
});
import { readdirSync as readdirSync4, readFileSync as readFileSync12, statSync as statSync11, existsSync as existsSync22 } from "fs";
import { join as join22, dirname as dirname3, resolve, extname } from "path";
function scanRepoImports(repoPath, project, db) {
  const d = db ?? getDatabase();
  const files = collectFiles(repoPath);
  const upsert = d.prepare(`INSERT INTO graph_edges(project, src_type, src_key, dst_type, dst_key, rel, weight, first_seen, last_seen)
     VALUES (?, 'file', ?, 'file', ?, 'imports', 1, ?, ?)
     ON CONFLICT(project, src_type, src_key, dst_type, dst_key, rel) DO UPDATE SET
       last_seen = excluded.last_seen`);
  const now = Date.now();
  let edges = 0;
  d.transaction(() => {
    d.run("DELETE FROM graph_edges WHERE project = ? AND rel = 'imports'", [project]);
    for (const file of files) {
      let content;
      try {
        content = readFileSync12(file, "utf-8");
      } catch {
        continue;
      }
      for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const spec = match[1];
          if (!spec || !spec.startsWith("."))
            continue;
          const target = resolveImport(file, spec);
          if (target) {
            upsert.run(project, file, target, now, now);
            edges++;
          }
        }
      }
    }
  })();
  log27.info("import scan complete", { repo: repoPath, files: files.length, edges });
  return { files_scanned: files.length, edges };
}
function collectFiles(root, acc = []) {
  if (acc.length >= MAX_FILES)
    return acc;
  let entries;
  try {
    entries = readdirSync4(root);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES)
      break;
    if (entry.startsWith(".") || SKIP_DIRS.has(entry))
      continue;
    const full = join22(root, entry);
    try {
      const stat = statSync11(full);
      if (stat.isDirectory()) {
        collectFiles(full, acc);
      } else if (SCAN_EXTENSIONS.has(extname(entry))) {
        acc.push(full);
      }
    } catch {}
  }
  return acc;
}
function resolveImport(fromFile, spec) {
  const base = resolve(dirname3(fromFile), spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    try {
      if (existsSync22(candidate) && statSync11(candidate).isFile())
        return candidate;
    } catch {}
  }
  return null;
}
var log27, SCAN_EXTENSIONS, SKIP_DIRS, MAX_FILES = 5000, IMPORT_PATTERNS, RESOLVE_SUFFIXES;
var init_code_scanner = __esm(() => {
  init_schema();
  init_logger();
  log27 = createLogger("code-scanner");
  SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".swift", ".kt", ".kts", ".java", ".py", ".dart"]);
  SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "Pods", "vendor", ".gradle", "DerivedData", "__pycache__", ".dart_tool", "coverage"]);
  IMPORT_PATTERNS = [
    /(?:import|export)\s+[^"']*?from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+([A-Za-z0-9_.]+)/gm,
    /^\s*from\s+([A-Za-z0-9_.]+)\s+import/gm
  ];
  RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js", ".dart", ".py"];
});

// src/cli/stats.ts
var exports_stats = {};
__export(exports_stats, {
  runStatsCommand: () => runStatsCommand,
  runStats: () => runStats
});
function runStatsCommand(args) {
  if (args.includes("--injections")) {
    runInjectionStats();
    return;
  }
  runStats();
}
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
  const tiers = db.query("SELECT tier, COUNT(*) cnt FROM long_term_summaries GROUP BY tier ORDER BY cnt DESC").all();
  if (tiers.length > 0) {
    console.log(`Summary tiers:       ${tiers.map((t) => `${t.tier} ${t.cnt}`).join(", ")}`);
  }
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
function runInjectionStats() {
  const agg = aggregateInjections();
  console.log("Injection Telemetry \u2014 last 30 days");
  console.log("\u2500".repeat(48));
  if (agg.total_injections === 0) {
    console.log("No injection telemetry recorded yet.");
    console.log("");
    console.log("Telemetry started writing in v0.14.0. Run a few prompts in");
    console.log("Claude Code and try again. Or check env var:");
    console.log("  echo $CLAUDE_MEMORY_HUB_TELEMETRY   # should not be 'disabled'");
    return;
  }
  console.log(`Total injections:     ${agg.total_injections}`);
  console.log(`Avg total chars:      ${agg.avg_total_chars}  (~${Math.round(agg.avg_total_chars / 3.75)} tokens)`);
  console.log(`Avg memory chars:     ${agg.avg_memory_chars}`);
  console.log("");
  console.log("Smart match performance:");
  console.log(`  Prompts with match: ${agg.prompts_with_match} / ${agg.total_injections}  (${agg.prompts_with_match_pct}%)`);
  console.log(`  Avg matches/prompt: ${agg.avg_smart_match_count}`);
  console.log(`  Avg top score:      ${agg.avg_top_score}`);
  console.log("");
  console.log("Other signals:");
  console.log(`  History intent fired: ${agg.history_intent_count} prompts`);
  console.log(`  Awareness hint shown: ${agg.awareness_hint_count} prompts`);
  console.log(`  Curated notes shown:  ${agg.curated_shown_count} prompts (avg ${agg.avg_curated_chars} chars)`);
  console.log("");
  console.log("Effectiveness (memory_* tool called after injection):");
  console.log(`  Sessions with memory tool use: ${agg.sessions_with_memory_tool_use}  (hit rate ${agg.memory_tool_hit_rate_pct}%)`);
  console.log("");
  if (agg.by_intent.length > 0) {
    console.log("Breakdown by intent:");
    for (const b of agg.by_intent) {
      const padIntent = b.intent.padEnd(10);
      console.log(`  ${padIntent} ${String(b.count).padStart(4)}x   avg ${String(b.avg_total_chars).padStart(5)} chars  (memory ${b.avg_memory_chars}, claude_md ${b.avg_claude_md_chars})`);
    }
  }
}
var DAY_MS = 86400000;
var init_stats = __esm(() => {
  init_schema();
  init_injection_telemetry();
});

// src/cli/main.ts
import { existsSync as existsSync23, mkdirSync as mkdirSync9, readFileSync as readFileSync13, writeFileSync as writeFileSync10, readdirSync as readdirSync5, unlinkSync as unlinkSync5 } from "fs";
import { homedir as homedir16 } from "os";
import { join as join23, resolve as resolve2, dirname as dirname4 } from "path";

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
// package.json
var package_default = {
  name: "claude-memory-hub",
  version: "0.18.3",
  description: "Persistent memory system for Claude Code. Zero API key. Zero Python. 7 hooks + MCP server + SQLite FTS5 + semantic search + knowledge graph + two-way Obsidian vault.",
  type: "module",
  main: "dist/index.js",
  bin: {
    "claude-memory-hub": "dist/cli.js"
  },
  files: [
    "dist/",
    "commands/",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  scripts: {
    start: "bun run src/index.ts",
    build: "bun build src/index.ts --outdir dist --target bun --entry-naming [name].js --external @huggingface/transformers",
    "build:cli": "bun build src/cli/main.ts --outdir dist --target bun --entry-naming cli.js --external @huggingface/transformers",
    "build:hooks": "bun build src/hooks-entry/post-tool-use.ts src/hooks-entry/session-end.ts src/hooks-entry/session-start.ts src/hooks-entry/stop.ts src/hooks-entry/user-prompt-submit.ts src/hooks-entry/pre-compact.ts src/hooks-entry/post-compact.ts --outdir dist/hooks --target bun --entry-naming [name].js --external @huggingface/transformers",
    "build:worker": "bun build src/worker/worker-main.ts --outdir dist --target bun --entry-naming worker.js --external @huggingface/transformers",
    "build:all": "bun run build && bun run build:cli && bun run build:hooks && bun run build:worker",
    dev: "bun run --watch src/index.ts",
    prepublishOnly: "test -f dist/index.js || bun run build:all",
    typecheck: "tsc --noEmit",
    test: "bun test",
    "test:coverage": "bun test --coverage"
  },
  keywords: [
    "claude",
    "claude-code",
    "memory",
    "mcp",
    "context",
    "persistent-memory",
    "sqlite",
    "fts5",
    "semantic-search",
    "embeddings"
  ],
  author: "TranHoaiHung",
  license: "MIT",
  homepage: "https://github.com/TranHoaiHung/claude-memory-hub#readme",
  bugs: {
    url: "https://github.com/TranHoaiHung/claude-memory-hub/issues"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/TranHoaiHung/claude-memory-hub.git"
  },
  engines: {
    bun: ">=1.0.0"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.10.2"
  },
  optionalDependencies: {
    "@huggingface/transformers": "^3.0.0"
  },
  devDependencies: {
    "@types/bun": "latest",
    typescript: "^5.4.0"
  }
};

// src/cli/version-check.ts
var VERSION = package_default.version;
async function warnIfOutdated() {
  try {
    const res = await fetch("https://registry.npmjs.org/claude-memory-hub/latest", {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok)
      return;
    const latest = (await res.json()).version;
    if (latest && semverLess(VERSION, latest)) {
      console.log(`
  \u26A0 You are running v${VERSION} but v${latest} is available.`);
      console.log("    bunx serves cached versions \u2014 upgrade with:");
      console.log("    bunx claude-memory-hub@latest install");
    }
  } catch {}
}
function semverLess(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0;i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y)
      return x < y;
  }
  return false;
}

// src/cli/main.ts
import { spawnSync as spawnSync4 } from "child_process";
var CLAUDE_DIR = join23(homedir16(), ".claude");
var SETTINGS_PATH2 = join23(CLAUDE_DIR, "settings.json");
var COMMANDS_DIR = join23(CLAUDE_DIR, "commands");
var PKG_DIR = resolve2(dirname4(import.meta.dir));
var STABLE_DIR4 = join23(homedir16(), ".claude-memory-hub");
function shellPath(p) {
  const normalized = p.replace(/\\/g, "/");
  return normalized.includes(" ") ? `"${normalized}"` : normalized;
}
function getBunPath() {
  const result = spawnSync4(process.platform === "win32" ? "where" : "which", ["bun"], {
    encoding: "utf-8"
  });
  const resolved = result.stdout?.trim().split(/\r?\n/)[0]?.trim();
  if (resolved && existsSync23(resolved))
    return shellPath(resolved);
  const candidates = [
    join23(homedir16(), ".bun", "bin", "bun"),
    join23(homedir16(), ".bun", "bin", "bun.exe")
  ];
  for (const c of candidates) {
    if (existsSync23(c))
      return shellPath(c);
  }
  return "bun";
}
function copyDistToStableDir() {
  const srcDist = join23(PKG_DIR, "dist");
  const destDist = join23(STABLE_DIR4, "dist");
  if (!existsSync23(srcDist)) {
    throw new Error(`dist/ not found at ${srcDist}. Run 'bun run build:all' first.`);
  }
  const destHooks = join23(destDist, "hooks");
  mkdirSync9(destHooks, { recursive: true });
  for (const file of readdirSync5(srcDist)) {
    if (file.endsWith(".js")) {
      const src = join23(srcDist, file);
      const dest = join23(destDist, file);
      writeFileSync10(dest, readFileSync13(src));
    }
  }
  const srcHooks = join23(srcDist, "hooks");
  if (existsSync23(srcHooks)) {
    for (const file of readdirSync5(srcHooks)) {
      if (file.endsWith(".js")) {
        const src = join23(srcHooks, file);
        const dest = join23(destHooks, file);
        writeFileSync10(dest, readFileSync13(src));
      }
    }
  }
  const srcCmds = join23(PKG_DIR, "commands");
  if (existsSync23(srcCmds)) {
    const destCmds = join23(STABLE_DIR4, "commands");
    mkdirSync9(destCmds, { recursive: true });
    for (const file of readdirSync5(srcCmds)) {
      if (file.endsWith(".md")) {
        writeFileSync10(join23(destCmds, file), readFileSync13(join23(srcCmds, file)));
      }
    }
  }
}
var HOOK_REGISTRATIONS = [
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt-submit"],
  ["PostToolUse", "post-tool-use"],
  ["PreCompact", "pre-compact"],
  ["PostCompact", "post-compact"],
  ["Stop", "stop"],
  ["SessionEnd", "session-end"]
];
function getHookPath(hookName) {
  return shellPath(join23(STABLE_DIR4, "dist", "hooks", `${hookName}.js`));
}
function getMcpServerPath() {
  return shellPath(join23(STABLE_DIR4, "dist", "index.js"));
}
function loadSettings() {
  if (!existsSync23(SETTINGS_PATH2))
    return {};
  try {
    return JSON.parse(readFileSync13(SETTINGS_PATH2, "utf-8"));
  } catch {
    return {};
  }
}
function saveSettings(settings) {
  if (!existsSync23(CLAUDE_DIR))
    mkdirSync9(CLAUDE_DIR, { recursive: true });
  writeFileSync10(SETTINGS_PATH2, JSON.stringify(settings, null, 2) + `
`);
}
var CLAUDE_JSON_PATH = join23(homedir16(), ".claude.json");
function loadClaudeJson() {
  if (!existsSync23(CLAUDE_JSON_PATH))
    return {};
  try {
    return JSON.parse(readFileSync13(CLAUDE_JSON_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function saveClaudeJson(data) {
  writeFileSync10(CLAUDE_JSON_PATH, JSON.stringify(data, null, 2) + `
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
  let srcCommands = join23(PKG_DIR, "commands");
  if (!existsSync23(srcCommands))
    srcCommands = join23(STABLE_DIR4, "commands");
  if (!existsSync23(srcCommands))
    return 0;
  mkdirSync9(COMMANDS_DIR, { recursive: true });
  let count = 0;
  for (const file of readdirSync5(srcCommands)) {
    if (!file.endsWith(".md"))
      continue;
    const src = join23(srcCommands, file);
    const dest = join23(COMMANDS_DIR, file);
    writeFileSync10(dest, readFileSync13(src));
    count++;
  }
  return count;
}
function uninstallCommands() {
  const memCommands = ["mem-search.md", "mem-status.md", "mem-save.md"];
  for (const file of memCommands) {
    const p = join23(COMMANDS_DIR, file);
    try {
      if (existsSync23(p))
        unlinkSync5(p);
    } catch {}
  }
}
async function install() {
  console.log(`claude-memory-hub \u2014 install (v${VERSION})
`);
  await warnIfOutdated();
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
  const result = spawnSync4("claude", ["mcp", "add", "claude-memory-hub", "-s", "user", "--", bunBin, "run", mcpPath], {
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
  const hookEntries = HOOK_REGISTRATIONS.map(([event, script]) => [event, getHookPath(script)]);
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
  console.log(`   ${registered}/${HOOK_REGISTRATIONS.length} hook(s) registered.`);
  const dataDir = join23(homedir16(), ".claude-memory-hub");
  if (!existsSync23(dataDir)) {
    mkdirSync9(dataDir, { recursive: true, mode: 448 });
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
  console.log(`  Hooks:    ${HOOK_REGISTRATIONS.map(([event]) => event).join(", ")}`);
  console.log("  Commands: /mem-search, /mem-status, /mem-save");
  console.log("  Data:     ~/.claude-memory-hub/memory.db");
  console.log("  Key:      not needed");
  console.log("");
  console.log("  Restart Claude Code to activate.");
  console.log("========================================");
  const migrationMarker = join23(STABLE_DIR4, "migration-claude-mem.json");
  const cmDbPath = detectClaudeMemDb();
  if (cmDbPath && !existsSync23(migrationMarker)) {
    console.log(`
[Migration] Detected claude-mem database:`);
    console.log(`  ${cmDbPath}`);
    console.log(`  Migrating data to claude-memory-hub...
`);
    try {
      const stats = migrateFromClaudeMem(cmDbPath);
      printMigrationStats(stats);
      writeFileSync10(migrationMarker, JSON.stringify({ migrated_at: Date.now(), source: cmDbPath }), "utf-8");
    } catch (e) {
      console.error(`  Migration failed: ${e}`);
      console.log("  You can retry later with: bunx claude-memory-hub@latest migrate");
    }
  } else if (cmDbPath) {
    console.log(`
[Migration] claude-mem data already migrated (rerun manually: migrate).`);
  }
}
function uninstall() {
  console.log(`claude-memory-hub \u2014 uninstall
`);
  uninstallCommands();
  console.log("Removed slash commands from ~/.claude/commands/");
  unregisterMcpFromClaudeJson();
  spawnSync4("claude", ["mcp", "remove", "claude-memory-hub", "-s", "user"], {
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
async function status() {
  console.log(`claude-memory-hub \u2014 status (v${VERSION})
`);
  const settings = loadSettings();
  const expected = HOOK_REGISTRATIONS.length;
  const hasMcp = !!settings.mcpServers?.["claude-memory-hub"];
  const hookCount = Object.values(settings.hooks ?? {}).flat().filter((e) => JSON.stringify(e).includes("claude-memory-hub")).length;
  const staleStopHook = JSON.stringify(settings.hooks?.["Stop"] ?? "").includes("session-end.js");
  const dataDir = join23(homedir16(), ".claude-memory-hub");
  const hasData = existsSync23(join23(dataDir, "memory.db"));
  console.log(`  MCP server:  ${hasMcp ? "registered" : "not registered"}`);
  console.log(`  Hooks:       ${hookCount}/${expected} registered`);
  console.log(`  Database:    ${hasData ? "exists" : "not created yet"}`);
  if (hasData) {
    const { statSync: statSync12 } = __require("fs");
    const stats = statSync12(join23(dataDir, "memory.db"));
    console.log(`  DB size:     ${(stats.size / 1024).toFixed(1)} KB`);
  }
  try {
    const { workerHealth: workerHealth2 } = (init_worker_client(), __toCommonJS(exports_worker_client));
    const worker = await workerHealth2();
    console.log(`  Worker:      ${worker.ok ? `running (pid ${worker.pid}, up ${Math.round((worker.uptime_s ?? 0) / 60)}m)` : "not running (auto-spawns on next hook)"}`);
  } catch {}
  if (!hasMcp || hookCount < expected || staleStopHook) {
    if (staleStopHook)
      console.log(`
  Outdated hook layout detected (session-end runs on Stop).`);
    console.log(`
  Run: bunx claude-memory-hub install`);
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
    await install();
    break;
  case "uninstall":
    uninstall();
    break;
  case "status":
    await status();
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
  case "worker": {
    const sub = process.argv[3];
    if (sub === "start") {
      const { startWorker: startWorker2 } = (init_worker_server(), __toCommonJS(exports_worker_server));
      startWorker2();
      await new Promise(() => {});
    } else if (sub === "stop") {
      const { readFileSync: readFileSync14, existsSync: existsSync24, unlinkSync: unlinkSync6 } = __require("fs");
      const { join: join24 } = __require("path");
      const { homedir: homedir17 } = __require("os");
      const pidPath = join24(homedir17(), ".claude-memory-hub", "worker.pid");
      if (existsSync24(pidPath)) {
        const pid = Number(readFileSync14(pidPath, "utf-8"));
        try {
          process.kill(pid);
          console.log(`Worker (pid ${pid}) stopped.`);
        } catch {
          console.log("Worker pid file found but process not running.");
        }
        try {
          unlinkSync6(pidPath);
        } catch {}
      } else {
        console.log("No worker pid file \u2014 worker not running.");
      }
    } else {
      const { workerHealth: workerHealth2 } = (init_worker_client(), __toCommonJS(exports_worker_client));
      const h = await workerHealth2();
      console.log(h.ok ? `Worker running (pid ${h.pid}, uptime ${h.uptime_s}s)` : "Worker not running (hooks auto-spawn it on demand, or run: worker start)");
    }
    break;
  }
  case "maintenance": {
    const { runMaintenance: runMaintenance2 } = (init_daemon(), __toCommonJS(exports_daemon));
    await runMaintenance2();
    break;
  }
  case "install-daemon": {
    const { installDaemon: installDaemon2 } = (init_daemon(), __toCommonJS(exports_daemon));
    const { spawnSync: spawnSync5 } = __require("child_process");
    const which = spawnSync5(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf-8" });
    const bunBin = which.stdout?.trim().split(/\r?\n/)[0] || "/usr/local/bin/bun";
    installDaemon2(bunBin);
    break;
  }
  case "obsidian": {
    const sub = process.argv[3];
    if (sub === "sync") {
      const { syncObsidianVault: syncObsidianVault2, getVaultRoot: getVaultRoot2 } = (init_obsidian_exporter(), __toCommonJS(exports_obsidian_exporter));
      const projIdx = process.argv.indexOf("--project");
      const project = projIdx > -1 ? process.argv[projIdx + 1] : undefined;
      console.log(`Syncing memory to Obsidian vault: ${getVaultRoot2()}`);
      const r = syncObsidianVault2({ project });
      console.log(`Done: ${r.sessions_exported} sessions, ${r.decisions_exported} decisions, ${r.file_notes_exported} file notes across ${r.projects} projects.`);
      if (r.preserved_user_edits > 0)
        console.log(`Preserved ${r.preserved_user_edits} user-edited note(s) (not overwritten).`);
      const { syncVaultReadback: syncVaultReadback2 } = (init_obsidian_readback(), __toCommonJS(exports_obsidian_readback));
      const rb = syncVaultReadback2();
      console.log(`Read-back: ${rb.scanned} notes scanned, ${rb.indexed} curated note(s) indexed, ${rb.removed} removed.`);
      console.log(`Open in Obsidian: "Open folder as vault" \u2192 ${getVaultRoot2()}`);
    } else {
      console.log("Usage: claude-memory-hub obsidian sync [--project <name>]");
      console.log("Vault path: CLAUDE_MEMORY_HUB_OBSIDIAN_VAULT (default ~/Documents/ObsidianVault)");
    }
    break;
  }
  case "graph": {
    const sub = process.argv[3];
    if (sub === "build") {
      const { backfillAllSessions: backfillAllSessions2 } = (init_edge_builder(), __toCommonJS(exports_edge_builder));
      console.log("Building graph edges from all stored sessions...");
      const result = backfillAllSessions2();
      console.log(`Done: ${result.edges} edge upserts from ${result.sessions} sessions.`);
    } else if (sub === "scan") {
      const repoPath = process.argv[4] ?? process.cwd();
      const { basename: basename4 } = __require("path");
      const { scanRepoImports: scanRepoImports2 } = (init_code_scanner(), __toCommonJS(exports_code_scanner));
      console.log(`Scanning imports in ${repoPath}...`);
      const result = scanRepoImports2(repoPath, basename4(repoPath));
      console.log(`Done: ${result.edges} import edges from ${result.files_scanned} files.`);
    } else {
      const { countEdges: countEdges2 } = (init_graph_queries(), __toCommonJS(exports_graph_queries));
      console.log(`Graph edges stored: ${countEdges2()}`);
      console.log("Usage: claude-memory-hub graph build | graph scan [repo-path]");
    }
    break;
  }
  case "stats": {
    const { runStatsCommand: runStatsCommand2 } = (init_stats(), __toCommonJS(exports_stats));
    runStatsCommand2(process.argv.slice(3));
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
    console.log("  stats       Memory health report (--injections for telemetry breakdown)");
    console.log("  reindex     Rebuild TF-IDF search index");
    console.log("  export      Export data as JSONL (--since T, --table T)");
    console.log("  import      Import JSONL from stdin (--dry-run)");
    console.log("  cleanup     Remove old data (--days N, default 90)");
    console.log("  prune       Remove low-quality summaries (--dry-run)");
    console.log("  graph       Knowledge graph: graph build | graph scan [repo]");
    console.log("  obsidian    Export memory to Obsidian vault: obsidian sync [--project X]");
    console.log("  maintenance Run retention + WAL checkpoint + obsidian sync now");
    console.log("  worker      Persistent hook worker: worker start | stop | status");
    console.log("  install-daemon  Install daily launchd maintenance agent (macOS)");
    console.log(`
Usage: npx claude-memory-hub <command>`);
    break;
}

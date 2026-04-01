#!/usr/bin/env bun
// @bun
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
  insertNote(note) {
    this.db.run("INSERT INTO session_notes(session_id, content, created_at) VALUES (?, ?, ?)", [note.session_id, note.content, note.created_at]);
  }
  getSessionNotes(session_id) {
    return this.db.query("SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at ASC").all(session_id);
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

// src/capture/observation-extractor.ts
var TOOL_OUTPUT_HEURISTICS = [
  { pattern: /\b(IMPORTANT|CRITICAL|WARNING)\b/i, importance: 4, label: "important" },
  { pattern: /\b(decision:|decided to|NOTE:)\b/i, importance: 3, label: "decision-note" },
  { pattern: /\b(TODO:|FIXME:)\b/i, importance: 2, label: "todo-note" },
  { pattern: /^>\s+.{10,}/m, importance: 2, label: "quoted" }
];
var PROMPT_HEURISTICS = [
  { pattern: /\b(IMPORTANT|CRITICAL)\b/i, importance: 4, label: "user-important" },
  { pattern: /\b(remember that|note that|I decided|we should)\b/i, importance: 3, label: "user-note" }
];
var MAX_VALUE_LENGTH = 300;
var MIN_INPUT_LENGTH = 20;
function extractObservationFromOutput(output, sessionId, project, toolName, promptNumber) {
  if (!output || output.length < MIN_INPUT_LENGTH)
    return;
  return matchHeuristics(output, TOOL_OUTPUT_HEURISTICS, sessionId, project, toolName, promptNumber);
}
function extractObservationFromPrompt(prompt, sessionId, project, promptNumber) {
  if (!prompt || prompt.length < MIN_INPUT_LENGTH)
    return;
  return matchHeuristics(prompt, PROMPT_HEURISTICS, sessionId, project, "UserPrompt", promptNumber);
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
  switch (tool_name) {
    case "Read": {
      const path = stringField2(tool_input, "file_path");
      if (path) {
        raw.push(makeEntity(session_id, project, tool_name, "file_read", path, 1, now, promptNumber));
      }
      break;
    }
    case "Write": {
      const path = stringField2(tool_input, "file_path");
      if (path) {
        raw.push(makeEntity(session_id, project, tool_name, "file_created", path, 4, now, promptNumber));
      }
      break;
    }
    case "Edit":
    case "MultiEdit": {
      const path = stringField2(tool_input, "file_path");
      if (path) {
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
      raw.push(makeEntity(session_id, project, tool_name, "decision", `agent:${subagentType}: ${prompt.slice(0, 100)}`, 3, now, promptNumber));
      break;
    }
    case "Skill": {
      const skillName = stringField2(tool_input, "skill") ?? "unknown";
      const args = stringField2(tool_input, "args") ?? "";
      raw.push(makeEntity(session_id, project, tool_name, "decision", `skill:${skillName} ${args.slice(0, 80)}`.trim(), 2, now, promptNumber));
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
var log2 = createLogger("resource-registry");
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
    if (plan.skipped.length === 0)
      return "";
    const lines = [
      `Context budget: ${plan.total_tokens}/${plan.total_tokens + plan.budget_remaining} tokens used.`
    ];
    if (plan.skipped.length > 0) {
      lines.push(`${plan.skipped.length} resource(s) deferred for token efficiency:`);
      for (const s of plan.skipped.slice(0, 5)) {
        lines.push(`  - ${s.resource_type}:${s.resource_name} (~${s.token_cost} tok, ${s.reason})`);
      }
      lines.push("Use SkillTool or ToolSearch to load these on demand if needed.");
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
var log3 = createLogger("injection-validator");
var MAX_CHARS = 4500;

class InjectionValidator {
  registry;
  constructor(registry) {
    this.registry = registry;
  }
  validate(rawContext, recommendations) {
    try {
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
      log3.error("validation failed, returning empty", { error: String(err) });
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
        log3.warn(`filtered dead resource: ${r.resource_type}:${r.resource_name}`);
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
import { join as join4, dirname, basename as basename2 } from "path";
var log4 = createLogger("claude-md-tracker");
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
        log4.error(`Failed to process ${filePath}`, { error: String(err) });
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
  formatForInjection(entries) {
    if (entries.length === 0)
      return "";
    const lines = ["**Active CLAUDE.md rules:**"];
    for (const e of entries) {
      const headings = e.sections.map((s) => s.heading).join(", ");
      lines.push(`- ${basename2(dirname(e.path))}/${basename2(e.path)} (~${e.tokenCost} tok): ${headings || "no sections"}`);
    }
    return lines.join(`
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

// src/capture/hook-handler.ts
import { basename as basename3 } from "path";
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
  store.upsertSession({
    id: hook.session_id,
    project,
    started_at: Date.now(),
    user_prompt: hook.prompt.slice(0, 500),
    status: "active"
  });
  const promptObs = extractObservationFromPrompt(hook.prompt, hook.session_id, project, 0);
  if (promptObs)
    store.insertEntity({ ...promptObs, project });
  const results = ltStore.search(hook.prompt, 3);
  const registry = getResourceRegistry();
  registry.scan(hook.cwd);
  const validator = new InjectionValidator(registry);
  const loader = new SmartResourceLoader(registry);
  const plan = loader.buildContextPlan(project, hook.prompt, 30000, hook.cwd);
  plan.recommendations = validator.filterAliveRecommendations(plan.recommendations);
  plan.skipped = validator.filterAliveRecommendations(plan.skipped);
  const advice = loader.formatContextAdvice(plan);
  const lines = [];
  if (results.length > 0) {
    lines.push("**Past session context:**");
    for (const r of results) {
      const date = new Date(r.created_at).toLocaleDateString();
      const files = safeJson3(r.files_touched, []);
      lines.push(`- [${date}, ${r.project}] ${r.summary.slice(0, 300)}`);
      if (files.length > 0)
        lines.push(`  Files: ${files.slice(0, 5).join(", ")}`);
    }
  }
  if (advice)
    lines.push("", advice);
  if (hook.cwd) {
    try {
      const mdTracker = new ClaudeMdTracker;
      const mdEntries = mdTracker.scanAndUpdate(hook.cwd, project);
      const mdSummary = mdTracker.formatForInjection(mdEntries);
      if (mdSummary)
        lines.push("", mdSummary);
      const tracker = new ResourceTracker;
      for (const entry of mdEntries) {
        tracker.trackUsage(hook.session_id, project, "claude_md", entry.path, entry.tokenCost);
      }
    } catch {}
  }
  const safeContext = validator.validate(lines.join(`
`));
  return { additionalContext: safeContext };
}
async function handleSessionEnd(hook, project) {
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

// src/hooks-entry/post-tool-use.ts
async function main() {
  const raw = await Bun.stdin.text();
  if (!raw.trim())
    return;
  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return;
  }
  await handlePostToolUse(hook, projectFromCwd(process.env["CLAUDE_CWD"] ?? process.cwd()));
}
main().catch(() => {}).finally(() => process.exit(0));

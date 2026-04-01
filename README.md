<p align="center">
  <img src="assets/logo.png" alt="claude-memory-hub" width="400" />
</p>

<h1 align="center">claude-memory-hub</h1>

<p align="center">
  <strong>The missing memory layer for Claude Code.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-memory-hub"><img src="https://img.shields.io/npm/v/claude-memory-hub.svg" alt="npm version" /></a>
  <a href="https://github.com/TranHoaiHung/claude-memory-hub/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-memory-hub.svg" alt="license" /></a>
</p>

Zero API key. Zero Python. Zero config. One install command.

---

## The Problem

Claude Code forgets everything between sessions. Within long sessions, auto-compact destroys 90% of context. Every session wastes tokens loading resources that aren't needed.

```
Session 1: You spend 2 hours building auth system
Session 2: Claude has no idea what happened yesterday

Long session: Claude auto-compacts at 200K tokens
              → 180K tokens of context vaporized
              → Claude loses track of files, decisions, errors

Every session: ALL skills + agents + rules loaded
               → 23-51K tokens consumed before you type anything
               → Most of them never used
```

**Three problems. No existing tool solves all of them.**

| Problem | Claude Code built-in | claude-mem | memory-hub |
|---------|:-------------------:|:----------:|:----------:|
| Cross-session memory | -- | Yes | **Yes** |
| Influence what compact preserves | -- | -- | **Yes** |
| Save compact output | -- | -- | **Yes** |
| Token budget optimization | -- | -- | **Yes** |
| No API key needed | N/A | Yes | **Yes** |
| No Python/Chroma needed | N/A | -- | **Yes** |
| No XML format required | N/A | -- | **Yes** |
| No HTTP server to manage | N/A | -- | **Yes** |

---

## How It Works

### Layer 1 — Entity Capture (every tool call)

```
Claude reads a file     → memory-hub records: which file, code patterns found
Claude edits a file     → memory-hub records: what changed (old → new diff)
Claude runs a command   → memory-hub records: command, exit code, stderr
Claude makes a decision → memory-hub records: decision text + importance score
```

No XML. No special format. Extracted directly from hook JSON metadata.

### Layer 2 — Compact Interceptor (the key innovation)

```
                    BEFORE compact runs
                           |
            +--------------+--------------+
            |                             |
     PreCompact hook               Claude Code's
     reads all entities            compact engine
     scores by importance          receives our output
     outputs priority list    -->  as Additional Instructions
            |                             |
            |                     compact now KNOWS
            |                     what to preserve
            |                             |
            |                    AFTER compact runs
            |                             |
            +-------- PostCompact hook ---+
                      receives FULL summary
                      saves to SQLite L3
                      zero information loss
```

**This is something no other memory tool does.** claude-mem never sees the compact. Built-in session memory is supplementary, not directive. memory-hub is the only system that **tells the compact what matters**.

### Layer 3 — Cross-Session Memory

```
Session N ends  → rule-based summary from entities → SQLite L3
                  OR PostCompact summary (richer) → SQLite L3

Session N+1     → UserPromptSubmit hook fires
                → FTS5 search: match user prompt against past summaries
                → inject relevant context automatically
                → Claude starts with history, not from zero
```

### Layer 4 — Smart Resource Loading

```
                 Typical Claude Code session

    BEFORE memory-hub          AFTER memory-hub
    ┌──────────────────┐        ┌──────────────────┐
    │ System prompt 8K │        │ System prompt 8K │
    │ ALL skills  10K  │        │ Used skills  3K  │
    │ ALL agents   5K  │        │ Used agents  1K  │
    │ ALL rules   15K  │        │ Key rules    5K  │
    │ ALL memory   5K  │        │ Relevant mem 2K  │
    ├──────────────────┤        ├──────────────────┤
    │ OVERHEAD:  ~43K  │        │ OVERHEAD:  ~19K  │
    │                  │        │ SAVED:     ~24K  │
    └──────────────────┘        └──────────────────┘
```

memory-hub tracks which skills/agents/tools you **actually use**, then recommends only those for future sessions. Rare resources load on demand via SkillTool.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                    Claude Code                            │
│                                                           │
│  5 Lifecycle Hooks                                        │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ PostToolUse   │  │ PreCompact   │  │ PostCompact  │    │
│  │ entity capture│  │ inject       │  │ save summary │    │
│  └──────┬────────┘  │ priorities   │  └──────┬───────┘    │
│         │           └──────┬───────┘         │            │
│  ┌──────┴───────┐          │          ┌──────┴───────┐    │
│  │UserPrompt    │          │          │ Stop         │    │
│  │Submit: inject│          │          │ session end  │    │
│  │past context  │          │          │ summarize    │    │
│  └──────────────┘          │          └──────────────┘    │
│                            │                              │
│  MCP Server (stdio)        │                              │
│  ┌─────────────────────┐   │                              │
│  │ memory_recall       │   │                              │
│  │ memory_entities     │   │  ┌────────────────────────┐  │
│  │ memory_session_notes│   │  │ Smart Resource Loader  │  │
│  │ memory_store        │   │  │ track usage → predict  │  │
│  │ memory_context_budget│  │  │ → budget → recommend   │  │
│  └─────────────────────┘   │  └────────────────────────┘  │
│                            │                              │
└────────────────────────────┼──────────────────────────────┘
                             │
                   ┌─────────┴────────┐
                   │  SQLite + FTS5   │
                   │  ~/.claude-      │
                   │  memory-hub/     │
                   │  memory.db       │
                   │                  │
                   │  sessions        │
                   │  entities        │
                   │  session_notes   │
                   │  long_term_      │
                   │   summaries      │
                   │  resource_usage  │
                   │  fts_memories    │
                   └──────────────────┘
```

---

## Memory Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  L1: WorkingMemory          in-process Map          │
│  Current session only       <1ms access             │
│  Lives in MCP server        FIFO 50 entries/session │
├─────────────────────────────────────────────────────┤
│  L2: SessionStore           SQLite                  │
│  Entities + notes           <10ms access            │
│  files_read, file_modified  Per-session scope       │
│  errors, decisions          Importance scored       │
├─────────────────────────────────────────────────────┤
│  L3: LongTermStore          SQLite + FTS5           │
│  Cross-session summaries    <100ms access           │
│  BM25 ranked search         Persistent forever      │
│  Auto-injected on start     LIKE fallback           │
└─────────────────────────────────────────────────────┘
```

---

## Install

### From npm (recommended)

```bash
bunx claude-memory-hub install
```

One command. Registers MCP server + 5 hooks globally. Works on CLI, VS Code, JetBrains.

### From source

```bash
git clone https://github.com/TranHoaiHung/claude-memory-hub.git ~/.claude-memory-hub
cd ~/.claude-memory-hub
bun install && bun run build:all
bunx . install
```

### Other commands

```bash
bunx claude-memory-hub status      # Check installation
bunx claude-memory-hub uninstall   # Clean removal
```

### Requirements

- [Bun](https://bun.sh) runtime
- Claude Code (CLI, VS Code, or JetBrains)
- **No API key needed**

---

## MCP Tools

Claude can call these tools directly during conversation:

| Tool | What it does | When to use |
|------|-------------|-------------|
| `memory_recall` | FTS5 search past session summaries | Starting a task, looking for prior work |
| `memory_entities` | Find all sessions that touched a file | Before editing a file, understanding history |
| `memory_session_notes` | Current session activity summary | Mid-session, checking what's been done |
| `memory_store` | Manually save a note or decision | Preserving important context |
| `memory_context_budget` | Analyze token costs + recommendations | Optimizing which resources to load |

---

## Version History

| Version | What it solved |
|---------|---------------|
| **v0.1.0** | Cross-session memory, entity tracking, FTS5 search |
| **v0.2.0** | Compact interceptor (PreCompact/PostCompact hooks), context enrichment, importance scoring |
| **v0.3.0** | Removed API key requirement, 1-command install |
| **v0.4.0** | Smart resource loading, token budget optimization |

See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## Dependencies

```
@modelcontextprotocol/sdk    MCP stdio server
bun:sqlite                   Built-in, zero install
```

That's it. **One npm package.** The other is built into Bun.

No Python. No Chroma. No HTTP server. No API key. No Docker.

---

## Data & Privacy

All data stored locally at `~/.claude-memory-hub/memory.db`.

No cloud. No telemetry. No network calls. Your memory stays on your machine.

---

## Uninstall

```bash
claude mcp remove claude-memory-hub -s user
# Remove hook entries containing "claude-memory-hub" from ~/.claude/settings.json
rm -rf ~/.claude-memory-hub
```

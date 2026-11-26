import { DatabaseSync } from 'node:sqlite'

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('customer','agent','admin')),
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject     TEXT NOT NULL,
      description TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
      priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER REFERENCES users(id),
      version     INTEGER NOT NULL DEFAULT 1,   -- bumped on every change, used to detect conflicting edits
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      due_at      INTEGER NOT NULL              -- SLA deadline
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority);
    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      body       TEXT NOT NULL,
      internal   INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1)),  -- 1 = staff-only note
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
    -- The audit log is append-only: the database itself refuses edits and deletes.
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  INTEGER NOT NULL,
      actor_id   INTEGER NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_log(ticket_id);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `)
  return db
}

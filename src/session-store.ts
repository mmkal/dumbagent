import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { createBunClient, type SyncClient } from "sqlfu";
import { sessionDb } from "../sqlfu.config.ts";
import { sessionStorePathForEnv } from "./state-db-path.ts";

export type SessionStore = ReturnType<typeof createSessionStore>;

export type StoredSession = {
  id: string;
  cwd: string;
  launchCommand: string;
  createdAtMs: number;
  archivedAtMs: number | null;
  recoveryCommand: string | null;
  recoveryCreatedAtMs: number | null;
};

export type RecordStoredSessionInput = {
  id: string;
  cwd: string;
  launchCommand: string;
  createdAtMs: number;
};

export type SetStoredSessionRecoveryInput = {
  sessionId: string;
  recoveryCommand: string;
  createdAtMs: number;
};

export type ArchiveStoredSessionInput = {
  sessionId: string;
  archivedAtMs: number;
};

export type RecordSessionProcessOwnerInput = {
  sessionId: string;
  pid: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RemoveSessionProcessOwnerInput = {
  sessionId: string;
  pid: number;
};

export type StoredSessionProcessOwner = {
  sessionId: string;
  pid: number;
  startedAtMs: number;
  updatedAtMs: number;
};

export { sessionStorePathForEnv };

export function createSessionStoreForEnv(env: NodeJS.ProcessEnv) {
  return createSessionStore(sessionStorePathForEnv(env));
}

export function createSessionStore(databasePath: string) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath);
  const client = createBunClient(database);
  const db = initializeSessionStore(client);

  return {
    path: databasePath,
    recordSession(input: RecordStoredSessionInput) {
      db.recordSession(input);
    },
    setSessionRecovery(input: SetStoredSessionRecoveryInput) {
      db.setSessionRecovery(input);
    },
    recordSessionProcessOwner(input: RecordSessionProcessOwnerInput) {
      db.recordSessionProcessOwner(input);
    },
    getSessionProcessOwners(): StoredSessionProcessOwner[] {
      return database.query(`
        select
          session_id as sessionId,
          pid,
          created_at_ms as startedAtMs,
          updated_at_ms as updatedAtMs
        from session_process_owners
        order by created_at_ms
      `).all() as StoredSessionProcessOwner[];
    },
    getSessionProcessOwnersForRecoveryCommand(recoveryCommand: string): StoredSessionProcessOwner[] {
      return database.query(`
        select
          session_process_owners.session_id as sessionId,
          session_process_owners.pid,
          session_process_owners.created_at_ms as startedAtMs,
          session_process_owners.updated_at_ms as updatedAtMs
        from session_process_owners
        inner join session_recovery on session_recovery.session_id = session_process_owners.session_id
        where session_recovery.recovery_command = ?
        order by session_process_owners.created_at_ms
      `).all(recoveryCommand) as StoredSessionProcessOwner[];
    },
    removeSessionProcessOwner(input: RemoveSessionProcessOwnerInput) {
      db.removeSessionProcessOwner(input);
    },
    archiveSession(input: ArchiveStoredSessionInput) {
      db.archiveSession(input);
    },
    getSession(id: string): StoredSession | null {
      const session = db.getSession({ id });
      if (!session) {
        return null;
      }
      const recovery = db.getSessionRecovery({ sessionId: id });
      return {
        id: session.id,
        cwd: session.cwd,
        launchCommand: session.launch_command,
        createdAtMs: session.created_at_ms,
        archivedAtMs: session.archived_at_ms || null,
        recoveryCommand: recovery?.recovery_command || null,
        recoveryCreatedAtMs: recovery?.created_at_ms || null,
      };
    },
    close() {
      database.close();
    },
    [Symbol.dispose]() {
      database.close();
    },
  };
}

function initializeSessionStore(client: SyncClient) {
  client.raw("pragma foreign_keys = on;");
  client.raw("pragma busy_timeout = 1000;");
  const db = sessionDb(client);
  db.migrate();
  addColumnIfMissing(client, "sessions", "archived_at_ms integer");
  return db;
}

function addColumnIfMissing(client: SyncClient, tableName: string, definition: string) {
  try {
    client.raw(`alter table ${tableName} add column ${definition};`);
  } catch (error) {
    if (!String(error).includes("duplicate column name")) {
      throw error;
    }
  }
}

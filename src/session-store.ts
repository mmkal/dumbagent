import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { createNodeSqliteClient, type SyncClient } from "sqlfu";
import {
  getSession,
  getSessionRecovery,
  recordSession,
  setSessionRecovery,
} from "../db/sql/.generated/queries.sql.ts";

export type SessionStore = ReturnType<typeof createSessionStore>;

export type StoredSession = {
  id: string;
  cwd: string;
  launchCommand: string;
  createdAtMs: number;
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

const definitionsPath = path.resolve(import.meta.dirname, "../db/definitions.sql");

export function sessionStorePathForEnv(env: NodeJS.ProcessEnv) {
  if (env.TUIUI_STATE_DB) {
    return path.resolve(env.TUIUI_STATE_DB);
  }
  const stateHome = env.XDG_STATE_HOME || path.join(String(env.HOME || os.homedir()), ".local", "state");
  return path.join(stateHome, "tuiui", "tuiui.sqlite");
}

export function createSessionStoreForEnv(env: NodeJS.ProcessEnv) {
  return createSessionStore(sessionStorePathForEnv(env));
}

export function createSessionStore(databasePath: string) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath);
  const client = createNodeSqliteClient(database as unknown as Parameters<typeof createNodeSqliteClient>[0]);
  initializeSessionStore(client);

  return {
    path: databasePath,
    recordSession(input: RecordStoredSessionInput) {
      recordSession(client, input);
    },
    setSessionRecovery(input: SetStoredSessionRecoveryInput) {
      setSessionRecovery(client, input);
    },
    getSession(id: string): StoredSession | null {
      const session = getSession(client, { id });
      if (!session) {
        return null;
      }
      const recovery = getSessionRecovery(client, { sessionId: id });
      return {
        id: session.id,
        cwd: session.cwd,
        launchCommand: session.launch_command,
        createdAtMs: session.created_at_ms,
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
  client.raw(fs.readFileSync(definitionsPath, "utf8"));
}

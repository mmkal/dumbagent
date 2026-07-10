import { defineConfig, sql } from "sqlfu";

export const sessionDb = defineConfig({
  definitions: sql`
    create table if not exists sessions (
      id text primary key,
      cwd text not null,
      launch_command text not null,
      created_at_ms integer not null,
      archived_at_ms integer
    );

    create table if not exists session_recovery (
      session_id text primary key references sessions (id) on delete cascade,
      recovery_command text not null,
      created_at_ms integer not null
    );

    create index if not exists idx_session_recovery_recovery_command
    on session_recovery (recovery_command);

    create table if not exists session_process_owners (
      session_id text not null references session_recovery (session_id) on delete cascade,
      pid integer not null,
      created_at_ms integer not null,
      updated_at_ms integer not null,
      primary key (session_id, pid)
    );
  `,
  migrations: [
    {
      name: "20260623000000_initial_session_store",
      content: sql`
        create table if not exists sessions (
          id text primary key,
          cwd text not null,
          launch_command text not null,
          created_at_ms integer not null,
          archived_at_ms integer
        );

        create table if not exists session_recovery (
          session_id text primary key references sessions (id) on delete cascade,
          recovery_command text not null,
          created_at_ms integer not null
        );

        create index if not exists idx_session_recovery_recovery_command
        on session_recovery (recovery_command);

        create table if not exists session_process_owners (
          session_id text not null references session_recovery (session_id) on delete cascade,
          pid integer not null,
          created_at_ms integer not null,
          updated_at_ms integer not null,
          primary key (session_id, pid)
        );
      `,
    },
  ],
  queries: {
    getSession: sql.nullableOne<{ parameters: { id: string }; result: { id: string; cwd: string; launch_command: string; created_at_ms: number; archived_at_ms: number | null } }>`
      select
        sessions.id,
        sessions.cwd,
        sessions.launch_command,
        sessions.created_at_ms,
        sessions.archived_at_ms
      from sessions
      where sessions.id = :id
      limit 1;
    `,
    getSessionRecovery: sql.nullableOne<{ parameters: { sessionId: string }; result: { session_id: string; recovery_command: string; created_at_ms: number } }>`
      select
        session_recovery.session_id,
        session_recovery.recovery_command,
        session_recovery.created_at_ms
      from session_recovery
      where session_recovery.session_id = :sessionId
      limit 1;
    `,
    recordSession: sql.run<{ parameters: { id: string; cwd: string; launchCommand: string; createdAtMs: number } }>`
      insert into sessions (
        id,
        cwd,
        launch_command,
        created_at_ms
      )
      values (
        :id,
        :cwd,
        :launchCommand,
        :createdAtMs
      )
      on conflict (id) do nothing;
    `,
    setSessionRecovery: sql.run<{ parameters: { sessionId: string; recoveryCommand: string; createdAtMs: number } }>`
      insert into session_recovery (
        session_id,
        recovery_command,
        created_at_ms
      )
      values (
        :sessionId,
        :recoveryCommand,
        :createdAtMs
      )
      on conflict (session_id) do update set
        recovery_command = excluded.recovery_command;
    `,
    archiveSession: sql.run<{ parameters: { archivedAtMs: number | null; sessionId: string } }>`
      update sessions
      set archived_at_ms = :archivedAtMs
      where id = :sessionId;
    `,
    recordSessionProcessOwner: sql.run<{ parameters: { sessionId: string; pid: number; createdAtMs: number; updatedAtMs: number } }>`
      insert into session_process_owners (
        session_id,
        pid,
        created_at_ms,
        updated_at_ms
      )
      values (
        :sessionId,
        :pid,
        :createdAtMs,
        :updatedAtMs
      )
      on conflict (session_id, pid) do update set
        updated_at_ms = excluded.updated_at_ms;
    `,
    removeSessionProcessOwner: sql.run<{ parameters: { sessionId: string; pid: number } }>`
      delete from session_process_owners
      where session_id = :sessionId
        and pid = :pid;
    `,
  },
});

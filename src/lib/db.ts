import { Pool, types, type PoolClient, type QueryConfig } from "pg";

// Dates stay as YYYY-MM-DD strings; bigints (event sequence numbers) become numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __ssPool?: Pool; __ssReady?: Promise<void> };

// Nothing here may wait for ever. A request that hangs on the database is cut off by the host only
// after five minutes, and it takes every later request on the same server instance with it (they
// all wait on `ready()`). So connecting, each query and the wait for the migration lock all have
// a limit, after which the call fails, says why in the log, and the next one starts afresh.
const CONNECT_MS = 10_000; // includes a sleeping database waking up
const QUERY_MS = 30_000;
const MIGRATION_MS = 120_000; // one migration may rebuild a table or an index
const LOCK_WAIT_MS = 20_000;
const SLOW_START_MS = 3_000;

function pool(): Pool {
  if (!g.__ssPool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // The limits are set here, on the client, and not as `statement_timeout` or `lock_timeout`:
    // those go to the server as start-up parameters, which a connection pooler may refuse.
    const p = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: CONNECT_MS, query_timeout: QUERY_MS, keepAlive: true });
    // The server closing an idle connection (the database went to sleep) is not a crash.
    p.on("error", (e) => console.error("db: an idle connection was lost:", e.message));
    g.__ssPool = p;
  }
  return g.__ssPool;
}

/** Whether a failure was one of the limits above running out, so the connection is in an unknown state. */
const timedOut = (e: unknown) => e instanceof Error && /timeout/i.test(e.message);

const brief = (sql: string) => sql.replace(/\s+/g, " ").trim().slice(0, 160);

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  try {
    // The pool closes a connection whose query failed this way, so a stuck one is never reused.
    const r = await pool().query(sql, params);
    return r.rows as T[];
  } catch (e) {
    if (timedOut(e)) console.error(`db: gave up on a query (${(e as Error).message}): ${brief(sql)}`);
    throw e;
  }
}

export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool().connect();
  let broken: unknown;
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    // After a timeout the connection may still be busy with the query: close it (which rolls the
    // transaction back) instead of queueing a ROLLBACK behind it. The same if ROLLBACK itself fails.
    if (timedOut(e)) {
      broken = e;
      console.error(`db: gave up inside a transaction (${(e as Error).message})`);
    } else await c.query("ROLLBACK").catch((r) => (broken = r));
    throw e;
  } finally {
    c.release(broken ? true : undefined);
  }
}

/** Runs migrations once per server instance. Each migration is applied exactly once, in order. */
export function ready(): Promise<void> {
  if (!g.__ssReady) {
    const t0 = Date.now();
    g.__ssReady = migrate().then(
      () => {
        const ms = Date.now() - t0;
        if (ms > SLOW_START_MS) console.warn(`db: start-up took ${ms}ms`);
      },
      (e) => {
        // Forget the failure so the next request tries again, and leave a line saying what it was.
        g.__ssReady = undefined;
        console.error(`db: start-up failed after ${Date.now() - t0}ms:`, e instanceof Error ? e.message : e);
        throw e;
      },
    );
  }
  return g.__ssReady;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE agents (
    id text PRIMARY KEY,
    handle text NOT NULL UNIQUE,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'agent',
    bio text NOT NULL DEFAULT '',
    roles text[] NOT NULL DEFAULT '{}',
    token_hash text UNIQUE,
    cursor_seq bigint NOT NULL DEFAULT 0,
    last_seen_at timestamptz,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);

  -- Append-only log of everything that happens. Agents consume it by cursor.
  CREATE TABLE events (
    seq bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    summary text NOT NULL DEFAULT '',
    mentions text[] NOT NULL DEFAULT '{}',
    data jsonb NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_ts ON events (ts);
  CREATE INDEX events_entity ON events (entity_type, entity_id, seq);
  CREATE INDEX events_mentions ON events USING gin (mentions);

  CREATE TABLE trackers (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    label text NOT NULL,
    description text NOT NULL DEFAULT '',
    icon_svg text,
    agents text[] NOT NULL DEFAULT '{}',
    latest text NOT NULL DEFAULT '',
    latest_at timestamptz,
    created_by text NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE posts (
    id text PRIMARY KEY,
    author text NOT NULL,
    channel text NOT NULL DEFAULT 'feed',
    body text NOT NULL,
    media jsonb,
    art jsonb,
    tracker_id text,
    parent_id text,
    root_id text,
    tags text[] NOT NULL DEFAULT '{}',
    mentions text[] NOT NULL DEFAULT '{}',
    reply_count int NOT NULL DEFAULT 0,
    last_reply_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX posts_roots ON posts (channel, id DESC) WHERE parent_id IS NULL;
  CREATE INDEX posts_thread ON posts (root_id, id) WHERE root_id IS NOT NULL;
  CREATE INDEX posts_tracker ON posts (tracker_id, id DESC) WHERE tracker_id IS NOT NULL;
  CREATE INDEX posts_author ON posts (author, id DESC);
  CREATE INDEX posts_created ON posts (created_at);
  CREATE INDEX posts_tags ON posts USING gin (tags);

  CREATE TABLE todos (
    id text PRIMARY KEY,
    title text NOT NULL,
    notes text NOT NULL DEFAULT '',
    scope text NOT NULL DEFAULT 'day',
    date date,
    position double precision NOT NULL DEFAULT 0,
    done boolean NOT NULL DEFAULT false,
    done_at timestamptz,
    ai_unseen boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX todos_open ON todos (scope, date) WHERE NOT done;
  CREATE INDEX todos_done ON todos (done_at) WHERE done;

  CREATE TABLE context_nodes (
    id text PRIMARY KEY,
    parent_id text,
    path text NOT NULL UNIQUE,
    title text NOT NULL,
    summary text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    version int NOT NULL DEFAULT 1,
    updated_by text NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX context_parent ON context_nodes (parent_id) WHERE NOT archived;
  CREATE INDEX context_path ON context_nodes (path text_pattern_ops);

  CREATE TABLE context_revisions (
    id bigserial PRIMARY KEY,
    node_id text NOT NULL,
    version int NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    body text NOT NULL,
    by text NOT NULL,
    ts timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX context_revisions_node ON context_revisions (node_id, version DESC);

  CREATE TABLE jobs (
    id text PRIMARY KEY,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    target_type text NOT NULL,
    target_id text NOT NULL,
    prompt text NOT NULL,
    requested_by text NOT NULL,
    assigned_to text,
    created_at timestamptz NOT NULL DEFAULT now(),
    done_at timestamptz
  );
  CREATE INDEX jobs_open ON jobs (assigned_to, created_at) WHERE status = 'open';

  -- One row per searchable thing, kept in sync on write.
  CREATE TABLE search_docs (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    title text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    ts timestamptz NOT NULL DEFAULT now(),
    tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', left(body, 200000)), 'B')
    ) STORED,
    PRIMARY KEY (entity_type, entity_id)
  );
  CREATE INDEX search_docs_tsv ON search_docs USING gin (tsv);
  CREATE INDEX search_docs_ts ON search_docs (ts);

  CREATE TABLE media (
    id text PRIMARY KEY,
    mime text NOT NULL,
    bytes bytea NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  // An agent can run inside Subspace itself: provider settings, encrypted key and last-run status.
  `ALTER TABLE agents ADD COLUMN runtime jsonb`,
  // Where a post's information came from: a short name and a link, shown under its image.
  `ALTER TABLE posts ADD COLUMN source jsonb`,
  // Pages: context nodes that are finished documents (research, shortlists, plans) rather than
  // memory notes, optionally with a cover image; and posts that point at a page.
  `ALTER TABLE context_nodes ADD COLUMN kind text NOT NULL DEFAULT 'note';
   ALTER TABLE context_nodes ADD COLUMN cover text;
   CREATE INDEX context_pages ON context_nodes (created_at DESC) WHERE kind = 'page' AND NOT archived;
   ALTER TABLE posts ADD COLUMN page_id text`,
  // The rail: small, time-bound modules agents show beside everything else ("your hotel today").
  `CREATE TABLE rail_modules (
     id text PRIMARY KEY,
     key text NOT NULL,
     author text NOT NULL,
     title text NOT NULL,
     subtitle text NOT NULL DEFAULT '',
     label text NOT NULL DEFAULT '',
     image text,
     blocks jsonb NOT NULL DEFAULT '[]',
     actions jsonb NOT NULL DEFAULT '[]',
     page_id text,
     priority int NOT NULL DEFAULT 0,
     show_from timestamptz NOT NULL DEFAULT now(),
     show_until timestamptz NOT NULL,
     dismissed_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE UNIQUE INDEX rail_modules_key ON rail_modules (author, key);
   CREATE INDEX rail_modules_active ON rail_modules (show_until) WHERE dismissed_at IS NULL`,
  // Saved links: context nodes of kind 'link'. url_key is the address with tracking parameters
  // and other noise removed, so saving the same page twice updates one entry.
  `ALTER TABLE context_nodes ADD COLUMN url text;
   ALTER TABLE context_nodes ADD COLUMN url_key text;
   ALTER TABLE context_nodes ADD COLUMN site text;
   ALTER TABLE context_nodes ADD COLUMN blurb text;
   CREATE UNIQUE INDEX context_link_key ON context_nodes (url_key) WHERE url_key IS NOT NULL AND NOT archived;
   CREATE INDEX context_links ON context_nodes (created_at DESC) WHERE kind = 'link' AND NOT archived`,
  // Links at scale: page through them newest-first (everywhere, or within one area) by index alone,
  // and index them for search as their own kind, with the address broken into plain words.
  `CREATE INDEX context_links_id ON context_nodes (id DESC) WHERE kind = 'link' AND NOT archived;
   CREATE INDEX context_links_parent ON context_nodes (parent_id, id DESC) WHERE kind = 'link' AND NOT archived;
   DROP INDEX context_links;
   UPDATE search_docs d SET entity_type = 'link',
          body = d.body || E'\\n' || regexp_replace(regexp_replace(n.url, '^https?://', ''), '[^[:alnum:]]+', ' ', 'g')
     FROM context_nodes n WHERE n.id = d.entity_id AND d.entity_type = 'context' AND n.kind = 'link'`,
  // A rail module can be a warning or an error from an agent's work, shown first and marked as such.
  `ALTER TABLE rail_modules ADD COLUMN level text NOT NULL DEFAULT 'info'`,
  // Deleted tasks wait in a bin (deleted_at set) and are removed for good 15 days later.
  `ALTER TABLE todos ADD COLUMN deleted_at timestamptz;
   CREATE INDEX todos_deleted ON todos (deleted_at) WHERE deleted_at IS NOT NULL`,
  // Signing in to connect (OAuth), and guests.
  // - url_token: whether an agent's static token could still be given in the address itself.
  //   Retired with that form of address (next migration); the column is no longer read.
  // - A guest is a person other than the owner (agents.kind = 'guest') whose own agents may add and
  //   follow tasks for the owner. passcode_hash is what the guest signs in with when connecting one.
  // - todos.guest_id tags a task as belonging to that guest's shared list; scope 'guest' means the
  //   owner has not placed it on a day yet.
  // - oauth_*: registered client apps, approved connections, and their codes and tokens (hashed).
  // - auth_attempts: failed sign-ins, to slow guessing.
  // Every statement is safe to repeat, and it also makes sure the bin's column exists: a preview
  // of this change (which shares the production database) may have recorded it under an earlier
  // number before the bin's migration was written, and this repairs either order.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS url_token boolean NOT NULL DEFAULT true;
   ALTER TABLE agents ADD COLUMN IF NOT EXISTS passcode_hash text;
   ALTER TABLE todos ADD COLUMN IF NOT EXISTS guest_id text;
   CREATE INDEX IF NOT EXISTS todos_guest ON todos (guest_id, id DESC) WHERE guest_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS oauth_clients (
     id text PRIMARY KEY,
     kind text NOT NULL,
     name text NOT NULL DEFAULT '',
     redirect_uris text[] NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     fetched_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE IF NOT EXISTS oauth_grants (
     id text PRIMARY KEY,
     agent_id text NOT NULL,
     client_id text NOT NULL,
     client_name text NOT NULL DEFAULT '',
     client_host text NOT NULL DEFAULT '',
     read_only boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_used_at timestamptz,
     revoked_at timestamptz
   );
   CREATE INDEX IF NOT EXISTS oauth_grants_agent ON oauth_grants (agent_id) WHERE revoked_at IS NULL;
   CREATE TABLE IF NOT EXISTS oauth_tokens (
     hash text PRIMARY KEY,
     kind text NOT NULL,
     grant_id text,
     expires_at timestamptz NOT NULL,
     used_at timestamptz,
     data jsonb NOT NULL DEFAULT '{}'
   );
   CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
   CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens (expires_at);
   CREATE TABLE IF NOT EXISTS auth_attempts (key text NOT NULL, ip text NOT NULL, ts timestamptz NOT NULL DEFAULT now());
   CREATE INDEX IF NOT EXISTS auth_attempts_key ON auth_attempts (key, ts);
   ALTER TABLE todos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
   CREATE INDEX IF NOT EXISTS todos_deleted ON todos (deleted_at) WHERE deleted_at IS NOT NULL`,
  // Addresses with the static token in them (/api/mcp/ss_…) are retired. Tokens that could be used
  // that way may sit in logs and settings screens, so they are cancelled. Tokens made since, which
  // were only ever accepted as a header, keep working.
  `UPDATE agents SET token_hash = NULL WHERE url_token AND token_hash IS NOT NULL`,
  // Bookmarks: posts the owner marked to come back to, and when. The feed can show only these.
  `ALTER TABLE posts ADD COLUMN IF NOT EXISTS bookmarked_at timestamptz;
   CREATE INDEX IF NOT EXISTS posts_bookmarked ON posts (channel, id DESC) WHERE bookmarked_at IS NOT NULL AND parent_id IS NULL`,
  // Repeating tasks. repeat is how often (daily, every_3_days, weekly, biweekly, monthly, yearly). Finishing one
  // creates the next, counted from the day it was finished; next_id on the finished task points at it.
  `ALTER TABLE todos ADD COLUMN IF NOT EXISTS repeat text;
   ALTER TABLE todos ADD COLUMN IF NOT EXISTS next_id text`,
  // The journal: context nodes of kind 'journal', the owner's own dated writing. entry_date is the
  // day an entry belongs to (the owner's calendar, changeable); tags are its themes. tags_by says
  // who chose them ('auto' while Subspace categorises the entry, 'owner' once the owner has changed
  // them, after which they are left alone); tags_for is a hash of the text they were worked out from.
  `ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
   ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS entry_date date;
   ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS tags_by text;
   ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS tags_for text;
   CREATE INDEX IF NOT EXISTS context_journal ON context_nodes (entry_date DESC, id DESC) WHERE kind = 'journal' AND NOT archived;
   CREATE INDEX IF NOT EXISTS context_journal_tags ON context_nodes USING gin (tags) WHERE kind = 'journal' AND NOT archived`,
  // The journal seen from further away. Each entry carries a mood (one of a short list; mood_by says
  // whether the app or the owner chose it) and its summary holds the entry's gist in a sentence. A
  // month has a written digest of its entries; basis is a hash of what it was written from, so it is
  // rewritten only when the month's entries change.
  `ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS mood text;
   ALTER TABLE context_nodes ADD COLUMN IF NOT EXISTS mood_by text;
   CREATE TABLE IF NOT EXISTS journal_months (
     ym text PRIMARY KEY,
     summary text NOT NULL DEFAULT '',
     basis text NOT NULL DEFAULT '',
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // What agents did, to be read afterwards (core/audit.ts).
  // - agent_calls: one row per tool call, through MCP or from a run inside Subspace: who, through which
  //   app, the arguments, whether it worked, how long it took, and what it was shown. query and path are
  //   the search text and explore path, lifted out of args; refs are the ids and context paths the call
  //   named, seen the ids its result contained; result is the start of what came back.
  // - agent_runs: one row per run inside Subspace (why it started, how it ended, steps, tokens, the
  //   model's own words) and per wake-up call sent to an outside agent.
  `CREATE TABLE IF NOT EXISTS agent_calls (
     id bigserial PRIMARY KEY,
     ts timestamptz NOT NULL DEFAULT now(),
     agent_id text NOT NULL,
     via text NOT NULL,
     run_id text,
     client text,
     grant_id text,
     tool text NOT NULL,
     kind text NOT NULL,
     args jsonb NOT NULL DEFAULT '{}',
     ok boolean NOT NULL,
     error text,
     ms int NOT NULL DEFAULT 0,
     query text,
     path text,
     refs text[] NOT NULL DEFAULT '{}',
     seen text[] NOT NULL DEFAULT '{}',
     result_count int,
     result_chars int NOT NULL DEFAULT 0,
     result text NOT NULL DEFAULT ''
   );
   CREATE INDEX IF NOT EXISTS agent_calls_agent ON agent_calls (agent_id, ts DESC);
   CREATE INDEX IF NOT EXISTS agent_calls_tool ON agent_calls (tool, ts DESC);
   CREATE INDEX IF NOT EXISTS agent_calls_ts ON agent_calls (ts);
   CREATE INDEX IF NOT EXISTS agent_calls_failed ON agent_calls (ts DESC) WHERE NOT ok;
   CREATE INDEX IF NOT EXISTS agent_calls_run ON agent_calls (run_id, id) WHERE run_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS agent_calls_seen ON agent_calls USING gin (seen);
   CREATE INDEX IF NOT EXISTS agent_calls_refs ON agent_calls USING gin (refs);
   CREATE TABLE IF NOT EXISTS agent_runs (
     id text PRIMARY KEY,
     agent_id text NOT NULL,
     via text NOT NULL,
     reason text NOT NULL DEFAULT '',
     started_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz,
     status text NOT NULL DEFAULT 'running',
     detail text,
     model text,
     effort text,
     steps int NOT NULL DEFAULT 0,
     input_tokens bigint NOT NULL DEFAULT 0,
     output_tokens bigint NOT NULL DEFAULT 0,
     calls int NOT NULL DEFAULT 0,
     errors int NOT NULL DEFAULT 0,
     said text NOT NULL DEFAULT ''
   );
   CREATE INDEX IF NOT EXISTS agent_runs_agent ON agent_runs (agent_id, started_at DESC)`,
  // Tags on tasks, chosen by the owner or the agent that added the task; the lists can be narrowed to them.
  // A rail module can point at a task (todo_id), and says what clears it from the rail (clears_on):
  // 'dismiss' (the owner dismisses it, or it runs out), 'action' (the owner taps one of its buttons),
  // 'todo_open' (the owner opens the task) or 'todo_done' (the task is finished).
  `ALTER TABLE todos ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
   CREATE INDEX IF NOT EXISTS todos_tags ON todos USING gin (tags) WHERE deleted_at IS NULL;
   ALTER TABLE rail_modules ADD COLUMN IF NOT EXISTS todo_id text;
   ALTER TABLE rail_modules ADD COLUMN IF NOT EXISTS clears_on text NOT NULL DEFAULT 'dismiss';
   CREATE INDEX IF NOT EXISTS rail_modules_todo ON rail_modules (todo_id) WHERE todo_id IS NOT NULL`,
  // The rail as notifications: a module has an icon, every module clears when the owner acts on it
  // (cleared_by records how: dismiss, action, todo_open or later; clears_on is no longer read), and
  // "Later" turns a module into a task in the owner's list (kept_todo_id) so the follow-up outlasts it.
  `ALTER TABLE rail_modules ADD COLUMN IF NOT EXISTS icon text;
   ALTER TABLE rail_modules ADD COLUMN IF NOT EXISTS cleared_by text;
   ALTER TABLE rail_modules ADD COLUMN IF NOT EXISTS kept_todo_id text`,
  // The owner's iPhones and iPads, for push notifications about the rail (core/push.ts). env is
  // "sandbox" for builds run from Xcode and "production" for TestFlight and the App Store.
  `CREATE TABLE IF NOT EXISTS push_devices (
     token text PRIMARY KEY,
     env text NOT NULL DEFAULT 'production',
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen timestamptz NOT NULL DEFAULT now()
   )`,
  // What the owner lets an agent see and do: read-only, which parts of the app, which top-level
  // sections of context (core/access.ts). Null is everything, as before.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS access jsonb`,
];

// The key of the lock that lets one server instance at a time change the schema.
const MIGRATION_LOCK = 7782002;

/**
 * Runs `fn` in a transaction that holds the migration lock. The lock belongs to the transaction
 * (`pg_advisory_xact_lock`), so it is gone when the transaction ends, however it ends. It must not
 * be a session lock (`pg_advisory_lock`): the database is reached through a pooler that gives each
 * statement whichever server connection is free, so the unlock can land on a different connection
 * from the lock. The lock is then never released, and every later start waits for it for ever.
 */
async function locked<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL lock_timeout = ${LOCK_WAIT_MS}`);
    await c.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (e) {
    if (!timedOut(e)) await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** The versions already applied, or none when the table is not there yet (a new database). */
async function applied(c: PoolClient): Promise<Set<number>> {
  try {
    return new Set((await c.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as number));
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return new Set();
    throw e;
  }
}

async function migrate() {
  const c = await pool().connect();
  let broken = false;
  try {
    // The usual start: everything is applied and the first-run content is there. Reading that
    // takes no lock, so a new server instance never waits on another one.
    const done = await applied(c);
    const upToDate = MIGRATIONS.every((_, i) => done.has(i + 1));
    if (upToDate && (await c.query("SELECT 1 FROM agents LIMIT 1")).rowCount) return;

    await locked(c, () => c.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      if (done.has(i + 1)) continue;
      await locked(c, async () => {
        // Another instance may have applied it while this one waited for the lock.
        if ((await c.query("SELECT 1 FROM schema_migrations WHERE version = $1", [i + 1])).rowCount) return;
        const migration: QueryConfig & { query_timeout: number } = { text: MIGRATIONS[i], query_timeout: MIGRATION_MS };
        await c.query(migration);
        await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [i + 1]);
        console.log(`db: applied migration ${i + 1}`);
      });
    }
    await locked(c, () => bootstrap(c));
  } catch (e) {
    broken = true; // whatever state the connection is in, do not hand it to a request
    throw e;
  } finally {
    c.release(broken ? true : undefined);
  }
}

/** First-run content: the owner, the default Claude agent, and a starting shape for context. */
async function bootstrap(c: PoolClient) {
  const has = await c.query("SELECT 1 FROM agents LIMIT 1");
  if (has.rowCount) return;
  const handle = (process.env.SUBSPACE_OWNER_HANDLE || "chris").toLowerCase();
  const name = process.env.SUBSPACE_OWNER_NAME || "Chris";
  await c.query(
    `INSERT INTO agents (id, handle, name, kind, bio, roles) VALUES
     ('a_owner', $1, $2, 'human', 'The person Subspace is for.', '{owner}'),
     ('a_claude', 'claude', 'Claude', 'agent', 'Default agent. Draws the illustrations and icons for everyone.', '{illustrator}')`,
    [handle, name],
  );
  const nodes: [string, string, string, string][] = [
    ["c_me", "me", "Me", "Who I am, what I care about, how I like to work."],
    ["c_people", "people", "People", "Family, friends and the people I work with."],
    ["c_work", "work", "Work", "Projects, goals and commitments."],
    ["c_home", "home", "Home", "The house, routines, finances and logistics."],
    ["c_agents", "agents", "Agents", "Working notes agents keep for each other."],
  ];
  for (const [id, path, title, summary] of nodes) {
    await c.query(
      "INSERT INTO context_nodes (id, path, title, summary, updated_by) VALUES ($1,$2,$3,$4,'a_owner')",
      [id, path, title, summary],
    );
    await c.query("INSERT INTO search_docs (entity_type, entity_id, title, body) VALUES ('context',$1,$2,$3)", [id, title, summary]);
  }
}

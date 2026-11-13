import { Pool, types, type PoolClient } from "pg";

// Dates stay as YYYY-MM-DD strings; bigints (event sequence numbers) become numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __ssPool?: Pool; __ssReady?: Promise<void> };

function pool(): Pool {
  if (!g.__ssPool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__ssPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  }
  return g.__ssPool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const r = await pool().query(sql, params);
  return r.rows as T[];
}

export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Runs migrations once per server instance. Each migration is applied exactly once, in order. */
export function ready(): Promise<void> {
  if (!g.__ssReady) {
    g.__ssReady = migrate().catch((e) => {
      g.__ssReady = undefined;
      throw e;
    });
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
];

async function migrate() {
  const c = await pool().connect();
  try {
    await c.query("SELECT pg_advisory_lock(7782001)");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as number));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      if (done.has(i + 1)) continue;
      await c.query("BEGIN");
      try {
        await c.query(MIGRATIONS[i]);
        await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [i + 1]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
    await bootstrap(c);
  } finally {
    await c.query("SELECT pg_advisory_unlock(7782001)").catch(() => {});
    c.release();
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

// The whole app state ({ players, events }) is one small JSON document.
// Writes use optimistic concurrency: if someone else saved in between, re-run the change on fresh data,
// so two friends answering the poll at the same moment never overwrite each other.

const empty = () => ({ players: [], events: [] });
const MAX_ATTEMPTS = 8;

/** Store backed by a Cloudflare D1 database (Webflow Cloud's SQLite). See migrations/. */
export class D1Store {
  constructor(db) {
    this.db = db;
  }

  async load() {
    const row = await this.db.prepare('SELECT data, version FROM app_state WHERE id = 1').first();
    return row ? { data: { ...empty(), ...JSON.parse(row.data) }, version: row.version } : { data: empty(), version: 0 };
  }

  async read() {
    return (await this.load()).data;
  }

  async transaction(change) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data, version } = await this.load();
      const result = await change(data);
      const saved = await this.db
        .prepare(
          `INSERT INTO app_state (id, data, version) VALUES (1, ?1, 1)
           ON CONFLICT (id) DO UPDATE SET data = ?1, version = version + 1 WHERE version = ?2`,
        )
        .bind(JSON.stringify(data), version)
        .run();
      if (saved.meta.changes === 1) return result;
    }
    throw new Error('Too many people saving at once, please try again');
  }
}

/** In-memory store with the same interface, for tests and local experiments. */
export class MemoryStore {
  constructor(data = empty()) {
    this.json = JSON.stringify(data);
  }

  async read() {
    return JSON.parse(this.json);
  }

  async transaction(change) {
    const data = await this.read();
    const result = await change(data);
    this.json = JSON.stringify(data);
    return result;
  }
}

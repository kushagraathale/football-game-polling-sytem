import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { D1Store } from '../src/lib/store.js';

// Minimal stand-in for Cloudflare's D1 API on top of Node's built-in SQLite, running the real migration.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_app_state.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => statement(sql) };
}

test('D1 store saves and reads back the state', async () => {
  const store = new D1Store(fakeD1());
  assert.deepEqual(await store.read(), { players: [], events: [] });
  await store.transaction((data) => data.players.push({ id: 'a' }));
  await store.transaction((data) => data.players.push({ id: 'b' }));
  assert.deepEqual((await store.read()).players.map((p) => p.id), ['a', 'b']);
});

test('simultaneous writes are retried instead of overwriting each other', async () => {
  const db = fakeD1();
  const one = new D1Store(db);
  const two = new D1Store(db);
  await one.transaction((data) => data.players.push({ id: 'seed' }));

  let interleaved = false;
  await one.transaction(async (data) => {
    // Someone else saves after we read but before we write.
    if (!interleaved) {
      interleaved = true;
      await two.transaction((d) => d.players.push({ id: 'theirs' }));
    }
    data.players.push({ id: 'mine' });
  });
  assert.deepEqual((await one.read()).players.map((p) => p.id).sort(), ['mine', 'seed', 'theirs']);
});

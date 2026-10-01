import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Tiny JSON-file database. Pass no file for an in-memory store (used by tests). */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { players: [], events: [] };
    this.pending = Promise.resolve();
  }

  async load() {
    if (this.file) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    this.data.players ??= [];
    this.data.events ??= [];
    return this;
  }

  /** Writes are serialised and atomic (write to a temp file, then rename). */
  save() {
    if (!this.file) return Promise.resolve();
    const snapshot = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.tmp`;
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    return this.pending;
  }
}

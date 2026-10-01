import http from 'node:http';
import { createApp } from './lib/app.js';
import { Store } from './lib/store.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || new URL('./data/db.json', import.meta.url).pathname;

const store = await new Store(dataFile).load();
http.createServer(createApp(store)).listen(port, () => {
  console.log(`Matchday is running on http://localhost:${port}`);
});

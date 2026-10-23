import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const storage = new Map();
let remote = { state: null, revision: 0, updatedAt: null };
const context = {
  console,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  Response,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  async fetch(_url, init) {
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.headers.Authorization !== "Bearer test-sync-key-123") {
      return Response.json({ error: "同步密钥不正确" }, { status: 401 });
    }
    if (init.method === "GET") return Response.json(remote);
    if (!body.force && body.baseRevision !== remote.revision) {
      return Response.json({ error: "云端数据已更新", revision: remote.revision }, { status: 409 });
    }
    remote = { state: body.state, revision: remote.revision + 1, updatedAt: "2026-10-24T00:00:00.000Z" };
    return Response.json(remote);
  }
};
context.window = context;

vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../dist/sync.js", import.meta.url), "utf8"), context);

const client = context.ListenfolioSync;
assert.equal(client.isConfigured(), false);
client.configure("https://sync.example/", "test-sync-key-123");
assert.equal(client.getConfig().endpoint, "https://sync.example");

await client.push({ version: 5, books: [], annotations: [] });
assert.equal(client.getRevision(), 1);
assert.equal(remote.state.version, 5);

const pulled = await client.pull();
assert.equal(pulled.revision, 1);
assert.equal(client.getStatus().kind, "synced");

remote.revision = 2;
await assert.rejects(() => client.push({ version: 5 }), error => error.code === "conflict");
assert.equal(client.getStatus().kind, "conflict");

client.disconnect();
assert.equal(client.isConfigured(), false);
console.log("Sync client test passed: configuration, push, pull and conflict handling verified.");

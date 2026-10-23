import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const local = new Map();
const session = new Map();
let remoteText = null;
let remoteSha = null;
let shaCounter = 0;

function storage(map) {
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

const context = {
  console,
  URL,
  AbortController,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  setTimeout,
  clearTimeout,
  Response,
  btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  atob(value) { return Buffer.from(value, "base64").toString("binary"); },
  localStorage: storage(local),
  sessionStorage: storage(session),
  async fetch(url, init) {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/Cityfishman\/IELSnetwork-data\/contents\/data\/listenfolio-state\.json/);
    if (init.headers.Authorization !== "Bearer test-token-value") {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (init.method === "GET") {
      if (!remoteText) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({
        type: "file",
        sha: remoteSha,
        content: Buffer.from(remoteText, "utf8").toString("base64")
      });
    }
    const body = JSON.parse(init.body);
    if (remoteSha && body.sha !== remoteSha) return Response.json({ message: "Conflict" }, { status: 409 });
    if (!remoteSha && body.sha) return Response.json({ message: "Conflict" }, { status: 409 });
    remoteText = Buffer.from(body.content, "base64").toString("utf8");
    remoteSha = `sha-${++shaCounter}`;
    return Response.json({ content: { sha: remoteSha }, commit: { sha: `commit-${shaCounter}` } }, { status: shaCounter === 1 ? 201 : 200 });
  }
};
context.window = context;

vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../dist/sync.js", import.meta.url), "utf8"), context);

const client = context.ListenfolioSync;
assert.equal(client.isConfigured(), false);
assert.equal(client.hasRepositoryConfig(), false);
client.configure({
  owner: "Cityfishman",
  repo: "IELSnetwork-data",
  branch: "main",
  path: "data/listenfolio-state.json",
  token: "test-token-value",
  rememberToken: false
});
assert.equal(client.isConfigured(), true);
assert.equal(client.hasRepositoryConfig(), true);
assert.equal(local.has("listenfolio-github-token-v1"), false);
assert.equal(session.get("listenfolio-github-token-v1"), "test-token-value");

await client.push({ version: 5, books: [], annotations: [] });
assert.equal(client.getRevision(), 1);
assert.equal(JSON.parse(remoteText).state.version, 5);

const pulled = await client.pull();
assert.equal(pulled.revision, 1);
assert.equal(client.getStatus().kind, "synced");

const remoteDocument = JSON.parse(remoteText);
remoteDocument.revision = 2;
remoteDocument.state.annotations = [{ id: "remote-change" }];
remoteText = `${JSON.stringify(remoteDocument)}\n`;
remoteSha = "sha-remote";
await assert.rejects(() => client.push({ version: 5 }), error => error.code === "conflict");
assert.equal(client.getStatus().kind, "conflict");

await client.push({ version: 5, books: [], annotations: [{ id: "local-choice" }] }, { force: true });
assert.equal(client.getRevision(), 3);
assert.equal(JSON.parse(remoteText).state.annotations[0].id, "local-choice");

client.configure({
  owner: "Cityfishman",
  repo: "IELSnetwork-data",
  branch: "main",
  path: "data/listenfolio-state.json",
  token: "",
  rememberToken: true
});
assert.equal(local.get("listenfolio-github-token-v1"), "test-token-value");

client.disconnect();
assert.equal(client.isConfigured(), false);
assert.equal(local.has("listenfolio-github-token-v1"), false);
console.log("GitHub sync client test passed: session token, file create/read, SHA conflict and forced update verified.");

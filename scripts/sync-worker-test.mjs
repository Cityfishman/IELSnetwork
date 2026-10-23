import assert from "node:assert/strict";
import worker from "../worker/src/index.mjs";

let storedFile = null;
let storedSha = null;
let commitCounter = 0;

const githubFetch = async (_url, init = {}) => {
  if ((init.method || "GET") === "GET") {
    if (!storedFile) return Response.json({ message: "Not Found" }, { status: 404 });
    return Response.json({ content: Buffer.from(storedFile, "utf8").toString("base64"), sha: storedSha });
  }
  const payload = JSON.parse(init.body);
  if (storedSha && payload.sha !== storedSha) return Response.json({ message: "Conflict" }, { status: 409 });
  storedFile = Buffer.from(payload.content, "base64").toString("utf8");
  storedSha = `sha-${++commitCounter}`;
  return Response.json({ commit: { sha: `commit-${commitCounter}` }, content: { sha: storedSha } }, { status: storedSha === "sha-1" ? 201 : 200 });
};

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "private-data",
  GITHUB_BRANCH: "main",
  DATA_PATH: "data/state.json",
  SYNC_KEY: "a-long-test-sync-key",
  ALLOWED_ORIGINS: "https://cityfishman.github.io",
  __fetch: githubFetch
};

const call = (method, body, key = env.SYNC_KEY) => worker.fetch(new Request("https://sync.example/v1/state", {
  method,
  headers: {
    "Origin": "https://cityfishman.github.io",
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  },
  body: body ? JSON.stringify(body) : undefined
}), env);

let response = await call("GET");
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { state: null, revision: 0, updatedAt: null });

response = await call("PUT", { baseRevision: 0, state: { version: 5, books: [], annotations: [{ id: "a1" }] } });
assert.equal(response.status, 200);
assert.equal((await response.json()).revision, 1);

response = await call("GET");
const loaded = await response.json();
assert.equal(loaded.revision, 1);
assert.equal(loaded.state.annotations[0].id, "a1");

response = await call("PUT", { baseRevision: 0, state: { version: 5 } });
assert.equal(response.status, 409);

response = await call("GET", null, "wrong-key-value");
assert.equal(response.status, 401);

response = await worker.fetch(new Request("https://sync.example/v1/state", { headers: { Origin: "https://evil.example" } }), env);
assert.equal(response.status, 403);

console.log("Sync worker test passed: authentication, read, write, conflict and CORS behavior verified.");

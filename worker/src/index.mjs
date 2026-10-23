const MAX_STATE_BYTES = 900_000;

function json(data, status = 200, origin = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configured = String(env.ALLOWED_ORIGINS || "https://cityfishman.github.io")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured.includes(origin.replace(/\/$/, "")) ? origin : false;
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return constantTimeEqual(header, `Bearer ${env.SYNC_KEY || ""}`) && String(env.SYNC_KEY || "").length >= 12;
}

function githubUrl(env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER || "");
  const repo = encodeURIComponent(env.GITHUB_REPO || "");
  const path = String(env.DATA_PATH || "data/listenfolio-state.json")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function githubHeaders(env) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${env.GITHUB_TOKEN || ""}`,
    "User-Agent": "listenfolio-sync-worker"
  };
}

function bytesToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToText(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubFetch(env, url, init) {
  const fetcher = typeof env.__fetch === "function" ? env.__fetch : fetch;
  return fetcher(url, init);
}

async function readStoredState(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const response = await githubFetch(env, `${githubUrl(env)}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env)
  });
  if (response.status === 404) return { document: null, sha: null };
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`GitHub 读取失败：${detail.message || response.status}`);
  }
  const file = await response.json();
  const document = JSON.parse(base64ToText(file.content));
  return { document, sha: file.sha };
}

async function writeStoredState(env, document, sha) {
  const body = {
    message: `sync: update listening data (revision ${document.revision})`,
    content: bytesToBase64(`${JSON.stringify(document, null, 2)}\n`),
    branch: env.GITHUB_BRANCH || "main"
  };
  if (sha) body.sha = sha;
  const response = await githubFetch(env, githubUrl(env), {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status === 409 || response.status === 422) return { conflict: true };
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`GitHub 保存失败：${detail.message || response.status}`);
  }
  const result = await response.json();
  return { conflict: false, commit: result.commit?.sha || null };
}

function validateEnvironment(env) {
  const required = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "SYNC_KEY"];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Worker 缺少配置：${missing.join(", ")}`);
}

async function handleRequest(request, env, origin) {
  validateEnvironment(env);
  if (!authorized(request, env)) return json({ error: "同步密钥不正确" }, 401, origin);

  if (request.method === "GET") {
    const stored = await readStoredState(env);
    if (!stored.document) return json({ state: null, revision: 0, updatedAt: null }, 200, origin);
    return json({
      state: stored.document.state,
      revision: Number(stored.document.revision || 0),
      updatedAt: stored.document.updatedAt || null
    }, 200, origin);
  }

  if (request.method === "PUT") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_STATE_BYTES) return json({ error: "同步数据超过 900 KB 限制" }, 413, origin);
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload.state !== "object" || Array.isArray(payload.state)) {
      return json({ error: "同步数据格式不正确" }, 400, origin);
    }
    const serializedState = JSON.stringify(payload.state);
    if (new TextEncoder().encode(serializedState).byteLength > MAX_STATE_BYTES) {
      return json({ error: "同步数据超过 900 KB 限制" }, 413, origin);
    }

    const stored = await readStoredState(env);
    const currentRevision = Number(stored.document?.revision || 0);
    if (!payload.force && Number(payload.baseRevision || 0) !== currentRevision) {
      return json({ error: "云端数据已更新", revision: currentRevision, updatedAt: stored.document?.updatedAt || null }, 409, origin);
    }

    const updatedAt = new Date().toISOString();
    const nextDocument = {
      schemaVersion: 1,
      revision: currentRevision + 1,
      updatedAt,
      state: payload.state
    };
    const saved = await writeStoredState(env, nextDocument, stored.sha);
    if (saved.conflict) {
      return json({ error: "GitHub 文件刚刚被其他设备更新", revision: currentRevision }, 409, origin);
    }
    return json({ revision: nextDocument.revision, updatedAt, commit: saved.commit }, 200, origin);
  }

  return json({ error: "Method not allowed" }, 405, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (origin === false) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 204 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true }, 200, origin);
    if (url.pathname !== "/v1/state") return json({ error: "Not found" }, 404, origin);
    try {
      return await handleRequest(request, env, origin);
    } catch (error) {
      return json({ error: error.message || "同步服务异常" }, 500, origin);
    }
  }
};

export { base64ToText, bytesToBase64 };

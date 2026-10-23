(function () {
  "use strict";

  const CONFIG_KEY = "listenfolio-github-sync-config-v1";
  const TOKEN_KEY = "listenfolio-github-token-v1";
  const REVISION_KEY = "listenfolio-github-revision-v1";
  const SHA_KEY = "listenfolio-github-file-sha-v1";
  const DEFAULT_CONFIG = {
    owner: "Cityfishman",
    repo: "IELSnetwork-data",
    branch: "main",
    path: "data/listenfolio-state.json"
  };
  const MAX_DOCUMENT_BYTES = 900_000;
  const listeners = new Set();

  let config = readJson(localStorage.getItem(CONFIG_KEY));
  let token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  let revision = Number(localStorage.getItem(REVISION_KEY) || 0);
  let fileSha = localStorage.getItem(SHA_KEY) || null;
  let status = initialStatus();

  function readJson(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function initialStatus() {
    if (!config) return { kind: "off", message: "未配置 GitHub 同步", updatedAt: null };
    if (!token) return { kind: "off", message: "需要输入 GitHub Token", updatedAt: null };
    return { kind: "idle", message: "等待同步", updatedAt: null };
  }

  function normalizeConfig(value) {
    const owner = String(value.owner || "").trim();
    const repo = String(value.repo || "").trim().replace(/\.git$/i, "");
    const branch = String(value.branch || "main").trim();
    const path = String(value.path || "data/listenfolio-state.json").trim().replace(/^\/+/, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner)) throw new Error("GitHub 用户名或组织名格式不正确");
    if (!/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("私有仓库名称格式不正确");
    if (!branch || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) throw new Error("分支名称格式不正确");
    if (!path || path.endsWith("/") || path.includes("..")) throw new Error("数据文件路径格式不正确");
    return { owner, repo, branch, path };
  }

  function repositoryIdentity(value) {
    return value ? `${value.owner}/${value.repo}@${value.branch}:${value.path}`.toLowerCase() : "";
  }

  function setStatus(kind, message, updatedAt = status.updatedAt) {
    status = { kind, message, updatedAt };
    listeners.forEach(listener => listener({ ...status }));
  }

  function apiUrl() {
    const path = config.path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`;
  }

  function headers() {
    return {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
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

  async function githubRequest(method, body) {
    if (!config || !token) throw new Error("请先填写私有仓库信息和 GitHub Token");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = method === "GET" ? `${apiUrl()}?ref=${encodeURIComponent(config.branch)}` : apiUrl();
      const response = await fetch(url, {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 404 && method === "GET") return { missing: true };
      if (response.status === 409 || (response.status === 422 && /sha|already exists/i.test(result.message || ""))) {
        const error = new Error("私有仓库数据已在另一台设备更新");
        error.code = "conflict";
        throw error;
      }
      if (!response.ok) {
        const message = response.status === 401
          ? "GitHub Token 无效或已过期"
          : response.status === 403
            ? "GitHub 拒绝访问，请检查 Token 权限或请求频率"
            : result.message || `GitHub API 返回 ${response.status}`;
        const error = new Error(message);
        error.code = response.status === 401 || response.status === 403 ? "unauthorized" : "request_failed";
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("GitHub API 请求超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pull() {
    setStatus("syncing", "正在从 GitHub 私有仓库读取…");
    try {
      const result = await githubRequest("GET");
      if (result.missing) {
        revision = 0;
        fileSha = null;
        localStorage.setItem(REVISION_KEY, "0");
        localStorage.removeItem(SHA_KEY);
        setStatus("synced", "私有仓库尚无数据", null);
        return { state: null, revision: 0, updatedAt: null };
      }
      if (result.type !== "file" || !result.content) throw new Error("GitHub 数据路径不是可读取的文件");
      const document = JSON.parse(base64ToText(result.content));
      if (!document || typeof document.state !== "object") throw new Error("私有仓库中的同步文件格式不正确");
      revision = Number(document.revision || 0);
      fileSha = result.sha || null;
      localStorage.setItem(REVISION_KEY, String(revision));
      if (fileSha) localStorage.setItem(SHA_KEY, fileSha);
      setStatus("synced", "GitHub 数据已加载", document.updatedAt || null);
      return { state: document.state, revision, updatedAt: document.updatedAt || null };
    } catch (error) {
      setStatus("error", error.message);
      throw error;
    }
  }

  async function push(state, options = {}) {
    setStatus("syncing", "正在提交到 GitHub 私有仓库…");
    try {
      if (options.force) {
        const latest = await githubRequest("GET");
        fileSha = latest.missing ? null : latest.sha || null;
        if (!latest.missing && latest.content) {
          const document = JSON.parse(base64ToText(latest.content));
          revision = Number(document.revision || 0);
        } else {
          revision = 0;
        }
      }
      const updatedAt = new Date().toISOString();
      const document = { schemaVersion: 1, revision: revision + 1, updatedAt, state };
      const serialized = `${JSON.stringify(document, null, 2)}\n`;
      if (new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("同步数据超过 900 KB，请导出备份并精简自定义资料");
      }
      const body = {
        message: `sync: update listening data (revision ${document.revision})`,
        content: bytesToBase64(serialized),
        branch: config.branch
      };
      if (fileSha) body.sha = fileSha;
      const result = await githubRequest("PUT", body);
      revision = document.revision;
      fileSha = result.content?.sha || fileSha;
      localStorage.setItem(REVISION_KEY, String(revision));
      if (fileSha) localStorage.setItem(SHA_KEY, fileSha);
      setStatus("synced", "已提交到 GitHub 私有仓库", updatedAt);
      return { revision, updatedAt, commit: result.commit?.sha || null };
    } catch (error) {
      setStatus(error.code === "conflict" ? "conflict" : "error", error.message);
      throw error;
    }
  }

  window.ListenfolioSync = {
    isConfigured() { return !!config && !!token; },
    hasRepositoryConfig() { return !!config; },
    getConfig() {
      return {
        owner: config?.owner || DEFAULT_CONFIG.owner,
        repo: config?.repo || DEFAULT_CONFIG.repo,
        branch: config?.branch || DEFAULT_CONFIG.branch,
        path: config?.path || DEFAULT_CONFIG.path,
        hasToken: !!token,
        rememberToken: !!localStorage.getItem(TOKEN_KEY)
      };
    },
    getStatus() { return { ...status }; },
    getRevision() { return revision; },
    configure(value) {
      const nextConfig = normalizeConfig(value);
      const nextToken = String(value.token || "").trim() || token;
      if (!nextToken) throw new Error("请输入 GitHub fine-grained Token");
      const changedRepository = repositoryIdentity(config) !== repositoryIdentity(nextConfig);
      config = nextConfig;
      token = nextToken;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(TOKEN_KEY, token);
      if (value.rememberToken) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (changedRepository) {
        revision = 0;
        fileSha = null;
        localStorage.setItem(REVISION_KEY, "0");
        localStorage.removeItem(SHA_KEY);
      }
      localStorage.removeItem("listenfolio-sync-config-v1");
      localStorage.removeItem("listenfolio-sync-revision-v1");
      setStatus("idle", "GitHub 同步配置已保存");
    },
    disconnect() {
      config = null;
      token = "";
      revision = 0;
      fileSha = null;
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REVISION_KEY);
      localStorage.removeItem(SHA_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      setStatus("off", "未配置 GitHub 同步", null);
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pull,
    push
  };
})();

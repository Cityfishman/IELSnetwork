(function () {
  "use strict";

  const CONFIG_KEY = "listenfolio-sync-config-v1";
  const REVISION_KEY = "listenfolio-sync-revision-v1";
  const listeners = new Set();
  let config = readConfig();
  let revision = Number(localStorage.getItem(REVISION_KEY) || 0);
  let status = { kind: config ? "idle" : "off", message: config ? "等待同步" : "未配置云同步", updatedAt: null };

  function readConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
      if (saved?.endpoint && saved?.syncKey) return saved;
    } catch (_) {}
    return null;
  }

  function normalizeEndpoint(value) {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("同步地址必须使用 HTTPS");
    }
    return url.toString().replace(/\/$/, "");
  }

  function setStatus(kind, message, updatedAt = status.updatedAt) {
    status = { kind, message, updatedAt };
    listeners.forEach(listener => listener({ ...status }));
  }

  async function request(method, body) {
    if (!config) throw new Error("请先配置云同步");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${config.endpoint}/v1/state`, {
        method,
        headers: {
          "Authorization": `Bearer ${config.syncKey}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409) {
        const error = new Error("云端数据已在另一台设备更新");
        error.code = "conflict";
        error.remoteRevision = Number(result.revision || 0);
        throw error;
      }
      if (!response.ok) {
        const error = new Error(result.error || `同步服务返回 ${response.status}`);
        error.code = response.status === 401 ? "unauthorized" : "request_failed";
        throw error;
      }
      revision = Number(result.revision || 0);
      localStorage.setItem(REVISION_KEY, String(revision));
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("同步请求超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pull() {
    setStatus("syncing", "正在读取云端数据…");
    try {
      const result = await request("GET");
      const updatedAt = result.updatedAt || null;
      setStatus("synced", result.state ? "云端数据已加载" : "云端尚无数据", updatedAt);
      return result;
    } catch (error) {
      setStatus("error", error.message);
      throw error;
    }
  }

  async function push(state, options = {}) {
    setStatus("syncing", "正在保存到私有仓库…");
    try {
      const result = await request("PUT", {
        baseRevision: revision,
        force: !!options.force,
        state
      });
      setStatus("synced", "已同步到私有仓库", result.updatedAt || new Date().toISOString());
      return result;
    } catch (error) {
      setStatus(error.code === "conflict" ? "conflict" : "error", error.message);
      throw error;
    }
  }

  window.ListenfolioSync = {
    isConfigured() { return !!config; },
    getConfig() { return { endpoint: config?.endpoint || "", hasKey: !!config?.syncKey }; },
    getStatus() { return { ...status }; },
    getRevision() { return revision; },
    configure(endpoint, syncKey) {
      const normalized = normalizeEndpoint(endpoint);
      const nextKey = String(syncKey || "").trim() || config?.syncKey;
      if (!nextKey || nextKey.length < 12) throw new Error("同步密钥至少需要 12 个字符");
      config = { endpoint: normalized, syncKey: nextKey };
      revision = 0;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      localStorage.setItem(REVISION_KEY, "0");
      setStatus("idle", "同步配置已保存");
    },
    disconnect() {
      config = null;
      revision = 0;
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(REVISION_KEY);
      setStatus("off", "未配置云同步", null);
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pull,
    push
  };
})();

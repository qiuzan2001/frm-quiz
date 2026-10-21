// github.js — GitHub Contents API
(function (root) {
  "use strict";
  class GitHubError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  function b64utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
  const MIME = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

  class GitHub {
    constructor({ token, repo, branch, name, email }) {
      this.token = token; this.repo = repo; this.branch = branch || "main";
      this.committer = { name: name || "frm-quiz", email: email || "frm-quiz@users.noreply.github.com" };
    }
    url(path) { return `https://api.github.com/repos/${this.repo}/contents/${enc(path)}`; }
    async req(path, { accept, method, body } = {}) {
      const res = await fetch(this.url(path) + (method ? "" : `?ref=${this.branch}`), {
        method: method || "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept || "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).message || msg; } catch (_e) { /* ignore */ }
        throw new GitHubError(res.status, msg);
      }
      return res;
    }
    // 目录列表：[{name, path, sha, type}]；不存在返回 []
    async dir(path) {
      try {
        return (await (await this.req(path)).json()).map((f) => ({ name: f.name, path: f.path, sha: f.sha, type: f.type }));
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    }
    async raw(path) { return (await this.req(path, { accept: "application/vnd.github.raw+json" })).text(); }
    async blob(path) {
      const b = await (await this.req(path, { accept: "application/vnd.github.raw+json" })).blob();
      const t = MIME[(path.split(".").pop() || "").toLowerCase()];
      return t ? new Blob([b], { type: t }) : b;
    }
    // 只新建；已存在时 GitHub 返回 422
    async create(path, text, message) {
      const res = await this.req(path, {
        method: "PUT",
        body: { message, content: b64utf8(text), branch: this.branch, committer: this.committer, author: this.committer },
      });
      return (await res.json()).content;
    }
  }
  root.FrmGitHub = { GitHub, GitHubError };
})(self);

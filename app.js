// app.js — 界面与同步
(() => {
  "use strict";
  const L = FrmLogic, S = FrmStore, { GitHub } = FrmGitHub;
  const REPO = "qiuzan2001/FRM-Vault", BRANCH = "main";
  const SYNC_DIR = "题库/FRM1/_sync", PHONE_DIR = SYNC_DIR + "/phone", PLAN_DIR = "Maps/学习计划";
  const CFG_KEY = "frm-quiz-config";
  const UPLOAD_DELAY = 30000;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = $("#main"), syncBtn = $("#btn-sync"), topTitle = $("#top-title");
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : String(kid));
    return el;
  };

  const show = (...kids) => main.replaceChildren(...kids.flat().filter((k) => k != null));

  // ---------- 状态 ----------
  const st = {
    cfg: null, gh: null,
    data: null, plan: null, progressFile: null,
    shas: {}, remote: {}, pending: [],
    progress: {}, tiers: new Map(),
    online: navigator.onLine, busy: false, lastSync: null, error: null,
    queue: null,
  };
  const byPath = () => { const m = new Map(); for (const q of st.data.questions) m.set(q.path, q); return m; };
  let qmap = new Map();

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch (_e) { return null; }
  }
  function saveCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); st.cfg = cfg; st.gh = cfg && cfg.token ? new GitHub({ token: cfg.token, repo: REPO, branch: BRANCH, name: cfg.name, email: cfg.email }) : null; }

  function recompute() {
    const remote = Object.values(st.remote).flat();
    st.progress = L.applyRecords(st.progressFile ? st.progressFile.questions : {}, remote, st.pending);
    st.tiers = L.tierIndex(st.plan);
  }

  async function loadLocal() {
    const [data, plan, progressFile, shas, remote, pending, lastSync] = await Promise.all([
      S.get("questions"), S.get("plan"), S.get("progress"), S.get("shas"), S.get("remote_records"), S.get("pending"), S.get("last_sync"),
    ]);
    st.data = data || null; st.plan = plan || null; st.progressFile = progressFile || null;
    st.shas = shas || {}; st.remote = remote || {}; st.pending = pending || []; st.lastSync = lastSync || null;
    if (st.data) qmap = byPath();
    recompute();
  }

  // ---------- 同步 ----------
  function setSyncUi() {
    syncBtn.classList.toggle("busy", st.busy);
    syncBtn.classList.toggle("pending", !st.busy && st.pending.length > 0);
    syncBtn.classList.toggle("offline", !st.online);
    syncBtn.textContent = st.busy ? "同步中…" : !st.online ? `离线${st.pending.length ? " · 待上传 " + st.pending.length : ""}` : st.pending.length ? `待上传 ${st.pending.length}` : "同步";
  }

  async function upload() {
    if (!st.gh || !st.pending.length || !st.online) return;
    const batch = st.pending.slice();
    const text = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const tryCreate = async (attempt) => {
      const name = L.recordFileName(new Date(), L.randStr(4)) + ".jsonl";
      try {
        await st.gh.create(`${PHONE_DIR}/${name}`, text, `手机作答 ${batch.length} 条`);
        return name;
      } catch (e) {
        if ((e.status === 422 || e.status === 409) && attempt === 0) return tryCreate(1);
        throw e;
      }
    };
    const name = await tryCreate(0);
    st.remote[name] = batch;
    st.pending = st.pending.filter((r) => !batch.includes(r));
    await S.set("remote_records", st.remote);
    await S.set("pending", st.pending);
  }

  async function refresh() {
    const gh = st.gh;
    const [syncList, phoneList, planList] = await Promise.all([gh.dir(SYNC_DIR), gh.dir(PHONE_DIR), gh.dir(PLAN_DIR)]);
    const sha = (list, name) => (list.find((f) => f.name === name) || {}).sha || null;
    const want = [
      ["questions", SYNC_DIR + "/questions.json", sha(syncList, "questions.json")],
      ["progress", SYNC_DIR + "/progress.json", sha(syncList, "progress.json")],
      ["plan", PLAN_DIR + "/plan.json", sha(planList, "plan.json")],
    ];
    if (!sha(syncList, "questions.json") && !st.data) {
      throw Object.assign(new Error("找不到 questions.json：请确认 token 已授权 FRM-Vault 仓库"), { status: 404 });
    }
    for (const [key, path, s] of want) {
      if (!s || st.shas[key] === s) continue;
      const obj = JSON.parse(await gh.raw(path));
      await S.set(key, obj);
      st.shas[key] = s;
      if (key === "questions") { st.data = obj; qmap = byPath(); }
      if (key === "progress") st.progressFile = obj;
      if (key === "plan") st.plan = obj;
    }
    const names = new Set(phoneList.filter((f) => f.name.endsWith(".jsonl")).map((f) => f.name));
    for (const name of Object.keys(st.remote)) if (!names.has(name)) delete st.remote[name];
    for (const name of names) {
      if (st.remote[name]) continue;
      const text = await gh.raw(`${PHONE_DIR}/${name}`);
      st.remote[name] = text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean);
    }
    await S.set("remote_records", st.remote);
    await S.set("shas", st.shas);
    st.lastSync = new Date().toISOString();
    await S.set("last_sync", st.lastSync);
  }

  let uploadTimer = null;
  function scheduleUpload() {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => sync({ quiet: true }), UPLOAD_DELAY);
  }

  async function sync({ quiet, pull } = {}) {
    if (st.busy || !st.gh) return;
    if (!st.online) { setSyncUi(); return; }
    const hadData = !!st.data;
    st.busy = true; st.error = null; setSyncUi();
    let refreshed = false;
    try {
      await upload();
      if (pull || !quiet || !st.data) { await refresh(); refreshed = true; }
      recompute();
    } catch (e) {
      if (e.status === 403 && /rate limit/i.test(e.message || "")) {
        st.error = "GitHub 限流，稍后再试";
      } else if (e.status === 404) {
        st.error = e.message;
      } else if (e.status === 401 || e.status === 403) {
        st.error = "token 无效或没有权限，请到设置页检查";
        if (!quiet || (location.hash || "#today").slice(1) !== "quiz") location.hash = "#settings";
      } else if (e instanceof TypeError) {
        st.error = "网络错误，稍后再试";
      } else {
        st.error = `同步失败：${e.message || e}`;
      }
    } finally {
      st.busy = false; setSyncUi();
      const tab = (location.hash || "#today").slice(1);
      if ((!hadData && st.data) || ((refreshed || st.error) && tab !== "quiz" && tab !== "settings" && tab !== "practice")) render();
      if (!st.error && st.pending.length) scheduleUpload();
    }
  }

  // ---------- 渲染 ----------
  const MATH_RE = /\\\$|\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\\n])+?\$/g;
  const MATH_PH = /\uE000(\d+)\uE001/g;
  function md(text) {
    const keep = [];
    const prepared = (text || "").replace(MATH_RE, (m) => (m === "\\$" ? "\uE002" : (keep.push(m), `\uE000${keep.length - 1}\uE001`)));
    const tpl = document.createElement("template");
    tpl.innerHTML = marked.parse(prepared, { breaks: true });
    const imgs = [];
    for (const img of tpl.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
      img.removeAttribute("src");
      let rel = src;
      try { rel = decodeURI(src); } catch (_e) { /* 保持原样 */ }
      imgs.push([img, rel]);
    }
    const el = h("div");
    el.append(tpl.content);
    const eachText = (fn) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (w.nextNode()) nodes.push(w.currentNode);
      for (const n of nodes) fn(n);
    };
    eachText((n) => { n.nodeValue = n.nodeValue.replace(MATH_PH, (_m, i) => keep[+i]); });
    if (window.renderMathInElement) {
      renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
    }
    eachText((n) => { if (n.nodeValue.includes("\uE002")) n.nodeValue = n.nodeValue.replace(/\uE002/g, "$"); });
    for (const [img, rel] of imgs) loadImage(img, rel);
    return el;
  }
  async function loadImage(img, rel) {
    try {
      const cache = await caches.open("frm-images");
      let res = await cache.match(rel);
      if (!res && st.gh) {
        const blob = await st.gh.blob(rel);
        res = new Response(blob, { headers: { "Content-Type": blob.type || "image/png" } });
        await cache.put(rel, res.clone());
      }
      if (res) {
        img.onload = () => URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(await res.blob());
      }
    } catch (_e) { img.alt = "（图片加载失败）"; }
  }
  function tierTag(q) {
    const t = L.tierOf(st.tiers, q);
    return h("span", { class: "tier " + t }, L.TIER_LABEL[t]);
  }
  function chip(path) {
    const q = qmap.get(path);
    const s = L.stateOf(st.progress, path);
    const cls = s.status === "已完成" ? "done" : s.status === "错题" ? "wrong" : "";
    return h("button", { class: "qchip " + cls, onclick: () => startQueue([path]) }, q ? q.id : path, q ? tierTag(q) : null);
  }
  function countText(c) { return `${c.done}/${c.total}${c.wrong ? " · 错 " + c.wrong : ""}`; }
  function startQueue(paths, title) {
    if (!paths.length) return;
    st.queue = { paths, i: 0, title: title || "" };
    location.hash = "#quiz";
  }
  function actions(paths, title) {
    return h("div", { class: "node-actions" },
      h("button", { class: "btn small", onclick: () => startQueue(L.queueFor(paths, st.progress, false), title) }, "刷未做"),
      h("button", { class: "btn small ghost", onclick: () => startQueue(L.queueFor(paths, st.progress, true), title) }, "全部"));
  }

  function needSetup() {
    show(h("div", { class: "card" }, h("h2", null, "先填 token"), h("p", { class: "muted" }, "到 ⚙︎ 设置页填写 GitHub token 后才能下载题目。")));
  }
  function errorBox() { return st.error ? h("div", { class: "msg err" }, st.error) : null; }

  function viewToday() {
    const today = L.fmtDate(new Date());
    const t = L.todayTasks(st.plan, today, st.progress);
    const days = L.daysToExam(st.plan, today);
    const kindText = { study: "学新内容", weekly: "周复习", review: "复习期" };
    const head = h("div", { class: "card" },
      h("div", { class: "row" }, h("h2", null, today), h("span", { class: "muted" }, days == null ? "" : `距考试 ${days} 天`)),
      h("div", { class: "muted" }, t.day ? `${kindText[t.day.kind] || t.day.kind} · 约 ${Math.round(t.day.minutes / 60 * 10) / 10} 小时${t.day.text ? " · " + t.day.text : ""}` : "今天没有安排，可以去刷题页自选"));
    const groups = t.groups.map((g) => {
      const done = g.done >= g.total && g.total > 0;
      return h("div", { class: "task" + (done ? " done" : "") },
        h("div", { class: "row" }, h("div", { class: "t" }, (done ? "✓ " : "") + g.title), h("span", { class: "muted" }, `${g.done}/${g.total}`)),
        h("div", null, g.paths.map(chip)),
        done ? null : actions(g.paths, g.title));
    });
    const backlog = t.backlog.length
      ? h("div", { class: "card" }, h("div", { class: "row" }, h("h2", null, "待补"), h("span", { class: "muted" }, `${t.backlog.length} 题`)),
          h("p", { class: "muted" }, "之前计划日里还没做的首轮题"), actions(t.backlog, "待补"))
      : null;
    show(errorBox(), head, groups.length ? h("div", { class: "card" }, groups) : null, backlog);
  }

  let practiceMode = "unit";
  function treeNode(name, paths, counts, children, title) {
    const body = h("div", null, actions(paths, title || name), children && children.length ? children : h("div", null, paths.map(chip)));
    return h("details", null, h("summary", null, h("span", { class: "n" }, name), h("span", { class: "c" }, countText(counts))), body);
  }
  function viewPractice() {
    const seg = h("div", { class: "seg" },
      h("button", { class: practiceMode === "unit" ? "on" : "", onclick: () => { practiceMode = "unit"; render(); } }, "按单元"),
      h("button", { class: practiceMode === "source" ? "on" : "", onclick: () => { practiceMode = "source"; render(); } }, "按来源"));
    let body;
    if (practiceMode === "unit") {
      body = L.unitTree(st.data, st.progress).map((ph) => h("div", { class: "card" }, h("h2", null, ph.name),
        ph.units.map((u) => treeNode(`${u.id} ${u.name}`, u.paths, u.counts,
          u.readings.map((r) => treeNode(`${r.id} ${r.title}`, r.paths, r.counts,
            r.los.map((lo) => treeNode(`LO ${lo.lo}`, lo.paths, lo.counts, null, `LO ${lo.lo}`)), `${r.id} ${r.title}`)),
          `${u.id} ${u.name}`))));
    } else {
      const rec = (n) => treeNode(n.name, n.paths, n.counts, (n.children || []).map(rec), n.name);
      body = h("div", { class: "card" }, L.sourceTree(st.data, st.progress).map(rec));
    }
    show(errorBox(), seg, body);
  }

  let wrongCurrent = true;
  function viewWrong() {
    const list = L.wrongList(st.data, st.progress, wrongCurrent);
    const seg = h("div", { class: "seg" },
      h("button", { class: wrongCurrent ? "on" : "", onclick: () => { wrongCurrent = true; render(); } }, "当前仍错"),
      h("button", { class: !wrongCurrent ? "on" : "", onclick: () => { wrongCurrent = false; render(); } }, "曾经错过"));
    const paths = list.map((q) => q.path);
    show(errorBox(), seg,
      h("div", { class: "card" }, h("div", { class: "row" }, h("h2", null, `${list.length} 题`),
        h("button", { class: "btn small", disabled: !paths.length ? "" : null, onclick: () => startQueue(paths, "错题") }, "开始重做")),
        list.length ? h("div", null, list.map((q) => {
          const s = L.stateOf(st.progress, q.path);
          return h("div", { class: "task" }, h("div", { class: "row" }, h("div", null, chip(q.path), " ", h("span", { class: "muted" }, `${q.unit || "未分类"} · ${q.readings.join(" ")}`)),
            h("span", { class: "muted" }, `错 ${s.wrong_count} 次 · ${s.last_done || ""}`)));
        })) : h("div", { class: "empty" }, "没有错题")));
  }

  function viewQuiz() {
    const Q = st.queue;
    if (!Q || !Q.paths.length) { location.hash = "#today"; return; }
    const path = Q.paths[Q.i];
    const q = qmap.get(path);
    if (!q) { Q.i += 1; if (Q.i >= Q.paths.length) location.hash = "#today"; else render(); return; }
    const selfJudge = !q.answer || !q.options.length;
    const s = L.stateOf(st.progress, path);
    let revealed = false;
    const stem = md(q.stem);
    for (const rel of q.images || []) { const img = h("img", { alt: "配图" }); stem.append(img); loadImage(img, rel); }
    const verdict = h("div", { class: "verdict" });
    const exp = h("div", { class: "qexp", style: "display:none" }, q.answer ? h("div", null, h("b", null, `答案：${q.answer}`)) : null, md(q.analysis || "（无解析）"));
    const optEls = new Map();
    const next = h("button", { class: "btn", style: "display:none", onclick: () => { Q.i += 1; if (Q.i >= Q.paths.length) { st.queue = null; location.hash = "#today"; } else render(); } }, Q.i + 1 >= Q.paths.length ? "完成" : "下一题");
    const finish = (correct, choice) => {
      revealed = true;
      exp.style.display = "";
      verdict.className = "verdict " + (correct ? "right" : "wrong");
      verdict.textContent = correct ? "✓ 正确" : "✗ 错误" + (q.answer ? `，正确答案 ${q.answer}` : "");
      next.style.display = "";
      answer(path, choice, correct).catch((e) => {
        st.error = "本机保存失败：" + (e.message || e);
        verdict.textContent += "（本机保存失败：" + (e.message || e) + "）";
        setSyncUi();
      });
    };
    const onPick = (label) => {
      if (revealed) return;
      for (const [l, el] of optEls) {
        el.disabled = true;
        el.classList.toggle("right", l === q.answer);
        el.classList.toggle("wrong", l === label && l !== q.answer);
      }
      finish(label === q.answer, label);
    };
    const opts = q.options.map((o) => {
      const el = h("button", { class: "opt", onclick: () => (q.answer ? onPick(o.label) : null) }, h("b", null, o.label + "."), md(o.text));
      optEls.set(o.label, el);
      return el;
    });
    const judgeRow = selfJudge ? h("div", { class: "judge", style: "display:none" },
      h("button", { class: "btn ok", onclick: () => finish(true, "-") }, "我答对了"),
      h("button", { class: "btn ng", onclick: () => finish(false, "-") }, "我答错了")) : null;
    const judge = selfJudge ? h("div", null,
      h("button", { class: "btn ghost", onclick: (e) => { exp.style.display = ""; e.target.style.display = "none"; judgeRow.style.display = ""; } }, "看答案")) : null;
    const card = h("div", { class: "card" },
      h("div", { class: "qhead" }, h("span", null, `${Q.i + 1} / ${Q.paths.length}${Q.title ? " · " + Q.title : ""}`), h("a", { href: "#today", onclick: () => { st.queue = null; } }, "退出")),
      h("div", { class: "qmeta" }, q.id, " · ", q.unit || "未分类", " · ", q.readings.join(" "), q.los.length ? " · LO " + q.los.join(", ") : "", " ", tierTag(q),
        s.attempts ? h("span", null, ` · 做过 ${s.attempts} 次`) : null),
      h("div", { class: "qstem" }, stem), opts, judge, judgeRow, verdict, exp,
      h("div", { class: "qnav" }, h("button", { class: "btn ghost", disabled: Q.i === 0 ? "" : null, onclick: () => { Q.i -= 1; render(); } }, "上一题"), next));
    let x0 = null;
    card.addEventListener("touchstart", (e) => {
      if (e.target.closest(".katex-display, table")) { x0 = null; return; }
      x0 = e.touches[0].clientX;
    }, { passive: true });
    card.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -70 && revealed) next.click();
      else if (dx > 70 && Q.i > 0) { Q.i -= 1; render(); }
    });
    show(card);
    window.scrollTo(0, 0);
  }

  let settingsNote = null;
  function viewSettings() {
    const cfg = st.cfg || { token: "", name: "Ellie", email: "" };
    const token = h("input", { type: "password", value: cfg.token || "", placeholder: "github_pat_…", autocomplete: "off" });
    const name = h("input", { type: "text", value: cfg.name || "", placeholder: "提交署名" });
    const email = h("input", { type: "email", value: cfg.email || "", placeholder: "署名邮箱（可留空）" });
    const msg = h("div", { class: "msg" + (settingsNote && settingsNote.err ? " err" : ""), style: settingsNote ? null : "display:none" }, settingsNote ? settingsNote.text : null);
    settingsNote = null;
    const say = (t, err) => { msg.style.display = ""; msg.textContent = t; msg.classList.toggle("err", !!err); };
    show(errorBox(),
      h("div", { class: "card" }, h("h2", null, "GitHub"),
        h("div", { class: "field" }, h("label", null, "Token（仓库 owner 创建的 fine-grained token，只授权 FRM-Vault，Contents 读写）"), token),
        h("div", { class: "field" }, h("label", null, "署名"), name),
        h("div", { class: "field" }, h("label", null, "邮箱"), email),
        h("button", { class: "btn", onclick: async () => {
          saveCfg({ token: token.value.trim(), name: name.value.trim() || "Ellie", email: email.value.trim() });
          say("已保存，正在同步…");
          await sync();
          settingsNote = { text: st.error || "同步完成", err: !!st.error };
          render();
        } }, "保存并同步"), msg),
      h("div", { class: "card" }, h("h2", null, "数据"),
        h("p", { class: "muted" }, `题目 ${st.data ? st.data.questions.length + " 道，生成于 " + st.data.generated_at : "未下载"}`),
        h("p", { class: "muted" }, `进度快照 ${st.progressFile ? st.progressFile.exported_at : "无"} · 未合并记录 ${Object.values(st.remote).flat().length} 条 · 待上传 ${st.pending.length} 条`),
        h("p", { class: "muted" }, `最近同步 ${st.lastSync || "无"}`),
        h("div", { class: "node-actions" },
          h("button", { class: "btn small", onclick: async () => { await sync(); render(); } }, "立即同步"),
          h("button", { class: "btn small ghost", onclick: async () => { st.shas = {}; await S.set("shas", {}); await sync(); render(); } }, "重新下载题目"),
          h("button", { class: "btn small ghost", onclick: async () => {
            if (st.pending.length && !confirm(`还有 ${st.pending.length} 条作答没上传，确定清除？`)) return;
            await S.clear(); await caches.delete("frm-images"); localStorage.removeItem(CFG_KEY); location.reload();
          } }, "清除本机数据"))),
      h("div", { class: "card muted" }, "frm-quiz v1 · 作答先存在手机，再上传到仓库 _sync/phone/，Obsidian 打开题库首页或学习计划页时合并。"));
  }

  function render() {
    const tab = (location.hash || "#today").slice(1);
    for (const a of document.querySelectorAll(".tabs a")) a.classList.toggle("on", a.dataset.tab === tab || (tab === "quiz" && a.dataset.tab === "practice"));
    topTitle.textContent = { today: "今日任务", practice: "刷题", wrong: "错题本", settings: "设置", quiz: st.queue && st.queue.title ? st.queue.title : "做题" }[tab] || "FRM 刷题";
    if (tab === "settings") return viewSettings();
    if (!st.cfg || !st.cfg.token) return needSetup();
    if (!st.data) { show(errorBox(), h("div", { class: "empty" }, st.busy ? "正在下载题目…" : "还没有题目数据，点右上角「同步」")); return; }
    if (tab === "quiz") return viewQuiz();
    if (tab === "practice") return viewPractice();
    if (tab === "wrong") return viewWrong();
    return viewToday();
  }

  // ---------- 作答 ----------
  async function answer(path, choice, correct) {
    st.pending.push({ id: L.newId(), q: path, choice, correct, at: L.isoNow(new Date()) });
    await S.set("pending", st.pending);
    recompute();
    setSyncUi();
    scheduleUpload();
  }

  // ---------- 启动 ----------
  window.addEventListener("hashchange", render);
  window.addEventListener("online", () => { st.online = true; setSyncUi(); sync({ quiet: true }); });
  window.addEventListener("offline", () => { st.online = false; setSyncUi(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && st.pending.length) { clearTimeout(uploadTimer); sync({ quiet: true }); } });
  window.addEventListener("pagehide", () => { if (st.pending.length) { clearTimeout(uploadTimer); sync({ quiet: true }); } });
  syncBtn.addEventListener("click", () => sync());
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  (async () => {
    saveCfg(loadCfg());
    await loadLocal();
    setSyncUi();
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (st.gh) sync({ quiet: true, pull: true });
  })();
})();

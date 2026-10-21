// logic.js — 纯逻辑，浏览器与 node 共用
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FrmLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DONE = "已完成";
  const EMPTY = Object.freeze({ status: "未做", attempts: 0, wrong_count: 0, last_done: null });
  const TIER_LABEL = { first: "首轮", optional: "选做", extra: "加练" };

  const pad = (n) => String(n).padStart(2, "0");
  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function isoNow(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const a = Math.abs(off);
    return `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  function recordFileName(d, rand) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}`;
  }
  function randStr(n) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function newId() { return randStr(16); }

  function normalizeStatus(v) {
    const s = v == null ? "" : String(v).trim();
    if (!s) return "未做";
    return s === "完成" ? DONE : s;
  }
  function toCount(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }

  function grade(state, correct, date) {
    const s = state || EMPTY;
    return { status: correct ? DONE : "错题", attempts: s.attempts + 1, wrong_count: s.wrong_count + (correct ? 0 : 1), last_done: date };
  }

  function applyRecords(progress, ...lists) {
    const out = {};
    for (const [k, raw] of Object.entries(progress || {})) {
      const v = raw || {};
      out[k] = { status: normalizeStatus(v.status), attempts: toCount(v.attempts), wrong_count: toCount(v.wrong_count), last_done: v.last_done || null };
    }
    const recs = [].concat(...lists.map((l) => l || []))
      .filter((r) => r && typeof r.id === "string" && typeof r.q === "string" && typeof r.at === "string")
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const r of recs) out[r.q] = grade(out[r.q], r.correct === true, String(r.at).slice(0, 10));
    return out;
  }
  function stateOf(progress, path) { return progress[path] || EMPTY; }

  function counts(paths, progress) {
    const c = { total: paths.length, done: 0, wrong: 0 };
    for (const p of paths) {
      const s = stateOf(progress, p);
      if (s.status !== "未做") c.done += 1;
      if (s.status === "错题") c.wrong += 1;
    }
    return c;
  }

  function tierIndex(plan) {
    const idx = new Map();
    for (const r of (plan && plan.readings) || []) {
      for (const p of r.module_quiz || []) idx.set(p, "first");
      for (const p of r.first || []) idx.set(p, "first");
      for (const p of r.optional || []) if (!idx.has(p)) idx.set(p, "optional");
    }
    return idx;
  }
  function tierOf(idx, q) {
    if (q.kind === "textbook") return "first";
    return idx.get(q.path) || "extra";
  }

  function pathsOf(list) { return list.map((q) => q.path); }

  function unitTree(data, progress) {
    const qs = data.questions.filter((q) => !q.mock);
    const phases = [];
    const phaseOf = {};
    for (const u of data.units) {
      let ph = phaseOf[u.phase];
      if (!ph) { ph = phaseOf[u.phase] = { id: u.phase, name: u.phase_name, units: [] }; phases.push(ph); }
      const uq = qs.filter((q) => q.unit === u.id);
      const readingIds = Object.keys(data.readings).filter((r) => data.readings[r].unit === u.id).sort();
      const readings = readingIds.map((rid) => {
        const rq = uq.filter((q) => q.readings.includes(rid));
        const loPrefix = String(Number(rid.slice(1))) + ".";
        const loIds = Array.from(new Set(rq.flatMap((q) => q.los.filter((lo) => lo.startsWith(loPrefix))))).sort();
        const los = loIds.map((lo) => {
          const lq = rq.filter((q) => q.los.includes(lo));
          return { lo, paths: pathsOf(lq), counts: counts(pathsOf(lq), progress) };
        });
        return { id: rid, title: data.readings[rid].title, paths: pathsOf(rq), counts: counts(pathsOf(rq), progress), los };
      });
      ph.units.push({ id: u.id, name: u.name, paths: pathsOf(uq), counts: counts(pathsOf(uq), progress), readings });
    }
    const none = qs.filter((q) => !q.unit || !data.units.some((u) => u.id === q.unit));
    if (none.length) {
      phases.push({ id: "P0", name: "未分类", units: [{ id: "U00", name: "未分类", paths: pathsOf(none), counts: counts(pathsOf(none), progress), readings: [] }] });
    }
    return phases;
  }

  function node(name, paths, progress, children) {
    const n = { name, paths, counts: counts(paths, progress) };
    if (children) n.children = children;
    return n;
  }

  function sourceTree(data, progress) {
    const qs = data.questions;
    const cat = qs.filter((q) => q.source === "分类题库");
    const catNames = Array.from(new Set(cat.map((q) => q.category || "其他"))).sort();
    const catNode = node("分类题库", pathsOf(cat), progress, catNames.map((c) => node(c, pathsOf(cat.filter((q) => (q.category || "其他") === c)), progress)));
    const rand = qs.filter((q) => q.source === "随机题库");
    const mock = qs.filter((q) => q.source === "模考");
    const tb = qs.filter((q) => q.kind === "textbook");
    const rids = Array.from(new Set(tb.map((q) => q.readings[0]))).sort();
    const tbNode = node("教材习题", pathsOf(tb), progress, rids.map((rid) => {
      const rq = tb.filter((q) => q.readings[0] === rid);
      const mods = Array.from(new Set(rq.map((q) => q.module))).sort((a, b) => Number(a) - Number(b));
      const title = data.readings[rid] ? `${rid} ${data.readings[rid].title}` : rid;
      return node(title, pathsOf(rq), progress, mods.map((m) => node(`Module ${m}`, pathsOf(rq.filter((q) => q.module === m)), progress)));
    }));
    return [catNode, node("随机题库", pathsOf(rand), progress), node("模考", pathsOf(mock), progress), tbNode];
  }

  function dayOf(plan, date) { return ((plan && plan.days) || []).find((d) => d.date === date) || null; }

  function todayTasks(plan, today, progress) {
    const day = dayOf(plan, today);
    const groups = [];
    if (day && day.kind === "study") {
      for (const t of day.tasks || []) {
        const c = counts(t.questions, progress);
        groups.push({ title: t.heading, reading: t.reading, paths: t.questions, done: c.done, total: c.total, minutes: t.minutes });
      }
    } else if (day && (day.optional || []).length) {
      const c = counts(day.optional, progress);
      groups.push({ title: "选做题", paths: day.optional, done: c.done, total: c.total, minutes: day.minutes });
    }
    const seen = new Set();
    const backlog = [];
    for (const d of (plan && plan.days) || []) {
      if (d.kind !== "study" || d.date >= today) continue;
      for (const t of d.tasks || []) for (const p of t.questions) {
        if (!seen.has(p) && stateOf(progress, p).status === "未做") { seen.add(p); backlog.push(p); }
      }
    }
    return { day, groups, backlog };
  }

  function daysToExam(plan, today) {
    if (!plan || !plan.exam) return null;
    return Math.round((Date.parse(plan.exam) - Date.parse(today)) / 86400000);
  }

  function wrongList(data, progress, currentOnly) {
    return data.questions
      .map((q) => ({ q, s: stateOf(progress, q.path) }))
      .filter(({ s }) => (currentOnly ? s.status === "错题" : s.status === "错题" || s.wrong_count > 0))
      .sort((a, b) => b.s.wrong_count - a.s.wrong_count || (b.s.last_done || "").localeCompare(a.s.last_done || ""))
      .map(({ q }) => q);
  }

  function queueFor(paths, progress, all) {
    if (all) return paths.slice();
    const undone = paths.filter((p) => stateOf(progress, p).status === "未做");
    return undone.length ? undone : paths.slice();
  }

  return {
    DONE, EMPTY, TIER_LABEL, fmtDate, isoNow, recordFileName, randStr, newId, normalizeStatus, grade, applyRecords,
    stateOf, counts, tierIndex, tierOf, unitTree, sourceTree, dayOf, todayTasks, daysToExam, wrongList, queueFor,
  };
});

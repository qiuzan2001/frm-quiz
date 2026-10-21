// logic.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./logic.js");

const P = (n) => `题库/FRM1/题目/U05 概率与随机变量/Q000${n}`;
const T = (n) => `题库/FRM1/教材习题/R12/M12.1-Q${n}`;

const DATA = {
  units: [
    { id: "U05", name: "概率与随机变量", phase: "P2", phase_name: "数量方法" },
    { id: "U06", name: "常见分布", phase: "P2", phase_name: "数量方法" },
  ],
  readings: { R12: { title: "概率基础", unit: "U05" }, R13: { title: "随机变量", unit: "U05" }, R14: { title: "分布", unit: "U06" } },
  questions: [
    { path: P(1), id: "Q0001", kind: "bank", unit: "U05", readings: ["R12"], los: ["12.a"], mock: false, source: "分类题库", category: "定量", module: null },
    { path: P(2), id: "Q0002", kind: "bank", unit: "U05", readings: ["R12", "R13"], los: ["12.a", "13.b"], mock: false, source: "随机题库", category: null, module: null },
    { path: P(3), id: "Q0003", kind: "bank", unit: "U05", readings: ["R13"], los: ["13.b"], mock: true, source: "模考", category: null, module: null },
    { path: P(4), id: "Q0004", kind: "bank", unit: null, readings: [], los: [], mock: false, source: "随机题库", category: null, module: null },
    { path: T(1), id: "M12.1-Q1", kind: "textbook", unit: "U05", readings: ["R12"], los: ["12.a"], mock: false, source: "教材习题", category: null, module: "12.1" },
  ],
};

const PLAN = {
  start: "2026-10-07", content_end: "2026-11-09", exam: "2026-11-20",
  readings: [{ id: "R12", module_quiz: [T(1)], first: [P(1)], optional: [P(2)] }],
  days: [
    { date: "2026-10-19", kind: "study", minutes: 100, tasks: [{ reading: "R12", module: "12.1", heading: "MODULE 12.1 概率", questions: [T(1), P(1)], minutes: 50 }] },
    { date: "2026-10-20", kind: "study", minutes: 100, tasks: [{ reading: "R13", module: "13.1", heading: "MODULE 13.1 随机变量", questions: [P(2), P(3)], minutes: 50 }] },
    { date: "2026-10-25", kind: "weekly", minutes: 120, text: "周复习", readings: ["R12"], optional: [P(2)] },
  ],
  lo_tiers: {},
};

test("applyRecords layers progress + remote + pending in time order", () => {
  const progress = { [P(1)]: { status: "错题", attempts: 1, wrong_count: 1, last_done: "2026-10-10" } };
  const remote = [{ id: "r1", q: P(1), choice: "A", correct: true, at: "2026-10-19T10:00:00+08:00" }];
  const pending = [
    { id: "p2", q: P(2), choice: "B", correct: false, at: "2026-10-20T08:00:00+08:00" },
    { id: "p1", q: P(1), choice: "C", correct: false, at: "2026-10-18T08:00:00+08:00" },
  ];
  const s = L.applyRecords(progress, remote, pending);
  assert.deepEqual(s[P(1)], { status: "已完成", attempts: 3, wrong_count: 2, last_done: "2026-10-19" });
  assert.deepEqual(s[P(2)], { status: "错题", attempts: 1, wrong_count: 1, last_done: "2026-10-20" });
  assert.deepEqual(L.stateOf(s, P(3)), { status: "未做", attempts: 0, wrong_count: 0, last_done: null });
});

test("tierOf: textbook always first, plan first/optional, else extra", () => {
  const idx = L.tierIndex(PLAN);
  assert.equal(L.tierOf(idx, DATA.questions[4]), "first");
  assert.equal(L.tierOf(idx, DATA.questions[0]), "first");
  assert.equal(L.tierOf(idx, DATA.questions[1]), "optional");
  assert.equal(L.tierOf(idx, DATA.questions[2]), "extra");
});

test("unitTree groups non-mock questions by phase/unit/reading/lo with counts", () => {
  const progress = { [P(1)]: { status: "已完成", attempts: 1, wrong_count: 0, last_done: "2026-10-10" } };
  const tree = L.unitTree(DATA, progress);
  assert.deepEqual(tree.map((p) => p.name), ["数量方法", "未分类"]);
  const u05 = tree[0].units[0];
  assert.equal(u05.id, "U05");
  assert.deepEqual(u05.counts, { total: 3, done: 1, wrong: 0 });
  assert.deepEqual(u05.readings.map((r) => r.id), ["R12", "R13"]);
  const r12 = u05.readings[0];
  assert.deepEqual(r12.paths, [P(1), P(2), T(1)]);
  assert.deepEqual(r12.los.map((l) => l.lo), ["12.a"]);
  assert.deepEqual(r12.los[0].paths, [P(1), P(2), T(1)]);
  assert.deepEqual(tree[1].units[0].paths, [P(4)]);
  assert.equal(tree[0].units[1].counts.total, 0);
});

test("sourceTree groups by source, category, reading/module", () => {
  const tree = L.sourceTree(DATA, {});
  assert.deepEqual(tree.map((g) => g.name), ["分类题库", "随机题库", "模考", "教材习题"]);
  assert.deepEqual(tree[0].children.map((c) => [c.name, c.paths]), [["定量", [P(1)]]]);
  assert.deepEqual(tree[1].paths, [P(2), P(4)]);
  assert.deepEqual(tree[2].paths, [P(3)]);
  assert.deepEqual(tree[3].children[0].name, "R12 概率基础");
  assert.deepEqual(tree[3].children[0].children[0], { name: "Module 12.1", paths: [T(1)], counts: { total: 1, done: 0, wrong: 0 } });
});

test("todayTasks for a study day, with backlog from earlier days", () => {
  const progress = { [T(1)]: { status: "已完成", attempts: 1, wrong_count: 0, last_done: "2026-10-19" } };
  const t = L.todayTasks(PLAN, "2026-10-20", progress);
  assert.equal(t.day.kind, "study");
  assert.deepEqual(t.groups.map((g) => [g.title, g.paths, g.done]), [["MODULE 13.1 随机变量", [P(2), P(3)], 0]]);
  assert.deepEqual(t.backlog, [P(1)]);
  assert.equal(L.daysToExam(PLAN, "2026-10-20"), 31);
});

test("todayTasks for weekly day lists optional questions, null outside plan", () => {
  const t = L.todayTasks(PLAN, "2026-10-25", {});
  assert.equal(t.day.kind, "weekly");
  assert.deepEqual(t.groups.map((g) => [g.title, g.paths]), [["选做题", [P(2)]]]);
  assert.equal(L.todayTasks(PLAN, "2026-12-01", {}).day, null);
});

test("wrongList sorts by wrong_count then last_done, filter by current", () => {
  const progress = {
    [P(1)]: { status: "已完成", attempts: 3, wrong_count: 2, last_done: "2026-10-10" },
    [P(2)]: { status: "错题", attempts: 1, wrong_count: 1, last_done: "2026-10-20" },
    [P(3)]: { status: "错题", attempts: 4, wrong_count: 2, last_done: "2026-10-15" },
  };
  assert.deepEqual(L.wrongList(DATA, progress, false).map((q) => q.id), ["Q0003", "Q0001", "Q0002"]);
  assert.deepEqual(L.wrongList(DATA, progress, true).map((q) => q.id), ["Q0003", "Q0002"]);
});

test("recordFileName and newId formats", () => {
  const d = new Date(2026, 9, 20, 8, 5, 9);
  assert.match(L.recordFileName(d, "ab12"), /^20261020-080509-ab12$/);
  assert.match(L.newId(), /^[a-z0-9]{16}$/);
  assert.equal(L.fmtDate(d), "2026-10-20");
  assert.match(L.isoNow(d), /^2026-10-20T08:05:09[+-]\d{2}:\d{2}$/);
});

test("queueFor returns undone first, or all when everything is done", () => {
  const progress = { [P(1)]: { status: "已完成", attempts: 1, wrong_count: 0, last_done: "2026-10-10" } };
  assert.deepEqual(L.queueFor([P(1), P(2)], progress, false), [P(2)]);
  assert.deepEqual(L.queueFor([P(1), P(2)], progress, true), [P(1), P(2)]);
  assert.deepEqual(L.queueFor([P(1)], progress, false), [P(1)]);
});

test("unitTree LO prefix handles zero-padded reading ids", () => {
  const data = {
    units: [{ id: "U01", name: "基础", phase: "P1", phase_name: "基础" }],
    readings: { R01: { title: "第一章", unit: "U01" } },
    questions: [
      { path: P(1), id: "Q0001", kind: "bank", unit: "U01", readings: ["R01"], los: ["1.a"], mock: false, source: "分类题库", category: null, module: null },
    ],
  };
  const r01 = L.unitTree(data, {})[0].units[0].readings[0];
  assert.deepEqual(r01.los, [{ lo: "1.a", paths: [P(1)], counts: { total: 1, done: 0, wrong: 0 } }]);
});

test("applyRecords breaks at-ties by id and skips malformed records", () => {
  const first = [{ id: "b", q: P(1), choice: "B", correct: false, at: "2026-10-20T08:00:00+08:00" }];
  const second = [
    { id: "a", q: P(1), choice: "A", correct: true, at: "2026-10-20T08:00:00+08:00" },
    { id: "c", choice: "A", correct: true, at: "2026-10-20T08:00:00+08:00" },
    { id: "d", q: P(2), choice: "A", correct: true },
  ];
  const s = L.applyRecords({}, first, second);
  assert.equal(s[P(1)].status, "错题");
  assert.equal(s[P(1)].attempts, 2);
  assert.deepEqual(Object.keys(s), [P(1)]);
});

test("wrongList sorts null last_done last", () => {
  const progress = {
    [P(1)]: { status: "错题", attempts: 1, wrong_count: 1, last_done: null },
    [P(2)]: { status: "错题", attempts: 1, wrong_count: 1, last_done: "2026-10-01" },
    [P(3)]: { status: "错题", attempts: 1, wrong_count: 1, last_done: "2026-10-05" },
  };
  assert.deepEqual(L.wrongList(DATA, progress, true).map((q) => q.id), ["Q0003", "Q0002", "Q0001"]);
});

test("wrongList non-current includes status 错题 even with wrong_count 0", () => {
  const progress = { [P(1)]: { status: "错题", attempts: 1, wrong_count: 0, last_done: "2026-10-01" } };
  assert.deepEqual(L.wrongList(DATA, progress, true).map((q) => q.id), ["Q0001"]);
  assert.deepEqual(L.wrongList(DATA, progress, false).map((q) => q.id), ["Q0001"]);
});

test("applyRecords tolerates null progress values and records without id", () => {
  const s = L.applyRecords({ [P(1)]: null }, [{ q: P(2), choice: "A", correct: true, at: "2026-10-20T08:00:00+08:00" }]);
  assert.deepEqual(L.stateOf(s, P(1)), { status: "未做", attempts: 0, wrong_count: 0, last_done: null });
  assert.equal(P(2) in s, false);
});

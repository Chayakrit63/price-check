/**
 * Live verify packingCounterCheck against Apps Script for POPUP counter.
 * Usage: node scripts/verify-counter-check.mjs
 */
import { packingCounterCheck, sohMapFromRows } from "../lib/catalog-core.mjs";

const API =
  process.env.PK_API ||
  "https://script.google.com/macros/s/AKfycbwk305ikcfnVjLh4JbCRdgKUZI2W5FDYt0rxt1aQqF0IhrQgtLKO_3Ggg5gXePFEg/exec";
const CTR = "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026";

async function get(params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(API + "?" + qs, { redirect: "follow" });
  if (!r.ok) throw new Error("http " + r.status + " " + qs);
  return r.json();
}

async function post(body) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    redirect: "follow",
  });
  if (!r.ok) throw new Error("http " + r.status + " post");
  return r.json();
}

function exportToBundles(res) {
  const cols = res.cols || [];
  const idx = {};
  cols.forEach((c, i) => (idx[c] = i));
  const cell = (row, n) => (idx[n] == null ? "" : row[idx[n]]);
  const by = {};
  for (const row of res.rows || []) {
    const no = String(cell(row, "BoxNo") || "").trim();
    const sku = String(cell(row, "SKU") || "").trim();
    const qty = Number(String(cell(row, "Qty") || "").replace(/,/g, "")) || 0;
    if (!no || !sku || qty <= 0) continue;
    if (!by[no]) by[no] = { boxNo: no, lines: [] };
    by[no].lines.push({
      sku,
      qty,
      desc: String(cell(row, "Description") || ""),
      barcode: String(cell(row, "EAN scanned") || ""),
      brand: String(cell(row, "Brand") || ""),
    });
  }
  return Object.values(by);
}

async function exportBatched(nos) {
  const size = 40;
  const acc = { cols: null, rows: [] };
  for (let i = 0; i < nos.length; i += size) {
    const batch = nos.slice(i, i + size);
    let res = await get({ api: "export", nos: batch.join(",") });
    if (!res || !res.ok) res = await post({ action: "export", nos: batch });
    if (!res || !res.ok) throw new Error("export failed: " + JSON.stringify(res).slice(0, 200));
    if (res.cols) acc.cols = res.cols;
    acc.rows = acc.rows.concat(res.rows || []);
  }
  return acc;
}

const sohRes = await get({ api: "possoh", counter: CTR });
if (!sohRes.ok) throw new Error("possoh: " + JSON.stringify(sohRes));
const sohMap = sohMapFromRows(sohRes.rows || []);
const boxesRes = await get({ api: "boxes", q: CTR, limit: "500" });
if (!boxesRes.ok) throw new Error("boxes failed");
const key = CTR.toLowerCase();
const boxes = (boxesRes.boxes || []).filter((b) => {
  if (!b || !b.boxNo) return false;
  const st = String(b.status || "");
  if (st === "Cancelled" || st === "Deleted") return false;
  return String(b.from || "").trim().toLowerCase() === key;
});
const nos = boxes.map((b) => b.boxNo);
const exp = await exportBatched(nos);
const bundles = exportToBundles(exp);
const check = packingCounterCheck(sohMap, bundles);
const expected = {
  sohSkuCount: 110,
  sohPcs: 741,
  pkCount: 21,
  packedPcs: 479,
  doneSku: 74,
  leftoverSku: 34,
  leftoverPcs: 264,
  overSku: 2,
  overPcs: 2,
  missingSku: 0,
};
const got = check.totals;
const report = {
  asOf: sohRes.asOf,
  boxesMatched: boxes.length,
  nosSample: nos.slice(0, 5),
  expected,
  got,
  over: check.over.map((r) => ({ sku: r.sku, soh: r.soh, packed: r.packed, boxNos: r.boxNos })),
  diffs: {},
};
for (const k of Object.keys(expected)) {
  if (got[k] !== expected[k]) report.diffs[k] = { expected: expected[k], got: got[k] };
}
console.log(JSON.stringify(report, null, 2));
if (Object.keys(report.diffs).length) process.exitCode = 2;

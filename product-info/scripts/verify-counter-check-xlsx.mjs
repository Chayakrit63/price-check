/**
 * Live Counter-check → Excel payload (+ real .xlsx via SheetJS).
 * node scripts/verify-counter-check-xlsx.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import {
  packingCounterCheck,
  sohMapFromRows,
  buildCounterCheckExcelData,
} from "../lib/catalog-core.mjs";

const API =
  process.env.PK_API ||
  "https://script.google.com/macros/s/AKfycbwk305ikcfnVjLh4JbCRdgKUZI2W5FDYt0rxt1aQqF0IhrQgtLKO_3Ggg5gXePFEg/exec";
const CTR = "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026";
const OUT = process.env.XLSX_OUT || "/opt/cursor/artifacts";

async function get(params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(API + "?" + qs, { redirect: "follow" });
  if (!r.ok) throw new Error("http " + r.status);
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
      boxSeq: Number(cell(row, "Box") || 1) || 1,
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
    if (!res || !res.ok) throw new Error("export failed");
    if (res.cols) acc.cols = res.cols;
    acc.rows = acc.rows.concat(res.rows || []);
  }
  return acc;
}

function loadXlsx() {
  const require = createRequire(import.meta.url);
  const candidates = [
    "/tmp/xlsx-pkg/node_modules/xlsx/xlsx.js",
    "/tmp/xlsx-lib/package/xlsx.js",
    path.resolve("node_modules/xlsx/xlsx.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("xlsx not found — npm install --prefix /tmp/xlsx-pkg xlsx@0.18.5");
}

const sohRes = await get({ api: "possoh", counter: CTR });
if (!sohRes.ok) throw new Error("possoh failed");
const sohMap = sohMapFromRows(sohRes.rows || []);
const boxesRes = await get({ api: "boxes", q: CTR, limit: "500" });
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
const data = buildCounterCheckExcelData({
  counter: CTR,
  asOf: sohRes.asOf || "",
  check,
  includedOpen: false,
  bundles,
  includeStatusSheets: true,
});

fs.mkdirSync(OUT, { recursive: true });
const XLSX = loadXlsx();
const wb = XLSX.utils.book_new();
for (const sheet of data.sheets) {
  const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
  if (sheet.cols) ws["!cols"] = sheet.cols.map((w) => ({ wch: w }));
  if (sheet.autofilter && sheet.aoa.length > 1) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: sheet.aoa.length - 1, c: sheet.aoa[0].length - 1 },
      }),
    };
  }
  (sheet.textCols || []).forEach((ci) => {
    for (let r = 1; r < sheet.aoa.length; r++) {
      const a = XLSX.utils.encode_cell({ r, c: ci });
      if (!ws[a]) continue;
      ws[a].t = "s";
      ws[a].v = String(ws[a].v == null ? "" : ws[a].v);
      ws[a].z = "@";
    }
  });
  XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
}
const outPath = path.join(OUT, data.fileName);
XLSX.writeFile(wb, outPath);

const summary = Object.fromEntries(data.sheets[0].aoa.slice(1));
const allSample = data.sheets[1].aoa.slice(0, 6);
const overSheet = data.sheets.find((s) => s.name === "เกิน");
const report = {
  file: outPath,
  fileName: data.fileName,
  sheetNames: data.sheets.map((s) => s.name),
  summary,
  allSkuHeader: data.sheets[1].aoa[0],
  allSkuSample: allSample,
  overRows: overSheet ? overSheet.aoa : [],
  byPkHeader: data.sheets[2].aoa[0],
  byPkSample: data.sheets[2].aoa.slice(0, 5),
  totals: check.totals,
  pkCountLive: boxes.length,
};
fs.writeFileSync(path.join(OUT, "ctr-check-xlsx-sample.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

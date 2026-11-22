/**
 * Shared catalog classifier + search (Node tests + browser via window.CatalogCore).
 */

export function itemTypeBucket(sku, desc, masterGroup, override) {
  if (override) return String(override).toUpperCase();
  var g = String(masterGroup || "").toUpperCase();
  if (g === "STOCK") return "STOCK";
  if (g === "TESTER") return "TESTER";
  if (g === "OTH") return "OTH";
  if (/GWP|SAMP|MINI|PR GIFT|EXEC GIFT/.test(g)) return "GWPS";
  var d = String(desc || "").toUpperCase();
  var s = String(sku || "").toUpperCase();
  if (/TESTER/.test(d)) return "TESTER";
  if (/^T-/.test(s) || /[0-9][FT]$/.test(s) || /TESTER/.test(s)) return "TESTER";
  if (/GWP|GIFT/.test(d)) return "GWPS";
  return "STOCK";
}

export function rowTypeBucket(row) {
  if (!row) return "STOCK";
  return itemTypeBucket(
    row.sku,
    row.desc || row.description,
    row.group || row.Group || "",
    row.groupOverride || row.groupoverride || ""
  );
}

/** Query text only (strips *qty / xqty); qty is ignored on Info tab in the app. */
export function searchQueryOnly(text) {
  return parseSearchQty(text).query;
}

export function parseSearchQty(text) {
  var raw = String(text || "").trim();
  var qty = 1;
  var m = /^(.+?)[\s]*[\*x×]\s*(\d{1,5})$/i.exec(raw);
  if (m) {
    qty = Math.max(1, Math.min(99999, parseInt(m[2], 10) || 1));
    raw = m[1].trim();
  }
  m = /^(.+?)\s+x\s*(\d{1,5})$/i.exec(raw);
  if (m) {
    qty = Math.max(1, Math.min(99999, parseInt(m[2], 10) || 1));
    raw = m[1].trim();
  }
  return { query: raw, qty: qty };
}

export function editDistance(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var la = a.length;
  var lb = b.length;
  if (la > 32 || lb > 32) return 99;
  var row = new Array(lb + 1);
  var i, j;
  for (j = 0; j <= lb; j++) row[j] = j;
  for (i = 1; i <= la; i++) {
    var prev = i - 1;
    var cur = i;
    for (j = 1; j <= lb; j++) {
      var next = row[j];
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur = Math.min(next + 1, cur + 1, prev + cost);
      prev = next;
      row[j] = cur;
    }
  }
  return row[lb];
}

function norm(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "");
}

function skuNumericLoose(sku, qn) {
  sku = String(sku || "").toUpperCase();
  qn = String(qn || "").toUpperCase();
  if (!qn) return false;
  var mSku = /(\d+)/.exec(sku);
  var mQ = /(\d+)/.exec(qn);
  if (!mSku || !mQ) return false;
  var a = mSku[1].replace(/^0+/, "") || "0";
  var b = mQ[1].replace(/^0+/, "") || "0";
  if (a === b) return true;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  return false;
}

function rowHay(row) {
  return (
    String(row.sku || "") +
    " " +
    (row.eans || []).join(" ") +
    " " +
    String(row.brand || "") +
    " " +
    String(row.line || "") +
    " " +
    String(row.desc || "")
  ).toLowerCase();
}

function rankRow(row, qn, tokens, wantFuzzy) {
  var rank = 99;
  var cs = row.codesU || [String(row.sku || "").toUpperCase()];
  var j, c, rk;
  for (j = 0; j < cs.length; j++) {
    c = cs[j];
    if (!c) continue;
    rk = 99;
    if (c === qn) rk = 0;
    else if (c.indexOf(qn) === 0) rk = 1;
    else if (c.length >= qn.length && c.slice(-qn.length) === qn) rk = 2;
    else if (qn.length >= 3 && c.indexOf(qn) >= 0) rk = 3;
    else if (qn.length >= 2 && skuNumericLoose(c, qn)) rk = 4;
    if (rk < rank) rank = rk;
  }
  for (j = 0; j < (row.eans || []).length; j++) {
    var e = norm(row.eans[j]).toUpperCase();
    if (e === qn) rank = Math.min(rank, 0);
    else if (e.indexOf(qn) === 0) rank = Math.min(rank, 1);
  }
  if (tokens.length) {
    var hay = row.hay || rowHay(row);
    var all = true;
    for (j = 0; j < tokens.length; j++) {
      if (hay.indexOf(tokens[j]) < 0) {
        all = false;
        break;
      }
    }
    if (all) rank = Math.min(rank, 5);
    else if (tokens.length > 1 && rank >= 99) return 99;
  }
  if (wantFuzzy && qn.length >= 4 && rank >= 99) {
    var words = String(row.desc || "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(function (w) {
        return w.length >= 4;
      });
    var qU = qn.toUpperCase();
    for (j = 0; j < words.length; j++) {
      if (editDistance(words[j], qU) <= 1) {
        rank = Math.min(rank, 6);
        break;
      }
    }
  }
  return rank;
}

function avClass(av) {
  var s = String(av || "").toLowerCase();
  return s === "active" ? "a" : s.indexOf("stock") >= 0 ? "w" : "o";
}

/**
 * @param {object[]} catalog unpacked rows
 * @param {string} text raw search box text
 * @param {{limit?: number}} opts
 * @returns {{hits: {row: object, rank: number}[], query: string, qty: number}}
 */
export function searchCatalog(catalog, text, opts) {
  opts = opts || {};
  var limit = opts.limit == null ? 12 : opts.limit;
  var parsed = parseSearchQty(text);
  var q = parsed.query;
  var qty = parsed.qty;
  if (q.length < 2 || !catalog.length) return { hits: [], query: q, qty: qty };
  var qn = norm(q).toUpperCase();
  var tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  var wantFuzzy = qn.length >= 4 && !/^\d+$/.test(qn);
  var hits = [];
  var i, row, rank;
  for (i = 0; i < catalog.length; i++) {
    row = catalog[i];
    rank = rankRow(row, qn, tokens, wantFuzzy);
    if (rank < 99) hits.push({ row: row, rank: rank });
  }
  hits.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    var aa = avClass(a.row.av) === "a" ? 0 : 1;
    var ba = avClass(b.row.av) === "a" ? 0 : 1;
    if (aa !== ba) return aa - ba;
    var an = String(a.row.desc || "").toLowerCase();
    var bn = String(b.row.desc || "").toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return String(a.row.sku).localeCompare(String(b.row.sku));
  });
  return { hits: hits.slice(0, limit), query: q, qty: qty, allHits: hits };
}

export function counterPlaceName(c) {
  if (!c) return "";
  return String(c.name != null ? c.name : c[1] || "").trim();
}

export function counterNamesDeduped(counters) {
  var seen = {};
  var out = [];
  (counters || []).forEach(function (c) {
    var n = counterPlaceName(c);
    if (!n) return;
    var k = n.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(n);
  });
  return out;
}

/** Pin names first, then other place names; case-insensitive dedupe. */
export function mergePinnedPlaceNames(pinned, names) {
  var seen = {};
  var out = [];
  function add(s) {
    s = String(s || "").trim();
    if (!s) return;
    var k = s.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(s);
  }
  (pinned || []).forEach(add);
  (names || []).forEach(add);
  return out;
}

/** Strip legacy datalist values like "ICON-ADP · ICONSIAM - NICHE ADP" → place name only. */
export function stripPlaceListLabel(s) {
  s = String(s || "").trim();
  var m = /^[A-Za-z0-9][A-Za-z0-9\-]{2,24}\s*·\s*(.+)$/.exec(s);
  return m ? m[1].trim() : s;
}

/**
 * Packing lookup decision after type filter.
 * Multi-SKU hits always require a picker (never auto-pick from "already in box").
 */
export function packingLookupAction(hitCount) {
  var n = Number(hitCount) || 0;
  if (n === 1) return "add";
  if (n > 1) return "pick";
  return "miss";
}

/**
 * Display order for packing box lines: highest `touched` first; for equal/missing
 * touched, later array index first (reverse saved order). Does not mutate input.
 */
export function sortPackingLinesForDisplay(lines) {
  return (lines || [])
    .map(function (l, i) {
      return { l: l, i: i };
    })
    .sort(function (a, b) {
      var ta = Number(a.l && a.l.touched) || 0;
      var tb = Number(b.l && b.l.touched) || 0;
      if (ta !== tb) return tb - ta;
      return b.i - a.i;
    })
    .map(function (x) {
      return x.l;
    });
}

export var PK_BIG_QTY = 20;

export function packingIsBigQty(qty, threshold) {
  var lim = threshold == null ? PK_BIG_QTY : threshold;
  return Number(qty) > lim;
}

/** Summarize packing lines by type bucket (lines + pieces). */
export function packingTypeSummary(lines, bucketFn) {
  bucketFn = bucketFn || rowTypeBucket;
  var out = {
    STOCK: { lines: 0, qty: 0 },
    TESTER: { lines: 0, qty: 0 },
    GWPS: { lines: 0, qty: 0 },
    OTH: { lines: 0, qty: 0 },
    totalLines: 0,
    totalQty: 0,
  };
  (lines || []).forEach(function (l) {
    var q = Number(l.qty) || 0;
    if (q <= 0) return;
    out.totalLines++;
    out.totalQty += q;
    var b = bucketFn(l);
    if (!out[b]) out[b] = { lines: 0, qty: 0 };
    out[b].lines++;
    out[b].qty += q;
  });
  return out;
}

export function packingBigQtyLines(lines, threshold) {
  var lim = threshold == null ? PK_BIG_QTY : threshold;
  return (lines || []).filter(function (l) {
    return (Number(l.qty) || 0) >= lim;
  });
}

/** Sort pick candidates: SKUs already in the box first, then original order. */
export function sortPickRowsInBoxFirst(rows, inBoxSkuSet) {
  var set = inBoxSkuSet || {};
  return (rows || [])
    .map(function (r, i) {
      return { r: r, i: i, in: !!set[String(r.sku || "").toUpperCase()] };
    })
    .sort(function (a, b) {
      if (a.in !== b.in) return a.in ? -1 : 1;
      return a.i - b.i;
    })
    .map(function (x) {
      return x.r;
    });
}

/**
 * Compute undo result for one add.
 * @returns {{ remove: boolean, nextQty: number }}
 */
export function packingUndoResult(prevQty, addedQty, created) {
  var add = Math.max(1, Math.round(Number(addedQty) || 1));
  if (created) return { remove: true, nextQty: 0 };
  var next = Math.max(0, (Number(prevQty) || 0) - add);
  return { remove: next <= 0, nextQty: next };
}

export function typeBucketLabel(bucket) {
  var b = String(bucket || "").toUpperCase();
  if (b === "TESTER") return "Tester";
  if (b === "GWPS") return "GWPs";
  if (b === "OTH") return "OTH";
  if (b === "STOCK") return "Stock";
  return b || "Stock";
}

/**
 * Info-tab "Back to list" state.
 * Keep a list when opening a result from 2+ candidates (search multi, suggestions, recent).
 */
export function infoBackListDecision(hits, opts) {
  opts = opts || {};
  var list = (hits || []).filter(Boolean);
  if (list.length > 1) {
    return {
      showBack: true,
      action: "list",
      hits: list,
      q: opts.q != null ? String(opts.q) : "",
      typeCat: opts.typeCat || "ALL",
    };
  }
  return { showBack: false, action: "search", hits: null, q: "", typeCat: opts.typeCat || "ALL" };
}

export function filterRowsByType(rows, typeCat, bucketFn) {
  bucketFn = bucketFn || rowTypeBucket;
  if (!typeCat || typeCat === "ALL") return rows ? rows.slice() : [];
  return (rows || []).filter(function (r) {
    return bucketFn(r) === typeCat;
  });
}

export function countByType(rows, bucketFn) {
  bucketFn = bucketFn || rowTypeBucket;
  var out = { ALL: 0, STOCK: 0, TESTER: 0, GWPS: 0, OTH: 0 };
  (rows || []).forEach(function (r) {
    var b = bucketFn(r);
    out.ALL++;
    if (out[b] != null) out[b]++;
  });
  return out;
}

/** Strip leading Excel/POS apostrophe ticks from codes. */
export function stripLeadingTick(s) {
  return String(s == null ? "" : s)
    .replace(/^['\u2018\u2019]+/, "")
    .trim();
}

function sohNormHeader(h) {
  return String(h || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

var POS_SOH_HEADERS = {
  sku: ["รหัสสินค้า", "sku", "itemno", "item no", "item number", "itemcode", "code"],
  barcode: ["รหัสบาร์โค้ด", "barcode", "ean", "ean code", "bar code", "บาร์โค้ด"],
  desc: ["ชื่อสินค้า", "description", "name", "desc", "สินค้า"],
  qty: ["จำนวนสินค้าคงเหลือ", "qty", "quantity", "soh", "on hand", "จำนวนคงเหลือ", "จำนวน"],
};

function guessPosSohMap(header) {
  var map = {};
  var used = {};
  Object.keys(POS_SOH_HEADERS).forEach(function (k) {
    for (var i = 0; i < header.length; i++) {
      if (used[i]) continue;
      var h = sohNormHeader(header[i]);
      if (
        POS_SOH_HEADERS[k].some(function (a) {
          return h === a || h.indexOf(a) >= 0;
        })
      ) {
        map[k] = i;
        used[i] = 1;
        return;
      }
    }
  });
  return map;
}

/**
 * Pull report title + as-of from POS inventory export.
 * Title row often: "รายงานสินค้าคงคลัง : <place> <dd/mm/yyyy>"
 * Timestamp cell (col E): "dd/mm/yyyy HH:MM"
 */
export function extractPosSohMeta(titleRow, timestampCell) {
  var cells = Array.isArray(titleRow) ? titleRow : [titleRow];
  var title = "";
  var i;
  for (i = 0; i < cells.length; i++) {
    var t = String(cells[i] == null ? "" : cells[i]).replace(/\s+/g, " ").trim();
    if (t) {
      title = t;
      break;
    }
  }
  var asOf = String(timestampCell == null ? "" : timestampCell)
    .replace(/\s+/g, " ")
    .trim();
  if (!asOf) {
    var m = /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2})?)\s*$/.exec(title);
    if (m) asOf = m[1];
  }
  var reportName = title
    .replace(/^รายงานสินค้าคงคลัง\s*[:：]\s*/i, "")
    .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2})?\s*$/, "")
    .trim();
  return { title: title, reportName: reportName, asOf: asOf };
}

/**
 * Parse POS inventory summary AOA (xlsx / html table rows).
 * Stores ONLY qty !== 0. Match key is SKU (barcodes may duplicate).
 */
export function parsePosInventoryAoa(aoa, fileName) {
  var rows = aoa || [];
  var headerI = -1;
  var i;
  for (i = 0; i < Math.min(rows.length, 12); i++) {
    var joined = (rows[i] || []).map(sohNormHeader).join("|");
    if (/รหัสสินค้า|barcode|\bsku\b/.test(joined) && /จำนวน|qty|soh|on hand/.test(joined)) {
      headerI = i;
      break;
    }
  }
  if (headerI < 0) {
    return {
      ok: false,
      error: "ไม่พบแถวหัวตาราง SKU/จำนวน",
      fileName: fileName || "",
      title: "",
      reportName: "",
      asOf: "",
      rows: [],
      skuCount: 0,
      pcs: 0,
    };
  }
  var header = (rows[headerI] || []).map(function (h) {
    return String(h || "")
      .replace(/\s+/g, " ")
      .trim();
  });
  var titleRow = headerI > 0 ? rows[0] || [] : [];
  var meta = extractPosSohMeta(titleRow, titleRow[4]);
  var map = guessPosSohMap(header);
  var out = [];
  var pcs = 0;
  var zeroSkipped = 0;
  var noSku = 0;
  for (i = headerI + 1; i < rows.length; i++) {
    var r = rows[i] || [];
    function cell(k) {
      return map[k] == null ? "" : stripLeadingTick(r[map[k]]);
    }
    var sku = cell("sku");
    var barcode = cell("barcode");
    var desc = cell("desc");
    var qtyS = cell("qty");
    var qty = Number(String(qtyS).replace(/,/g, ""));
    if (!sku && !barcode && !desc) continue;
    if (!sku) {
      noSku++;
      continue;
    }
    if (!isFinite(qty)) qty = 0;
    if (qty === 0) {
      zeroSkipped++;
      continue;
    }
    pcs += qty;
    out.push({ sku: sku, barcode: barcode, desc: desc, qty: qty });
  }
  return {
    ok: true,
    fileName: fileName || "",
    title: meta.title,
    reportName: meta.reportName,
    asOf: meta.asOf,
    header: header,
    map: map,
    rows: out,
    skuCount: out.length,
    pcs: pcs,
    zeroSkipped: zeroSkipped,
    noSku: noSku,
  };
}

/** Map packing lines → { SKU_UPPER: totalQty } across all boxes. */
export function packingSkuQtyMap(lines) {
  var map = {};
  (lines || []).forEach(function (l) {
    var sku = String((l && l.sku) || "")
      .trim()
      .toUpperCase();
    if (!sku) return;
    var q = Number(l.qty) || 0;
    if (q <= 0) return;
    map[sku] = (map[sku] || 0) + q;
  });
  return map;
}

/** Build SOH lookup { SKU_UPPER: { qty, barcode, desc } } from rows. */
export function sohMapFromRows(rows) {
  var map = {};
  (rows || []).forEach(function (r) {
    var sku = String((r && r.sku) || "")
      .trim()
      .toUpperCase();
    if (!sku) return;
    var q = Number(r.qty) || 0;
    if (q === 0) return;
    if (!map[sku]) map[sku] = { qty: 0, barcode: r.barcode || "", desc: r.desc || "" };
    map[sku].qty += q;
    if (r.barcode && !map[sku].barcode) map[sku].barcode = r.barcode;
    if (r.desc && !map[sku].desc) map[sku].desc = r.desc;
  });
  return map;
}

/**
 * Check one SKU against SOH.
 * @returns {{ status: 'ok'|'missing'|'over', packed: number, soh: number, warn?: string }}
 */
export function packingSohCheck(sku, packedQty, sohMap) {
  var k = String(sku || "")
    .trim()
    .toUpperCase();
  var packed = Number(packedQty) || 0;
  if (!sohMap || !k) return { status: "ok", packed: packed, soh: 0 };
  var rec = sohMap[k];
  if (!rec) {
    return {
      status: "missing",
      packed: packed,
      soh: 0,
      warn: "ไม่มีใน POS ของ counter นี้",
    };
  }
  var soh = Number(rec.qty) || 0;
  if (packed > soh) {
    return {
      status: "over",
      packed: packed,
      soh: soh,
      warn: "แพ็ค " + packed + " / POS มี " + soh,
    };
  }
  return { status: "ok", packed: packed, soh: soh };
}

/** Mismatches for a packing list vs SOH (missing + over). */
export function packingSohMismatches(lines, sohMap) {
  if (!sohMap) return [];
  var packed = packingSkuQtyMap(lines);
  var out = [];
  Object.keys(packed).forEach(function (sku) {
    var c = packingSohCheck(sku, packed[sku], sohMap);
    if (c.status === "ok") return;
    out.push({
      sku: sku,
      packed: c.packed,
      soh: c.soh,
      status: c.status,
      warn: c.warn,
      desc: (sohMap[sku] && sohMap[sku].desc) || "",
    });
  });
  out.sort(function (a, b) {
    if (a.status !== b.status) return a.status === "missing" ? -1 : 1;
    return a.sku.localeCompare(b.sku);
  });
  return out;
}

/** SOH SKUs still left (packed < soh) — pullback completeness. */
export function packingSohLeftover(lines, sohMap) {
  if (!sohMap) return [];
  var packed = packingSkuQtyMap(lines);
  var out = [];
  Object.keys(sohMap).forEach(function (sku) {
    var soh = Number(sohMap[sku].qty) || 0;
    var p = packed[sku] || 0;
    if (soh > 0 && p < soh) {
      out.push({
        sku: sku,
        packed: p,
        soh: soh,
        left: soh - p,
        desc: sohMap[sku].desc || "",
        barcode: sohMap[sku].barcode || "",
      });
    }
  });
  out.sort(function (a, b) {
    return b.left - a.left || a.sku.localeCompare(b.sku);
  });
  return out;
}

/** Short chip text: "SOH ณ 22/11 15:35 · 110 SKU" */
export function formatSohChip(asOf, skuCount) {
  var a = String(asOf || "").trim();
  var short = a;
  var m = /^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s+(\d{1,2}:\d{2})/.exec(a);
  if (m) short = m[1] + "/" + m[2] + " " + m[3];
  else {
    m = /^(\d{1,2})\/(\d{1,2})/.exec(a);
    if (m) short = m[1] + "/" + m[2];
  }
  var n = Number(skuCount) || 0;
  return "SOH ณ " + (short || "—") + " · " + n + " SKU";
}

if (typeof window !== "undefined") {
  window.CatalogCore = {
    itemTypeBucket: itemTypeBucket,
    rowTypeBucket: rowTypeBucket,
    parseSearchQty: parseSearchQty,
    searchQueryOnly: searchQueryOnly,
    counterPlaceName: counterPlaceName,
    counterNamesDeduped: counterNamesDeduped,
    mergePinnedPlaceNames: mergePinnedPlaceNames,
    stripPlaceListLabel: stripPlaceListLabel,
    packingLookupAction: packingLookupAction,
    sortPackingLinesForDisplay: sortPackingLinesForDisplay,
    PK_BIG_QTY: PK_BIG_QTY,
    packingIsBigQty: packingIsBigQty,
    packingTypeSummary: packingTypeSummary,
    packingBigQtyLines: packingBigQtyLines,
    sortPickRowsInBoxFirst: sortPickRowsInBoxFirst,
    packingUndoResult: packingUndoResult,
    typeBucketLabel: typeBucketLabel,
    infoBackListDecision: infoBackListDecision,
    searchCatalog: searchCatalog,
    filterRowsByType: filterRowsByType,
    countByType: countByType,
    editDistance: editDistance,
    stripLeadingTick: stripLeadingTick,
    extractPosSohMeta: extractPosSohMeta,
    parsePosInventoryAoa: parsePosInventoryAoa,
    packingSkuQtyMap: packingSkuQtyMap,
    sohMapFromRows: sohMapFromRows,
    packingSohCheck: packingSohCheck,
    packingSohMismatches: packingSohMismatches,
    packingSohLeftover: packingSohLeftover,
    formatSohChip: formatSohChip,
  };
}
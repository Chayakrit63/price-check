/**
 * Shared catalog classifier + search (Node tests + browser via window.CatalogCore).
 * Bump VERSION in lockstep with APP_VER in index.html (cache-bust query on the module URL).
 */
export var VERSION = "20261123a";

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
 * Inline POS line math for packing list rows.
 * packed = cumulative qty for SKU across ALL boxes of this PK.
 * @returns {{ status: 'ok'|'done'|'over', soh: number, packed: number, left: number, over: number, text: string, className: string }}
 */
export function formatPackingSohLine(sohQty, packedQty) {
  return formatPackingSohLineDetailed(sohQty, packedQty, null);
}

/**
 * Line SOH text. When packedThis is a number, show counter-wide packed + this-box qty:
 *   POS 6 · แพ็คแล้ว 3 (กล่องนี้ 1) · เหลือ 3
 * Over-pack (packedAll > soh) uses className "over" (red) and เกิน.
 */
export function formatPackingSohLineDetailed(sohQty, packedAllQty, packedThisQty) {
  var soh = Math.max(0, Number(sohQty) || 0);
  var packed = Math.max(0, Number(packedAllQty) || 0);
  var hasThis = packedThisQty != null && packedThisQty !== "";
  var packedThis = hasThis ? Math.max(0, Number(packedThisQty) || 0) : null;
  var thisBit =
    packedThis != null ? " (กล่องนี้ " + packedThis + ")" : "";
  if (packed > soh) {
    var over = packed - soh;
    return {
      status: "over",
      soh: soh,
      packed: packed,
      packedThis: packedThis,
      left: soh - packed,
      over: over,
      text:
        "POS " +
        soh +
        " · แพ็คแล้ว " +
        packed +
        thisBit +
        " · เกิน " +
        over,
      className: "over",
    };
  }
  var left = soh - packed;
  if (left === 0) {
    return {
      status: "done",
      soh: soh,
      packed: packed,
      packedThis: packedThis,
      left: 0,
      over: 0,
      text:
        "✓ POS " +
        soh +
        " · แพ็คแล้ว " +
        packed +
        thisBit +
        " · เหลือ 0",
      className: "done",
    };
  }
  return {
    status: "ok",
    soh: soh,
    packed: packed,
    packedThis: packedThis,
    left: left,
    over: 0,
    text:
      "POS " +
      soh +
      " · แพ็คแล้ว " +
      packed +
      thisBit +
      " · เหลือ " +
      left,
    className: "ok",
  };
}

/**
 * Full line info when SOH map is loaded (null if no map / blank sku).
 * missing → yellow warning text; otherwise formatPackingSohLine.
 */
export function packingSohLineInfo(sku, packedQty, sohMap) {
  return packingSohLineInfoDetailed(sku, packedQty, null, sohMap);
}

/**
 * @param {string} sku
 * @param {number} packedAllQty - packed across counter (all PKs + draft)
 * @param {number|null} packedThisQty - packed in open PK only (optional)
 * @param {object} sohMap
 */
export function packingSohLineInfoDetailed(sku, packedAllQty, packedThisQty, sohMap) {
  if (!sohMap) return null;
  var k = String(sku || "")
    .trim()
    .toUpperCase();
  if (!k) return null;
  var packed = Math.max(0, Number(packedAllQty) || 0);
  var rec = sohMap[k];
  if (!rec) {
    return {
      status: "missing",
      soh: 0,
      packed: packed,
      packedThis:
        packedThisQty != null && packedThisQty !== ""
          ? Math.max(0, Number(packedThisQty) || 0)
          : null,
      left: 0,
      over: 0,
      text: "⚠ ไม่มีใน POS ของ counter นี้",
      className: "miss",
      warn: "ไม่มีใน POS ของ counter นี้",
    };
  }
  return formatPackingSohLineDetailed(rec.qty, packed, packedThisQty);
}

/** Flatten many PK bundles → { SKU: qty }. Same aggregation as packingCounterCheck. */
export function packingCounterPackedMap(pkBundles) {
  var packed = {};
  (pkBundles || []).forEach(function (bundle) {
    var part = packingSkuQtyMap(bundle && bundle.lines ? bundle.lines : bundle);
    Object.keys(part).forEach(function (sku) {
      packed[sku] = (packed[sku] || 0) + part[sku];
    });
  });
  return packed;
}

/**
 * Merge server counter totals with the open draft:
 * packedAll = otherPksMap + thisBoxLocalMap
 * (otherPksMap should exclude the open boxNo's saved lines).
 */
export function packingMergeCounterPacked(otherPksMap, thisBoxLocalMap) {
  var out = {};
  Object.keys(otherPksMap || {}).forEach(function (sku) {
    out[sku] = Number(otherPksMap[sku]) || 0;
  });
  Object.keys(thisBoxLocalMap || {}).forEach(function (sku) {
    out[sku] = (out[sku] || 0) + (Number(thisBoxLocalMap[sku]) || 0);
  });
  return out;
}

/** Summary from an already-aggregated packed map (counter-wide). */
export function packingSohSummaryFromPacked(sohMap, packedMap) {
  if (!sohMap) return null;
  return packingSohSummary(
    Object.keys(packedMap || {}).map(function (sku) {
      return { sku: sku, qty: packedMap[sku] };
    }),
    sohMap
  );
}

/** Short badge for picker/suggestions: "POS 57" or "" if unknown/no SOH. */
export function formatSohPosBadge(sku, sohMap) {
  if (!sohMap) return "";
  var k = String(sku || "")
    .trim()
    .toUpperCase();
  if (!k || !sohMap[k]) return "";
  return "POS " + (Number(sohMap[k].qty) || 0);
}

/**
 * Sticky last-scanned status (short).
 * @returns {{ text: string, className: string } | null}
 */
export function formatPackingSohLastStatus(info) {
  if (!info) return null;
  if (info.status === "missing") {
    return { text: "ไม่มีใน POS", className: "miss" };
  }
  if (info.status === "done") {
    return { text: "✓ ครบ", className: "done" };
  }
  if (info.status === "over") {
    return {
      text: "แพ็ค " + info.packed + " / POS " + info.soh + " · เกิน " + info.over,
      className: "over",
    };
  }
  return {
    text: "แพ็ค " + info.packed + " / POS " + info.soh + " · เหลือ " + info.left,
    className: "ok",
  };
}

/**
 * Whole-list SOH summary for packing pullback.
 * packedPcs counts only SKUs present in SOH (not missing-from-POS packed qty).
 * doneSku = packed >= soh; overSku ⊆ done; leftoverSku = packed < soh.
 * @returns {null | {
 *   posPcs, packedPcs, sohSkuCount, doneSku, overSku, missingSku, leftoverSku, leftoverPcs
 * }}
 */
export function packingSohSummary(lines, sohMap) {
  if (!sohMap) return null;
  var packed = packingSkuQtyMap(lines);
  var posPcs = 0;
  var packedPcs = 0;
  var sohSkuCount = 0;
  var doneSku = 0;
  var overSku = 0;
  var leftoverSku = 0;
  var leftoverPcs = 0;
  Object.keys(sohMap).forEach(function (sku) {
    var soh = Number(sohMap[sku].qty) || 0;
    if (soh <= 0) return;
    sohSkuCount++;
    posPcs += soh;
    var p = packed[sku] || 0;
    packedPcs += p;
    if (p > soh) overSku++;
    if (p >= soh) doneSku++;
    else {
      leftoverSku++;
      leftoverPcs += soh - p;
    }
  });
  var missingSku = 0;
  Object.keys(packed).forEach(function (sku) {
    if (!sohMap[sku]) missingSku++;
  });
  return {
    posPcs: posPcs,
    packedPcs: packedPcs,
    sohSkuCount: sohSkuCount,
    doneSku: doneSku,
    overSku: overSku,
    missingSku: missingSku,
    leftoverSku: leftoverSku,
    leftoverPcs: leftoverPcs,
  };
}

/**
 * Counter-level SOH check across many packing lists.
 * @param {object} sohMap - { SKU: { qty, barcode, desc } }
 * @param {Array<{ boxNo?: string, lines: Array<{sku,qty,desc?,ean?,barcode?,brand?}> }>} pkBundles
 * @returns {null | {
 *   totals: {
 *     pkCount, packedPcs, sohPcs, sohSkuCount,
 *     doneSku, leftoverSku, leftoverPcs, overSku, overPcs, missingSku, missingPcs
 *   },
 *   rows: Array<{
 *     sku, desc, barcode, brand, soh, packed, left, over, status, boxNos
 *   }>,
 *   leftover, over, missing, done
 * }}
 */
export function packingCounterCheck(sohMap, pkBundles) {
  if (!sohMap) return null;
  var bundles = pkBundles || [];
  var packed = {};
  var meta = {};
  var boxSet = {};
  bundles.forEach(function (bundle) {
    var boxNo = String((bundle && bundle.boxNo) || "").trim();
    if (boxNo) boxSet[boxNo] = 1;
    (bundle && bundle.lines ? bundle.lines : []).forEach(function (l) {
      var sku = String((l && l.sku) || "")
        .trim()
        .toUpperCase();
      if (!sku) return;
      var q = Number(l.qty) || 0;
      if (q <= 0) return;
      packed[sku] = (packed[sku] || 0) + q;
      if (!meta[sku]) meta[sku] = { desc: "", barcode: "", brand: "", boxNos: {} };
      if (l.desc && !meta[sku].desc) meta[sku].desc = String(l.desc);
      var bc = l.barcode || l.ean || "";
      if (bc && !meta[sku].barcode) meta[sku].barcode = String(bc);
      if (l.brand && !meta[sku].brand) meta[sku].brand = String(l.brand);
      if (boxNo) meta[sku].boxNos[boxNo] = 1;
    });
  });

  var sohPcs = 0;
  var sohSkuCount = 0;
  var doneSku = 0;
  var leftoverSku = 0;
  var leftoverPcs = 0;
  var overSku = 0;
  var overPcs = 0;
  var packedPcs = 0;
  Object.keys(packed).forEach(function (sku) {
    packedPcs += packed[sku];
  });

  var rows = [];
  Object.keys(sohMap).forEach(function (sku) {
    var soh = Number(sohMap[sku].qty) || 0;
    if (soh <= 0) return;
    sohSkuCount++;
    sohPcs += soh;
    var p = packed[sku] || 0;
    var m = meta[sku] || { desc: "", barcode: "", brand: "", boxNos: {} };
    var status;
    var left = 0;
    var over = 0;
    // ครบ = exact match only; เกิน counted separately (done+leftover+over = sohSkuCount)
    if (p > soh) {
      status = "over";
      over = p - soh;
      overSku++;
      overPcs += over;
    } else if (p === soh) {
      status = "done";
      doneSku++;
    } else {
      status = "leftover";
      left = soh - p;
      leftoverSku++;
      leftoverPcs += left;
    }
    rows.push({
      sku: sku,
      desc: sohMap[sku].desc || m.desc || "",
      barcode: sohMap[sku].barcode || m.barcode || "",
      brand: m.brand || "",
      soh: soh,
      packed: p,
      left: left,
      over: over,
      status: status,
      boxNos: Object.keys(m.boxNos || {}).sort(),
    });
  });

  var missingSku = 0;
  var missingPcs = 0;
  var missing = [];
  Object.keys(packed).forEach(function (sku) {
    if (sohMap[sku]) return;
    missingSku++;
    missingPcs += packed[sku];
    var m = meta[sku] || { desc: "", barcode: "", brand: "", boxNos: {} };
    missing.push({
      sku: sku,
      desc: m.desc || "",
      barcode: m.barcode || "",
      brand: m.brand || "",
      soh: 0,
      packed: packed[sku],
      left: 0,
      over: packed[sku],
      status: "missing",
      boxNos: Object.keys(m.boxNos || {}).sort(),
    });
  });

  rows.sort(function (a, b) {
    if (a.status !== b.status) {
      var order = { leftover: 0, over: 1, done: 2 };
      return (order[a.status] || 9) - (order[b.status] || 9);
    }
    if (a.status === "leftover") return b.left - a.left || a.sku.localeCompare(b.sku);
    if (a.status === "over") return b.over - a.over || a.sku.localeCompare(b.sku);
    return a.sku.localeCompare(b.sku);
  });

  var leftover = rows.filter(function (r) {
    return r.status === "leftover";
  });
  var over = rows.filter(function (r) {
    return r.status === "over";
  });
  var done = rows.filter(function (r) {
    return r.status === "done";
  });

  return {
    totals: {
      pkCount: Object.keys(boxSet).length || bundles.length,
      packedPcs: packedPcs,
      sohPcs: sohPcs,
      sohSkuCount: sohSkuCount,
      doneSku: doneSku,
      leftoverSku: leftoverSku,
      leftoverPcs: leftoverPcs,
      overSku: overSku,
      overPcs: overPcs,
      missingSku: missingSku,
      missingPcs: missingPcs,
    },
    rows: rows.concat(missing),
    leftover: leftover,
    over: over,
    missing: missing,
    done: done,
  };
}

/** Filter leftover list by query (sku / barcode / desc) and optional brand. */
export function filterSohLeftover(rows, query, brand) {
  var q = String(query || "")
    .trim()
    .toLowerCase();
  var b = String(brand || "")
    .trim()
    .toLowerCase();
  return (rows || []).filter(function (r) {
    if (b && String(r.brand || "").toLowerCase() !== b) return false;
    if (!q) return true;
    var hay = (
      String(r.sku || "") +
      " " +
      String(r.barcode || "") +
      " " +
      String(r.desc || "") +
      " " +
      String(r.brand || "")
    ).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

export function packingCounterCheckStatusLabel(status) {
  if (status === "leftover") return "ยังไม่แพ็ค";
  if (status === "over") return "เกิน";
  if (status === "missing") return "ไม่มีใน POS";
  if (status === "done") return "ครบ";
  return String(status || "");
}

/** Short safe token for CounterCheck_*.xlsx filenames. */
export function packingCounterCheckShortName(counter) {
  var s = String(counter || "").trim();
  if (!s) return "Counter";
  var cut = s.split(/\s+at\s+/i)[0].trim() || s;
  var out = cut
    .replace(/[^\w\u0E00-\u0E7F]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (out || "Counter").slice(0, 48);
}

/**
 * Format yyyymmdd-hhmm in a fixed timezone (default Asia/Bangkok).
 * @param {Date|string|number} [date]
 * @param {string} [timeZone]
 */
export function packingCounterCheckExportStamp(date, timeZone) {
  var d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  if (isNaN(d.getTime())) d = new Date();
  var tz = timeZone || "Asia/Bangkok";
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (e) {
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes())
    );
  }
  var parts = {};
  fmt.formatToParts(d).forEach(function (p) {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  // en-GB hourCycle can yield "24" for midnight — normalize
  var hour = parts.hour === "24" ? "00" : parts.hour;
  return parts.year + parts.month + parts.day + "-" + hour + parts.minute;
}

var CTR_CHECK_ALL_HEADERS = [
  "Status",
  "Brand",
  "SKU",
  "Barcode",
  "Description",
  "POS SOH",
  "Packed",
  "Left",
  "Over",
  "PK nos",
];

/**
 * Pure workbook payload for Counter check Excel export (no SheetJS).
 * Sheets: Summary, All SKUs, By PK (+ optional per-status sheets).
 *
 * @param {{
 *   counter: string,
 *   asOf?: string,
 *   check: object,
 *   includedOpen?: boolean,
 *   bundles?: Array<{boxNo?:string, lines?:Array}>,
 *   exportedAt?: Date|string|number,
 *   stamp?: string,
 *   includeStatusSheets?: boolean,
 * }} opts
 */
export function buildCounterCheckExcelData(opts) {
  opts = opts || {};
  var check = opts.check;
  if (!check || !check.totals) return null;
  var counter = String(opts.counter || "").trim();
  var asOf = String(opts.asOf || "").trim();
  var includedOpen = !!opts.includedOpen;
  var bundles = opts.bundles || [];
  var stamp = opts.stamp || packingCounterCheckExportStamp(opts.exportedAt);
  var short = packingCounterCheckShortName(counter);
  var fileName = "CounterCheck_" + short + "_" + stamp + ".xlsx";
  var t = check.totals;

  var pkSet = {};
  bundles.forEach(function (b) {
    var no = String((b && b.boxNo) || "").trim();
    if (no && no !== "__open__") pkSet[no] = 1;
  });
  (check.rows || []).forEach(function (r) {
    (r.boxNos || []).forEach(function (n) {
      if (n && n !== "__open__" && n !== "(เปิดอยู่)") pkSet[n] = 1;
    });
  });
  var pkNos = Object.keys(pkSet).sort();
  if (includedOpen && !pkNos.some(function (n) {
    return n.indexOf("(เปิด") === 0;
  })) {
    // open draft may use real boxNo already in list; note separately in summary
  }

  var summaryAoa = [
    ["Field", "Value"],
    ["Counter", counter],
    ["SOH as-of", asOf || "—"],
    ["Export time", stamp],
    ["PK count", t.pkCount],
    ["PK numbers", pkNos.join(", ")],
    ["Included open draft", includedOpen ? "Yes" : "No"],
    ["SOH SKU", t.sohSkuCount],
    ["SOH pcs", t.sohPcs],
    ["Packed pcs", t.packedPcs],
    ["Done SKU", t.doneSku],
    ["Leftover SKU", t.leftoverSku],
    ["Leftover pcs", t.leftoverPcs],
    ["Over SKU", t.overSku],
    ["Over pcs", t.overPcs],
    ["Not-in-POS SKU", t.missingSku],
    ["Not-in-POS pcs", t.missingPcs || 0],
  ];

  function skuRow(r) {
    return [
      packingCounterCheckStatusLabel(r.status),
      String(r.brand || ""),
      String(r.sku || ""),
      String(r.barcode || ""),
      String(r.desc || ""),
      Number(r.soh) || 0,
      Number(r.packed) || 0,
      Number(r.left) || 0,
      Number(r.over) || 0,
      (r.boxNos || []).join(", "),
    ];
  }

  var allRows = (check.rows || []).map(skuRow);
  var allAoa = [CTR_CHECK_ALL_HEADERS.slice()].concat(allRows);

  var byPkAoa = [["PK no", "Box", "SKU", "Barcode", "Description", "Brand", "Qty"]];
  bundles.forEach(function (b) {
    var no = String((b && b.boxNo) || "").trim() || "(เปิดอยู่)";
    if (no === "__open__") no = "(เปิดอยู่)";
    (b.lines || []).forEach(function (l) {
      var qty = Number(l.qty) || 0;
      if (qty <= 0) return;
      var box =
        Math.round(Number(l.boxSeq != null ? l.boxSeq : l.box) || 1) || 1;
      byPkAoa.push([
        no,
        box,
        String(l.sku || "").trim().toUpperCase(),
        String(l.barcode || l.ean || ""),
        String(l.desc || ""),
        String(l.brand || ""),
        qty,
      ]);
    });
  });

  var sheets = [
    {
      name: "Summary",
      aoa: summaryAoa,
      textCols: [0, 1],
      freeze: true,
      autofilter: false,
      cols: [22, 60],
    },
    {
      name: "All SKUs",
      aoa: allAoa,
      textCols: [2, 3],
      freeze: true,
      autofilter: true,
      cols: [12, 14, 14, 16, 40, 10, 10, 10, 10, 28],
    },
    {
      name: "By PK",
      aoa: byPkAoa,
      textCols: [2, 3],
      freeze: true,
      autofilter: true,
      cols: [16, 6, 14, 16, 40, 14, 8],
    },
  ];

  if (opts.includeStatusSheets) {
    [
      { key: "leftover", name: "ยังไม่แพ็ค" },
      { key: "over", name: "เกิน" },
      { key: "missing", name: "ไม่มีใน POS" },
      { key: "done", name: "ครบ" },
    ].forEach(function (s) {
      var list = check[s.key] || [];
      sheets.push({
        name: s.name,
        aoa: [CTR_CHECK_ALL_HEADERS.slice()].concat(list.map(skuRow)),
        textCols: [2, 3],
        freeze: true,
        autofilter: true,
        cols: [12, 14, 14, 16, 40, 10, 10, 10, 10, 28],
      });
    });
  }

  return {
    fileName: fileName,
    shortName: short,
    stamp: stamp,
    pkNos: pkNos,
    sheets: sheets,
  };
}

/** Line identity key used in packing drafts (S:SKU or N:…). */
export function packingLineKey(line) {
  if (!line) return "";
  if (line.k) return String(line.k);
  var sku = String(line.sku || "")
    .trim()
    .toUpperCase();
  if (sku) return "S:" + sku;
  var raw = String(line.ean || line.barcode || line.desc || "")
    .trim()
    .toUpperCase();
  return raw ? "N:" + raw : "";
}

/** Map key includes boxSeq so multi-box PKs stay separate. */
export function packingLineMapKey(line) {
  var seq = Math.round(Number(line && (line.boxSeq != null ? line.boxSeq : line.box)) || 1);
  if (!(seq > 0)) seq = 1;
  return packingLineKey(line) + "|" + seq;
}

/**
 * Build one idempotent packing delta op.
 * @returns {object|null}
 */
export function buildPackingDeltaOp( partial ) {
  partial = partial || {};
  var opId = String(partial.opId || "").trim();
  var deltaQty = Number(partial.deltaQty);
  if (!opId || !isFinite(deltaQty) || deltaQty === 0) return null;
  var boxSeq = Math.round(Number(partial.boxSeq) || 1) || 1;
  var sku = String(partial.sku || "").trim();
  var ean = String(partial.ean || partial.barcode || "").trim();
  var desc = String(partial.desc || "").trim();
  var brand = String(partial.brand || "").trim();
  var flag = String(partial.flag || "").trim();
  var lineKey =
    String(partial.lineKey || "").trim() ||
    packingLineKey({ sku: sku, ean: ean, desc: desc, k: partial.k });
  if (!lineKey) return null;
  return {
    opId: opId,
    deviceId: String(partial.deviceId || "").trim(),
    clientTs: Number(partial.clientTs) || Date.now(),
    boxNo: String(partial.boxNo || "").trim(),
    lineKey: lineKey,
    sku: sku,
    ean: ean,
    desc: desc,
    brand: brand,
    flag: flag,
    boxSeq: boxSeq,
    deltaQty: deltaQty,
  };
}

/**
 * Apply packing delta ops onto base lines. Duplicate opIds (in ops or seenOpIds) are skipped.
 * Negative deltas reduce qty; lines at qty<=0 are removed.
 *
 * @param {Array} baseLines
 * @param {Array} ops
 * @param {{ seenOpIds?: Object }} [opts]
 * @returns {{ lines: Array, applied: Array, skippedDup: string[], seenOpIds: Object }}
 */
export function applyPackingOps(baseLines, ops, opts) {
  opts = opts || {};
  var seenOpIds = {};
  Object.keys(opts.seenOpIds || {}).forEach(function (k) {
    seenOpIds[k] = 1;
  });
  var map = {};
  (baseLines || []).forEach(function (l) {
    if (!l) return;
    var qty = Number(l.qty) || 0;
    if (qty <= 0) return;
    var key = packingLineMapKey(l);
    if (!key || key.charAt(0) === "|") return;
    var boxSeq = Math.round(Number(l.boxSeq != null ? l.boxSeq : l.box) || 1) || 1;
    map[key] = {
      k: packingLineKey(l),
      sku: String(l.sku || ""),
      ean: String(l.ean || l.barcode || ""),
      desc: String(l.desc || ""),
      brand: String(l.brand || ""),
      flag: String(l.flag || ""),
      boxSeq: boxSeq,
      qty: qty,
      lastDeviceId: l.lastDeviceId || "",
      lastOpAt: l.lastOpAt || "",
    };
  });

  var applied = [];
  var skippedDup = [];
  (ops || []).forEach(function (raw) {
    var op = buildPackingDeltaOp(raw) || raw;
    var id = String((op && op.opId) || "").trim();
    if (!id) return;
    if (seenOpIds[id]) {
      skippedDup.push(id);
      return;
    }
    seenOpIds[id] = 1;
    var delta = Number(op.deltaQty);
    if (!isFinite(delta) || delta === 0) return;
    var boxSeq = Math.round(Number(op.boxSeq) || 1) || 1;
    var lineKey =
      String(op.lineKey || "").trim() ||
      packingLineKey({
        sku: op.sku,
        ean: op.ean,
        desc: op.desc,
        k: op.k,
      });
    if (!lineKey) return;
    var key = lineKey + "|" + boxSeq;
    var cur = map[key];
    if (!cur) {
      if (delta < 0) {
        applied.push(op);
        return;
      }
      cur = {
        k: lineKey,
        sku: String(op.sku || ""),
        ean: String(op.ean || ""),
        desc: String(op.desc || ""),
        brand: String(op.brand || ""),
        flag: String(op.flag || ""),
        boxSeq: boxSeq,
        qty: 0,
        lastDeviceId: "",
        lastOpAt: "",
      };
      map[key] = cur;
    }
    cur.qty = (Number(cur.qty) || 0) + delta;
    if (op.sku) cur.sku = String(op.sku);
    if (op.ean) cur.ean = String(op.ean);
    if (op.desc) cur.desc = String(op.desc);
    if (op.brand) cur.brand = String(op.brand);
    if (op.flag != null && String(op.flag) !== "") cur.flag = String(op.flag);
    if (op.deviceId) cur.lastDeviceId = String(op.deviceId);
    if (op.clientTs) cur.lastOpAt = op.clientTs;
    if (cur.qty <= 0) delete map[key];
    applied.push(op);
  });

  var lines = Object.keys(map)
    .map(function (k) {
      return map[k];
    })
    .filter(function (l) {
      return (Number(l.qty) || 0) > 0;
    });

  return {
    lines: lines,
    applied: applied,
    skippedDup: skippedDup,
    seenOpIds: seenOpIds,
  };
}

/** True when localRev is set and differs from serverRev. */
export function packingStaleVersion(localRev, serverRev) {
  if (localRev == null || localRev === "" || serverRev == null || serverRev === "") return false;
  return Number(localRev) !== Number(serverRev);
}

/**
 * Devices (excluding me) seen within windowMs.
 * @param {Array<{deviceId:string,lastSeen:number}>} devices
 */
export function packingActivePeers(devices, myDeviceId, nowMs, windowMs) {
  var now = nowMs != null ? Number(nowMs) : Date.now();
  var win = windowMs != null ? Number(windowMs) : 30000;
  var me = String(myDeviceId || "");
  return (devices || []).filter(function (d) {
    if (!d || !d.deviceId) return false;
    if (String(d.deviceId) === me) return false;
    var seen = Number(d.lastSeen) || 0;
    return now - seen <= win;
  });
}

export function packingPeerBannerText(peers) {
  var n = (peers || []).length;
  if (n <= 0) return "";
  if (n === 1) return "อีก 1 เครื่องกำลังแพ็คกล่องนี้";
  return "อีก " + n + " เครื่องกำลังแพ็คกล่องนี้";
}

/**
 * Check one SKU against SOH.
 * @returns {{ status: 'ok'|'missing'|'over', packed: number, soh: number, warn?: string }}
 */
export function packingSohCheck(sku, packedQty, sohMap) {
  var info = packingSohLineInfo(sku, packedQty, sohMap);
  if (!info) return { status: "ok", packed: Number(packedQty) || 0, soh: 0 };
  if (info.status === "missing") {
    return {
      status: "missing",
      packed: info.packed,
      soh: 0,
      warn: info.warn || "ไม่มีใน POS ของ counter นี้",
    };
  }
  if (info.status === "over") {
    return {
      status: "over",
      packed: info.packed,
      soh: info.soh,
      warn: "แพ็ค " + info.packed + " / POS มี " + info.soh,
    };
  }
  return { status: "ok", packed: info.packed, soh: info.soh };
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
    VERSION: VERSION,
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
    formatPackingSohLine: formatPackingSohLine,
    formatPackingSohLineDetailed: formatPackingSohLineDetailed,
    packingSohLineInfo: packingSohLineInfo,
    packingSohLineInfoDetailed: packingSohLineInfoDetailed,
    packingCounterPackedMap: packingCounterPackedMap,
    packingMergeCounterPacked: packingMergeCounterPacked,
    packingSohSummaryFromPacked: packingSohSummaryFromPacked,
    formatSohPosBadge: formatSohPosBadge,
    formatPackingSohLastStatus: formatPackingSohLastStatus,
    packingSohSummary: packingSohSummary,
    filterSohLeftover: filterSohLeftover,
    packingCounterCheck: packingCounterCheck,
    packingCounterCheckStatusLabel: packingCounterCheckStatusLabel,
    packingCounterCheckShortName: packingCounterCheckShortName,
    packingCounterCheckExportStamp: packingCounterCheckExportStamp,
    buildCounterCheckExcelData: buildCounterCheckExcelData,
    packingLineKey: packingLineKey,
    packingLineMapKey: packingLineMapKey,
    applyPackingOps: applyPackingOps,
    packingStaleVersion: packingStaleVersion,
    packingActivePeers: packingActivePeers,
    packingPeerBannerText: packingPeerBannerText,
    buildPackingDeltaOp: buildPackingDeltaOp,
  };
}
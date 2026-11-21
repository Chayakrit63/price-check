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

/** Strip legacy datalist values like "ICON-ADP · ICONSIAM - NICHE ADP" → place name only. */
export function stripPlaceListLabel(s) {
  s = String(s || "").trim();
  var m = /^[A-Za-z0-9][A-Za-z0-9\-]{2,24}\s*·\s*(.+)$/.exec(s);
  return m ? m[1].trim() : s;
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

if (typeof window !== "undefined") {
  window.CatalogCore = {
    itemTypeBucket: itemTypeBucket,
    rowTypeBucket: rowTypeBucket,
    parseSearchQty: parseSearchQty,
    searchQueryOnly: searchQueryOnly,
    counterPlaceName: counterPlaceName,
    counterNamesDeduped: counterNamesDeduped,
    stripPlaceListLabel: stripPlaceListLabel,
    searchCatalog: searchCatalog,
    filterRowsByType: filterRowsByType,
    countByType: countByType,
    editDistance: editDistance,
  };
}
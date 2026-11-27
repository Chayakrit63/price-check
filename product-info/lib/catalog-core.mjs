/**
 * Shared catalog classifier + search (Node tests + browser via window.CatalogCore).
 * Bump VERSION in lockstep with APP_VER in index.html (cache-bust query on the module URL).
 */
import {
  stripBarcodeRaw,
  gtinChecksumOk,
  expandUpce,
  normalizeBarcode,
  barcodeConsensusPush,
  barcodeFormatsForMode,
} from "./cam-barcode.mjs";
export {
  stripBarcodeRaw,
  gtinChecksumOk,
  expandUpce,
  normalizeBarcode,
  barcodeConsensusPush,
  barcodeFormatsForMode,
};

export var VERSION = "20261127i";

/**
 * Classify a product into STOCK | TESTER | GWPS | OTH for packing / remaining filters.
 *
 * Priority (first match wins):
 * 1. Explicit override (stock-count groupOverride, etc.)
 * 2. Master Items `group` / category when present:
 *    - STOCK / TESTER / OTH → that bucket
 *    - GWP, SAMP, MINI, PR GIFT, EXEC GIFT (and similar) → GWPS
 * 3. Derived from SKU / description when master group is empty/unknown:
 *    - Tester: desc/sku contains TESTER; SKU like T-… or ends with digit+F/T
 *    - GWPs: desc matches GWP, GIFT, POSM, SAMPLE/SAMP, TOTE BAG, WOVEN BAG
 *    - Other: TRAINING / FIXTURE / DISPLAY in desc
 *    - else Stock (normal saleable)
 *
 * Examples:
 * - STOCK: L3720002 "CACHAREL ANAIS ANAIS EDT 50ML" group=STOCK
 * - TESTER: T-EXT0029 "… TESTER 100ML" group=TESTER
 * - GWPS: "RED TOTE BAG GWP LARGE", "WOVEN BAG POSM MEDIUM", "EDP SAMPLE 2ML"
 * - OTH: 3111601-TRG "TRAINING" group=OTH
 */
export function itemTypeBucket(sku, desc, masterGroup, override) {
  if (override) return String(override).toUpperCase();
  var g = String(masterGroup || "").toUpperCase().trim();
  if (g === "STOCK") return "STOCK";
  if (g === "TESTER") return "TESTER";
  if (g === "OTH" || g === "OTHER") return "OTH";
  if (g && /GWP|SAMP|MINI|PR GIFT|EXEC GIFT|POSM/.test(g)) return "GWPS";
  var d = String(desc || "").toUpperCase();
  var s = String(sku || "").toUpperCase();
  if (/TESTER/.test(d)) return "TESTER";
  if (/^T-/.test(s) || /[0-9][FT]$/.test(s) || /TESTER/.test(s)) return "TESTER";
  // Gift / POSM / sample / branded tote-style bags (Prestige warehouse)
  if (
    /\bGWP\b/.test(d) ||
    /\bGIFT\b/.test(d) ||
    /\bPOSM\b/.test(d) ||
    /\bSAMPLES?\b/.test(d) ||
    /\bSAMP\b/.test(d) ||
    /TOTE\s*BAG/.test(d) ||
    /WOVEN\s*BAG/.test(d)
  ) {
    return "GWPS";
  }
  if (/TRAINING|FIXTURE|\bDISPLAY\b/.test(d)) return "OTH";
  // Unknown master group that isn't empty — treat as Stock unless clearly other
  if (g && g !== "STOCK") {
    // leave non-empty unrecognized groups as STOCK (saleable default)
  }
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

/**
 * Shade abbreviations derived from live catalog depth×undertone phrases
 * (Prada Reveal + Valentino cushions). Initials of each word; no collisions
 * in current data. LIGHT PINK (POSM pouch) intentionally excluded — not a shade.
 *
 * Catalog coverage (approx rows matching the phrase):
 *   LN LIGHT NEUTRAL 29 · LW LIGHT WARM 14 · LC LIGHT COOL 12
 *   MN MEDIUM NEUTRAL 20 · MW MEDIUM WARM 13 · MC MEDIUM COOL 10
 *   DN DARK NEUTRAL 6 · DW DARK WARM 3
 */
export var SHADE_ABBREV = {
  LN: "LIGHT NEUTRAL",
  LW: "LIGHT WARM",
  LC: "LIGHT COOL",
  MN: "MEDIUM NEUTRAL",
  MW: "MEDIUM WARM",
  MC: "MEDIUM COOL",
  DN: "DARK NEUTRAL",
  DW: "DARK WARM",
};

export function normalizeSearchText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a single token as shade abbrev (+ optional number): MW, mw40, MW-40. */
export function parseShadeAbbrevToken(tok) {
  var m = /^([a-z]{2,4})(?:[\s\-]?(\d{1,3}))?$/i.exec(String(tok || "").trim());
  if (!m) return null;
  var code = m[1].toUpperCase();
  var phrase = SHADE_ABBREV[code];
  if (!phrase) return null;
  return { code: code, phrase: phrase, num: m[2] || null };
}

/**
 * Build match plan: literal tokens (existing AND) + optional shade-expanded clauses.
 * Coalesces "mw" + "40" → MEDIUM WARM 40; accepts "MW40" / "mw-40".
 */
export function buildShadeMatchPlan(query) {
  var raw = normalizeSearchText(query);
  var parts = raw ? raw.split(" ").filter(Boolean) : [];
  var literalTokens = parts.slice();
  var expanded = [];
  var hasShade = false;
  var hasShadeNum = false;
  var i;
  for (i = 0; i < parts.length; i++) {
    var attached = parseShadeAbbrevToken(parts[i]);
    if (attached && attached.num) {
      expanded.push({
        kind: "shade",
        phrase: attached.phrase.toLowerCase(),
        num: attached.num,
        code: attached.code,
      });
      hasShade = true;
      hasShadeNum = true;
      continue;
    }
    if (attached && !attached.num) {
      var next = parts[i + 1];
      if (next && /^\d{1,3}$/.test(next)) {
        expanded.push({
          kind: "shade",
          phrase: attached.phrase.toLowerCase(),
          num: next,
          code: attached.code,
        });
        hasShade = true;
        hasShadeNum = true;
        i++;
        continue;
      }
      expanded.push({
        kind: "shade",
        phrase: attached.phrase.toLowerCase(),
        num: null,
        code: attached.code,
      });
      hasShade = true;
      continue;
    }
    expanded.push({ kind: "word", text: parts[i] });
  }
  return {
    literalTokens: literalTokens,
    expanded: expanded,
    hasShade: hasShade,
    hasShadeNum: hasShadeNum,
  };
}

/**
 * Phrase (+ optional shade number) with word/digit boundaries.
 * Number may sit immediately after OR before the phrase.
 * MW 40 must not match MEDIUM WARM 45 / 140.
 */
export function shadePhraseInHay(hay, phrase, num) {
  var h = normalizeSearchText(hay);
  var esc = escapeRegExp(normalizeSearchText(phrase));
  if (!esc) return false;
  if (num != null && num !== "") {
    var n = String(num);
    var after = new RegExp("(?:^|[^a-z0-9])" + esc + " " + n + "(?![0-9])");
    var before = new RegExp("(?:^|[^a-z0-9])" + n + " " + esc + "(?![a-z0-9])");
    return after.test(h) || before.test(h);
  }
  return new RegExp("(?:^|[^a-z0-9])" + esc + "(?![a-z0-9])").test(h);
}

export function hayMatchesShadePlan(hay, plan) {
  plan = plan || buildShadeMatchPlan("");
  var h = normalizeSearchText(hay);
  var litOk =
    !plan.literalTokens.length ||
    plan.literalTokens.every(function (t) {
      return h.indexOf(t) >= 0;
    });
  var expOk =
    !plan.expanded.length ||
    plan.expanded.every(function (c) {
      if (c.kind === "word") return h.indexOf(c.text) >= 0;
      return shadePhraseInHay(h, c.phrase, c.num);
    });
  // Shade path only counts when we actually expanded something (else same as literal)
  if (!plan.hasShade) expOk = litOk;
  return { litOk: litOk, expOk: expOk, any: litOk || expOk };
}

/** Shared matcher for searchCatalog + Remaining/Counter filters. */
export function textMatchesQuery(hay, query) {
  var q = String(query || "").trim();
  if (!q) return true;
  return hayMatchesShadePlan(hay, buildShadeMatchPlan(q)).any;
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

function rankRow(row, qn, tokens, wantFuzzy, shadePlan) {
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
  var hay = row.hay || rowHay(row);
  if (tokens.length || (shadePlan && shadePlan.hasShade)) {
    var modes = hayMatchesShadePlan(hay, shadePlan || buildShadeMatchPlan(tokens.join(" ")));
    if (modes.litOk) rank = Math.min(rank, 5);
    if (modes.expOk && shadePlan && shadePlan.hasShade) {
      // Shade expansion hit — same band as multi-word; tighter when number present
      rank = Math.min(rank, shadePlan.hasShadeNum ? 5 : 5);
    }
    if (!modes.any && tokens.length > 1 && rank >= 99) return 99;
    if (!modes.any && shadePlan && shadePlan.hasShade && tokens.length && rank >= 99) return 99;
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
  var shadePlan = buildShadeMatchPlan(q);
  var wantFuzzy = qn.length >= 4 && !/^\d+$/.test(qn);
  var hits = [];
  var i, row, rank;
  for (i = 0; i < catalog.length; i++) {
    row = catalog[i];
    rank = rankRow(row, qn, tokens, wantFuzzy, shadePlan);
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

/** Case-insensitive trim match against a closed-counter hide list. */
export function isClosedPlaceName(name, closed) {
  var k = String(name || "")
    .trim()
    .toLowerCase();
  if (!k) return false;
  return (closed || []).some(function (s) {
    return (
      String(s || "")
        .trim()
        .toLowerCase() === k
    );
  });
}

/**
 * Drop closed counters from a place-name list (case-insensitive, trim).
 * Also drops "CODE · Name" labels whose place name is closed.
 */
export function filterClosedPlaceNames(names, closed) {
  if (!closed || !closed.length) return (names || []).slice();
  return (names || []).filter(function (raw) {
    var s = String(raw || "").trim();
    if (!s) return false;
    if (isClosedPlaceName(s, closed)) return false;
    var place = stripPlaceListLabel(s);
    if (place !== s && isClosedPlaceName(place, closed)) return false;
    return true;
  });
}

/**
 * Seed for Counter check: keep current from if open; else first available; else "".
 */
export function pickOpenPlaceSeed(currentFrom, closed, available) {
  var cur = String(currentFrom || "").trim();
  if (cur && !isClosedPlaceName(cur, closed)) return cur;
  var open = filterClosedPlaceNames(available || [], closed);
  return open.length ? String(open[0]).trim() : "";
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
    // Only positive POS SOH counts as "in POS". Qty 0 / empty entries must not
    // swallow packed lines (e.g. -TST pseudo-SKUs, or stale zero rows).
    var sohQty = sohMap[sku] ? Number(sohMap[sku].qty) || 0 : 0;
    if (sohQty > 0) return;
    missingSku++;
    missingPcs += packed[sku];
    var m = meta[sku] || { desc: "", barcode: "", brand: "", boxNos: {} };
    missing.push({
      sku: sku,
      desc: m.desc || (sohMap[sku] && sohMap[sku].desc) || "",
      barcode: m.barcode || (sohMap[sku] && sohMap[sku].barcode) || "",
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

/**
 * Filter leftover list by query (sku / barcode / desc), optional brand,
 * and optional typeCat (ALL|STOCK|TESTER|GWPS|OTH). Uses row.type when set,
 * else rowTypeBucket(row).
 */
export function filterSohLeftover(rows, query, brand, typeCat) {
  var q = String(query || "").trim();
  var b = String(brand || "")
    .trim()
    .toLowerCase();
  var tc = String(typeCat || "ALL")
    .trim()
    .toUpperCase();
  if (tc === "OTHER") tc = "OTH";
  return (rows || []).filter(function (r) {
    if (tc && tc !== "ALL") {
      var t = String(r.type || rowTypeBucket(r) || "").toUpperCase();
      if (t === "OTHER") t = "OTH";
      if (t !== tc) return false;
    }
    if (b && String(r.brand || "").toLowerCase() !== b) return false;
    if (!q) return true;
    var hay =
      String(r.sku || "") +
      " " +
      String(r.barcode || "") +
      " " +
      String(r.desc || "") +
      " " +
      String(r.brand || "");
    return textMatchesQuery(hay, q);
  });
}

/**
 * Counts of remaining SKUs + leftover qty per type bucket (for filter chips).
 * @returns {{ ALL:{sku:number,qty:number}, STOCK:…, TESTER:…, GWPS:…, OTH:… }}
 */
export function sohLeftoverTypeCounts(rows) {
  var out = {
    ALL: { sku: 0, qty: 0 },
    STOCK: { sku: 0, qty: 0 },
    TESTER: { sku: 0, qty: 0 },
    GWPS: { sku: 0, qty: 0 },
    OTH: { sku: 0, qty: 0 },
  };
  (rows || []).forEach(function (r) {
    if (!r) return;
    var left = Number(r.left) || 0;
    var t = String(r.type || rowTypeBucket(r) || "STOCK").toUpperCase();
    if (t === "OTHER") t = "OTH";
    if (!out[t]) t = "OTH";
    out.ALL.sku += 1;
    out.ALL.qty += left;
    out[t].sku += 1;
    out[t].qty += left;
  });
  return out;
}

/**
 * Extract size/weight from a product description (100ML, 100 ML, 50G).
 * @returns {{ value: number, unit: string, key: string }|null}
 */
export function parseItemSize(desc) {
  var m = /(\d+(?:\.\d+)?)\s*(ML|G)\b/i.exec(String(desc || ""));
  if (!m) return null;
  var value = Number(m[1]);
  if (!isFinite(value) || value <= 0) return null;
  var unit = String(m[2] || "").toUpperCase();
  return { value: value, unit: unit, key: String(value) + unit };
}

var SWAP_DESC_STOP = {
  EDT: 1,
  EDP: 1,
  PERFUME: 1,
  PARFUM: 1,
  SPRAY: 1,
  TESTER: 1,
  VAPORISATEUR: 1,
  FLACON: 1,
  THE: 1,
  AND: 1,
  FOR: 1,
  WITH: 1,
  ML: 1,
  ASMB: 1,
};

/** Significant description tokens for swap matching (size stripped). */
export function swapDescTokens(desc) {
  var d = String(desc || "")
    .toUpperCase()
    .replace(/(\d+(?:\.\d+)?)\s*(ML|G)\b/gi, " ")
    .replace(/[^A-Z0-9\u0E00-\u0E7F]+/g, " ")
    .trim();
  if (!d) return [];
  var out = [];
  var seen = {};
  d.split(/\s+/).forEach(function (tok) {
    if (tok.length < 3) return;
    if (SWAP_DESC_STOP[tok]) return;
    if (seen[tok]) return;
    seen[tok] = 1;
    out.push(tok);
  });
  return out;
}

/**
 * True when descriptions are "very similar" for swap detection
 * (shared ≥2 significant tokens, or one long shared token ≥8 chars).
 */
export function descsVerySimilar(a, b) {
  var ta = swapDescTokens(a);
  var tb = swapDescTokens(b);
  if (!ta.length || !tb.length) return false;
  var setB = {};
  tb.forEach(function (t) {
    setB[t] = 1;
  });
  var shared = 0;
  var longHit = false;
  ta.forEach(function (t) {
    if (!setB[t]) return;
    shared++;
    if (t.length >= 8) longHit = true;
  });
  return shared >= 2 || longHit;
}

function counterCheckSwapStatusesOk(sa, sb) {
  var a = String(sa || "");
  var b = String(sb || "");
  if (a === b) return false;
  var pair = a < b ? a + "|" + b : b + "|" + a;
  return (
    pair === "leftover|over" ||
    pair === "leftover|missing" ||
    pair === "missing|over"
  );
}

function counterCheckSizeKey(row) {
  if (row && row.size && row.size.key) return row.size.key;
  var parsed = parseItemSize(row && row.desc);
  return parsed ? parsed.key : "";
}

/**
 * Detect สลับ (swapped) pairs among counter-check rows.
 * Same barcode (preferred) or very similar description, same size/ML,
 * different SKU, and complementary issue statuses (short↔over / short↔No POS / over↔No POS).
 *
 * @returns {Array<{ a: object, b: object, reason: string, size: string }>}
 */
export function detectCounterCheckSwaps(rows) {
  var list = (rows || []).filter(function (r) {
    return r && r.sku && r.status && r.status !== "done";
  });
  var pairs = [];
  var used = {};

  function tryPair(i, j, reason) {
    var a = list[i];
    var b = list[j];
    if (!a || !b) return;
    var sa = String(a.sku).toUpperCase();
    var sb = String(b.sku).toUpperCase();
    if (!sa || !sb || sa === sb) return;
    if (used[sa] || used[sb]) return;
    if (!counterCheckSwapStatusesOk(a.status, b.status)) return;
    var ka = counterCheckSizeKey(a);
    var kb = counterCheckSizeKey(b);
    if (!ka || !kb || ka !== kb) return;
    used[sa] = 1;
    used[sb] = 1;
    pairs.push({ a: a, b: b, reason: reason, size: ka });
  }

  // 1) Same barcode groups
  var byBc = {};
  list.forEach(function (r, idx) {
    var bc = String(r.barcode || "")
      .replace(/\s+/g, "")
      .trim();
    if (!bc) return;
    if (!byBc[bc]) byBc[bc] = [];
    byBc[bc].push(idx);
  });
  Object.keys(byBc).forEach(function (bc) {
    var idxs = byBc[bc];
    if (idxs.length < 2) return;
    for (var i = 0; i < idxs.length; i++) {
      for (var j = i + 1; j < idxs.length; j++) {
        tryPair(idxs[i], idxs[j], "barcode");
      }
    }
  });

  // 2) Similar description + same size (rows not already paired)
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    var sa = String(a.sku || "").toUpperCase();
    if (!sa || used[sa]) continue;
    for (var j = i + 1; j < list.length; j++) {
      var b = list[j];
      var sb = String(b.sku || "").toUpperCase();
      if (!sb || used[sb]) continue;
      if (!descsVerySimilar(a.desc, b.desc)) continue;
      tryPair(i, j, "desc");
    }
  }

  return pairs;
}

/**
 * Annotate counter-check rows with type / size / swap partner / draft pcs.
 * Does not change existing status meanings (leftover|over|missing|done).
 * @param {object} check
 * @param {{ draftPacked?: Record<string, number> }} [opts]
 *   draftPacked = SKU→qty from the open unsaved PK (ยังไม่บันทึก).
 */
export function enrichCounterCheck(check, opts) {
  if (!check) return null;
  opts = opts || {};
  var draftMap = opts.draftPacked || opts.draftMap || {};
  var rows = (check.rows || []).map(function (r) {
    var size = parseItemSize(r.desc);
    var sku = String(r.sku || "")
      .trim()
      .toUpperCase();
    var draftPacked = Number(draftMap[sku]) || 0;
    return Object.assign({}, r, {
      type: String(r.type || rowTypeBucket(r) || "STOCK").toUpperCase(),
      size: size,
      swapWith: "",
      swapNote: "",
      swapped: false,
      draftPacked: draftPacked,
    });
  });
  var bySku = {};
  rows.forEach(function (r) {
    bySku[String(r.sku || "").toUpperCase()] = r;
  });
  var pairs = detectCounterCheckSwaps(rows);
  pairs.forEach(function (p) {
    var a = bySku[String(p.a.sku || "").toUpperCase()];
    var b = bySku[String(p.b.sku || "").toUpperCase()];
    if (!a || !b) return;
    a.swapWith = String(b.sku);
    a.swapNote = "สลับกับ " + b.sku;
    a.swapped = true;
    b.swapWith = String(a.sku);
    b.swapNote = "สลับกับ " + a.sku;
    b.swapped = true;
  });
  function slice(status) {
    return rows.filter(function (r) {
      return r.status === status;
    });
  }
  function sliceIssue(issue) {
    return rows.filter(function (r) {
      return counterCheckRowMatchesIssue(r, issue);
    });
  }
  var swappedRows = sliceIssue("swapped");
  var notStarted = sliceIssue("notStarted");
  var partial = sliceIssue("partial");
  var nearDone = sliceIssue("nearDone");
  var unsaved = sliceIssue("unsaved");
  var totals = Object.assign({}, check.totals || {}, {
    swappedSku: swappedRows.length,
    swappedPairs: pairs.length,
    notStartedSku: notStarted.length,
    partialSku: partial.length,
    nearDoneSku: nearDone.length,
    unsavedSku: unsaved.length,
    unsavedPcs: unsaved.reduce(function (n, r) {
      return n + (Number(r.draftPacked) || 0);
    }, 0),
  });
  return Object.assign({}, check, {
    rows: rows,
    leftover: slice("leftover"),
    over: slice("over"),
    missing: slice("missing"),
    done: slice("done"),
    swapped: swappedRows,
    notStarted: notStarted,
    partial: partial,
    nearDone: nearDone,
    unsaved: unsaved,
    swapPairs: pairs,
    totals: totals,
  });
}

/**
 * Chip / filter defs for Counter check issue row.
 * Overlapping views (notStarted+partial = leftover); add new keys here + matcher.
 */
export var COUNTER_CHECK_ISSUE_DEFS = [
  { key: "ALL", label: "All" },
  { key: "notStarted", label: "ยังไม่เริ่ม" },
  { key: "partial", label: "แพ็คบางส่วน" },
  { key: "nearDone", label: "ใกล้ครบ" },
  { key: "leftover", label: "ขาด" },
  { key: "over", label: "เกิน" },
  { key: "missing", label: "No POS" },
  { key: "done", label: "ครบ" },
  { key: "swapped", label: "สลับ" },
  { key: "unsaved", label: "ยังไม่บันทึก" },
];

export var COUNTER_CHECK_TYPE_DEFS = [
  { key: "ALL", label: "All" },
  { key: "STOCK", label: "Stock" },
  { key: "TESTER", label: "Tester" },
  { key: "GWPS", label: "GWPs" },
  { key: "OTH", label: "Other" },
];

/**
 * Left pcs for one counter-check row — same as All SKUs "Left":
 * max(0, POS SOH − packed). Prefer stored `left` when present.
 */
function counterCheckRowRemaining(r) {
  if (!r) return 0;
  if (r.left != null && r.left !== "") {
    var stored = Number(r.left);
    if (isFinite(stored)) return stored > 0 ? stored : 0;
  }
  var soh = Number(r.soh) || 0;
  var packed = Number(r.packed) || 0;
  var rem = soh - packed;
  return rem > 0 ? rem : 0;
}

/** Normalize issue chip / filter keys (Thai aliases → canonical). */
export function normalizeCounterCheckIssueCat(issue) {
  var ic = String(issue || "ALL")
    .trim()
    .toLowerCase();
  if (!ic || ic === "all") return "ALL";
  if (ic === "ขาด" || ic === "short" || ic === "leftover") return "leftover";
  if (ic === "เกิน" || ic === "over") return "over";
  if (ic === "nopos" || ic === "no_pos" || ic === "no pos" || ic === "missing")
    return "missing";
  if (ic === "ครบ" || ic === "ok" || ic === "done") return "done";
  if (ic === "สลับ" || ic === "swap" || ic === "swapped") return "swapped";
  if (
    ic === "ยังไม่เริ่ม" ||
    ic === "notstarted" ||
    ic === "not_started" ||
    ic === "not-started"
  )
    return "notStarted";
  if (
    ic === "แพ็คบางส่วน" ||
    ic === "partial" ||
    ic === "part" ||
    ic === "inprogress"
  )
    return "partial";
  if (
    ic === "ใกล้ครบ" ||
    ic === "neardone" ||
    ic === "near_done" ||
    ic === "near-done"
  )
    return "nearDone";
  if (
    ic === "ยังไม่บันทึก" ||
    ic === "unsaved" ||
    ic === "draft" ||
    ic === "open"
  )
    return "unsaved";
  return String(issue || "").trim() || "ALL";
}

/**
 * Whether a row belongs in an issue chip / filter (overlapping views allowed).
 * ขาด = leftover status; ยังไม่เริ่ม / แพ็คบางส่วน partition leftover;
 * ใกล้ครบ = packed>0 and left∈{1,2}; ยังไม่บันทึก = draftPacked>0.
 */
export function counterCheckRowMatchesIssue(r, issueCat) {
  if (!r) return false;
  var ic = normalizeCounterCheckIssueCat(issueCat);
  if (!ic || ic === "ALL") return true;
  var soh = Number(r.soh) || 0;
  var packed = Number(r.packed) || 0;
  var left = counterCheckRowRemaining(r);
  if (ic === "swapped") return !!r.swapped;
  if (ic === "leftover" || ic === "over" || ic === "missing" || ic === "done") {
    return String(r.status || "") === ic;
  }
  if (ic === "notStarted") return soh > 0 && packed === 0;
  if (ic === "partial") return soh > 0 && packed > 0 && packed < soh;
  if (ic === "nearDone") return packed > 0 && left >= 1 && left <= 2;
  if (ic === "unsaved") return (Number(r.draftPacked) || 0) > 0;
  return String(r.status || "") === ic;
}

/**
 * Overlapping flag labels for Excel Flags column (Thai).
 * @returns {string[]}
 */
export function counterCheckRowFlags(r) {
  var flags = [];
  if (!r) return flags;
  if (counterCheckRowMatchesIssue(r, "notStarted")) flags.push("ยังไม่เริ่ม");
  if (counterCheckRowMatchesIssue(r, "partial")) flags.push("แพ็คบางส่วน");
  if (counterCheckRowMatchesIssue(r, "nearDone")) flags.push("ใกล้ครบ");
  if (r.swapped) flags.push("สลับ");
  if (counterCheckRowMatchesIssue(r, "unsaved")) flags.push("ยังไม่บันทึก");
  return flags;
}

/**
 * Aggregate SKU / packed / remaining for a counter-check row set.
 * Remaining = sum of Left (SOH − packed, min 0) — matches All SKUs Left.
 * Packed includes No POS rows so totals reconcile with Summary Packed pcs.
 * @returns {{ sku: number, packed: number, remaining: number }}
 */
export function counterCheckRowStats(rows, opts) {
  opts = opts || {};
  var useDraft = !!opts.useDraftPacked;
  var out = { sku: 0, packed: 0, remaining: 0 };
  (rows || []).forEach(function (r) {
    if (!r) return;
    out.sku += 1;
    out.packed += useDraft
      ? Number(r.draftPacked) || 0
      : Number(r.packed) || 0;
    out.remaining += counterCheckRowRemaining(r);
  });
  return out;
}

function emptyChipStat() {
  return { sku: 0, packed: 0, remaining: 0 };
}

function addChipStat(bucket, r, useDraft) {
  bucket.sku += 1;
  bucket.packed += useDraft
    ? Number(r.draftPacked) || 0
    : Number(r.packed) || 0;
  bucket.remaining += counterCheckRowRemaining(r);
}

/**
 * Two-line chip copy: title = "ขาด 422", sub = "แพ็ค 87 · เหลือ 3485".
 * Pure string helper so UI stays thin and future issue keys reuse the same shape.
 */
export function formatCounterCheckChipLines(label, stats) {
  var s = stats || emptyChipStat();
  return {
    title: String(label || "") + " " + (Number(s.sku) || 0),
    sub:
      "แพ็ค " +
      (Number(s.packed) || 0) +
      " · เหลือ " +
      (Number(s.remaining) || 0),
  };
}

/**
 * Type chip stats (Stock/Tester/GWPs/Other) for a row set already scoped by
 * the other filter (e.g. current issue). Keys stay stable for new groups.
 * @returns {{ ALL, STOCK, TESTER, GWPS, OTH }} each { sku, packed, remaining }
 */
export function counterCheckTypeCounts(rows) {
  var out = {
    ALL: emptyChipStat(),
    STOCK: emptyChipStat(),
    TESTER: emptyChipStat(),
    GWPS: emptyChipStat(),
    OTH: emptyChipStat(),
  };
  (rows || []).forEach(function (r) {
    if (!r) return;
    var t = String(r.type || rowTypeBucket(r) || "STOCK").toUpperCase();
    if (t === "OTHER") t = "OTH";
    if (!out[t]) t = "OTH";
    addChipStat(out.ALL, r, false);
    addChipStat(out[t], r, false);
  });
  return out;
}

/**
 * Issue chip stats within a row set already scoped by the other filter.
 * Includes overlapping views (notStarted/partial/nearDone/unsaved).
 * Unsaved.packed = sum(draftPacked) so the chip shows draft pcs.
 * @returns {Record<string, { sku: number, packed: number, remaining: number }>}
 */
export function counterCheckIssueCounts(rows) {
  var out = {
    ALL: emptyChipStat(),
    notStarted: emptyChipStat(),
    partial: emptyChipStat(),
    nearDone: emptyChipStat(),
    leftover: emptyChipStat(),
    over: emptyChipStat(),
    missing: emptyChipStat(),
    done: emptyChipStat(),
    swapped: emptyChipStat(),
    unsaved: emptyChipStat(),
  };
  (rows || []).forEach(function (r) {
    if (!r) return;
    addChipStat(out.ALL, r, false);
    COUNTER_CHECK_ISSUE_DEFS.forEach(function (def) {
      if (def.key === "ALL") return;
      if (!counterCheckRowMatchesIssue(r, def.key)) return;
      if (!out[def.key]) out[def.key] = emptyChipStat();
      addChipStat(out[def.key], r, def.key === "unsaved");
    });
  });
  return out;
}

/**
 * Filter counter-check rows by search / brand / typeCat / issueCat.
 * issueCat supports overlapping views (notStarted|partial|nearDone|unsaved)
 * plus leftover|over|missing|done|swapped.
 */
export function filterCounterCheckRows(rows, opts) {
  opts = opts || {};
  var q = String(opts.query != null ? opts.query : opts.q || "").trim();
  var b = String(opts.brand || "")
    .trim()
    .toLowerCase();
  var tc = String(opts.typeCat || "ALL")
    .trim()
    .toUpperCase();
  if (tc === "OTHER") tc = "OTH";
  var ic = normalizeCounterCheckIssueCat(opts.issueCat || opts.tab || "ALL");
  return (rows || []).filter(function (r) {
    if (!r) return false;
    if (tc && tc !== "ALL") {
      var t = String(r.type || rowTypeBucket(r) || "").toUpperCase();
      if (t === "OTHER") t = "OTH";
      if (t !== tc) return false;
    }
    if (ic && ic !== "ALL" && !counterCheckRowMatchesIssue(r, ic)) return false;
    if (b && String(r.brand || "").toLowerCase() !== b) return false;
    if (!q) return true;
    var hay =
      String(r.sku || "") +
      " " +
      String(r.barcode || "") +
      " " +
      String(r.desc || "") +
      " " +
      String(r.brand || "") +
      " " +
      String(r.swapWith || "");
    return textMatchesQuery(hay, q);
  });
}

export function packingCounterCheckIssueLabel(issue) {
  var ic = normalizeCounterCheckIssueCat(issue);
  if (ic === "ALL") return "All";
  for (var i = 0; i < COUNTER_CHECK_ISSUE_DEFS.length; i++) {
    if (COUNTER_CHECK_ISSUE_DEFS[i].key === ic)
      return COUNTER_CHECK_ISSUE_DEFS[i].label;
  }
  return packingCounterCheckStatusLabel(issue);
}

export function packingCounterCheckStatusLabel(status) {
  var ic = normalizeCounterCheckIssueCat(status);
  if (ic === "leftover") return "ยังไม่แพ็ค";
  if (ic === "notStarted") return "ยังไม่เริ่ม";
  if (ic === "partial") return "แพ็คบางส่วน";
  if (ic === "nearDone") return "ใกล้ครบ";
  if (ic === "unsaved") return "ยังไม่บันทึก";
  if (ic === "over") return "เกิน";
  if (ic === "missing") return "ไม่มีใน POS";
  if (ic === "done") return "ครบ";
  if (ic === "swapped") return "สลับ";
  if (status === "leftover") return "ยังไม่แพ็ค";
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
  "Group",
  "Issue",
  "Flags",
  "Brand",
  "SKU",
  "Barcode",
  "Description",
  "POS SOH",
  "Packed",
  "Left",
  "Over",
  "Swap",
  "PK nos",
];

var CTR_CHECK_SKU_TEXT_COLS = [5, 6]; // SKU, Barcode
var CTR_CHECK_SKU_COLS = [12, 10, 10, 22, 14, 14, 16, 40, 10, 10, 10, 10, 18, 28];

/** Status sheet order for Excel (full unfiltered lists). */
var CTR_CHECK_STATUS_SHEETS = [
  { key: "notStarted", name: "ยังไม่เริ่ม" },
  { key: "partial", name: "แพ็คบางส่วน" },
  { key: "nearDone", name: "ใกล้ครบ" },
  { key: "leftover", name: "ยังไม่แพ็ค" },
  { key: "over", name: "เกิน" },
  { key: "missing", name: "ไม่มีใน POS" },
  { key: "done", name: "ครบ" },
  { key: "swapped", name: "สลับ" },
  { key: "unsaved", name: "ยังไม่บันทึก" },
];

/**
 * Pure workbook payload for Counter check Excel export (no SheetJS).
 * Sheets: Summary, All SKUs (always full), By PK, optional per-status sheets
 * (always full), optional Filtered sheet for the active UI filter.
 *
 * Totals must reconcile: sum(All SKUs.Packed) == sum(By PK.Qty) == Summary Packed pcs.
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
 *   filter?: { query?: string, brand?: string, typeCat?: string, issueCat?: string },
 *   viewRows?: Array,
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
  var filter = opts.filter || null;
  var allRows = check.rows || [];
  var viewRows =
    opts.viewRows ||
    (filter ? filterCounterCheckRows(allRows, filter) : allRows.slice());
  var filterActive = false;
  if (filter) {
    var tc = String(filter.typeCat || "ALL").toUpperCase();
    var ic = String(filter.issueCat || "ALL").toLowerCase();
    if (tc && tc !== "ALL") filterActive = true;
    if (ic && ic !== "all") filterActive = true;
    if (filter.brand) filterActive = true;
    if (String(filter.query || filter.q || "").trim()) filterActive = true;
  }

  var pkSet = {};
  bundles.forEach(function (b) {
    var no = String((b && b.boxNo) || "").trim();
    if (no && no !== "__open__") pkSet[no] = 1;
  });
  allRows.forEach(function (r) {
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

  var filterNote = "";
  if (filterActive) {
    var bits = [];
    if (filter.typeCat && String(filter.typeCat).toUpperCase() !== "ALL")
      bits.push("Group=" + String(filter.typeCat).toUpperCase());
    if (filter.issueCat && String(filter.issueCat).toLowerCase() !== "all")
      bits.push("Issue=" + packingCounterCheckIssueLabel(filter.issueCat));
    if (filter.brand) bits.push("Brand=" + filter.brand);
    if (filter.query || filter.q) bits.push("Search=" + (filter.query || filter.q));
    filterNote = bits.length ? bits.join("; ") : "All";
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
    ["Swapped SKU", t.swappedSku || 0],
    ["All SKUs rows", allRows.length],
    ["Active filters", filterNote || "—"],
    ["Filtered SKU rows", filterActive ? viewRows.length : "—"],
  ];

  function skuRow(r) {
    var group = String(r.type || rowTypeBucket(r) || "").toUpperCase();
    if (group === "OTHER") group = "OTH";
    var issue = packingCounterCheckIssueLabel(r.status);
    if (r.swapped && String(r.status) !== "done") {
      issue = issue + " · สลับ";
    }
    return [
      packingCounterCheckStatusLabel(r.status),
      group,
      issue,
      counterCheckRowFlags(r).join(" · "),
      String(r.brand || ""),
      String(r.sku || ""),
      String(r.barcode || ""),
      String(r.desc || ""),
      Number(r.soh) || 0,
      Number(r.packed) || 0,
      Number(r.left) || 0,
      Number(r.over) || 0,
      String(r.swapNote || r.swapWith || ""),
      (r.boxNos || []).join(", "),
    ];
  }

  // Always full unfiltered set so Packed totals reconcile with By PK / Summary
  var allAoa = [CTR_CHECK_ALL_HEADERS.slice()].concat(allRows.map(skuRow));

  // SKU → All SKUs row (same matching key as packingCounterCheck)
  var bySku = {};
  allRows.forEach(function (r) {
    var k = String((r && r.sku) || "")
      .trim()
      .toUpperCase();
    if (k) bySku[k] = r;
  });

  var byPkAoa = [
    [
      "PK no",
      "Box",
      "SKU",
      "Barcode",
      "Description",
      "Brand",
      "Qty",
      "POS SOH",
      "Remaining SOH",
    ],
  ];
  var byPkPacked = 0;
  bundles.forEach(function (b) {
    var no = String((b && b.boxNo) || "").trim() || "(เปิดอยู่)";
    if (no === "__open__") no = "(เปิดอยู่)";
    (b.lines || []).forEach(function (l) {
      var qty = Number(l.qty) || 0;
      if (qty <= 0) return;
      byPkPacked += qty;
      var box =
        Math.round(Number(l.boxSeq != null ? l.boxSeq : l.box) || 1) || 1;
      var sku = String(l.sku || "")
        .trim()
        .toUpperCase();
      var info = bySku[sku];
      var posSoh = info ? Number(info.soh) || 0 : 0;
      var packedTotal = info ? Number(info.packed) || 0 : qty;
      // Same as All SKUs Left for leftover; negative when over / not in POS
      var remaining = posSoh - packedTotal;
      var notInPos = !info || info.status === "missing" || !(posSoh > 0);
      var posCell = notInPos ? "" : posSoh;
      var remCell = notInPos ? remaining + " · not in POS" : remaining;
      byPkAoa.push([
        no,
        box,
        sku,
        String(l.barcode || l.ean || ""),
        String(l.desc || ""),
        String(l.brand || ""),
        qty,
        posCell,
        remCell,
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
      textCols: CTR_CHECK_SKU_TEXT_COLS.slice(),
      freeze: true,
      autofilter: true,
      cols: CTR_CHECK_SKU_COLS.slice(),
    },
    {
      name: "By PK",
      aoa: byPkAoa,
      textCols: [2, 3],
      freeze: true,
      autofilter: true,
      cols: [16, 6, 14, 16, 40, 14, 8, 10, 16],
    },
  ];

  if (opts.includeStatusSheets) {
    CTR_CHECK_STATUS_SHEETS.forEach(function (s) {
      // Full unfiltered status lists — never apply the UI issue/group filter here
      var list =
        check[s.key] ||
        allRows.filter(function (r) {
          return counterCheckRowMatchesIssue(r, s.key);
        });
      sheets.push({
        name: s.name,
        aoa: [CTR_CHECK_ALL_HEADERS.slice()].concat(list.map(skuRow)),
        textCols: CTR_CHECK_SKU_TEXT_COLS.slice(),
        freeze: true,
        autofilter: true,
        cols: CTR_CHECK_SKU_COLS.slice(),
      });
    });
  }

  if (filterActive) {
    sheets.push({
      name: "Filtered",
      aoa: [CTR_CHECK_ALL_HEADERS.slice()].concat(viewRows.map(skuRow)),
      textCols: CTR_CHECK_SKU_TEXT_COLS.slice(),
      freeze: true,
      autofilter: true,
      cols: CTR_CHECK_SKU_COLS.slice(),
    });
  }

  return {
    fileName: fileName,
    shortName: short,
    stamp: stamp,
    pkNos: pkNos,
    byPkPacked: byPkPacked,
    allPacked: allRows.reduce(function (n, r) {
      return n + (Number(r.packed) || 0);
    }, 0),
    sheets: sheets,
  };
}

/**
 * Line identity key used in packing drafts (S:SKU or N:…).
 * Prefer server-provided `k` when present. N: keys match index.html `norm`
 * (trim + strip all whitespace) then uppercase — not trim-only.
 */
export function packingLineKey(line) {
  if (!line) return "";
  if (line.k) return String(line.k);
  var sku = String(line.sku || "")
    .trim()
    .toUpperCase();
  if (sku) return "S:" + sku;
  var raw = norm(line.ean || line.barcode || line.desc || "").toUpperCase();
  return raw ? "N:" + raw : "";
}

/**
 * Whether a poll/flush response may replace local packing lines.
 * Requires supportsDelta; rejects server rev older than local (slow GET after flush).
 */
export function packingShouldApplyServerBox(serverBox, localRev) {
  if (!serverBox || !serverBox.supportsDelta) return false;
  var srvRev = serverBox.rev;
  if (
    localRev != null &&
    localRev !== "" &&
    srvRev != null &&
    srvRev !== "" &&
    isFinite(Number(localRev)) &&
    isFinite(Number(srvRev)) &&
    Number(srvRev) < Number(localRev)
  ) {
    return false;
  }
  return true;
}

/**
 * Positive qty diffs (local − server) as seed delta partials (no opId).
 * Used when a boxNo is first assigned or on first contact with a delta-capable server
 * so in-progress draft lines are not wiped by an empty/partial server box.
 */
export function packingSeedDeltaPartials(localLines, serverLines) {
  function qtyByMapKey(lines) {
    var m = {};
    (lines || []).forEach(function (l) {
      if (!l) return;
      var mk = packingLineMapKey(l);
      if (!mk || mk.charAt(0) === "|") return;
      var q = Number(l.qty) || 0;
      if (q <= 0) return;
      m[mk] = (m[mk] || 0) + q;
    });
    return m;
  }
  function metaByMapKey(lines) {
    var m = {};
    (lines || []).forEach(function (l) {
      if (!l) return;
      var mk = packingLineMapKey(l);
      if (!mk || mk.charAt(0) === "|") return;
      if (!m[mk]) m[mk] = l;
    });
    return m;
  }
  var localQ = qtyByMapKey(localLines);
  var serverQ = qtyByMapKey(serverLines);
  var meta = metaByMapKey(localLines);
  var out = [];
  Object.keys(localQ).forEach(function (mk) {
    var diff = localQ[mk] - (serverQ[mk] || 0);
    if (!(diff > 0)) return;
    var l = meta[mk] || {};
    var lineKey = packingLineKey(l);
    if (!lineKey) {
      var pipe = mk.indexOf("|");
      lineKey = pipe >= 0 ? mk.slice(0, pipe) : mk;
    }
    var boxSeq = Math.round(Number(l.boxSeq != null ? l.boxSeq : l.box) || 1) || 1;
    out.push({
      lineKey: lineKey,
      k: lineKey,
      sku: String(l.sku || ""),
      ean: String(l.ean || l.barcode || ""),
      desc: String(l.desc || ""),
      brand: String(l.brand || ""),
      flag: String(l.flag || ""),
      boxSeq: boxSeq,
      deltaQty: diff,
    });
  });
  return out;
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

/** Default packing-list QR payload budget (bytes). */
export var PACK_QR_MAX = 2000;
/** Clip length for product name on QR lines (after brand strip). */
export var PACK_QR_DESC_CLIP = 28;

/** UTF-8 byte length (browser TextEncoder or encodeURIComponent fallback). */
export function utf8ByteLen(s) {
  s = String(s == null ? "" : s);
  try {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  } catch (e) {}
  try {
    return unescape(encodeURIComponent(s)).length;
  } catch (e2) {
    return s.length;
  }
}

/**
 * Strip brand from a packing-line description for compact QR text.
 * Prefer the line's brand field (multi-word brands stripped fully).
 * Without brand, strip the leading token (common "BRAND NAME …" shape).
 * Never returns empty when desc had content — falls back to original.
 */
export function stripBrandFromPackDesc(desc, brand) {
  var raw = String(desc || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  var b = String(brand || "").replace(/\s+/g, " ").trim();
  if (b) {
    var re = new RegExp("^" + escapeRegExp(b) + "(?:\\s+|$)", "i");
    var stripped = raw.replace(re, "").trim();
    return stripped || raw;
  }
  var m = raw.match(/^(\S+)\s+(.+)$/);
  if (m && m[2]) return m[2].trim() || raw;
  return raw;
}

/** Clip description to maxLen chars (default 28), ellipsis when truncated. */
export function clipPackQrDesc(s, maxLen) {
  var lim = maxLen == null ? PACK_QR_DESC_CLIP : Number(maxLen) || PACK_QR_DESC_CLIP;
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= lim) return s;
  if (lim <= 1) return "…";
  return s.slice(0, lim - 1).trim() + "…";
}

/** Line id for QR: SKU, else EAN when not-in-master / missing SKU. */
export function packQrLineId(line) {
  var l = line || {};
  var id = String(l.sku || "").trim();
  if (!id || l.flag === "NOT IN MASTER") {
    id = String(l.ean || l.barcode || id || "").trim() || "UNKNOWN";
  }
  return id;
}

/**
 * One body line for packing QR.
 * mode "desc" → `SKU xN clippedName`; mode "sku" → `SKU xN` only.
 */
export function formatPackQrLine(line, mode) {
  var id = packQrLineId(line);
  var qty = Number(line && line.qty) || 0;
  var base = id + " x" + qty;
  if (String(mode || "desc").toLowerCase() === "sku") return base;
  var name = clipPackQrDesc(stripBrandFromPackDesc(line && line.desc, line && line.brand));
  return name ? base + " " + name : base;
}

/**
 * Build packing-list QR plaintext.
 *
 * Strategy (uniform format within one QR — never mix desc/sku lines):
 * 1. Brand-stripped + 28-char clipped descriptions for every line.
 * 2. If over maxBytes → every line SKU+qty only.
 * 3. If still over → truncate with `...+N more`, then shorten To/From.
 *
 * @param {{
 *   boxNo?: string,
 *   boxSeq?: number,
 *   boxCount?: number,
 *   shipTo?: string,
 *   from?: string,
 *   refNo?: string,
 * }} meta
 * @param {Array<{sku?,ean?,barcode?,desc?,brand?,qty?,flag?}>} lines
 * @param {number} [maxBytes]
 * @param {(s:string)=>number} [utf8Len] byte-length fn (defaults to utf8ByteLen)
 * @returns {string}
 */
export function buildPackQrText(meta, lines, maxBytes, utf8Len) {
  meta = meta || {};
  var cap = maxBytes == null ? PACK_QR_MAX : Number(maxBytes) || PACK_QR_MAX;
  var len = typeof utf8Len === "function" ? utf8Len : utf8ByteLen;
  var items = (lines || []).filter(function (l) {
    return (Number(l && l.qty) || 0) > 0;
  });
  var skuCount = items.length;
  var pcs = items.reduce(function (n, l) {
    return n + (Number(l.qty) || 0);
  }, 0);
  var ref = String(meta.refNo || "")
    .replace(/\s+/g, " ")
    .trim();
  var boxNo = String(meta.boxNo || "").trim();
  var k = Math.round(Number(meta.boxSeq != null ? meta.boxSeq : meta.activeBox) || 1) || 1;
  var n = Math.round(Number(meta.boxCount != null ? meta.boxCount : 1) || 1) || 1;
  var first = boxNo ? boxNo + " BOX " + k + "/" + n : "";
  var ship = String(meta.shipTo || "")
    .replace(/\s+/g, " ")
    .trim();
  var from = String(meta.from || "")
    .replace(/\s+/g, " ")
    .trim();
  var foot = "Total " + skuCount + " SKU / " + pcs + " pcs";

  function headOf(sh, fr) {
    var h = [];
    if (first) h.push(first);
    h.push("To: " + sh);
    if (fr) h.push("From: " + fr);
    if (ref) h.push("Ref/GRF: " + ref);
    return h.join("\n") + "\n\n";
  }

  function bodyLines(mode) {
    return items.map(function (l) {
      return formatPackQrLine(l, mode);
    });
  }

  function build(body, take, sh, fr) {
    var more = body.length - take;
    var mid = body.slice(0, take);
    if (more > 0) mid.push("...+" + more + " more");
    return headOf(sh, fr) + (mid.length ? mid.join("\n") + "\n" : "") + foot;
  }

  function fitOrTruncate(body, sh0, fr0) {
    var sh = sh0;
    var fr = fr0;
    var text = build(body, body.length, sh, fr);
    if (len(text) <= cap) return text;
    var take = body.length;
    while (take > 0 && len(build(body, take, sh, fr)) > cap) take--;
    text = build(body, take, sh, fr);
    var orig = sh;
    var origF = fr;
    while (sh.length > 8 && len(text) > cap) {
      sh = sh.slice(0, Math.max(8, sh.length - 8)).trim();
      text = build(body, take, sh + (sh.length < orig.length ? "…" : ""), fr);
    }
    while (fr.length > 8 && len(text) > cap) {
      fr = fr.slice(0, Math.max(8, fr.length - 8)).trim();
      text = build(body, take, sh, fr + (fr.length < origF.length ? "…" : ""));
    }
    return text;
  }

  var descBody = bodyLines("desc");
  var withDesc = build(descBody, descBody.length, ship, from);
  if (len(withDesc) <= cap) return withDesc;

  var skuBody = bodyLines("sku");
  var withSku = build(skuBody, skuBody.length, ship, from);
  if (len(withSku) <= cap) return withSku;

  return fitOrTruncate(skuBody, ship, from);
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
    isClosedPlaceName: isClosedPlaceName,
    filterClosedPlaceNames: filterClosedPlaceNames,
    pickOpenPlaceSeed: pickOpenPlaceSeed,
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
    SHADE_ABBREV: SHADE_ABBREV,
    normalizeSearchText: normalizeSearchText,
    parseShadeAbbrevToken: parseShadeAbbrevToken,
    buildShadeMatchPlan: buildShadeMatchPlan,
    shadePhraseInHay: shadePhraseInHay,
    hayMatchesShadePlan: hayMatchesShadePlan,
    textMatchesQuery: textMatchesQuery,
    filterSohLeftover: filterSohLeftover,
    sohLeftoverTypeCounts: sohLeftoverTypeCounts,
    parseItemSize: parseItemSize,
    swapDescTokens: swapDescTokens,
    descsVerySimilar: descsVerySimilar,
    detectCounterCheckSwaps: detectCounterCheckSwaps,
    enrichCounterCheck: enrichCounterCheck,
    COUNTER_CHECK_ISSUE_DEFS: COUNTER_CHECK_ISSUE_DEFS,
    COUNTER_CHECK_TYPE_DEFS: COUNTER_CHECK_TYPE_DEFS,
    counterCheckRowStats: counterCheckRowStats,
    counterCheckRowFlags: counterCheckRowFlags,
    counterCheckRowMatchesIssue: counterCheckRowMatchesIssue,
    normalizeCounterCheckIssueCat: normalizeCounterCheckIssueCat,
    formatCounterCheckChipLines: formatCounterCheckChipLines,
    counterCheckTypeCounts: counterCheckTypeCounts,
    counterCheckIssueCounts: counterCheckIssueCounts,
    filterCounterCheckRows: filterCounterCheckRows,
    packingCounterCheckIssueLabel: packingCounterCheckIssueLabel,
    packingCounterCheck: packingCounterCheck,
    packingCounterCheckStatusLabel: packingCounterCheckStatusLabel,
    packingCounterCheckShortName: packingCounterCheckShortName,
    packingCounterCheckExportStamp: packingCounterCheckExportStamp,
    buildCounterCheckExcelData: buildCounterCheckExcelData,
    packingLineKey: packingLineKey,
    packingLineMapKey: packingLineMapKey,
    packingShouldApplyServerBox: packingShouldApplyServerBox,
    packingSeedDeltaPartials: packingSeedDeltaPartials,
    applyPackingOps: applyPackingOps,
    packingStaleVersion: packingStaleVersion,
    packingActivePeers: packingActivePeers,
    packingPeerBannerText: packingPeerBannerText,
    PACK_QR_MAX: PACK_QR_MAX,
    PACK_QR_DESC_CLIP: PACK_QR_DESC_CLIP,
    utf8ByteLen: utf8ByteLen,
    stripBrandFromPackDesc: stripBrandFromPackDesc,
    clipPackQrDesc: clipPackQrDesc,
    packQrLineId: packQrLineId,
    formatPackQrLine: formatPackQrLine,
    buildPackQrText: buildPackQrText,
    buildPackingDeltaOp: buildPackingDeltaOp,
    stripBarcodeRaw: stripBarcodeRaw,
    gtinChecksumOk: gtinChecksumOk,
    expandUpce: expandUpce,
    normalizeBarcode: normalizeBarcode,
    barcodeConsensusPush: barcodeConsensusPush,
    barcodeFormatsForMode: barcodeFormatsForMode,
  };
}
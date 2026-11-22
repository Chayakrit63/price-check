/**
 * PosSOH addon for ITEM MASTER Apps Script (paste into the existing project).
 *
 * This file is NOT deployed from the repo. Copy the functions below into your
 * Apps Script editor, then wire doGet / doPost as documented.
 *
 * Assumes existing helpers in the live project:
 *   - ensureTab_(name, headers)  → returns Sheet, creates tab + header row if missing
 *   - out_(obj)                  → ContentService JSON (and JSONP if callback present)
 *   - SpreadsheetApp.getActive()
 *
 * ========== Paste into doGet (alongside other api= branches) ==========
 *
 *   if (api === 'possoh') {
 *     return out_(getPosSoh(String(e.parameter.counter || '')));
 *   }
 *   if (api === 'possohlist') {
 *     return out_(listPosSoh());
 *   }
 *
 * ========== Paste into doPost (JSON text/plain body, like packing) ==========
 *
 *   // after parsing body = JSON.parse(e.postData.contents)
 *   if (body.action === 'replacepossoh') {
 *     return out_(replacePosSoh(body));
 *   }
 *   if (body.action === 'deletepossoh') {
 *     return out_(deletePosSoh(String(body.counter || '')));
 *   }
 *
 * Tab PosSOH headers:
 *   CounterName | SKU | Barcode | Desc | Qty | AsOf | SourceFile | ImportedAt
 *   (SKU and Barcode columns formatted as text '@')
 */

var POS_SOH_TAB = 'PosSOH';
var POS_SOH_HEADERS = [
  'CounterName',
  'SKU',
  'Barcode',
  'Desc',
  'Qty',
  'AsOf',
  'SourceFile',
  'ImportedAt',
];

function posSohSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ensureTab_(POS_SOH_TAB, POS_SOH_HEADERS);
  // Force SKU / Barcode as text so leading zeros / codes stay intact.
  try {
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('C:C').setNumberFormat('@');
  } catch (e) {}
  return sh;
}

function posSohLock_() {
  return LockService.getScriptLock();
}

/**
 * Replace all PosSOH rows for one counter.
 * body: { counter, asOf, sourceFile, rows: [{sku,barcode,desc,qty}] }
 */
function replacePosSoh(body) {
  body = body || {};
  var counter = String(body.counter || '').trim();
  if (!counter) return { ok: false, error: 'counter required' };
  var rows = Array.isArray(body.rows) ? body.rows : [];
  var asOf = String(body.asOf || '').trim();
  var sourceFile = String(body.sourceFile || '').trim();
  var importedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');

  var lock = posSohLock_();
  lock.waitLock(30000);
  try {
    var sh = posSohSheet_();
    var last = sh.getLastRow();
    var nCols = POS_SOH_HEADERS.length;
    if (last > 1) {
      var vals = sh.getRange(2, 1, last, nCols).getValues();
      var keep = [];
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || '').trim().toLowerCase() !== counter.toLowerCase()) {
          keep.push(vals[i]);
        }
      }
      sh.getRange(2, 1, last, nCols).clearContent();
      if (keep.length) {
        sh.getRange(2, 1, 1 + keep.length, nCols).setValues(keep);
      }
    }
    var out = [];
    var pcs = 0;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j] || {};
      var sku = String(r.sku == null ? '' : r.sku).replace(/^['\u2018\u2019]+/, '').trim();
      if (!sku) continue;
      var qty = Number(r.qty);
      if (!isFinite(qty) || qty === 0) continue;
      pcs += qty;
      out.push([
        counter,
        sku,
        String(r.barcode == null ? '' : r.barcode).replace(/^['\u2018\u2019]+/, '').trim(),
        String(r.desc == null ? '' : r.desc).trim(),
        qty,
        asOf,
        sourceFile,
        importedAt,
      ]);
    }
    if (out.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, start + out.length - 1, nCols).setValues(out);
      sh.getRange(start, 2, start + out.length - 1, 2).setNumberFormat('@');
      sh.getRange(start, 3, start + out.length - 1, 3).setNumberFormat('@');
    }
    return {
      ok: true,
      counter: counter,
      asOf: asOf,
      skuCount: out.length,
      pcs: pcs,
      importedAt: importedAt,
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (e2) {}
  }
}

/** All SOH rows for one counter (qty already non-zero if imported correctly). */
function getPosSoh(counter) {
  counter = String(counter || '').trim();
  if (!counter) return { ok: false, error: 'counter required', rows: [] };
  var sh = posSohSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, counter: counter, asOf: '', rows: [], skuCount: 0, pcs: 0 };
  var vals = sh.getRange(2, 1, last, POS_SOH_HEADERS.length).getDisplayValues();
  var rows = [];
  var asOf = '';
  var pcs = 0;
  var key = counter.toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toLowerCase() !== key) continue;
    var sku = String(vals[i][1] || '').trim();
    var qty = Number(String(vals[i][4] || '').replace(/,/g, ''));
    if (!sku || !isFinite(qty) || qty === 0) continue;
    if (!asOf) asOf = String(vals[i][5] || '').trim();
    pcs += qty;
    rows.push({
      sku: sku,
      barcode: String(vals[i][2] || '').trim(),
      desc: String(vals[i][3] || '').trim(),
      qty: qty,
    });
  }
  return {
    ok: true,
    counter: counter,
    asOf: asOf,
    rows: rows,
    skuCount: rows.length,
    pcs: pcs,
  };
}

/** Summary per counter currently stored. */
function listPosSoh() {
  var sh = posSohSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, counters: [] };
  var vals = sh.getRange(2, 1, last, POS_SOH_HEADERS.length).getDisplayValues();
  var by = {};
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][0] || '').trim();
    if (!name) continue;
    var sku = String(vals[i][1] || '').trim();
    var qty = Number(String(vals[i][4] || '').replace(/,/g, ''));
    if (!sku || !isFinite(qty) || qty === 0) continue;
    var k = name.toLowerCase();
    if (!by[k]) {
      by[k] = {
        counter: name,
        asOf: String(vals[i][5] || '').trim(),
        skuCount: 0,
        pcs: 0,
      };
    }
    by[k].skuCount++;
    by[k].pcs += qty;
    if (!by[k].asOf) by[k].asOf = String(vals[i][5] || '').trim();
  }
  var counters = Object.keys(by)
    .map(function (k) {
      return by[k];
    })
    .sort(function (a, b) {
      return String(a.counter).localeCompare(String(b.counter));
    });
  return { ok: true, counters: counters };
}

/** Delete all PosSOH rows for one counter. */
function deletePosSoh(counter) {
  counter = String(counter || '').trim();
  if (!counter) return { ok: false, error: 'counter required' };
  var lock = posSohLock_();
  lock.waitLock(30000);
  try {
    var sh = posSohSheet_();
    var last = sh.getLastRow();
    var nCols = POS_SOH_HEADERS.length;
    if (last < 2) return { ok: true, counter: counter, deleted: 0 };
    var vals = sh.getRange(2, 1, last, nCols).getValues();
    var keep = [];
    var deleted = 0;
    var key = counter.toLowerCase();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim().toLowerCase() === key) {
        deleted++;
      } else {
        keep.push(vals[i]);
      }
    }
    sh.getRange(2, 1, last, nCols).clearContent();
    if (keep.length) {
      sh.getRange(2, 1, 1 + keep.length, nCols).setValues(keep);
    }
    return { ok: true, counter: counter, deleted: deleted };
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

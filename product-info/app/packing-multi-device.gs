/**
 * Multi-device packing + light counter packed totals (paste into ITEM MASTER Apps Script).
 *
 * NOT auto-deployed from the repo. Paste into the existing Apps Script project that
 * serves the current /exec URL (keep the same deployment — no new URL required).
 *
 * =====================================================================
 * DEPLOY STEPS (manual)
 * =====================================================================
 * 1. Open the Apps Script project linked to the ITEM MASTER spreadsheet.
 * 2. Add a new script file `packing-multi-device.gs` and paste this whole file
 *    (or merge into Code.gs — avoid duplicate function names).
 * 3. Wire doGet / doPost as below (alongside existing branches).
 * 4. Deploy → Manage deployments → Edit the EXISTING web app deployment
 *    → New version → Deploy. Keep the same /exec URL.
 * 5. Smoke: GET ?api=packtotals&counter=<name> should return {ok:true, skuQty:{…}}.
 *    POST {action:"appendpackops", boxNo, deviceId, ops:[…]} should return {ok:true, rev}.
 *
 * Assumes existing helpers in the live project:
 *   - ensureTab_(name, headers)
 *   - out_(obj)
 *   - getBox / saveBox / boxes sheet accessors if named differently — adapt
 *     packGetBoxRow_ / packWriteLines_ to your sheet layout (documented below).
 *
 * ========== doGet ==========
 *   if (api === 'packtotals') {
 *     return out_(getPackTotals(String(e.parameter.counter || e.parameter.q || ''), {
 *       exclude: String(e.parameter.exclude || ''),
 *     }));
 *   }
 *   // When returning a single box (api=box), attach rev + peers:
 *   //   var box = …existing…;
 *   //   return out_(enrichBoxMultiDevice_(box));
 *
 * ========== doPost ==========
 *   if (body.action === 'appendpackops') {
 *     return out_(appendPackOps(body));
 *   }
 *   if (body.action === 'packpresence') {
 *     return out_(packPresence(body));
 *   }
 *   // Wrap existing savebox:
 *   //   if (body.action === 'savebox') {
 *   //     return out_(saveBoxWithRev_(body));
 *   //   }
 *
 * Sheet PackOps headers:
 *   BoxNo | OpId | DeviceId | ClientTs | ServerTs | LineKey | SKU | EAN |
 *   Desc | Brand | Flag | BoxSeq | DeltaQty
 *
 * Sheet PackPresence headers:
 *   BoxNo | DeviceId | LastSeen | Label
 *
 * Boxes sheet: add column Rev (number, default 0) if missing — see packEnsureRevCol_.
 * Lines sheet: optional LastDevice | LastOpAt columns for export audit.
 */

var PACK_OPS_TAB = 'PackOps';
var PACK_OPS_HEADERS = [
  'BoxNo',
  'OpId',
  'DeviceId',
  'ClientTs',
  'ServerTs',
  'LineKey',
  'SKU',
  'EAN',
  'Desc',
  'Brand',
  'Flag',
  'BoxSeq',
  'DeltaQty',
];
var PACK_PRESENCE_TAB = 'PackPresence';
var PACK_PRESENCE_HEADERS = ['BoxNo', 'DeviceId', 'LastSeen', 'Label'];

function packOpsSheet_() {
  var sh = ensureTab_(PACK_OPS_TAB, PACK_OPS_HEADERS);
  try {
    sh.getRange('G:H').setNumberFormat('@'); // SKU / EAN text
  } catch (e) {}
  return sh;
}

function packPresenceSheet_() {
  return ensureTab_(PACK_PRESENCE_TAB, PACK_PRESENCE_HEADERS);
}

function packLock_() {
  return LockService.getScriptLock();
}

function packNowMs_() {
  return Date.now();
}

function packServerTs_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Asia/Bangkok',
    'yyyy-MM-dd HH:mm:ss'
  );
}

/**
 * Light per-counter SKU totals from the Lines sheet (no full export).
 * exclude: boxNo whose lines are omitted (open draft supplies those on the client).
 *
 * ADAPT: packListLineRowsForCounter_ must read your Lines tab.
 */
function getPackTotals(counter, opts) {
  opts = opts || {};
  counter = String(counter || '').trim();
  if (!counter) return { ok: false, error: 'counter required', skuQty: {}, pkCount: 0 };
  var exclude = String(opts.exclude || '').trim().toUpperCase();
  var meta = packListLineRowsForCounter_(counter, exclude);
  return {
    ok: true,
    counter: counter,
    exclude: exclude || '',
    skuQty: meta.skuQty,
    pkCount: meta.pkCount,
    pkNos: meta.pkNos,
    supportsDelta: true,
  };
}

/**
 * Read Lines (+ Boxes for From/Status filter).
 * Expected Boxes cols include BoxNo, From, Status.
 * Expected Lines cols include BoxNo, SKU, Qty (and optionally Box/BoxSeq).
 *
 * *** Adapt sheet/column indexes to the live workbook. ***
 */
function packListLineRowsForCounter_(counter, excludeBoxNo) {
  var ss = SpreadsheetApp.getActive();
  var boxesSh = ss.getSheetByName('Boxes') || ss.getSheetByName('PackBoxes');
  var linesSh = ss.getSheetByName('Lines') || ss.getSheetByName('PackLines');
  var skuQty = {};
  var pkNos = [];
  if (!boxesSh || !linesSh) {
    return { skuQty: skuQty, pkCount: 0, pkNos: pkNos };
  }
  var bLast = boxesSh.getLastRow();
  var lLast = linesSh.getLastRow();
  if (bLast < 2 || lLast < 2) return { skuQty: skuQty, pkCount: 0, pkNos: pkNos };

  var bHeaders = boxesSh.getRange(1, 1, 1, boxesSh.getLastColumn()).getDisplayValues()[0];
  var lHeaders = linesSh.getRange(1, 1, 1, linesSh.getLastColumn()).getDisplayValues()[0];
  function idx(headers, names) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').trim().toLowerCase();
      for (var j = 0; j < names.length; j++) {
        if (h === names[j]) return i;
      }
    }
    return -1;
  }
  var bNo = idx(bHeaders, ['boxno', 'box no', 'pk']);
  var bFrom = idx(bHeaders, ['from']);
  var bStatus = idx(bHeaders, ['status']);
  var lNo = idx(lHeaders, ['boxno', 'box no', 'pk']);
  var lSku = idx(lHeaders, ['sku']);
  var lQty = idx(lHeaders, ['qty', 'quantity']);
  if (bNo < 0 || bFrom < 0 || lNo < 0 || lSku < 0 || lQty < 0) {
    return { skuQty: skuQty, pkCount: 0, pkNos: pkNos, error: 'column map failed' };
  }

  var key = counter.toLowerCase();
  var include = {};
  var bVals = boxesSh.getRange(2, 1, bLast - 1, boxesSh.getLastColumn()).getDisplayValues();
  for (var i = 0; i < bVals.length; i++) {
    var no = String(bVals[i][bNo] || '').trim().toUpperCase();
    if (!no) continue;
    if (excludeBoxNo && no === excludeBoxNo) continue;
    var st = String(bStatus >= 0 ? bVals[i][bStatus] : '').trim();
    if (st === 'Cancelled' || st === 'Deleted') continue;
    if (String(bVals[i][bFrom] || '').trim().toLowerCase() !== key) continue;
    include[no] = 1;
    pkNos.push(no);
  }

  var lVals = linesSh.getRange(2, 1, lLast - 1, linesSh.getLastColumn()).getDisplayValues();
  for (var j = 0; j < lVals.length; j++) {
    var boxNo = String(lVals[j][lNo] || '').trim().toUpperCase();
    if (!include[boxNo]) continue;
    var sku = String(lVals[j][lSku] || '').trim().toUpperCase();
    var qty = Number(String(lVals[j][lQty] || '').replace(/,/g, ''));
    if (!sku || !isFinite(qty) || qty === 0) continue;
    skuQty[sku] = (skuQty[sku] || 0) + qty;
  }
  return { skuQty: skuQty, pkCount: pkNos.length, pkNos: pkNos };
}

/** Append idempotent packing deltas; rebuild line qtys under lock. */
function appendPackOps(body) {
  body = body || {};
  var boxNo = String(body.boxNo || '').trim().toUpperCase();
  var deviceId = String(body.deviceId || '').trim();
  var ops = Array.isArray(body.ops) ? body.ops : [];
  if (!boxNo) return { ok: false, error: 'boxNo required' };
  if (!ops.length) {
    packTouchPresence_(boxNo, deviceId, body.label);
    return enrichBoxMultiDevice_(packLoadBoxSafe_(boxNo));
  }

  var lock = packLock_();
  lock.waitLock(30000);
  try {
    var sh = packOpsSheet_();
    var last = sh.getLastRow();
    var seen = {};
    if (last >= 2) {
      var existing = sh.getRange(2, 1, last - 1, 2).getDisplayValues();
      for (var i = 0; i < existing.length; i++) {
        if (String(existing[i][0] || '').trim().toUpperCase() !== boxNo) continue;
        var id = String(existing[i][1] || '').trim();
        if (id) seen[id] = 1;
      }
    }

    var toWrite = [];
    var applied = [];
    var skipped = [];
    var serverTs = packServerTs_();
    for (var j = 0; j < ops.length; j++) {
      var op = ops[j] || {};
      var opId = String(op.opId || '').trim();
      if (!opId) continue;
      if (seen[opId]) {
        skipped.push(opId);
        continue;
      }
      seen[opId] = 1;
      var delta = Number(op.deltaQty);
      if (!isFinite(delta) || delta === 0) continue;
      var lineKey = String(op.lineKey || '').trim();
      var sku = String(op.sku || '').trim();
      if (!lineKey) {
        lineKey = sku ? 'S:' + sku.toUpperCase() : 'N:' + String(op.ean || op.desc || '').trim().toUpperCase();
      }
      toWrite.push([
        boxNo,
        opId,
        String(op.deviceId || deviceId || ''),
        Number(op.clientTs) || packNowMs_(),
        serverTs,
        lineKey,
        sku,
        String(op.ean || ''),
        String(op.desc || ''),
        String(op.brand || ''),
        String(op.flag || ''),
        Math.round(Number(op.boxSeq) || 1) || 1,
        delta,
      ]);
      applied.push(opId);
    }

    if (toWrite.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, toWrite.length, PACK_OPS_HEADERS.length).setValues(toWrite);
      packApplyOpsToLines_(boxNo, toWrite);
      packBumpRev_(boxNo, deviceId);
    }
    packTouchPresence_(boxNo, deviceId, body.label);
    var box = packLoadBoxSafe_(boxNo);
    var out = enrichBoxMultiDevice_(box);
    out.ok = true;
    out.applied = applied;
    out.skippedDup = skipped;
    out.supportsDelta = true;
    return out;
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function packPresence(body) {
  body = body || {};
  var boxNo = String(body.boxNo || '').trim().toUpperCase();
  var deviceId = String(body.deviceId || '').trim();
  if (!boxNo || !deviceId) return { ok: false, error: 'boxNo and deviceId required' };
  packTouchPresence_(boxNo, deviceId, body.label);
  return enrichBoxMultiDevice_(packLoadBoxSafe_(boxNo));
}

function packTouchPresence_(boxNo, deviceId, label) {
  if (!boxNo || !deviceId) return;
  var sh = packPresenceSheet_();
  var last = sh.getLastRow();
  var now = packNowMs_();
  var lab = String(label || '').trim();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, PACK_PRESENCE_HEADERS.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (
        String(vals[i][0] || '').trim().toUpperCase() === boxNo &&
        String(vals[i][1] || '').trim() === deviceId
      ) {
        sh.getRange(i + 2, 3, 1, 2).setValues([[now, lab || vals[i][3] || '']]);
        return;
      }
    }
  }
  sh.appendRow([boxNo, deviceId, now, lab]);
}

function packListPeers_(boxNo, windowMs) {
  windowMs = windowMs || 30000;
  var sh = packPresenceSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var now = packNowMs_();
  var vals = sh.getRange(2, 1, last - 1, PACK_PRESENCE_HEADERS.length).getValues();
  var out = [];
  var key = String(boxNo || '').trim().toUpperCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toUpperCase() !== key) continue;
    var seen = Number(vals[i][2]) || 0;
    if (now - seen > windowMs) continue;
    out.push({
      deviceId: String(vals[i][1] || ''),
      lastSeen: seen,
      label: String(vals[i][3] || ''),
    });
  }
  return out;
}

/**
 * Apply newly written PackOps rows to the Lines sheet (delta on current qtys).
 * ADAPT column mapping to your Lines tab.
 */
function packApplyOpsToLines_(boxNo, opRows) {
  // Best-effort: if a project-specific applyLinesDelta_ exists, use it.
  if (typeof applyLinesDelta_ === 'function') {
    applyLinesDelta_(boxNo, opRows);
    return;
  }
  // Fallback no-op with note — live project should implement applyLinesDelta_
  // or map Lines columns here similarly to packListLineRowsForCounter_.
  Logger.log('packApplyOpsToLines_: implement Lines update for ' + boxNo + ' ops=' + opRows.length);
}

function packBumpRev_(boxNo, deviceId) {
  if (typeof bumpBoxRev_ === 'function') {
    return bumpBoxRev_(boxNo, deviceId);
  }
  // Optional: store rev in a PackRev tab
  var sh = ensureTab_('PackRev', ['BoxNo', 'Rev', 'LastDeviceId', 'UpdatedAt']);
  var last = sh.getLastRow();
  var key = String(boxNo || '').trim().toUpperCase();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 4).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim().toUpperCase() === key) {
        var rev = (Number(vals[i][1]) || 0) + 1;
        sh.getRange(i + 2, 2, 1, 3).setValues([[rev, deviceId || '', packServerTs_()]]);
        return rev;
      }
    }
  }
  sh.appendRow([key, 1, deviceId || '', packServerTs_()]);
  return 1;
}

function packGetRev_(boxNo) {
  if (typeof getBoxRev_ === 'function') return Number(getBoxRev_(boxNo)) || 0;
  var sh = SpreadsheetApp.getActive().getSheetByName('PackRev');
  if (!sh || sh.getLastRow() < 2) return 0;
  var key = String(boxNo || '').trim().toUpperCase();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toUpperCase() === key) return Number(vals[i][1]) || 0;
  }
  return 0;
}

function packLoadBoxSafe_(boxNo) {
  if (typeof getBox === 'function') {
    try {
      var r = getBox(boxNo);
      if (r && r.box) return r.box;
      if (r && r.boxNo) return r;
    } catch (e) {}
  }
  return { boxNo: boxNo, items: [], lines: [], status: '' };
}

function enrichBoxMultiDevice_(box) {
  box = box || {};
  var no = String(box.boxNo || '').trim().toUpperCase();
  box.rev = packGetRev_(no);
  box.peers = packListPeers_(no, 30000);
  box.supportsDelta = true;
  return { ok: true, box: box, rev: box.rev, peers: box.peers, supportsDelta: true };
}

/**
 * Drop-in wrapper for existing saveBox: reject stale expectedRev.
 * Call from doPost instead of bare saveBox when body.expectedRev is set.
 */
function saveBoxWithRev_(body) {
  body = body || {};
  var box = body.box || body;
  var boxNo = String((box && box.boxNo) || body.boxNo || '').trim().toUpperCase();
  var expected = body.expectedRev;
  if (expected != null && expected !== '' && boxNo) {
    var cur = packGetRev_(boxNo);
    if (Number(expected) !== Number(cur)) {
      var latest = enrichBoxMultiDevice_(packLoadBoxSafe_(boxNo));
      latest.ok = false;
      latest.error = 'STALE_VERSION';
      return latest;
    }
  }
  if (typeof saveBox === 'function') {
    var saved = saveBox(body);
    if (boxNo) packBumpRev_(boxNo, body.deviceId || (box && box.clientId) || '');
    if (saved && saved.box) {
      var enriched = enrichBoxMultiDevice_(saved.box);
      saved.box = enriched.box;
      saved.rev = enriched.rev;
      saved.supportsDelta = true;
    }
    return saved;
  }
  return { ok: false, error: 'saveBox missing — wire saveBoxWithRev_ to your saveBox' };
}

/**
 * Pure barcode normalize / checksum / consensus helpers (Node-testable).
 * Used by cam-scan.mjs and unit tests. Keep in sync with any CamScan wrappers.
 */

/** Strip whitespace / ticks; keep digits+letters for Code128. */
export function stripBarcodeRaw(text) {
  return String(text || "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\s+/g, "");
}

/** GTIN/EAN check digit (mod-10). digits = string of all digits including check. */
export function gtinChecksumOk(digits) {
  var s = String(digits || "");
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s)) return false;
  var body = s.slice(0, -1);
  var check = Number(s.slice(-1));
  var sum = 0;
  // From the right: weight 3,1,3,1…
  for (var i = 0; i < body.length; i++) {
    var n = Number(body.charAt(body.length - 1 - i));
    sum += i % 2 === 0 ? n * 3 : n;
  }
  var expect = (10 - (sum % 10)) % 10;
  return expect === check;
}

/**
 * UPC-E expand to UPC-A (12 digits) when possible.
 * @returns {string|null}
 */
export function expandUpce(upce) {
  var s = String(upce || "");
  if (!/^\d{8}$/.test(s)) return null;
  // standard UPC-E: NABCDEXX where last is check, first is number system 0/1
  var ns = s.charAt(0);
  var body = s.slice(1, 7);
  var check = s.charAt(7);
  var d = body.split("");
  var upca;
  switch (d[5]) {
    case "0":
    case "1":
    case "2":
      upca = ns + d[0] + d[1] + d[5] + "0000" + d[2] + d[3] + d[4] + check;
      break;
    case "3":
      upca = ns + d[0] + d[1] + d[2] + "00000" + d[3] + d[4] + check;
      break;
    case "4":
      upca = ns + d[0] + d[1] + d[2] + d[3] + "00000" + d[4] + check;
      break;
    default:
      upca = ns + d[0] + d[1] + d[2] + d[3] + d[4] + "0000" + d[5] + check;
      break;
  }
  return /^\d{12}$/.test(upca) ? upca : null;
}

/**
 * Normalize a retail barcode:
 * - strip noise
 * - UPC-E → UPC-A when valid
 * - UPC-A (12) → EAN-13 with leading 0
 * - validate EAN-8 / EAN-13 / UPC-A checksum when applicable
 * @returns {{ ok:boolean, text:string, kind:string, reason?:string }}
 */
export function normalizeBarcode(raw) {
  var text = stripBarcodeRaw(raw);
  if (!text) return { ok: false, text: "", kind: "empty", reason: "empty" };

  // Prefer digit-only retail codes
  if (/^\d+$/.test(text)) {
    if (text.length === 8) {
      // Could be EAN-8 or UPC-E
      if (gtinChecksumOk(text)) {
        // UPC-E number system is 0/1 — don't rewrite ordinary EAN-8
        if (text.charAt(0) === "0" || text.charAt(0) === "1") {
          var asUpce = expandUpce(text);
          if (asUpce && gtinChecksumOk(asUpce)) {
            var e13fromE = "0" + asUpce;
            if (gtinChecksumOk(e13fromE)) {
              return { ok: true, text: e13fromE, kind: "upce" };
            }
            return { ok: true, text: asUpce, kind: "upce-upca" };
          }
        }
        return { ok: true, text: text, kind: "ean8" };
      }
      return { ok: false, text: text, kind: "ean8", reason: "checksum" };
    }
    if (text.length === 12) {
      if (!gtinChecksumOk(text)) {
        return { ok: false, text: text, kind: "upca", reason: "checksum" };
      }
      var e13 = "0" + text;
      if (gtinChecksumOk(e13)) return { ok: true, text: e13, kind: "upca" };
      return { ok: true, text: text, kind: "upca-raw" };
    }
    if (text.length === 13) {
      if (!gtinChecksumOk(text)) {
        return { ok: false, text: text, kind: "ean13", reason: "checksum" };
      }
      return { ok: true, text: text, kind: "ean13" };
    }
    if (text.length === 14) {
      if (!gtinChecksumOk(text)) {
        return { ok: false, text: text, kind: "gtin14", reason: "checksum" };
      }
      return { ok: true, text: text, kind: "gtin14" };
    }
    // Other pure-digit lengths: reject short junk; allow Code128-like numeric SKUs ≥4
    if (text.length < 4) {
      return { ok: false, text: text, kind: "short", reason: "short" };
    }
    if (text.length < 8) {
      return { ok: false, text: text, kind: "partial", reason: "partial" };
    }
    return { ok: true, text: text, kind: "numeric" };
  }

  // Alphanumeric (Code128 / QR payload): require reasonable length
  if (text.length < 3) {
    return { ok: false, text: text, kind: "short", reason: "short" };
  }
  return { ok: true, text: text, kind: "code128" };
}

/**
 * Sliding consensus: require `need` identical normalized texts within windowMs.
 * @returns {{ accept:boolean, text:string, hits:number, reset?:boolean }}
 */
export function barcodeConsensusPush(state, raw, opts) {
  opts = opts || {};
  var need = Math.max(1, Number(opts.need) || 2);
  var windowMs = Number(opts.windowMs) || 450;
  var now = opts.now != null ? Number(opts.now) : Date.now();
  var norm = normalizeBarcode(raw);
  if (!norm.ok) {
    return { accept: false, text: "", hits: 0, rejected: norm.reason || "invalid" };
  }
  var text = norm.text;
  state = state || { text: "", times: [] };
  if (state.text !== text) {
    state.text = text;
    state.times = [now];
  } else {
    state.times = (state.times || []).filter(function (t) {
      return now - t <= windowMs;
    });
    state.times.push(now);
  }
  var hits = state.times.length;
  return {
    accept: hits >= need,
    text: text,
    hits: hits,
    kind: norm.kind,
    state: state,
  };
}

/** Format profile names → logical format keys (mapped by cam-scan to Html5 / native). */
export function barcodeFormatsForMode(mode) {
  var m = String(mode || "retail").toLowerCase();
  if (m === "pack" || m === "all") {
    return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code", "data_matrix"];
  }
  // price / info / count / retail / oneshot: product barcodes
  return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
}

export var CAM_BARCODE = {
  stripBarcodeRaw: stripBarcodeRaw,
  gtinChecksumOk: gtinChecksumOk,
  expandUpce: expandUpce,
  normalizeBarcode: normalizeBarcode,
  barcodeConsensusPush: barcodeConsensusPush,
  barcodeFormatsForMode: barcodeFormatsForMode,
};

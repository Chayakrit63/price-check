import test from "node:test";
import assert from "node:assert/strict";
import {
  gtinChecksumOk,
  expandUpce,
  normalizeBarcode,
  barcodeConsensusPush,
  barcodeFormatsForMode,
  stripBarcodeRaw,
} from "../lib/cam-barcode.mjs";

test("gtinChecksumOk EAN-13 / EAN-8 / UPC-A", () => {
  assert.equal(gtinChecksumOk("3360374507206"), true); // Prestige sample
  assert.equal(gtinChecksumOk("4006381333931"), true);
  assert.equal(gtinChecksumOk("12345670"), true); // EAN-8
  assert.equal(gtinChecksumOk("042100005264"), true); // UPC-A
  assert.equal(gtinChecksumOk("3360374507207"), false); // bad check
  assert.equal(gtinChecksumOk("123"), false);
  assert.equal(gtinChecksumOk(""), false);
});

test("normalizeBarcode: UPC-A → EAN-13, strip spaces, reject bad checksum", () => {
  assert.equal(stripBarcodeRaw(" 3360 3745 07206 "), "3360374507206");
  var ean = normalizeBarcode("3360374507206");
  assert.equal(ean.ok, true);
  assert.equal(ean.text, "3360374507206");
  assert.equal(ean.kind, "ean13");

  var upca = normalizeBarcode("042100005264");
  assert.equal(upca.ok, true);
  assert.equal(upca.text, "0042100005264"); // leading 0
  assert.equal(upca.kind, "upca");

  var spaced = normalizeBarcode(" 3360 3745 07206 ");
  assert.equal(spaced.ok, true);
  assert.equal(spaced.text, "3360374507206");

  var bad = normalizeBarcode("3360374507207");
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "checksum");

  var short = normalizeBarcode("12345");
  assert.equal(short.ok, false);
  assert.match(short.reason, /partial|short/);

  var code128 = normalizeBarcode("PK-261122-007");
  assert.equal(code128.ok, true);
  assert.equal(code128.kind, "code128");
});

test("expandUpce + normalize UPC-E (number system 0/1 only)", () => {
  // Classic example: 01234565 → UPC-A 012000003465 (then EAN-13)
  var upce = "01234565";
  assert.equal(gtinChecksumOk(upce), true);
  var expanded = expandUpce(upce);
  assert.ok(expanded);
  assert.equal(expanded.length, 12);
  assert.equal(gtinChecksumOk(expanded), true);
  var n = normalizeBarcode(upce);
  assert.equal(n.ok, true);
  assert.ok(n.kind === "upce" || n.kind === "upce-upca" || n.kind === "ean8");
});

test("barcodeConsensusPush: need 2 matching reads in window", () => {
  var st = { text: "", times: [] };
  var t0 = 1_000_000;
  var a = barcodeConsensusPush(st, "3360374507206", { need: 2, windowMs: 400, now: t0 });
  assert.equal(a.accept, false);
  assert.equal(a.hits, 1);
  st = a.state;
  var b = barcodeConsensusPush(st, "3360374507206", { need: 2, windowMs: 400, now: t0 + 100 });
  assert.equal(b.accept, true);
  assert.equal(b.text, "3360374507206");
  assert.equal(b.hits, 2);

  // Different code resets
  st = b.state;
  var c = barcodeConsensusPush(st, "4006381333931", { need: 2, windowMs: 400, now: t0 + 150 });
  assert.equal(c.accept, false);
  assert.equal(c.hits, 1);

  // Bad checksum never accepts
  var bad = barcodeConsensusPush({ text: "", times: [] }, "3360374507207", {
    need: 1,
    now: t0,
  });
  assert.equal(bad.accept, false);
  assert.equal(bad.rejected, "checksum");

  // Native path can use need:1
  var one = barcodeConsensusPush({ text: "", times: [] }, "3360374507206", {
    need: 1,
    now: t0,
  });
  assert.equal(one.accept, true);
});

test("barcodeFormatsForMode: retail vs pack", () => {
  assert.deepEqual(barcodeFormatsForMode("oneshot"), [
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
  ]);
  assert.deepEqual(barcodeFormatsForMode("info"), barcodeFormatsForMode("retail"));
  assert.ok(barcodeFormatsForMode("pack").includes("qr_code"));
  assert.ok(!barcodeFormatsForMode("count").includes("qr_code"));
});

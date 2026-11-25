import test from "node:test";
import assert from "node:assert/strict";
import {
  VERSION,
  itemTypeBucket,
  rowTypeBucket,
  parseSearchQty,
  searchQueryOnly,
  searchCatalog,
  editDistance,
  filterRowsByType,
  counterNamesDeduped,
  mergePinnedPlaceNames,
  stripPlaceListLabel,
  packingLookupAction,
  sortPackingLinesForDisplay,
  packingIsBigQty,
  packingTypeSummary,
  packingBigQtyLines,
  sortPickRowsInBoxFirst,
  packingUndoResult,
  PK_BIG_QTY,
  infoBackListDecision,
  stripLeadingTick,
  extractPosSohMeta,
  parsePosInventoryAoa,
  packingSkuQtyMap,
  sohMapFromRows,
  packingSohCheck,
  packingSohMismatches,
  packingSohLeftover,
  formatSohChip,
  formatPackingSohLine,
  packingSohLineInfo,
  formatSohPosBadge,
  formatPackingSohLastStatus,
  packingSohSummary,
  filterSohLeftover,
  sohLeftoverTypeCounts,
  packingCounterCheck,
  packingCounterCheckStatusLabel,
  packingCounterCheckShortName,
  packingCounterCheckExportStamp,
  buildCounterCheckExcelData,
  applyPackingOps,
  packingStaleVersion,
  packingActivePeers,
  packingPeerBannerText,
  buildPackingDeltaOp,
  packingLineKey,
  packingShouldApplyServerBox,
  packingSeedDeltaPartials,
  formatPackingSohLineDetailed,
  packingSohLineInfoDetailed,
  packingCounterPackedMap,
  packingMergeCounterPacked,
  packingSohSummaryFromPacked,
} from "../lib/catalog-core.mjs";

test("CatalogCore VERSION is a non-empty release id", () => {
  assert.equal(typeof VERSION, "string");
  assert.ok(VERSION.length >= 4);
  assert.equal(typeof packingCounterCheck, "function");
  assert.equal(typeof buildCounterCheckExcelData, "function");
  assert.equal(typeof applyPackingOps, "function");
  assert.equal(typeof formatPackingSohLineDetailed, "function");
});

const SAMPLE_ROWS = [
  {
    sku: "EXT0029",
    brand: "NISHANE",
    line: "HACIVAT",
    desc: "NISHANE HACIVAT EXTRAIT DE PARFUM 100ML UNISEX",
    group: "STOCK",
    av: "Active",
    eans: ["8681008055180"],
    codesU: ["EXT0029"],
    hay: "nishane hacivat extrait de parfum 100ml unisex",
  },
  {
    sku: "T-EXT0029",
    brand: "NISHANE",
    line: "HACIVAT",
    desc: "NISHANE HACIVAT EXTRAIT DE PARFUM TESTER 100ML UNISEX",
    group: "TESTER",
    av: "Active",
    eans: ["8681008055364"],
    codesU: ["T-EXT0029"],
    hay: "nishane hacivat extrait de parfum tester 100ml unisex",
  },
  {
    sku: "1800103",
    brand: "CREED",
    desc: "CREED CNY 2026 GIFT BAG POSM MEDIUM",
    group: "OTH",
    av: "Active",
    eans: [],
    codesU: ["1800103"],
    hay: "creed cny 2026 gift bag posm medium",
  },
  {
    sku: "3111601-TRG",
    brand: "SMN",
    desc: "SANTA MARIA NOVELLA ACQUA EDP TRAINING 100ML",
    group: "OTH",
    av: "Active",
    eans: [],
    codesU: ["3111601-TRG"],
    hay: "santa maria novella acqua edp training 100ml",
  },
  {
    sku: "GWP1",
    brand: "X",
    desc: "MINI CREAM",
    group: "SAMP",
    av: "Active",
    eans: [],
    codesU: ["GWP1"],
    hay: "mini cream",
  },
];

test("itemTypeBucket classifier", () => {
  assert.equal(itemTypeBucket("EXT0029", "", "STOCK", ""), "STOCK");
  assert.equal(itemTypeBucket("T-EXT0029", "TESTER 100ML", "TESTER", ""), "TESTER");
  assert.equal(itemTypeBucket("1800103", "GIFT BAG POSM", "OTH", ""), "OTH"); // master OTH wins
  assert.equal(itemTypeBucket("3111601-TRG", "TRAINING", "OTH", ""), "OTH");
  assert.equal(itemTypeBucket("X", "", "SAMP", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "GWP", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "MINI", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "PR GIFT", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "OTH", "STOCK"), "STOCK");
  // Derive from description when master group empty (Prestige warehouse examples)
  assert.equal(itemTypeBucket("GWP001", "RED TOTE BAG GWP LARGE", "", ""), "GWPS");
  assert.equal(itemTypeBucket("POSM01", "WOVEN BAG POSM MEDIUM", "", ""), "GWPS");
  assert.equal(itemTypeBucket("SAMP01", "EDP SAMPLE 2ML", "", ""), "GWPS");
  assert.equal(itemTypeBucket("L3720002", "CACHAREL ANAIS ANAIS EDT 50ML", "", ""), "STOCK");
  assert.equal(itemTypeBucket("T3720002", "CACHAREL ANAIS ANAIS EDT 50ML TESTER", "", ""), "TESTER");
  assert.equal(itemTypeBucket("TRG1", "STAFF TRAINING KIT", "", ""), "OTH");
});

test("filterSohLeftover typeCat + sohLeftoverTypeCounts", () => {
  var rows = [
    { sku: "A", desc: "Saleable EDT 50ML", brand: "DIOR", left: 3, type: "STOCK" },
    { sku: "T1", desc: "EDT TESTER 100ML", brand: "DIOR", left: 1, type: "TESTER" },
    { sku: "G1", desc: "RED TOTE BAG GWP LARGE", brand: "DIOR", left: 5, type: "GWPS" },
    { sku: "O1", desc: "TRAINING", brand: "OTHER", left: 2, type: "OTH" },
  ];
  var counts = sohLeftoverTypeCounts(rows);
  assert.equal(counts.ALL.sku, 4);
  assert.equal(counts.ALL.qty, 11);
  assert.equal(counts.STOCK.sku, 1);
  assert.equal(counts.STOCK.qty, 3);
  assert.equal(counts.TESTER.sku, 1);
  assert.equal(counts.GWPS.qty, 5);
  assert.equal(counts.OTH.sku, 1);

  assert.equal(filterSohLeftover(rows, "", "", "STOCK").length, 1);
  assert.equal(filterSohLeftover(rows, "", "", "GWPS")[0].sku, "G1");
  assert.equal(filterSohLeftover(rows, "tote", "", "ALL").length, 1);
  assert.equal(filterSohLeftover(rows, "tote", "", "STOCK").length, 0); // type + search
  assert.equal(filterSohLeftover(rows, "", "dior", "TESTER").length, 1);
  // Derive type from desc when row.type missing
  assert.equal(
    filterSohLeftover([{ sku: "X", desc: "WOVEN BAG POSM MEDIUM", left: 1 }], "", "", "GWPS")
      .length,
    1
  );
});

test("parseSearchQty", () => {
  assert.deepEqual(parseSearchQty("ext0029*6"), { query: "ext0029", qty: 6 });
  assert.deepEqual(parseSearchQty("ext0029 x6"), { query: "ext0029", qty: 6 });
  assert.deepEqual(parseSearchQty("foo"), { query: "foo", qty: 1 });
  assert.equal(searchQueryOnly("3360374507206*3"), "3360374507206");
});

test("searchCatalog multi-word and fuzzy", () => {
  var r = searchCatalog(SAMPLE_ROWS, "nishane 100 tester", { limit: 5 });
  assert.ok(r.hits.some((h) => h.row.sku === "T-EXT0029"));
  r = searchCatalog(SAMPLE_ROWS, "ext29", { limit: 5 });
  assert.equal(r.hits[0].row.sku, "EXT0029");
  r = searchCatalog(SAMPLE_ROWS, "hacivt", { limit: 5 });
  assert.ok(r.hits.some((h) => /HACIVAT/i.test(h.row.desc)));
});

test("filterRowsByType", () => {
  var stock = filterRowsByType(SAMPLE_ROWS, "STOCK", rowTypeBucket);
  assert.ok(stock.every((r) => rowTypeBucket(r) === "STOCK"));
});

test("editDistance", () => {
  assert.equal(editDistance("hacivat", "hacivt"), 1);
});

test("packing from datalist labels", () => {
  var sample = [
    { code: "ICON-ADP", name: "ICONSIAM - NICHE ADP" },
    { code: "CC002-CLOM", name: "CENTRAL CHIDLOM - NICHE ADP" },
    { code: "CC002-CLOM", name: "CENTRAL CHIDLOM - NISHANE" },
  ];
  assert.deepEqual(counterNamesDeduped(sample), [
    "ICONSIAM - NICHE ADP",
    "CENTRAL CHIDLOM - NICHE ADP",
    "CENTRAL CHIDLOM - NISHANE",
  ]);
  assert.equal(stripPlaceListLabel("ICON-ADP · ICONSIAM - NICHE ADP"), "ICONSIAM - NICHE ADP");
  assert.equal(stripPlaceListLabel("Pullback to Office"), "Pullback to Office");
  var pinned = ["FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026"];
  assert.deepEqual(mergePinnedPlaceNames(pinned, ["ICONSIAM - NICHE ADP", pinned[0]]), [
    pinned[0],
    "ICONSIAM - NICHE ADP",
  ]);
});

test("packingLookupAction always picks on multi-SKU", () => {
  assert.equal(packingLookupAction(0), "miss");
  assert.equal(packingLookupAction(1), "add");
  assert.equal(packingLookupAction(2), "pick");
  assert.equal(packingLookupAction(5), "pick");
});

test("sortPackingLinesForDisplay newest touched first", () => {
  var lines = [
    { k: "S:A", touched: 1 },
    { k: "S:B" },
    { k: "S:C", touched: 3 },
    { k: "S:D" },
  ];
  assert.deepEqual(
    sortPackingLinesForDisplay(lines).map((l) => l.k),
    ["S:C", "S:A", "S:D", "S:B"]
  );
  assert.deepEqual(
    sortPackingLinesForDisplay([{ k: "1" }, { k: "2" }, { k: "3" }]).map((l) => l.k),
    ["3", "2", "1"]
  );
});

test("infoBackListDecision", () => {
  assert.equal(infoBackListDecision([{ sku: "A" }]).showBack, false);
  assert.equal(infoBackListDecision([{ sku: "A" }]).action, "search");
  var d = infoBackListDecision([{ sku: "A" }, { sku: "B" }], { q: "hacivat", typeCat: "TESTER" });
  assert.equal(d.showBack, true);
  assert.equal(d.action, "list");
  assert.equal(d.q, "hacivat");
  assert.equal(d.typeCat, "TESTER");
  assert.equal(d.hits.length, 2);
});

test("packing big qty + type summary + undo + pick sort", () => {
  assert.equal(PK_BIG_QTY, 20);
  assert.equal(packingIsBigQty(20), false);
  assert.equal(packingIsBigQty(21), true);
  var lines = [
    { sku: "A", qty: 2, group: "STOCK" },
    { sku: "T-A", qty: 1, group: "TESTER" },
    { sku: "G1", qty: 25, group: "GWP" },
  ];
  var sum = packingTypeSummary(lines, rowTypeBucket);
  assert.equal(sum.totalLines, 3);
  assert.equal(sum.totalQty, 28);
  assert.equal(sum.STOCK.qty, 2);
  assert.equal(sum.TESTER.qty, 1);
  assert.equal(sum.GWPS.qty, 25);
  assert.equal(packingBigQtyLines(lines).length, 1);
  assert.deepEqual(packingUndoResult(5, 2, false), { remove: false, nextQty: 3 });
  assert.deepEqual(packingUndoResult(2, 2, true), { remove: true, nextQty: 0 });
  var pick = sortPickRowsInBoxFirst(
    [{ sku: "X" }, { sku: "Y" }, { sku: "Z" }],
    { Y: 1 }
  );
  assert.deepEqual(
    pick.map((r) => r.sku),
    ["Y", "X", "Z"]
  );
});

test("POS SOH parse: apostrophe strip, qty!=0, header/as-of", () => {
  assert.equal(stripLeadingTick("'H0D7010000"), "H0D7010000");
  assert.equal(stripLeadingTick("\u20183700135021143"), "3700135021143");
  assert.equal(stripLeadingTick("ABC"), "ABC");
  var meta = extractPosSohMeta(
    [
      "รายงานสินค้าคงคลัง : at Fashion Hall, Siam Paragon 12-22 NOV 2026 22/11/2026",
      "",
      "",
      "",
      "22/11/2026 15:35",
    ],
    "22/11/2026 15:35"
  );
  assert.equal(meta.asOf, "22/11/2026 15:35");
  assert.match(meta.reportName, /Fashion Hall, Siam Paragon/);
  assert.equal(formatSohChip("22/11/2026 15:35", 110), "SOH ณ 22/11 15:35 · 110 SKU");

  var aoa = [
    [
      "รายงานสินค้าคงคลัง : at Fashion Hall, Siam Paragon 12-22 NOV 2026 22/11/2026",
      "",
      "",
      "",
      "22/11/2026 15:35",
    ],
    ["รหัสสินค้า", "รหัสบาร์โค้ด", "ชื่อสินค้า", "จำนวนสินค้าคงเหลือ", "ราคาทุนเฉลี่ย", "มูลค่ารวม"],
    ["'H0D7010000", "'3700135021143", "Item A", "3", "10", "30"],
    ["'ZERO001", "'111", "Zero", "0", "1", "0"],
    ["'H0D7020000", "'3700135021143", "Item B shared bc", "2", "5", "10"],
    ["", "", "", "", "", ""],
  ];
  var r = parsePosInventoryAoa(aoa, "export_inventory_summary_all_20261122.xlsx");
  assert.equal(r.ok, true);
  assert.equal(r.asOf, "22/11/2026 15:35");
  assert.equal(r.skuCount, 2);
  assert.equal(r.pcs, 5);
  assert.equal(r.zeroSkipped, 1);
  assert.equal(r.rows[0].sku, "H0D7010000");
  assert.equal(r.rows[0].barcode, "3700135021143");
  assert.equal(r.rows[1].sku, "H0D7020000");
});

test("packing SOH mismatch + cumulative qty across boxes", () => {
  var lines = [
    { sku: "A", qty: 2, boxSeq: 1 },
    { sku: "A", qty: 3, boxSeq: 2 },
    { sku: "B", qty: 1, boxSeq: 1 },
    { sku: "MISS", qty: 2, boxSeq: 1 },
  ];
  assert.deepEqual(packingSkuQtyMap(lines), { A: 5, B: 1, MISS: 2 });
  var soh = sohMapFromRows([
    { sku: "A", qty: 3, desc: "Alpha" },
    { sku: "B", qty: 1, desc: "Beta" },
    { sku: "C", qty: 4, desc: "Left" },
  ]);
  assert.equal(packingSohCheck("MISS", 2, soh).status, "missing");
  assert.equal(packingSohCheck("A", 5, soh).status, "over");
  assert.equal(packingSohCheck("A", 5, soh).warn, "แพ็ค 5 / POS มี 3");
  assert.equal(packingSohCheck("B", 1, soh).status, "ok");
  var mm = packingSohMismatches(lines, soh);
  assert.equal(mm.length, 2);
  assert.equal(mm.find((x) => x.sku === "A").packed, 5);
  assert.equal(mm.find((x) => x.sku === "MISS").status, "missing");
  var left = packingSohLeftover(lines, soh);
  assert.equal(left.length, 1);
  assert.equal(left[0].sku, "C");
  assert.equal(left[0].left, 4);
});

test("formatPackingSohLine remaining / done / over", () => {
  var mid = formatPackingSohLine(57, 1);
  assert.equal(mid.status, "ok");
  assert.equal(mid.left, 56);
  assert.equal(mid.over, 0);
  assert.equal(mid.text, "POS 57 · แพ็คแล้ว 1 · เหลือ 56");
  assert.equal(mid.className, "ok");

  var done = formatPackingSohLine(3, 3);
  assert.equal(done.status, "done");
  assert.equal(done.left, 0);
  assert.equal(done.text, "✓ POS 3 · แพ็คแล้ว 3 · เหลือ 0");
  assert.equal(done.className, "done");

  var over = formatPackingSohLine(3, 5);
  assert.equal(over.status, "over");
  assert.equal(over.over, 2);
  assert.equal(over.left, -2); // remaining can go negative when over-packed
  assert.equal(over.text, "POS 3 · แพ็คแล้ว 5 · เกิน 2");
  assert.equal(over.className, "over");

  var zeroPacked = formatPackingSohLine(10, 0);
  assert.equal(zeroPacked.status, "ok");
  assert.equal(zeroPacked.left, 10);
  assert.equal(zeroPacked.text, "POS 10 · แพ็คแล้ว 0 · เหลือ 10");

  var soh = sohMapFromRows([
    { sku: "A", qty: 57 },
    { sku: "B", qty: 3 },
  ]);
  assert.equal(packingSohLineInfo("A", 1, soh).text, "POS 57 · แพ็คแล้ว 1 · เหลือ 56");
  assert.equal(packingSohLineInfo("B", 5, soh).status, "over");
  assert.equal(packingSohLineInfo("MISS", 2, soh).status, "missing");
  assert.equal(packingSohLineInfo("MISS", 2, soh).text, "⚠ ไม่มีใน POS ของ counter นี้");
  assert.equal(packingSohLineInfo("A", 1, null), null);
  assert.equal(formatSohPosBadge("A", soh), "POS 57");
  assert.equal(formatSohPosBadge("MISS", soh), "");
  assert.equal(formatSohPosBadge("A", null), "");

  assert.equal(formatPackingSohLastStatus(mid).text, "แพ็ค 1 / POS 57 · เหลือ 56");
  assert.equal(formatPackingSohLastStatus(done).text, "✓ ครบ");
  assert.equal(formatPackingSohLastStatus(over).text, "แพ็ค 5 / POS 3 · เกิน 2");
  assert.equal(formatPackingSohLastStatus({ status: "missing" }).text, "ไม่มีใน POS");
});

test("packingSohSummary counts + leftover filter", () => {
  var soh = sohMapFromRows([
    { sku: "A", qty: 10, desc: "Alpha", barcode: "111" },
    { sku: "B", qty: 5, desc: "Beta", barcode: "222" },
    { sku: "C", qty: 20, desc: "Gamma", barcode: "333" },
  ]);
  // A exact done, B over, C leftover, MISS not in POS
  var lines = [
    { sku: "A", qty: 10 },
    { sku: "B", qty: 7 },
    { sku: "C", qty: 3 },
    { sku: "MISS", qty: 2 },
  ];
  var sum = packingSohSummary(lines, soh);
  assert.equal(sum.posPcs, 35);
  assert.equal(sum.packedPcs, 20); // A10+B7+C3 — MISS excluded
  assert.equal(sum.sohSkuCount, 3);
  assert.equal(sum.doneSku, 2); // A + B (packed >= soh)
  assert.equal(sum.overSku, 1); // B
  assert.equal(sum.leftoverSku, 1); // C
  assert.equal(sum.leftoverPcs, 17);
  assert.equal(sum.missingSku, 1);
  assert.equal(packingSohSummary(lines, null), null);

  var left = packingSohLeftover(lines, soh).map(function (r) {
    return Object.assign({ brand: r.sku === "C" ? "NISHANE" : "OTHER" }, r);
  });
  assert.equal(left.length, 1);
  assert.equal(left[0].left, 17);
  assert.equal(filterSohLeftover(left, "gam", "").length, 1);
  assert.equal(filterSohLeftover(left, "zzz", "").length, 0);
  assert.equal(filterSohLeftover(left, "", "nishane").length, 1);
  assert.equal(filterSohLeftover(left, "", "other").length, 0);
});

test("packingCounterCheck live POPUP shape (done+leftover+over = 110)", () => {
  // Live expectations: SOH 110/741; 21 PKs; packed 479; done 74; leftover 34/264;
  // over 2/2 (H4GK010000 6→7, H4GR010000 5→6); not-in-POS 0
  var sohRows = [];
  var i;
  sohRows.push({ sku: "H4GK010000", qty: 6, desc: "Over A", barcode: "3700A" });
  sohRows.push({ sku: "H4GR010000", qty: 5, desc: "Over B", barcode: "3700B" });
  for (i = 1; i <= 74; i++) {
    sohRows.push({ sku: "DONE" + String(i).padStart(4, "0"), qty: 5, desc: "Done " + i });
  }
  for (i = 1; i <= 32; i++) {
    sohRows.push({ sku: "LEFT" + String(i).padStart(4, "0"), qty: 7, desc: "Left " + i });
  }
  sohRows.push({ sku: "LEFT0033", qty: 20, desc: "Left 33" });
  sohRows.push({ sku: "LEFT0034", qty: 20, desc: "Left 34" });
  assert.equal(sohRows.length, 110);
  // pcs = 11 + 370 + 224 + 40 = 645; need 741 → +96 into done qtys
  for (i = 0; i < 96; i++) sohRows[2 + (i % 74)].qty += 1;
  assert.equal(
    sohRows.reduce((n, r) => n + r.qty, 0),
    741
  );

  var soh = sohMapFromRows(sohRows);
  var bundles = [];
  bundles.push({
    boxNo: "PK-261122-007",
    lines: [
      { sku: "H4GK010000", qty: 7 },
      { sku: "H4GR010000", qty: 6 },
    ],
  });
  var doneLines = [];
  var packedFromDone = 0;
  for (i = 1; i <= 74; i++) {
    var sku = "DONE" + String(i).padStart(4, "0");
    var q = soh[sku].qty;
    doneLines.push({ sku: sku, qty: q });
    packedFromDone += q;
  }
  assert.equal(packedFromDone + 13, 479);
  var chunk = Math.ceil(doneLines.length / 20);
  for (i = 0; i < 20; i++) {
    bundles.push({
      boxNo: "PK-261122-" + String(8 + i).padStart(3, "0"),
      lines: doneLines.slice(i * chunk, (i + 1) * chunk),
    });
  }
  assert.equal(bundles.length, 21);

  var check = packingCounterCheck(soh, bundles);
  assert.equal(check.totals.sohSkuCount, 110);
  assert.equal(check.totals.sohPcs, 741);
  assert.equal(check.totals.pkCount, 21);
  assert.equal(check.totals.packedPcs, 479);
  assert.equal(check.totals.doneSku, 74);
  assert.equal(check.totals.leftoverSku, 34);
  assert.equal(check.totals.leftoverPcs, 264);
  assert.equal(check.totals.overSku, 2);
  assert.equal(check.totals.overPcs, 2);
  assert.equal(check.totals.missingSku, 0);
  assert.equal(check.over.find((r) => r.sku === "H4GK010000").packed, 7);
  assert.equal(check.over.find((r) => r.sku === "H4GR010000").packed, 6);
  assert.deepEqual(check.over.find((r) => r.sku === "H4GK010000").boxNos, ["PK-261122-007"]);

  var replaced = packingCounterCheck(soh, [
    ...bundles.filter((b) => b.boxNo !== "PK-261122-007"),
    { boxNo: "PK-261122-007", lines: [{ sku: "H4GK010000", qty: 6 }, { sku: "H4GR010000", qty: 5 }] },
  ]);
  assert.equal(replaced.totals.overSku, 0);
  assert.equal(replaced.totals.doneSku, 76);
});

test("buildCounterCheckExcelData Summary + All SKUs + By PK", () => {
  assert.equal(packingCounterCheckStatusLabel("leftover"), "ยังไม่แพ็ค");
  assert.equal(packingCounterCheckStatusLabel("over"), "เกิน");
  assert.equal(packingCounterCheckStatusLabel("missing"), "ไม่มีใน POS");
  assert.equal(packingCounterCheckStatusLabel("done"), "ครบ");
  assert.equal(
    packingCounterCheckShortName(
      "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026"
    ),
    "FM_x_GD_POPUP"
  );
  assert.match(packingCounterCheckExportStamp(new Date("2026-11-22T12:34:00+07:00")), /^\d{8}-\d{4}$/);

  var soh = sohMapFromRows([
    { sku: "00LEAD", qty: 2, desc: "Lead zero SKU", barcode: "001234" },
    { sku: "OVER1", qty: 1, desc: "Over one", barcode: "9" },
  ]);
  var bundles = [
    {
      boxNo: "PK-261122-007",
      lines: [
        { sku: "00LEAD", qty: 1, barcode: "001234", desc: "Lead zero SKU", brand: "DIOR", boxSeq: 1 },
        { sku: "OVER1", qty: 2, barcode: "9", desc: "Over one", brand: "DIOR" },
      ],
    },
  ];
  var check = packingCounterCheck(soh, bundles);
  var data = buildCounterCheckExcelData({
    counter: "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026",
    asOf: "22/11/2026 19:04",
    check: check,
    includedOpen: false,
    bundles: bundles,
    stamp: "20261122-1904",
    includeStatusSheets: true,
  });
  assert.ok(data);
  assert.equal(data.fileName, "CounterCheck_FM_x_GD_POPUP_20261122-1904.xlsx");
  assert.equal(data.sheets[0].name, "Summary");
  assert.equal(data.sheets[1].name, "All SKUs");
  assert.equal(data.sheets[2].name, "By PK");
  var summary = Object.fromEntries(data.sheets[0].aoa.slice(1));
  assert.equal(summary.Counter, "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026");
  assert.equal(summary["SOH as-of"], "22/11/2026 19:04");
  assert.equal(summary["PK count"], 1);
  assert.equal(summary["Packed pcs"], 3);
  assert.equal(summary["Over SKU"], 1);
  assert.equal(summary["Leftover SKU"], 1);
  assert.equal(summary["Included open draft"], "No");

  var allHeader = data.sheets[1].aoa[0];
  assert.deepEqual(allHeader.slice(0, 4), ["Status", "Brand", "SKU", "Barcode"]);
  assert.ok(data.sheets[1].textCols.includes(2));
  assert.ok(data.sheets[1].textCols.includes(3));
  assert.equal(data.sheets[1].freeze, true);
  assert.equal(data.sheets[1].autofilter, true);

  var allBody = data.sheets[1].aoa.slice(1);
  var lead = allBody.find((r) => r[2] === "00LEAD");
  assert.ok(lead);
  assert.equal(lead[0], "ยังไม่แพ็ค");
  assert.equal(lead[3], "001234");
  assert.equal(typeof lead[2], "string");
  assert.equal(lead[5], 2);
  assert.equal(lead[6], 1);
  assert.equal(lead[7], 1);

  var over = allBody.find((r) => r[2] === "OVER1");
  assert.equal(over[0], "เกิน");
  assert.equal(over[8], 1);
  assert.match(String(over[9]), /PK-261122-007/);

  var byPk = data.sheets[2].aoa;
  assert.equal(byPk[0][0], "PK no");
  assert.equal(byPk.length, 3); // header + 2 lines
  assert.equal(byPk[1][0], "PK-261122-007");
  assert.equal(byPk[1][2], "00LEAD");
  assert.equal(byPk[1][6], 1);

  var statusNames = data.sheets.slice(3).map((s) => s.name);
  assert.deepEqual(statusNames, ["ยังไม่แพ็ค", "เกิน", "ไม่มีใน POS", "ครบ"]);
  assert.equal(data.sheets.find((s) => s.name === "เกิน").aoa.length, 2);
});
test("applyPackingOps: concurrent deltas merge; duplicate opId ignored; negative deltas", () => {
  var base = [
    { sku: "A", ean: "1", desc: "Item A", brand: "X", qty: 2, boxSeq: 1, k: "S:A" },
  ];
  var opA = buildPackingDeltaOp({
    opId: "dev1-1",
    deviceId: "dev1",
    sku: "A",
    ean: "1",
    desc: "Item A",
    deltaQty: 3,
    boxSeq: 1,
  });
  var opB = buildPackingDeltaOp({
    opId: "dev2-1",
    deviceId: "dev2",
    sku: "B",
    ean: "2",
    desc: "Item B",
    brand: "Y",
    deltaQty: 5,
    boxSeq: 1,
  });
  var merged = applyPackingOps(base, [opA, opB]);
  assert.equal(merged.skippedDup.length, 0);
  assert.equal(merged.applied.length, 2);
  var bySku = Object.fromEntries(merged.lines.map((l) => [l.sku, l.qty]));
  assert.equal(bySku.A, 5);
  assert.equal(bySku.B, 5);

  // Device A retries same opId + another device adds more — no double count
  // (server/client must pass already-seen opIds when replaying)
  var again = applyPackingOps(
    merged.lines,
    [
      opA,
      buildPackingDeltaOp({
        opId: "dev2-2",
        deviceId: "dev2",
        sku: "A",
        deltaQty: 1,
        boxSeq: 1,
        lineKey: "S:A",
      }),
    ],
    { seenOpIds: merged.seenOpIds }
  );
  assert.deepEqual(again.skippedDup, ["dev1-1"]);
  bySku = Object.fromEntries(again.lines.map((l) => [l.sku, l.qty]));
  assert.equal(bySku.A, 6);

  var removed = applyPackingOps(again.lines, [
    buildPackingDeltaOp({
      opId: "dev1-rm",
      deviceId: "dev1",
      sku: "B",
      deltaQty: -5,
      boxSeq: 1,
      lineKey: "S:B",
    }),
  ]);
  assert.ok(!removed.lines.find((l) => l.sku === "B"));
  assert.equal(removed.lines.find((l) => l.sku === "A").qty, 6);

  assert.equal(packingStaleVersion(3, 4), true);
  assert.equal(packingStaleVersion(4, 4), false);
  assert.equal(packingStaleVersion(null, 4), false);
  var peers = packingActivePeers(
    [
      { deviceId: "me", lastSeen: 1000 },
      { deviceId: "other", lastSeen: 900 },
      { deviceId: "stale", lastSeen: 100 },
    ],
    "me",
    1000,
    200
  );
  assert.equal(peers.length, 1);
  assert.equal(peers[0].deviceId, "other");
  assert.equal(packingPeerBannerText(peers), "อีก 1 เครื่องกำลังแพ็คกล่องนี้");
  assert.equal(packingPeerBannerText([{ deviceId: "a" }, { deviceId: "b" }]), "อีก 2 เครื่องกำลังแพ็คกล่องนี้");
});

test("packingShouldApplyServerBox: supportsDelta gate + ignore older rev", () => {
  assert.equal(packingShouldApplyServerBox(null, 1), false);
  assert.equal(packingShouldApplyServerBox({}, 1), false);
  assert.equal(packingShouldApplyServerBox({ supportsDelta: false, rev: 5 }, 1), false);
  // v6-shaped box (no supportsDelta) must not wipe local lines
  assert.equal(packingShouldApplyServerBox({ rev: 1, items: [] }, 0), false);
  assert.equal(packingShouldApplyServerBox({ supportsDelta: true, rev: 3 }, 5), false); // server older
  assert.equal(packingShouldApplyServerBox({ supportsDelta: true, rev: 5 }, 5), true);
  assert.equal(packingShouldApplyServerBox({ supportsDelta: true, rev: 6 }, 5), true);
  assert.equal(packingShouldApplyServerBox({ supportsDelta: true }, null), true);
  assert.equal(packingShouldApplyServerBox({ supportsDelta: true, rev: 1 }, null), true);
});

test("packingLineKey: prefer k; N: strips whitespace like index.html norm", () => {
  assert.equal(packingLineKey({ k: "S:ABC" }), "S:ABC");
  assert.equal(packingLineKey({ sku: "h0d701" }), "S:H0D701");
  assert.equal(packingLineKey({ ean: " 3700 1350 21143 " }), "N:3700135021143");
  assert.equal(packingLineKey({ desc: "foo  bar" }), "N:FOOBAR");
  // server k wins even if sku/ean would differ
  assert.equal(packingLineKey({ k: "N:SERVER", sku: "X", ean: "1" }), "N:SERVER");
});

test("packingSeedDeltaPartials: local excess only; no wipe when server empty", () => {
  var local = [
    { sku: "A", qty: 3, boxSeq: 1, k: "S:A" },
    { ean: "12 34", desc: "no sku", qty: 2, boxSeq: 1 },
  ];
  var empty = packingSeedDeltaPartials(local, []);
  assert.equal(empty.length, 2);
  var byKey = Object.fromEntries(empty.map((p) => [p.lineKey, p.deltaQty]));
  assert.equal(byKey["S:A"], 3);
  assert.equal(byKey["N:1234"], 2); // whitespace stripped

  var partialServer = packingSeedDeltaPartials(local, [
    { sku: "A", qty: 1, boxSeq: 1, k: "S:A" },
  ]);
  byKey = Object.fromEntries(partialServer.map((p) => [p.lineKey, p.deltaQty]));
  assert.equal(byKey["S:A"], 2); // 3-1
  assert.equal(byKey["N:1234"], 2);

  // local already covered — no seed (would double-count)
  assert.deepEqual(
    packingSeedDeltaPartials(
      [{ sku: "A", qty: 1, boxSeq: 1, k: "S:A" }],
      [{ sku: "A", qty: 1, boxSeq: 1, k: "S:A" }]
    ),
    []
  );

  // apply seed on empty server recovers local qty
  var ops = empty.map((p, i) =>
    buildPackingDeltaOp(Object.assign({}, p, { opId: "seed-" + i, deviceId: "me", boxNo: "PK-1" }))
  );
  var merged = applyPackingOps([], ops);
  assert.equal(merged.lines.find((l) => l.k === "S:A" || l.sku === "A").qty, 3);
  assert.equal(merged.lines.find((l) => String(l.k).indexOf("N:") === 0).qty, 2);
});

test("formatPackingSohLineDetailed counter-wide + this-box; over in red", () => {
  var mid = formatPackingSohLineDetailed(6, 3, 1);
  assert.equal(mid.status, "ok");
  assert.equal(mid.left, 3);
  assert.equal(mid.text, "POS 6 · แพ็คแล้ว 3 (กล่องนี้ 1) · เหลือ 3");
  assert.equal(mid.className, "ok");

  var over = formatPackingSohLineDetailed(6, 7, 2);
  assert.equal(over.status, "over");
  assert.equal(over.over, 1);
  assert.equal(over.left, -1);
  assert.equal(over.className, "over");
  assert.match(over.text, /เกิน 1/);
  assert.match(over.text, /กล่องนี้ 2/);

  var info = packingSohLineInfoDetailed(
    "A",
    3,
    1,
    sohMapFromRows([{ sku: "A", qty: 6, desc: "A" }])
  );
  assert.equal(info.text, "POS 6 · แพ็คแล้ว 3 (กล่องนี้ 1) · เหลือ 3");

  // other PKs + this draft
  var other = packingCounterPackedMap([
    { boxNo: "PK-1", lines: [{ sku: "A", qty: 2 }] },
    { boxNo: "PK-2", lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 4 }] },
  ]);
  assert.deepEqual(other, { A: 3, B: 4 });
  var all = packingMergeCounterPacked(other, { A: 1, C: 2 });
  assert.deepEqual(all, { A: 4, B: 4, C: 2 });
  var sum = packingSohSummaryFromPacked(
    sohMapFromRows([
      { sku: "A", qty: 6 },
      { sku: "B", qty: 4 },
      { sku: "C", qty: 1 },
    ]),
    all
  );
  assert.equal(sum.packedPcs, 10); // A4+B4+C2
  assert.equal(sum.leftoverSku, 1); // A left 2
  assert.equal(sum.doneSku, 2); // B exact + C over counts as done (>=)
  assert.equal(sum.overSku, 1); // C 2>1
});

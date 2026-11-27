import test from "node:test";
import assert from "node:assert/strict";
import {
  VERSION,
  itemTypeBucket,
  rowTypeBucket,
  lookupMasterForSohRow,
  preferItemMasterFields,
  applyItemMasterToSohRow,
  parseSearchQty,
  searchQueryOnly,
  searchCatalog,
  editDistance,
  filterRowsByType,
  counterNamesDeduped,
  mergePinnedPlaceNames,
  isClosedPlaceName,
  filterClosedPlaceNames,
  pickOpenPlaceSeed,
  stripPlaceListLabel,
  packingLookupAction,
  sortPackingLinesForDisplay,
  packingIsBigQty,
  packingTypeSummary,
  packingBigQtyLines,
  buildPackingReviewRows,
  filterPackingReviewRows,
  packingReviewTypeCounts,
  packingReviewStatusCounts,
  packingReviewFilterTotals,
  packingReviewStatusLabel,
  normalizePackingReviewTypeCat,
  normalizePackingReviewStatusCat,
  PACKING_REVIEW_STATUS_DEFS,
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
  packingCounterCheckIssueLabel,
  packingCounterCheckShortName,
  packingCounterCheckExportStamp,
  buildCounterCheckExcelData,
  parseItemSize,
  descsVerySimilar,
  detectCounterCheckSwaps,
  enrichCounterCheck,
  counterCheckTypeCounts,
  counterCheckIssueCounts,
  counterCheckRowStats,
  counterCheckRowFlags,
  counterCheckRowMatchesIssue,
  formatCounterCheckChipLines,
  normalizeCounterCheckIssueCat,
  COUNTER_CHECK_ISSUE_DEFS,
  filterCounterCheckRows,
  SHADE_ABBREV,
  textMatchesQuery,
  shadePhraseInHay,
  buildShadeMatchPlan,
  parseShadeAbbrevToken,
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
  stripBrandFromPackDesc,
  clipPackQrDesc,
  formatPackQrLine,
  buildPackQrText,
  utf8ByteLen,
  PACK_QR_MAX,
  PACK_QR_DESC_CLIP,
} from "../lib/catalog-core.mjs";

test("CatalogCore VERSION is a non-empty release id", () => {
  assert.equal(typeof VERSION, "string");
  assert.ok(VERSION.length >= 4);
  assert.equal(typeof packingCounterCheck, "function");
  assert.equal(typeof buildCounterCheckExcelData, "function");
  assert.equal(typeof applyPackingOps, "function");
  assert.equal(typeof formatPackingSohLineDetailed, "function");
  assert.equal(typeof buildPackQrText, "function");
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
  assert.equal(VERSION, "20261127l");
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

  // Strong tester signals override master STOCK
  assert.equal(
    itemTypeBucket(
      "F8638900-TST",
      "Prada LC5 Reveal Mesh Blue Cushion Ltd Ed Found. TST",
      "STOCK",
      ""
    ),
    "TESTER"
  );
  assert.equal(
    itemTypeBucket(
      "F8639000-TST",
      "Prada LN10 Reveal Mesh Blue Cushion Ltd Ed Found. TS…",
      "STOCK",
      ""
    ),
    "TESTER"
  );
  assert.equal(itemTypeBucket("LE032000-TST", "any desc", "STOCK", ""), "TESTER");
  assert.equal(
    itemTypeBucket("PRADA1", "PRADA AMBER POUR HOMME EDT TESTER 100ML", "STOCK", ""),
    "TESTER"
  );
  assert.equal(
    itemTypeBucket("L3720002", "CACHAREL ANAIS ANAIS EDT 50ML", "STOCK", ""),
    "STOCK"
  );
  assert.equal(itemTypeBucket("X1", "TSTUDIO BAG 30ML", "STOCK", ""), "STOCK");
  assert.equal(itemTypeBucket("X2", "Found. TST", "STOCK", ""), "TESTER");
  assert.equal(itemTypeBucket("X3", "TST 30ML", "", ""), "TESTER");
  // GWPS master wins over -TST
  assert.equal(itemTypeBucket("GWP-TST", "GIFT BAG", "GWP", ""), "GWPS");
  assert.equal(itemTypeBucket("SAMP-TST", "SAMPLE", "SAMP", ""), "GWPS");
  assert.equal(
    itemTypeBucket("F8638900-TST", "Found. TST", "STOCK", "STOCK"),
    "STOCK"
  );
  assert.equal(
    rowTypeBucket({
      sku: "F8638900-TST",
      desc: "Prada LC5 Reveal Mesh Blue Cushion Ltd Ed Found. TST",
      group: "STOCK",
    }),
    "TESTER"
  );
});

test("prefer Item Master group over POS STOCK (Counter check / SOH)", () => {
  // Real bug: POS SOH carries group=STOCK + truncated desc; Item Master has TESTER
  var sohRow = {
    sku: "F8638900-TST",
    desc: "Prada LC5 Reveal Mesh Blue Cushion Ltd Ed Found. TST…",
    group: "STOCK",
    barcode: "3614273961234",
  };
  var master = {
    sku: "F8638900-TST",
    group: "TESTER",
    desc: "PRADA LC5 REVEAL MESH BLUE CUSHION LTD ED FOUNDATION TESTER 12G",
    brand: "PRADA FACE",
  };
  var merged = preferItemMasterFields(sohRow, master);
  assert.equal(merged.group, "TESTER");
  assert.equal(merged.type, "TESTER");
  // display desc kept from POS when present (only fill when empty)
  assert.match(merged.desc, /Found\. TST/);

  // masterBySku path used by enrichCounterCheck
  var check = enrichCounterCheck(
    packingCounterCheck(
      sohMapFromRows([{ sku: "F8638900-TST", qty: 2, desc: sohRow.desc, group: "STOCK" }]),
      []
    ),
    { masterBySku: { "F8638900-TST": master } }
  );
  assert.equal(check.rows.length, 1);
  assert.equal(check.rows[0].group, "TESTER");
  assert.equal(check.rows[0].type, "TESTER");

  // lookupMaster: SKU miss → barcode hit
  var byEan = {
    "3614273961234": master,
  };
  var viaBc = applyItemMasterToSohRow(
    { sku: "UNKNOWN-SKU", barcode: "3614273961234", desc: sohRow.desc, group: "STOCK" },
    {
      lookupMaster: function (code) {
        var k = String(code || "").trim().toUpperCase();
        return byEan[k] ? [byEan[k]] : null;
      },
    }
  );
  assert.equal(viaBc.type, "TESTER");
  assert.equal(viaBc.group, "TESTER");

  // no master → POS STOCK kept (then -TST safety net still yields TESTER)
  var noMaster = preferItemMasterFields(sohRow, null);
  assert.equal(noMaster.group, "STOCK");
  assert.equal(noMaster.type, "TESTER"); // -TST / whole-word TST safety net

  // POS STOCK must not override master GWPS
  assert.equal(
    preferItemMasterFields(
      { sku: "G1", desc: "bag", group: "STOCK" },
      { sku: "G1", group: "GWP", desc: "TOTE" }
    ).type,
    "GWPS"
  );

  assert.equal(typeof lookupMasterForSohRow, "function");
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

test("shade abbrevs from catalog (MW/MC/LN) + number boundaries", () => {
  assert.equal(SHADE_ABBREV.MW, "MEDIUM WARM");
  assert.equal(SHADE_ABBREV.LN, "LIGHT NEUTRAL");
  assert.equal(SHADE_ABBREV.DN, "DARK NEUTRAL");
  assert.ok(!SHADE_ABBREV.LP); // LIGHT PINK pouch is not a shade

  assert.equal(
    shadePhraseInHay("REVEAL SKIN OPTIMIZING MEDIUM WARM 40 FOUNDATION REFILL TESTER 30ML", "medium warm", "40"),
    true
  );
  assert.equal(
    shadePhraseInHay("REVEAL SKIN OPTIMIZING MEDIUM WARM  55  FOUNDATION REFILL TESTER 30ML", "medium warm", "55"),
    true
  );
  assert.equal(
    shadePhraseInHay("REVEAL SKIN OPTIMIZING MEDIUM WARM 45 FOUNDATION", "medium warm", "40"),
    false
  );
  assert.equal(
    shadePhraseInHay("REVEAL SKIN OPTIMIZING MEDIUM WARM 140 FOUNDATION", "medium warm", "40"),
    false
  );
  assert.equal(buildShadeMatchPlan("mw-40").hasShadeNum, true);
  assert.equal(buildShadeMatchPlan("MW 40").expanded[0].phrase, "medium warm");

  var shadeRows = [
    {
      sku: "LD978700",
      brand: "PRADA",
      desc: "PRADA REVEAL SKIN OPTIMIZING MEDIUM WARM 40 FOUNDATION REFILL 30ML",
      eans: [],
      codesU: ["LD978700"],
    },
    {
      sku: "LD978800",
      brand: "PRADA",
      desc: "PRADA REVEAL SKIN OPTIMIZING MEDIUM WARM 55  FOUNDATION REFILL TESTER 30ML",
      eans: [],
      codesU: ["LD978800"],
    },
    {
      sku: "LD571202",
      brand: "PRADA",
      desc: "PRADA REVEAL SKIN OPTIMIZING MEDIUM COOL 45 FOUNDATION 30ML",
      eans: [],
      codesU: ["LD571202"],
    },
    {
      sku: "TLD00305",
      brand: "PRADA",
      desc: "PRADA REVEAL MESH CUSHION LIGHT NEUTRAL 5 FOUNDATION TESTER",
      eans: [],
      codesU: ["TLD00305"],
    },
    {
      sku: "TLD00306",
      brand: "PRADA",
      desc: "PRADA REVEAL MESH CUSHION LIGHT NEUTRAL 10 FOUNDATION TESTER",
      eans: [],
      codesU: ["TLD00306"],
    },
    {
      sku: "LE032200",
      brand: "PRADA",
      desc: "PRADA ROUGE MONOCHROME HYPER MATTE ARGILE B01 LIPSTICK",
      eans: [],
      codesU: ["LE032200", "B01"],
    },
  ];
  shadeRows.forEach(function (r) {
    r.hay = (r.sku + " " + r.brand + " " + r.desc).toLowerCase();
  });

  function skus(q) {
    return searchCatalog(shadeRows, q, { limit: 20 }).hits.map((h) => h.row.sku).sort();
  }

  assert.deepEqual(skus("MW 40"), ["LD978700"]);
  assert.deepEqual(skus("mw40"), ["LD978700"]);
  assert.deepEqual(skus("MW-40"), ["LD978700"]);
  assert.deepEqual(skus("reveal mw 40"), ["LD978700"]);
  assert.deepEqual(skus("MC45"), ["LD571202"]);
  assert.deepEqual(skus("mc 45"), ["LD571202"]);
  assert.deepEqual(skus("LN").sort(), ["TLD00305", "TLD00306"]);
  assert.ok(skus("reveal").includes("LD978700"));
  assert.ok(skus("reveal").includes("LD571202"));

  // Remaining / counter-check filter path
  var left = shadeRows.map((r) => ({ sku: r.sku, desc: r.desc, brand: r.brand, barcode: "", left: 1 }));
  assert.equal(filterSohLeftover(left, "MW 40", "", "ALL").map((r) => r.sku).join(), "LD978700");
  assert.equal(filterSohLeftover(left, "LN", "", "ALL").length, 2);
  assert.equal(textMatchesQuery(shadeRows[0].desc, "mw 40"), true);
  assert.equal(textMatchesQuery(shadeRows[1].desc, "mw 40"), false);

  // Literal lipstick codes still work (not treated as shade abbrev)
  assert.ok(skus("B01").includes("LE032200"));
  assert.equal(parseShadeAbbrevToken("B01"), null);
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

test("filterClosedPlaceNames hides closed counters case-insensitively", () => {
  var closed = ["FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026"];
  assert.equal(isClosedPlaceName(closed[0], closed), true);
  assert.equal(
    isClosedPlaceName("  fm x gd popup at fashion hall, siam paragon 12-22 nov 2026 ", closed),
    true
  );
  assert.equal(isClosedPlaceName("ICONSIAM - NICHE ADP", closed), false);

  var merged = mergePinnedPlaceNames(closed, [
    "ICONSIAM - NICHE ADP",
    closed[0],
    "CENTRAL CHIDLOM - PRADA",
  ]);
  assert.deepEqual(filterClosedPlaceNames(merged, closed), [
    "ICONSIAM - NICHE ADP",
    "CENTRAL CHIDLOM - PRADA",
  ]);
  assert.deepEqual(
    filterClosedPlaceNames(
      ["FM-POP · " + closed[0], "ICON-ADP · ICONSIAM - NICHE ADP"],
      closed
    ),
    ["ICON-ADP · ICONSIAM - NICHE ADP"]
  );

  assert.equal(
    pickOpenPlaceSeed(closed[0], closed, ["ICONSIAM - NICHE ADP", closed[0]]),
    "ICONSIAM - NICHE ADP"
  );
  assert.equal(
    pickOpenPlaceSeed("CENTRAL CHIDLOM - PRADA", closed, ["ICONSIAM - NICHE ADP"]),
    "CENTRAL CHIDLOM - PRADA"
  );
  assert.equal(pickOpenPlaceSeed(closed[0], closed, [closed[0]]), "");
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

test("packing review sheet filter: type + status + search (view-only rows)", () => {
  assert.equal(normalizePackingReviewTypeCat("other"), "OTH");
  assert.equal(normalizePackingReviewStatusCat("leftover"), "notPacked");
  assert.equal(PACKING_REVIEW_STATUS_DEFS.length >= 5, true);
  assert.match(packingReviewStatusLabel("partial"), /แพ็คบางส่วน/);

  var soh = sohMapFromRows([
    { sku: "STOCK1", qty: 10, desc: "Saleable EDT", group: "STOCK" },
    { sku: "T-TEST", qty: 3, desc: "EDT TESTER", group: "TESTER" },
    { sku: "LEFT0", qty: 5, desc: "Not started", group: "STOCK" },
    { sku: "PART1", qty: 4, desc: "Partial stock", group: "STOCK" },
  ]);
  var lines = [
    { sku: "STOCK1", qty: 10, desc: "Saleable EDT", group: "STOCK" },
    { sku: "T-TEST", qty: 1, desc: "EDT TESTER", group: "TESTER" },
    { sku: "PART1", qty: 2, desc: "Partial stock", group: "STOCK" },
    { sku: "BIG1", qty: 25, desc: "Big stock line", group: "STOCK" },
    { sku: "MISS1", qty: 2, desc: "Not in POS", group: "STOCK" },
  ];
  var rows = buildPackingReviewRows(lines, soh, { bucketFn: rowTypeBucket });
  var by = {};
  rows.forEach(function (r) {
    by[r.sku] = r;
  });
  assert.ok(by.STOCK1);
  assert.ok(by.STOCK1.statuses.indexOf("packed") >= 0);
  assert.ok(by.LEFT0);
  assert.ok(by.LEFT0.statuses.indexOf("notPacked") >= 0);
  assert.equal(by.LEFT0.packed, 0);
  assert.equal(by.LEFT0.left, 5);
  assert.ok(by.PART1.statuses.indexOf("partial") >= 0);
  assert.ok(by.PART1.statuses.indexOf("packed") >= 0);
  assert.ok(by.BIG1.statuses.indexOf("bigQty") >= 0);
  assert.ok(by.MISS1.statuses.indexOf("mismatch") >= 0);
  assert.equal(by["T-TEST"].type, "TESTER");

  // Master group preferred via bucketFn (simulate applyItemMaster)
  var masterBucket = function (r) {
    if (String(r.sku).toUpperCase() === "STOCK1") {
      return itemTypeBucket(r.sku, r.desc, "TESTER", "");
    }
    return rowTypeBucket(r);
  };
  var withMaster = buildPackingReviewRows(lines, soh, { bucketFn: masterBucket });
  assert.equal(
    withMaster.filter(function (r) {
      return r.sku === "STOCK1";
    })[0].type,
    "TESTER"
  );

  var typed = filterPackingReviewRows(rows, { typeCat: "TESTER", statusCat: "ALL" });
  assert.ok(typed.every(function (r) {
    return r.type === "TESTER";
  }));
  assert.equal(typed.length, 1);

  var notPacked = filterPackingReviewRows(rows, { statusCat: "notPacked" });
  assert.ok(notPacked.some(function (r) {
    return r.sku === "LEFT0";
  }));
  assert.ok(
    notPacked.every(function (r) {
      return r.statuses.indexOf("notPacked") >= 0;
    })
  );

  var partial = filterPackingReviewRows(rows, { statusCat: "partial" });
  assert.deepEqual(
    partial.map(function (r) {
      return r.sku;
    }),
    ["PART1", "T-TEST"]
  );

  var searched = filterPackingReviewRows(rows, { query: "partial" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].sku, "PART1");

  var tc = packingReviewTypeCounts(rows);
  assert.ok(tc.ALL.sku >= 5);
  assert.ok(tc.TESTER.sku >= 1);
  var sc = packingReviewStatusCounts(rows);
  assert.ok(sc.notPacked.sku >= 1);
  assert.ok(sc.bigQty.sku >= 1);
  assert.ok(sc.mismatch.sku >= 1);

  var tot = packingReviewFilterTotals(
    filterPackingReviewRows(rows, { statusCat: "packed" })
  );
  assert.ok(tot.sku >= 4);
  assert.ok(tot.packed >= 10);
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
  assert.deepEqual(allHeader.slice(0, 7), [
    "Status",
    "Group",
    "Issue",
    "Flags",
    "Brand",
    "SKU",
    "Barcode",
  ]);
  assert.ok(data.sheets[1].textCols.includes(5));
  assert.ok(data.sheets[1].textCols.includes(6));
  assert.equal(data.sheets[1].freeze, true);
  assert.equal(data.sheets[1].autofilter, true);

  var allBody = data.sheets[1].aoa.slice(1);
  var lead = allBody.find((r) => r[5] === "00LEAD");
  assert.ok(lead);
  assert.equal(lead[0], "ยังไม่แพ็ค");
  assert.equal(lead[2], "ขาด");
  assert.match(String(lead[3]), /แพ็คบางส่วน/);
  assert.equal(lead[6], "001234");
  assert.equal(typeof lead[5], "string");
  assert.equal(lead[8], 2);
  assert.equal(lead[9], 1);
  assert.equal(lead[10], 1);

  var over = allBody.find((r) => r[5] === "OVER1");
  assert.equal(over[0], "เกิน");
  assert.equal(over[11], 1);
  assert.match(String(over[13]), /PK-261122-007/);

  var byPk = data.sheets[2].aoa;
  assert.equal(byPk[0][0], "PK no");
  assert.deepEqual(byPk[0].slice(6), ["Qty", "POS SOH", "Remaining SOH"]);
  assert.equal(byPk.length, 3); // header + 2 lines
  assert.equal(byPk[1][0], "PK-261122-007");
  assert.equal(byPk[1][2], "00LEAD");
  assert.equal(byPk[1][6], 1);
  assert.equal(byPk[1][7], 2); // POS SOH
  assert.equal(byPk[1][8], 1); // Remaining = Left

  var statusNames = data.sheets.slice(3).map((s) => s.name);
  assert.deepEqual(statusNames, [
    "ยังไม่เริ่ม",
    "แพ็คบางส่วน",
    "ใกล้ครบ",
    "ยังไม่แพ็ค",
    "เกิน",
    "ไม่มีใน POS",
    "ครบ",
    "สลับ",
    "ยังไม่บันทึก",
  ]);
  assert.equal(data.sheets.find((s) => s.name === "เกิน").aoa.length, 2);
  assert.equal(data.sheets.find((s) => s.name === "แพ็คบางส่วน").aoa.length, 2);
  assert.equal(data.sheets.find((s) => s.name === "ใกล้ครบ").aoa.length, 2);
});

test("counter-check Excel: filter does not shrink All SKUs; -TST + done reconcile", () => {
  // Mimics CENTRAL CHIDLOM - PRADA export: Issue=ขาด active, Done SKUs + -TST not-in-POS
  var soh = sohMapFromRows([
    { sku: "STOCK1", qty: 10, desc: "Leftover stock", barcode: "111" },
    { sku: "LD076001", qty: 1, desc: "PRADA AMBER POUR HOMME EDT TESTER 100ML", barcode: "222" },
    { sku: "LG109900", qty: 1, desc: "U002 BANANA YELLOW LIP BALM", barcode: "333" },
    { sku: "LE055101", qty: 1, desc: "ROUGE MONOCHROME HYPER MATTE AMBER O76 LIPSTICK", barcode: "444" },
    // zero-qty SOH entry must not swallow a packed -TST sister SKU
    { sku: "LG100600-TST", qty: 0, desc: "stale zero", barcode: "LG100600-TST" },
  ]);
  var bundles = [
    {
      boxNo: "PK-261127-001",
      lines: [
        { sku: "STOCK1", qty: 2, desc: "Leftover stock", barcode: "111" },
        { sku: "LD076001", qty: 1, desc: "PRADA AMBER POUR HOMME EDT TESTER 100ML", barcode: "222" },
        { sku: "LG109900", qty: 1, desc: "U002 BANANA YELLOW LIP BALM", barcode: "333" },
        { sku: "LE055101", qty: 1, desc: "ROUGE MONOCHROME HYPER MATTE AMBER O76 LIPSTICK", barcode: "444" },
        {
          sku: "LG100600-TST",
          qty: 1,
          desc: "U002 BANANA YELLOW LIP BALM TESTER",
          barcode: "LG100600-TST",
        },
        {
          sku: "LE032000-TST",
          qty: 1,
          desc: "ROUGE MONOCHROME HYPER MATTE AMBER O76 LIPSTICK TESTER",
          barcode: "LE032000-TST",
        },
      ],
    },
  ];
  var check = enrichCounterCheck(packingCounterCheck(soh, bundles));
  assert.equal(check.totals.packedPcs, 7);
  assert.equal(check.totals.doneSku, 3); // LD076001, LG109900, LE055101
  assert.equal(check.totals.leftoverSku, 1); // STOCK1
  assert.equal(check.totals.missingSku, 2); // both -TST
  assert.ok(check.missing.find((r) => r.sku === "LG100600-TST"));
  assert.ok(check.missing.find((r) => r.sku === "LE032000-TST"));
  assert.ok(check.done.find((r) => r.sku === "LD076001"));

  var data = buildCounterCheckExcelData({
    counter: "CENTRAL CHIDLOM - PRADA",
    asOf: "27/11/2026",
    check: check,
    includedOpen: true,
    bundles: bundles,
    stamp: "20261127-1207",
    includeStatusSheets: true,
    filter: { issueCat: "leftover", typeCat: "ALL", query: "", brand: "" },
  });

  var summary = Object.fromEntries(data.sheets[0].aoa.slice(1));
  assert.equal(summary["Packed pcs"], 7);
  assert.equal(summary["Done SKU"], 3);
  assert.equal(summary["Active filters"], "Issue=ขาด");
  assert.equal(summary["Filtered SKU rows"], 1);
  assert.equal(summary["All SKUs rows"], check.rows.length);

  var allBody = data.sheets.find((s) => s.name === "All SKUs").aoa.slice(1);
  assert.equal(allBody.length, check.rows.length);
  var allPacked = allBody.reduce((n, r) => n + (Number(r[9]) || 0), 0);
  assert.equal(allPacked, 7);
  assert.equal(data.byPkPacked, 7);
  assert.equal(data.allPacked, 7);

  // Status sheets stay full despite Issue=ขาด filter
  assert.equal(data.sheets.find((s) => s.name === "ครบ").aoa.length, 1 + 3);
  assert.equal(data.sheets.find((s) => s.name === "ไม่มีใน POS").aoa.length, 1 + 2);
  assert.equal(data.sheets.find((s) => s.name === "ยังไม่แพ็ค").aoa.length, 1 + 1);
  assert.ok(data.sheets.find((s) => s.name === "Filtered"));
  assert.equal(data.sheets.find((s) => s.name === "Filtered").aoa.length, 2); // header + STOCK1

  var byPk = data.sheets.find((s) => s.name === "By PK").aoa;
  assert.deepEqual(byPk[0].slice(6), ["Qty", "POS SOH", "Remaining SOH"]);
  var byPkQty = byPk.slice(1).reduce((n, r) => n + (Number(r[6]) || 0), 0);
  assert.equal(byPkQty, 7);

  var stockLine = byPk.find((r) => r[2] === "STOCK1");
  assert.equal(stockLine[7], 10);
  assert.equal(stockLine[8], 8); // Remaining = All SKUs Left

  var doneLine = byPk.find((r) => r[2] === "LD076001");
  assert.equal(doneLine[7], 1);
  assert.equal(doneLine[8], 0);

  var tstLine = byPk.find((r) => r[2] === "LG100600-TST");
  assert.equal(tstLine[7], ""); // not in POS
  assert.match(String(tstLine[8]), /not in POS/);
  assert.match(String(tstLine[8]), /^-1/);

  // -TST present on All SKUs as ไม่มีใน POS
  var tstAll = allBody.find((r) => r[5] === "LG100600-TST");
  assert.ok(tstAll);
  assert.equal(tstAll[0], "ไม่มีใน POS");
  assert.equal(tstAll[9], 1);
});

test("parseItemSize + detectCounterCheckSwaps (sample barcode pair)", () => {
  assert.deepEqual(parseItemSize("FM L'EAU D'HIVER PERFUME EDT 100ML SPRAY"), {
    value: 100,
    unit: "ML",
    key: "100ML",
  });
  assert.deepEqual(parseItemSize("body cream 50 G"), { value: 50, unit: "G", key: "50G" });
  assert.equal(parseItemSize("no size here"), null);
  assert.equal(
    descsVerySimilar(
      "FM L'EAU D'HIVER PERFUME EDT 100ML SPRAY",
      "FREDERIC MALLE L'EAU D'HIVER ASMB  EDT 100ML"
    ),
    true
  );

  var rows = [
    {
      sku: "H3RH010000",
      desc: "FM L'EAU D'HIVER PERFUME EDT 100ML SPRAY",
      barcode: "3700135001312",
      status: "leftover",
      soh: 2,
      packed: 0,
      left: 2,
      over: 0,
    },
    {
      sku: "H4GR010000",
      desc: "FREDERIC MALLE L'EAU D'HIVER ASMB  EDT 100ML",
      barcode: "3700135001312",
      status: "over",
      soh: 5,
      packed: 6,
      left: 0,
      over: 1,
    },
    {
      sku: "OTHER1",
      desc: "UNRELATED EDT 100ML",
      barcode: "999",
      status: "leftover",
      left: 1,
      over: 0,
    },
  ];
  var pairs = detectCounterCheckSwaps(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].reason, "barcode");
  assert.equal(pairs[0].size, "100ML");
  var skus = [pairs[0].a.sku, pairs[0].b.sku].sort();
  assert.deepEqual(skus, ["H3RH010000", "H4GR010000"]);

  var soh = sohMapFromRows([
    { sku: "H3RH010000", qty: 2, desc: rows[0].desc, barcode: "3700135001312" },
    { sku: "H4GR010000", qty: 5, desc: rows[1].desc, barcode: "3700135001312" },
  ]);
  var check = enrichCounterCheck(
    packingCounterCheck(soh, [
      { boxNo: "PK1", lines: [{ sku: "H4GR010000", qty: 6, barcode: "3700135001312", desc: rows[1].desc }] },
    ])
  );
  assert.equal(check.totals.swappedSku, 2);
  assert.equal(check.totals.swappedPairs, 1);
  var short = check.rows.find((r) => r.sku === "H3RH010000");
  var overR = check.rows.find((r) => r.sku === "H4GR010000");
  assert.equal(short.status, "leftover");
  assert.equal(overR.status, "over");
  assert.equal(short.swapped, true);
  assert.equal(short.swapWith, "H4GR010000");
  assert.match(short.swapNote, /สลับกับ H4GR010000/);
  assert.equal(overR.swapWith, "H3RH010000");

  var typeCounts = counterCheckTypeCounts(check.rows);
  assert.ok(typeCounts.ALL.sku >= 2);
  assert.ok("packed" in typeCounts.ALL && "remaining" in typeCounts.ALL);
  var issueCounts = counterCheckIssueCounts(check.rows);
  assert.equal(issueCounts.leftover.sku, 1);
  assert.equal(issueCounts.over.sku, 1);
  assert.equal(issueCounts.swapped.sku, 2);
  assert.equal(issueCounts.notStarted.sku, 1); // H3RH packed 0

  assert.equal(filterCounterCheckRows(check.rows, { issueCat: "swapped" }).length, 2);
  assert.equal(filterCounterCheckRows(check.rows, { issueCat: "leftover" }).length, 1);
  assert.equal(filterCounterCheckRows(check.rows, { typeCat: "STOCK", issueCat: "ALL" }).length, 2);
  assert.equal(packingCounterCheckIssueLabel("leftover"), "ขาด");
  assert.equal(packingCounterCheckIssueLabel("missing"), "No POS");
  assert.equal(packingCounterCheckIssueLabel("notStarted"), "ยังไม่เริ่ม");
  assert.equal(packingCounterCheckIssueLabel("partial"), "แพ็คบางส่วน");

  // Similar description, different barcodes — still a swap when sizes match
  var descPairs = detectCounterCheckSwaps([
    {
      sku: "A1",
      desc: "NISHANE HACIVAT EDP 100ML",
      barcode: "111",
      status: "leftover",
      left: 1,
    },
    {
      sku: "B1",
      desc: "NISHANE HACIVAT EXTRAIT 100ML",
      barcode: "222",
      status: "over",
      over: 1,
    },
  ]);
  assert.equal(descPairs.length, 1);
  assert.equal(descPairs[0].reason, "desc");
});

test("counter-check chip stats: packed/remaining + overlapping issue views", () => {
  assert.equal(VERSION, "20261127l");
  assert.ok(COUNTER_CHECK_ISSUE_DEFS.some((d) => d.key === "nearDone"));
  assert.equal(normalizeCounterCheckIssueCat("ยังไม่เริ่ม"), "notStarted");
  assert.equal(normalizeCounterCheckIssueCat("ใกล้ครบ"), "nearDone");

  var soh = sohMapFromRows([
    { sku: "A0", qty: 5, desc: "Not started STOCK", barcode: "a0" },
    { sku: "B1", qty: 10, desc: "Partial STOCK", barcode: "b1" },
    { sku: "C2", qty: 3, desc: "Near done left2", barcode: "c2" },
    { sku: "D3", qty: 4, desc: "Done STOCK", barcode: "d3" },
    { sku: "E4", qty: 2, desc: "Over STOCK", barcode: "e4" },
    { sku: "T1", qty: 8, desc: "TESTER leftover", barcode: "t1" },
  ]);
  var bundles = [
    {
      boxNo: "PK-SAVED",
      lines: [
        { sku: "B1", qty: 3, desc: "Partial STOCK" },
        { sku: "C2", qty: 1, desc: "Near done left2" },
        { sku: "D3", qty: 4, desc: "Done STOCK" },
        { sku: "E4", qty: 5, desc: "Over STOCK" },
        { sku: "T1", qty: 2, desc: "TESTER leftover" },
        { sku: "MISS1", qty: 2, desc: "No POS item" },
      ],
    },
  ];
  var draftPacked = packingSkuQtyMap([
    { sku: "B1", qty: 1 },
    { sku: "A0", qty: 0 }, // ignored
    { sku: "NEW1", qty: 3 }, // draft-only; may not be in check until packed in bundles
  ]);
  // Include draft lines in check totals the way UI merges open draft
  var withDraft = bundles.concat([
    {
      boxNo: "__open__",
      lines: [
        { sku: "B1", qty: 1, desc: "Partial STOCK" },
        { sku: "NEW1", qty: 3, desc: "Draft only" },
      ],
    },
  ]);
  var check = enrichCounterCheck(packingCounterCheck(soh, withDraft), {
    draftPacked: draftPacked,
  });

  // A0 not started; B1 partial (4/10); C2 nearDone (1 packed, left 2); D3 done; E4 over; T1 partial tester; NEW1+MISS1 missing
  var a0 = check.rows.find((r) => r.sku === "A0");
  var b1 = check.rows.find((r) => r.sku === "B1");
  var c2 = check.rows.find((r) => r.sku === "C2");
  assert.equal(a0.status, "leftover");
  assert.equal(a0.packed, 0);
  assert.equal(a0.left, 5);
  assert.ok(counterCheckRowMatchesIssue(a0, "notStarted"));
  assert.equal(counterCheckRowMatchesIssue(a0, "partial"), false);

  assert.equal(b1.packed, 4);
  assert.equal(b1.left, 6);
  assert.ok(counterCheckRowMatchesIssue(b1, "partial"));
  assert.equal(counterCheckRowMatchesIssue(b1, "nearDone"), false);
  assert.equal(b1.draftPacked, 1);
  assert.ok(counterCheckRowMatchesIssue(b1, "unsaved"));

  assert.equal(c2.left, 2);
  assert.ok(counterCheckRowMatchesIssue(c2, "nearDone"));
  assert.ok(counterCheckRowMatchesIssue(c2, "partial"));
  assert.deepEqual(counterCheckRowFlags(c2), ["แพ็คบางส่วน", "ใกล้ครบ"]);

  var issues = counterCheckIssueCounts(check.rows);
  assert.equal(issues.leftover.sku, issues.notStarted.sku + issues.partial.sku);
  assert.equal(issues.notStarted.sku, 1); // A0
  assert.ok(issues.partial.sku >= 2); // B1, C2, T1
  assert.equal(issues.nearDone.sku, 1); // C2 only (left 2, packed>0)
  var new1 = check.rows.find((r) => r.sku === "NEW1");
  assert.ok(new1);
  assert.equal(new1.status, "missing");
  assert.equal(new1.draftPacked, 3);
  assert.equal(issues.unsaved.sku, 2); // B1 + NEW1
  assert.equal(issues.unsaved.packed, 1 + 3); // draft pcs, not total packed
  assert.equal(issues.ALL.packed, check.totals.packedPcs);

  var allStats = counterCheckRowStats(check.rows);
  assert.equal(allStats.packed, check.totals.packedPcs);
  assert.equal(allStats.remaining, check.totals.leftoverPcs);

  var leftoverRows = filterCounterCheckRows(check.rows, { issueCat: "leftover" });
  var leftoverStats = counterCheckRowStats(leftoverRows);
  var lines = formatCounterCheckChipLines("ขาด", leftoverStats);
  assert.match(lines.title, /^ขาด /);
  assert.match(lines.sub, /^แพ็ค \d+ · เหลือ \d+$/);
  assert.equal(leftoverStats.remaining, issues.leftover.remaining);

  // Cross-filter: issue chips within Tester only
  var testerOnly = filterCounterCheckRows(check.rows, {
    typeCat: "TESTER",
    issueCat: "ALL",
  });
  var testerIssues = counterCheckIssueCounts(testerOnly);
  assert.equal(testerIssues.ALL.sku, 1);
  assert.equal(testerIssues.partial.sku, 1);
  assert.equal(testerIssues.notStarted.sku, 0);

  // Group chips within ขาด
  var shortOnly = filterCounterCheckRows(check.rows, {
    typeCat: "ALL",
    issueCat: "leftover",
  });
  var shortTypes = counterCheckTypeCounts(shortOnly);
  assert.equal(shortTypes.ALL.sku, leftoverRows.length);
  assert.ok(shortTypes.TESTER.sku >= 1);
  assert.ok(shortTypes.STOCK.sku >= 1);

  assert.equal(filterCounterCheckRows(check.rows, { issueCat: "ยังไม่เริ่ม" }).length, 1);
  assert.equal(filterCounterCheckRows(check.rows, { issueCat: "ใกล้ครบ" }).length, 1);
  assert.equal(filterCounterCheckRows(check.rows, { issueCat: "unsaved" }).length, 2);

  var data = buildCounterCheckExcelData({
    counter: "CHIP TEST",
    check: check,
    bundles: withDraft,
    stamp: "20261127-1400",
    includeStatusSheets: true,
  });
  var nearSheet = data.sheets.find((s) => s.name === "ใกล้ครบ");
  assert.ok(nearSheet);
  assert.equal(nearSheet.aoa.length, 2); // header + C2
  var unsavedSheet = data.sheets.find((s) => s.name === "ยังไม่บันทึก");
  assert.equal(unsavedSheet.aoa.length, 1 + 2);
  var flagsIdx = data.sheets.find((s) => s.name === "All SKUs").aoa[0].indexOf("Flags");
  assert.ok(flagsIdx >= 0);
  var c2Excel = data.sheets
    .find((s) => s.name === "All SKUs")
    .aoa.slice(1)
    .find((r) => r[5] === "C2");
  assert.match(String(c2Excel[flagsIdx]), /ใกล้ครบ/);
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

test("stripBrandFromPackDesc + clipPackQrDesc", () => {
  assert.equal(PACK_QR_DESC_CLIP, 28);
  assert.equal(PACK_QR_MAX, 2000);
  assert.equal(
    stripBrandFromPackDesc("PRADA UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G", "PRADA"),
    "UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G"
  );
  assert.equal(
    stripBrandFromPackDesc(
      "GIORGIO ARMANI SI PASSIONE EDP 100ML",
      "GIORGIO ARMANI"
    ),
    "SI PASSIONE EDP 100ML"
  );
  assert.equal(
    stripBrandFromPackDesc(
      "YVES SAINT LAURENT LIBRE EDP 90ML",
      "YVES SAINT LAURENT"
    ),
    "LIBRE EDP 90ML"
  );
  // brand equals whole desc → keep original (never empty)
  assert.equal(stripBrandFromPackDesc("PRADA", "PRADA"), "PRADA");
  // no brand field → strip leading token
  assert.equal(
    stripBrandFromPackDesc("PRADA UNIVERSAL U001 BLUE LIP BALM", ""),
    "UNIVERSAL U001 BLUE LIP BALM"
  );
  var long =
    "UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G EXTRA WORDS";
  var clipped = clipPackQrDesc(long);
  assert.ok(clipped.length <= 28);
  assert.match(clipped, /…$/);
  assert.equal(
    formatPackQrLine(
      {
        sku: "LE901900",
        qty: 4,
        brand: "PRADA",
        desc: "PRADA UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G",
      },
      "desc"
    ),
    "LE901900 x4 " + clipPackQrDesc("UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G")
  );
  assert.equal(
    formatPackQrLine({ sku: "LE901900", qty: 4, desc: "PRADA FOO", brand: "PRADA" }, "sku"),
    "LE901900 x4"
  );
});

test("buildPackQrText: tiny keeps desc; 63 lines → SKU-only; 400 → +N more", () => {
  assert.equal(VERSION, "20261127l");
  var meta = {
    boxNo: "PK-261127-001",
    boxSeq: 1,
    boxCount: 1,
    shipTo: "CENTRAL CHIDLOM - PRADA",
    from: "WH PRESTIGE",
    refNo: "GRF-1",
  };

  var tiny = [
    {
      sku: "A1",
      qty: 2,
      brand: "PRADA",
      desc: "PRADA UNIVERSAL U001 BLUE LIP BALM TESTER 3.8G",
    },
    {
      sku: "B2",
      qty: 1,
      brand: "GIORGIO ARMANI",
      desc: "GIORGIO ARMANI SI PASSIONE EDP 100ML",
    },
  ];
  var tinyText = buildPackQrText(meta, tiny, PACK_QR_MAX, utf8ByteLen);
  assert.match(tinyText, /^PK-261127-001 BOX 1\/1\n/);
  assert.match(tinyText, /To: CENTRAL CHIDLOM - PRADA/);
  assert.match(tinyText, /From: WH PRESTIGE/);
  assert.match(tinyText, /Ref\/GRF: GRF-1/);
  assert.match(tinyText, /Total 2 SKU \/ 3 pcs/);
  assert.match(tinyText, /A1 x2 UNIVERSAL/);
  assert.match(tinyText, /B2 x1 SI PASSIONE/);
  assert.equal(tinyText.includes("more"), false);
  assert.ok(utf8ByteLen(tinyText) <= PACK_QR_MAX);

  // 63 SKU / 109 pcs — long brand-prefixed descs force SKU-only mode
  var lines63 = [];
  var pcs = 0;
  for (var i = 0; i < 63; i++) {
    var q = i < 46 ? 2 : 1; // 46*2 + 17*1 = 92+17 = 109
    pcs += q;
    var sku = "LE" + String(900000 + i).slice(-6);
    lines63.push({
      sku: sku,
      qty: q,
      brand: "PRADA",
      desc:
        "PRADA UNIVERSAL U00" +
        i +
        " BLUE LIP BALM TESTER 3.8G LONG NAME " +
        i,
    });
  }
  assert.equal(lines63.length, 63);
  assert.equal(pcs, 109);
  var text63 = buildPackQrText(meta, lines63, PACK_QR_MAX, utf8ByteLen);
  assert.ok(utf8ByteLen(text63) <= PACK_QR_MAX);
  assert.match(text63, /Total 63 SKU \/ 109 pcs/);
  assert.equal(text63.includes("more"), false);
  // every SKU present; no descriptions (SKU-only — no space after qty)
  for (var j = 0; j < 63; j++) {
    var id = lines63[j].sku;
    assert.match(text63, new RegExp(id + " x" + lines63[j].qty + "(?:\\n|$)"));
    assert.equal(text63.includes("UNIVERSAL"), false);
    assert.equal(text63.includes("PRADA UNIVERSAL"), false);
  }
  // uniform: no mixed desc lines
  assert.equal(/\nLE\d+ x\d+ \S/.test(text63), false);

  // 400 lines — SKU-only still too big → ...+N more
  var lines400 = [];
  for (var k = 0; k < 400; k++) {
    lines400.push({
      sku: "SKU" + String(k).padStart(4, "0"),
      qty: 1,
      brand: "X",
      desc: "X PRODUCT " + k,
    });
  }
  var text400 = buildPackQrText(
    {
      boxNo: "PK-BIG",
      boxSeq: 1,
      boxCount: 1,
      shipTo: "SOME LONG DESTINATION NAME HERE",
      from: "SOME LONG FROM COUNTER NAME",
    },
    lines400,
    PACK_QR_MAX,
    utf8ByteLen
  );
  assert.ok(utf8ByteLen(text400) <= PACK_QR_MAX);
  assert.match(text400, /\.\.\.\+\d+ more/);
  assert.match(text400, /Total 400 SKU \/ 400 pcs/);
  assert.match(text400, /^PK-BIG BOX 1\/1\n/);
});

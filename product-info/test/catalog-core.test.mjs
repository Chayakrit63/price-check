import test from "node:test";
import assert from "node:assert/strict";
import {
  itemTypeBucket,
  rowTypeBucket,
  parseSearchQty,
  searchQueryOnly,
  searchCatalog,
  editDistance,
  filterRowsByType,
  counterNamesDeduped,
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
} from "../lib/catalog-core.mjs";

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
  assert.equal(itemTypeBucket("1800103", "GIFT BAG POSM", "OTH", ""), "OTH");
  assert.equal(itemTypeBucket("3111601-TRG", "TRAINING", "OTH", ""), "OTH");
  assert.equal(itemTypeBucket("X", "", "SAMP", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "GWP", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "MINI", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "PR GIFT", ""), "GWPS");
  assert.equal(itemTypeBucket("X", "", "OTH", "STOCK"), "STOCK");
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
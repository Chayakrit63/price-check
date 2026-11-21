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
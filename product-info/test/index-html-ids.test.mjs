import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

/** Collect id="…" occurrences (static markup + JS string templates). */
function idCounts(src) {
  var counts = Object.create(null);
  var re = /\bid=["']([^"']+)["']/g;
  var m;
  while ((m = re.exec(src))) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
}

test("Counter check: datalist id ≠ results list id (no duplicate ctr-check-list)", () => {
  assert.match(HTML, /list="ctr-check-ctr-opts"/);
  assert.match(HTML, /<datalist id="ctr-check-ctr-opts">/);
  assert.match(HTML, /fillDatalist\("ctr-check-ctr-opts"/);
  assert.match(HTML, /<div id="ctr-check-list"><\/div>/);
  assert.equal((HTML.match(/id="ctr-check-list"/g) || []).length, 1);
  assert.equal((HTML.match(/id="ctr-check-ctr-opts"/g) || []).length, 1);
  // Tap handler + row paint must target the results node inside #ctr-check-body
  assert.match(HTML, /host\.querySelector\("#ctr-check-list"\)/);
  assert.equal((HTML.match(/host\.querySelector\("#ctr-check-list"\)/g) || []).length >= 2, true);
  // No silent row slice in Counter check list paint
  assert.match(HTML, /rows\.forEach\(function\(r\)\{\s*listHtml\+=ctrCheckItemHtml\(r\);\s*\}\)/);
  assert.doesNotMatch(HTML, /rows\.slice\(0,\s*\d+\).*ctrCheckItemHtml/);
});

test("index.html: no duplicate DOM ids that would collide in one sheet", () => {
  var counts = idCounts(HTML);
  // soh-left-to-ctr appears in both branches of a ternary — only one is in the DOM.
  var allow = { "soh-left-to-ctr": true };
  var dups = Object.keys(counts)
    .filter((id) => counts[id] > 1 && !allow[id])
    .sort();
  assert.deepEqual(dups, [], "duplicate ids: " + dups.join(", "));
});

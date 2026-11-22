/**
 * Headless phone-viewport smoke for Packing SOH UI.
 * Run: node test/soh-smoke.mjs  (server must serve product-info on :8765)
 */
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = process.env.SOH_SMOKE_URL || "http://127.0.0.1:8765/index.html";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const FROM = "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function buildSohRows() {
  const rows = [];
  rows.push({ sku: "H0D7010000", barcode: "3700135021143", desc: "Item H0D7010000", qty: 27 });
  rows.push({ sku: "H0D8400000", barcode: "3700135029999", desc: "Item H0D8400000", qty: 57 });
  for (let i = 3; i <= 110; i++) {
    const sku = "SOH" + String(i).padStart(6, "0");
    rows.push({ sku, barcode: "9" + String(i).padStart(12, "0"), desc: "SOH filler " + i, qty: 6 });
  }
  // 27+57+108*6 = 84+648 = 732 — bump last to hit ~749? not required; shape matters
  return rows;
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 180000,
    args: ["--no-sandbox", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch (e) {}
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err && err.message ? err.message : err)));

  // Avoid real Apps Script / camera noise
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/script\.google\.com|macros\/s\//.test(url)) {
      const cb = (url.match(/[?&]callback=([^&]+)/) || [])[1];
      const payload = JSON.stringify({ ok: false, error: "unknown api" });
      if (cb) {
        req.respond({
          status: 200,
          contentType: "application/javascript",
          body: decodeURIComponent(cb) + "(" + payload + ");",
        });
      } else {
        req.respond({ status: 200, contentType: "application/json", body: payload });
      }
      return;
    }
    req.continue();
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.CatalogCore && window.__pk && typeof onCat === "function"), {
    timeout: 30000,
  });
  await page.evaluate(() => {
    window.confirm = function () {
      return true;
    };
    window.alert = function () {};
    try {
      localStorage.setItem("productInfo.camOn", "0");
    } catch (e) {}
    if (typeof setCamUserOn === "function") setCamUserOn(false);
    if (typeof stopCam === "function") stopCam();
  });

  // --- NO SOH path: packing UI unchanged (no last/summary) ---
  const noSoh = await page.evaluate((FROM) => {
    localStorage.setItem("productInfo.camOn", "0");
    if (typeof setCamUserOn === "function") setCamUserOn(false);
    // seed tiny catalog
    const rows = [
      ["H0D7010000", "DIOR", "LINE", "Item H0D7010000", "STOCK", "EDP", "Active", "3700135021143"],
      ["H0D8400000", "DIOR", "LINE", "Item H0D8400000", "STOCK", "EDP", "Active", "3700135029999"],
      ["NOTINSOH1", "OTHER", "LINE", "Not in SOH item", "STOCK", "EDP", "Active", "1111111111111"],
    ];
    onCat({ updated: "smoke", count: rows.length, rows });
    setTab("pack");
    const b = {
      id: "smoke-nosoh",
      boxNo: "",
      status: "Draft",
      created: "smoke",
      createdTs: Date.now(),
      lines: [],
      dirty: true,
      boxCount: 1,
      activeBox: 1,
      shipTo: "Pullback to Warehouse",
      from: "",
      packedBy: "Smoke",
      note: "",
      refNo: "",
    };
    PK.drafts[b.id] = b;
    PK.cur = b.id;
    pkPersist();
    pkShow("box");
    const row = lookup("H0D7010000")[0];
    pkAdd(row, row.sku, 1, { typed: true });
    return {
      lastShow: document.getElementById("pk-soh-last").classList.contains("show"),
      sumShow: document.getElementById("pk-soh-sum").classList.contains("show"),
      lineSoh: !!document.querySelector(".pk-soh-line"),
      lines: document.querySelectorAll("#pk-lines .ln").length,
    };
  }, FROM);
  assert(!noSoh.lastShow, "no-SOH: last bar hidden");
  assert(!noSoh.sumShow, "no-SOH: summary hidden");
  assert(!noSoh.lineSoh, "no-SOH: no inline POS lines");
  assert(noSoh.lines === 1, "no-SOH: still can pack");

  // --- WITH SOH ---
  const withSoh = await page.evaluate(
    (FROM, sohRows) => {
      const out = { steps: [] };
      function note(k, v) {
        out.steps.push(k);
        out[k] = v;
      }

      // store SOH local for From counter
      pkSohStoreLocal(FROM, {
        asOf: "22/11/2026 15:35",
        fileName: "export_inventory_summary_all_20261122.xlsx",
        rows: sohRows,
        skuCount: sohRows.length,
        pcs: sohRows.reduce((n, r) => n + r.qty, 0),
      });

      const b = {
        id: "smoke-soh",
        boxNo: "",
        status: "Draft",
        created: "smoke",
        createdTs: Date.now(),
        lines: [],
        dirty: true,
        boxCount: 1,
        activeBox: 1,
        shipTo: "Pullback to Warehouse",
        from: FROM,
        packedBy: "Smoke",
        note: "",
        refNo: "",
      };
      PK.drafts[b.id] = b;
      PK.cur = b.id;
      pkPersist();
      pkShow("box");
      pkEnsureSohForBox(b);
      pkRenderBox();

      note("chip", (document.getElementById("h-soh") || {}).textContent || "");
      note("sumBefore", document.getElementById("pk-soh-sum").classList.contains("show"));

      // add in-SOH SKU
      const a = lookup("H0D7010000")[0];
      pkAdd(a, a.sku, 1, { typed: true });
      note("lastAfterAdd", document.getElementById("pk-soh-last").innerText);
      note("lastShow", document.getElementById("pk-soh-last").classList.contains("show"));
      note("sumText", document.getElementById("pk-soh-sum").innerText.replace(/\s+/g, " "));

      // exceed SOH for this SKU (27) without big-qty confirm loop: set line qty directly then refresh
      var lineA = findLine(curBox(), "S:H0D7010000");
      lineA.qty = 80;
      pkSetSohLast("H0D7010000", lineA.desc);
      pkPersist();
      pkRenderBox();
      note("lastOver", document.getElementById("pk-soh-last").innerText);
      note("lastOverClass", document.querySelector("#pk-soh-last .st").className);

      // not in SOH
      const miss = lookup("NOTINSOH1")[0];
      pkAdd(miss, miss.sku, 2, { typed: true });
      note("lastMiss", document.getElementById("pk-soh-last").innerText);
      note("lastMissClass", document.querySelector("#pk-soh-last .st").className);

      // multi-box cumulative: add H0D8400000 in box1 then box2
      const bsku = lookup("H0D8400000")[0];
      pkAdd(bsku, bsku.sku, 10, { typed: true });
      var lineB = findLine(curBox(), "S:H0D8400000");
      lineB.qty = 50;
      pkPersist();
      pkAddBox();
      pkAdd(bsku, bsku.sku, 10, { typed: true }); // total 60 > 57
      note("lastMulti", document.getElementById("pk-soh-last").innerText);
      note("sumMulti", document.getElementById("pk-soh-sum").innerText.replace(/\s+/g, " "));
      note("boxCount", boxCountOf(curBox()));

      // qty − on active box line for H0D8400000
      const line = findLine(curBox(), "S:H0D8400000");
      line.qty = Number(line.qty) - 1; // 9 in box2 → total 59
      pkSetSohLast("H0D8400000", line.desc);
      pkPersist();
      pkRenderBox();
      note("lastAfterDec", document.getElementById("pk-soh-last").innerText);

      // typed qty
      line.qty = 5; // total 55
      pkSetSohLast("H0D8400000", line.desc);
      pkPersist();
      pkRenderBox();
      note("lastAfterType", document.getElementById("pk-soh-last").innerText);

      // leftover sheet
      pkOpenSohLeftoverSheet();
      note("leftoverOpen", document.getElementById("sheet").classList.contains("hidden") === false);
      note("leftoverTitle", document.getElementById("sh-t").textContent);
      note("leftoverSub", document.getElementById("sh-p").textContent);
      note("leftoverItems", document.querySelectorAll(".soh-left-item").length);
      closeSheet(false);

      // filter over
      pkSetSohFilter("over");
      note("filterOverLines", document.querySelectorAll("#pk-lines .ln").length);
      note("filterBtnOn", !!document.querySelector('#pk-soh-sum button.err.on'));
      pkSetSohFilter(null);

      // review sheet html includes SOH section
      const review = pkBuildSummaryHtml(curBox());
      note("reviewHasSoh", /SOH vs/.test(review) || /ไม่มีใน POS|เกิน|แพ็ค/.test(review));

      // undo last add path: add then undo
      const beforeUndo = packItemList(curBox()).length;
      pkAdd(a, a.sku, 1, { typed: true });
      pkUndoLastAdd();
      note("undoLines", packItemList(curBox()).length === beforeUndo);
      note("lastAfterUndo", document.getElementById("pk-soh-last").innerText);

      return out;
    },
    FROM,
    buildSohRows()
  );

  assert(withSoh.sumBefore === true, "summary shows when SOH loaded");
  assert(withSoh.lastShow === true, "last bar shows after add");
  assert(/H0D7010000/.test(withSoh.lastAfterAdd), "last bar has SKU");
  assert(/เหลือ|แพ็ค/.test(withSoh.lastAfterAdd), "last bar has remaining text");
  assert(/เกิน/.test(withSoh.lastOver), "last bar shows over");
  assert(/over/.test(withSoh.lastOverClass), "over class on last bar");
  assert(/ไม่มีใน POS/.test(withSoh.lastMiss), "missing yellow status");
  assert(/miss/.test(withSoh.lastMissClass), "miss class");
  assert(withSoh.boxCount === 2, "multi-box created");
  assert(/เกิน/.test(withSoh.lastMulti), "multi-box cumulative over");
  assert(/110 SKU|ครบ/.test(withSoh.sumMulti), "summary mentions SKU totals");
  assert(/เหลือ|เกิน/.test(withSoh.lastAfterDec), "last updates after dec");
  assert(/เหลือ|เกิน|ครบ/.test(withSoh.lastAfterType), "last updates after typed qty");
  assert(withSoh.leftoverOpen === true, "leftover sheet opens");
  assert(/ยังไม่แพ็ค/.test(withSoh.leftoverTitle), "leftover title");
  assert(/15:35|SOH ณ/.test(withSoh.leftoverSub), "as-of in leftover header");
  assert(withSoh.leftoverItems > 0, "leftover has rows");
  assert(withSoh.filterOverLines >= 1, "over filter shows lines");
  assert(withSoh.reviewHasSoh === true, "review sheet has SOH section");
  assert(withSoh.undoLines === true, "undo restores line count");

  // draft restore after reload
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.CatalogCore && window.__pk), { timeout: 15000 });
  const restored = await page.evaluate((FROM, sohRows) => {
    localStorage.setItem("productInfo.camOn", "0");
    if (typeof setCamUserOn === "function") setCamUserOn(false);
    const rows = [
      ["H0D7010000", "DIOR", "LINE", "Item H0D7010000", "STOCK", "EDP", "Active", "3700135021143"],
      ["H0D8400000", "DIOR", "LINE", "Item H0D8400000", "STOCK", "EDP", "Active", "3700135029999"],
      ["NOTINSOH1", "OTHER", "LINE", "Not in SOH item", "STOCK", "EDP", "Active", "1111111111111"],
    ];
    onCat({ updated: "smoke", count: rows.length, rows });
    pkSohStoreLocal(FROM, {
      asOf: "22/11/2026 15:35",
      fileName: "export_inventory_summary_all_20261122.xlsx",
      rows: sohRows,
      skuCount: sohRows.length,
      pcs: sohRows.reduce((n, r) => n + r.qty, 0),
    });
    pkLoad();
    setTab("pack");
    const ids = Object.keys(PK.drafts || {});
    const draft = ids.map((id) => PK.drafts[id]).find((d) => d && d.from === FROM);
    if (!draft) return { ok: false, reason: "draft missing", ids };
    PK.cur = draft.id;
    pkPersist();
    pkShow("box");
    pkEnsureSohForBox(draft);
    pkRenderBox();
    return {
      ok: true,
      lines: packItemList(draft).length,
      boxes: boxCountOf(draft),
      sumShow: document.getElementById("pk-soh-sum").classList.contains("show"),
      chip: (document.getElementById("h-soh") || {}).textContent || "",
    };
  }, FROM, buildSohRows());
  assert(restored.ok, "draft restored: " + (restored.reason || ""));
  assert(restored.lines >= 1, "restored draft has lines");
  assert(restored.boxes >= 1, "restored draft has boxes");
  assert(restored.sumShow === true, "SOH summary after restore");

  // Filter known-benign console noise (CORS/JSONP against mocked Apps Script, CDN)
  const serious = consoleErrors.filter(
    (t) =>
      !/Failed to load resource/i.test(t) &&
      !/net::ERR/i.test(t) &&
      !/CORS policy/i.test(t) &&
      !/Access-Control-Allow-Origin/i.test(t) &&
      !/script\.google\.com/i.test(t) &&
      !/cdn\.jsdelivr|unpkg|fonts\.g/i.test(t)
  );
  const seriousPage = pageErrors.filter(
    (t) => !/ResizeObserver|Script error|Unexpected token ':'|unknown api/i.test(t)
  );

  await browser.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        noSoh,
        withSoh: {
          chip: withSoh.chip,
          lastOver: withSoh.lastOver,
          lastMiss: withSoh.lastMiss,
          lastMulti: withSoh.lastMulti,
          sumMulti: withSoh.sumMulti,
          leftoverItems: withSoh.leftoverItems,
          filterOverLines: withSoh.filterOverLines,
          boxCount: withSoh.boxCount,
        },
        restored,
        consoleErrors: serious,
        pageErrors: seriousPage,
      },
      null,
      2
    )
  );

  if (serious.length || seriousPage.length) {
    throw new Error("Console/page errors: " + JSON.stringify({ serious, seriousPage }));
  }
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e && e.stack ? e.stack : e);
  process.exit(1);
});

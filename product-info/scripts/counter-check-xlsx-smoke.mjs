/**
 * Screenshot Counter check sheet with Excel button enabled (390×844).
 */
import fs from "fs";
import path from "path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = process.env.SOH_SMOKE_URL || "http://127.0.0.1:8765/index.html";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const FROM = "FM x GD POPUP at Fashion Hall, Siam Paragon 12-22 NOV 2026";
const OUT = process.env.SMOKE_SHOT_DIR || "/opt/cursor/artifacts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // serve: assume already up, else start? caller starts server
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch (e) {}
  });

  // Mock boxes/export/possoh with tiny fixture so Check completes
  const sohRows = [];
  for (let i = 0; i < 5; i++) {
    sohRows.push({
      sku: "SKU" + i,
      barcode: "000" + i,
      desc: "Item " + i,
      qty: 3,
      brand: "DIOR",
    });
  }
  const cols = [
    "BoxNo","Created","Closed","ShipTo","From","RefNo","PackedBy","Status","BoxOf","Box","Line",
    "SKU","EAN scanned","Description","Brand","Qty","Flag",
  ];
  const exportRows = [
    ["PK-261122-007","a","b","Pullback",FROM,"","X","Edited","1",1,1,"SKU0","0000","Item 0","DIOR",1,""],
    ["PK-261122-007","a","b","Pullback",FROM,"","X","Edited","1",1,2,"SKU1","0001","Item 1","DIOR",5,""],
  ];
  const fixture = {
    soh: { ok: true, asOf: "22/11/2026 19:04", rows: sohRows, skuCount: 5, pcs: 15 },
    boxes: {
      ok: true,
      boxes: [{ boxNo: "PK-261122-007", from: FROM, status: "Edited", totalQty: 6 }],
    },
    export: { ok: true, cols, rows: exportRows },
  };

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!/script\.google\.com|macros\/s\//.test(url)) {
      // allow cdn sheetjs
      req.continue();
      return;
    }
    const cb = (url.match(/[?&]callback=([^&]+)/) || [])[1];
    let payload = { ok: false, error: "unknown api" };
    if (/api=possoh/.test(url)) payload = fixture.soh;
    else if (/api=boxes/.test(url)) payload = fixture.boxes;
    else if (/api=export/.test(url) || req.method() === "POST") payload = fixture.export;
    const body = JSON.stringify(payload);
    if (cb) {
      req.respond({
        status: 200,
        contentType: "application/javascript",
        body: decodeURIComponent(cb) + "(" + body + ");",
      });
    } else req.respond({ status: 200, contentType: "application/json", body });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.CatalogCore && typeof onCat === "function"), { timeout: 30000 });
  await page.evaluate((FROM, sohRows) => {
    window.confirm = () => true;
    try {
      localStorage.setItem("productInfo.camOn", "0");
    } catch (e) {}
    if (typeof setCamUserOn === "function") setCamUserOn(false);
    onCat({
      updated: "smoke",
      count: 2,
      rows: [
        ["SKU0", "DIOR", "L", "Item 0", "STOCK", "EDP", "Active", "0000"],
        ["SKU1", "DIOR", "L", "Item 1", "STOCK", "EDP", "Active", "0001"],
      ],
    });
    setTab("pack");
    pkShow("home");
    document.getElementById("pk-ctr-check-open").click();
  }, FROM, sohRows);

  await page.waitForFunction(() => !!document.querySelector(".ctr-check-tot"), { timeout: 25000 });
  const ui = await page.evaluate(() => {
    const x = document.getElementById("ctr-check-xlsx");
    return {
      hasBtn: !!x,
      label: (x && x.textContent) || "",
      disabled: !!(x && x.disabled),
      title: (document.getElementById("sh-t") || {}).textContent || "",
      tot: (document.querySelector(".ctr-check-tot") || {}).innerText || "",
      appVer: typeof APP_VER !== "undefined" ? APP_VER : "",
      coreVer: (window.CatalogCore && CatalogCore.VERSION) || "",
    };
  });
  assert(ui.hasBtn, "Excel button missing");
  assert(/Excel/i.test(ui.label), "Excel label");
  assert(!ui.disabled, "Excel should be enabled after check");
  assert(ui.appVer === ui.coreVer && !!ui.appVer, "APP_VER sync got " + ui.appVer + "/" + ui.coreVer);

  await page.screenshot({ path: path.join(OUT, "ctr-check-excel-btn.png"), fullPage: false });

  // Trigger export (download may not persist in headless — just ensure no throw)
  const exportResult = await page.evaluate(async () => {
    try {
      const data = await pkExportCounterCheckXlsx({
        counter: document.getElementById("ctr-check-ctr").value,
        asOf: "22/11/2026 19:04",
        check: {
          totals: {
            pkCount: 1, packedPcs: 6, sohPcs: 15, sohSkuCount: 5,
            doneSku: 0, leftoverSku: 4, leftoverPcs: 11, overSku: 1, overPcs: 2,
            missingSku: 0, missingPcs: 0,
          },
          rows: [
            { status: "over", brand: "DIOR", sku: "SKU1", barcode: "0001", desc: "Item 1", soh: 3, packed: 5, left: 0, over: 2, boxNos: ["PK-261122-007"] },
            { status: "leftover", brand: "DIOR", sku: "SKU0", barcode: "0000", desc: "Item 0", soh: 3, packed: 1, left: 2, over: 0, boxNos: ["PK-261122-007"] },
          ],
          leftover: [],
          over: [],
          missing: [],
          done: [],
        },
        includedOpen: false,
        bundles: [{ boxNo: "PK-261122-007", lines: [{ sku: "SKU1", qty: 5, barcode: "0001" }] }],
        includeStatusSheets: true,
        stamp: "20261122-2200",
      });
      return { ok: true, fileName: data.fileName, sheets: data.sheets.map((s) => s.name) };
    } catch (e) {
      return { ok: false, err: String(e && e.message ? e.message : e) };
    }
  });
  assert(exportResult.ok, "export failed: " + exportResult.err);
  assert(/CounterCheck_/.test(exportResult.fileName), "filename");

  await browser.close();
  console.log(JSON.stringify({ ok: true, ui, exportResult, shot: path.join(OUT, "ctr-check-excel-btn.png") }, null, 2));
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e && e.stack ? e.stack : e);
  process.exit(1);
});

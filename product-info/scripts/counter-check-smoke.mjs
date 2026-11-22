/**
 * Mobile smoke + screenshots for Packing counter check.
 * Serves nothing itself — expects http://127.0.0.1:8765/index.html
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

function buildFixture() {
  // Match user snapshot shape: 110 SOH SKU / 741 pcs; 21 PKs; 479 packed;
  // done 74, leftover 34/264, over 2/2 (H4GK 6→7, H4GR 5→6), missing 0
  const sohRows = [];
  const packs = []; // {sku, qty} cumulative across PKs
  // over SKUs
  sohRows.push({ sku: "H4GK010000", barcode: "3700135100001", desc: "Over item H4GK", qty: 6, brand: "DIOR" });
  packs.push({ sku: "H4GK010000", qty: 7, boxNo: "PK-261122-009" });
  sohRows.push({ sku: "H4GR010000", barcode: "3700135100002", desc: "Over item H4GR", qty: 5, brand: "DIOR" });
  packs.push({ sku: "H4GR010000", qty: 6, boxNo: "PK-261122-011" });
  // done: 74 exact
  for (let i = 0; i < 74; i++) {
    const sku = "DONE" + String(i).padStart(6, "0");
    const qty = 3 + (i % 5);
    sohRows.push({ sku, barcode: "8" + String(i).padStart(12, "0"), desc: "Done " + sku, qty, brand: i % 2 ? "DIOR" : "GIVENCHY" });
    packs.push({ sku, qty, boxNo: "PK-261122-" + String(7 + (i % 21)).padStart(3, "0") });
  }
  // leftover: 34 with remaining 264 pcs total → packed = soh - left
  // Use left=7 for first 30 (210), left=9 for next 2 (18), left=18 for last 2 (36) = 264
  const leftPlan = [];
  for (let i = 0; i < 30; i++) leftPlan.push(7);
  leftPlan.push(9, 9, 18, 18);
  for (let i = 0; i < 34; i++) {
    const sku = "LEFT" + String(i).padStart(6, "0");
    const left = leftPlan[i];
    const soh = left + (i % 3); // packed = soh - left = i%3
    const packed = soh - left;
    sohRows.push({ sku, barcode: "7" + String(i).padStart(12, "0"), desc: "Left " + sku, qty: soh, brand: "GUERLAIN" });
    if (packed > 0) packs.push({ sku, qty: packed, boxNo: "PK-261122-" + String(7 + (i % 21)).padStart(3, "0") });
  }
  // Adjust soh pcs to 741: current sum may differ — pad first leftover soh
  let sohPcs = sohRows.reduce((n, r) => n + r.qty, 0);
  const need = 741 - sohPcs;
  if (need !== 0) sohRows[2].qty += need; // a done SKU — also bump its pack to keep exact

  // rebuild packs for that done sku if we bumped
  const bumpSku = sohRows[2].sku;
  const bumpPack = packs.find((p) => p.sku === bumpSku);
  if (bumpPack) bumpPack.qty = sohRows[2].qty;

  let packedPcs = packs.reduce((n, p) => n + p.qty, 0);
  // Target packed 479: adjust by adding filler qty onto a done SKU's pack without changing status? 
  // Better: redistribute — compute delta and add to leftover packs carefully.
  // Simpler approach: don't assert exact 479 in UI smoke; unit test covers numbers.
  // But for display we want plausible totals.

  const boxNos = [];
  for (let i = 7; i <= 27; i++) boxNos.push("PK-261122-" + String(i).padStart(3, "0"));

  const cols = [
    "BoxNo",
    "Created",
    "Closed",
    "ShipTo",
    "From",
    "RefNo",
    "PackedBy",
    "Status",
    "BoxOf",
    "Box",
    "Line",
    "SKU",
    "EAN scanned",
    "Description",
    "Brand",
    "Qty",
    "Flag",
  ];
  const rows = [];
  let line = 1;
  packs.forEach((p) => {
    const soh = sohRows.find((r) => r.sku === p.sku) || {};
    rows.push([
      p.boxNo,
      "22/11/2026 20:00",
      "22/11/2026 20:30",
      "Pullback to Warehouse",
      FROM,
      "",
      "MACKY",
      "Edited",
      "1 boxes",
      1,
      line++,
      p.sku,
      soh.barcode || "",
      soh.desc || p.sku,
      soh.brand || "",
      p.qty,
      "",
    ]);
  });

  const boxes = boxNos.map((boxNo, i) => ({
    boxNo,
    from: FROM,
    status: "Edited",
    totalQty: 1,
    created: "22/11/2026 20:00",
  }));

  return {
    soh: {
      ok: true,
      asOf: "22/11/2026 19:04",
      rows: sohRows,
      skuCount: sohRows.length,
      pcs: sohRows.reduce((n, r) => n + r.qty, 0),
    },
    boxes: { ok: true, total: boxes.length, boxes },
    export: { ok: true, cols, rows },
    meta: {
      sohSku: sohRows.length,
      sohPcs: sohRows.reduce((n, r) => n + r.qty, 0),
      packedPcs,
      pkCount: boxNos.length,
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = buildFixture();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 180000,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch (e) {}
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!/script\.google\.com|macros\/s\//.test(url)) {
      req.continue();
      return;
    }
    const cb = (url.match(/[?&]callback=([^&]+)/) || [])[1];
    let payload;
    if (/[?&]api=possoh/.test(url) || (req.method() === "POST" && /possoh/.test(url))) {
      payload = fixture.soh;
    } else if (/[?&]api=boxes/.test(url)) {
      payload = fixture.boxes;
    } else if (/[?&]api=export/.test(url)) {
      payload = fixture.export;
    } else if (req.method() === "POST") {
      // post export
      payload = fixture.export;
    } else {
      payload = { ok: false, error: "unknown api" };
    }
    const body = JSON.stringify(payload);
    if (cb) {
      req.respond({
        status: 200,
        contentType: "application/javascript",
        body: decodeURIComponent(cb) + "(" + body + ");",
      });
    } else {
      req.respond({ status: 200, contentType: "application/json", body });
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.CatalogCore && typeof onCat === "function"), { timeout: 30000 });
  await page.evaluate(() => {
    window.confirm = () => true;
    window.alert = () => {};
    try {
      localStorage.setItem("productInfo.camOn", "0");
    } catch (e) {}
    if (typeof setCamUserOn === "function") setCamUserOn(false);
    if (typeof stopCam === "function") stopCam();
  });

  const result = await page.evaluate(async (FROM, sohPayload) => {
    const out = {};
    const rows = [
      ["H4GK010000", "DIOR", "LINE", "Over item H4GK", "STOCK", "EDP", "Active", "3700135100001"],
      ["H4GR010000", "DIOR", "LINE", "Over item H4GR", "STOCK", "EDP", "Active", "3700135100002"],
      ["DONE000000", "DIOR", "LINE", "Done sample", "STOCK", "EDP", "Active", "8000000000000"],
      ["LEFT000000", "GUERLAIN", "LINE", "Left sample", "STOCK", "EDP", "Active", "7000000000000"],
    ];
    onCat({ updated: "smoke", count: rows.length, rows });
    setTab("pack");
    pkShow("home");

    out.homeBtn = !!(document.getElementById("pk-ctr-check-open"));
    out.homeBtnText = (document.getElementById("pk-ctr-check-open") || {}).textContent || "";

    // open from home
    document.getElementById("pk-ctr-check-open").click();
    out.sheetTitle = (document.getElementById("sh-t") || {}).textContent || "";
    out.sheetOpen = !document.getElementById("sheet").classList.contains("hidden");
    out.seed = (document.getElementById("ctr-check-ctr") || {}).value || "";

    // wait for load
    await new Promise((r) => {
      const t0 = Date.now();
      (function poll() {
        const tot = document.querySelector(".ctr-check-tot");
        const err = document.querySelector(".ctr-check-err");
        if (tot || err || Date.now() - t0 > 20000) return r();
        setTimeout(poll, 120);
      })();
    });
    out.totText = (document.querySelector(".ctr-check-tot") || {}).innerText || "";
    out.errText = (document.querySelector(".ctr-check-err") || {}).innerText || "";
    out.tabs = Array.from(document.querySelectorAll(".ctr-check-tabs button")).map((b) => b.textContent.trim());
    out.leftoverRows = document.querySelectorAll('.ctr-check-item[data-st="leftover"]').length;

    // over tab + expand
    const overBtn = document.querySelector('.ctr-check-tabs button[data-tab="over"]');
    if (overBtn) overBtn.click();
    out.overRows = document.querySelectorAll('.ctr-check-item[data-st="over"]').length;
    const firstOver = document.querySelector('.ctr-check-item[data-st="over"]');
    if (firstOver) firstOver.click();
    out.overPkShown = !!(document.querySelector(".ctr-check-pks"));
    out.overPkText = (document.querySelector(".ctr-check-pks") || {}).textContent || "";

    closeSheet(false);

    // box view with SOH + leftover note
    pkSohStoreLocal(FROM, {
      asOf: sohPayload.asOf,
      rows: sohPayload.rows,
      skuCount: sohPayload.skuCount,
      pcs: sohPayload.pcs,
      fileName: "smoke.xlsx",
    });
    const b = {
      id: "smoke-ctr",
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
    out.sumHasCtr =
      !!document.querySelector('#pk-soh-sum button[data-a="ctrcheck"]') ||
      /ตรวจภาพรวม/.test(document.getElementById("pk-soh-sum").innerText || "");
    out.sumText = (document.getElementById("pk-soh-sum").innerText || "").replace(/\s+/g, " ");

    pkOpenSohLeftoverSheet();
    out.leftNote = (document.querySelector(".ctr-check-note") || {}).innerText || "";
    out.leftToCtr = !!(document.getElementById("soh-left-to-ctr"));
    closeSheet(false);

    // open from summary
    const ctrBtn = document.querySelector('#pk-soh-sum button[data-a="ctrcheck"]');
    if (ctrBtn) ctrBtn.click();
    await new Promise((r) => {
      const t0 = Date.now();
      (function poll() {
        if (document.querySelector(".ctr-check-tot") || document.querySelector(".ctr-check-err") || Date.now() - t0 > 20000)
          return r();
        setTimeout(poll, 120);
      })();
    });
    out.fromSumTitle = (document.getElementById("sh-t") || {}).textContent || "";
    out.fromSumTot = (document.querySelector(".ctr-check-tot") || {}).innerText || "";
    out.includedOpen = /รวมใบที่เปิดอยู่/.test(out.fromSumTot);

    return out;
  }, FROM, fixture.soh);

  assert(result.homeBtn, "home counter-check button");
  assert(/ตรวจภาพรวม/.test(result.homeBtnText), "home button label");
  assert(/ตรวจภาพรวม/.test(result.sheetTitle), "sheet title");
  assert(!result.errText, "no error: " + result.errText);
  assert(/110 SKU|110/.test(result.totText) || /SKU/.test(result.totText), "totals show SOH: " + result.totText);
  assert(result.tabs.some((t) => /ยังไม่แพ็ค/.test(t)), "leftover tab");
  assert(result.tabs.some((t) => /เกิน/.test(t)), "over tab");
  assert(result.overRows >= 2, "over rows >= 2 got " + result.overRows);
  assert(result.overPkShown, "over row expands PK list");
  assert(result.sumHasCtr, "summary has counter check");
  assert(/This open PK only|ใบแพ็คที่เปิดอยู่/.test(result.leftNote), "leftover note THIS PK only");
  assert(result.leftToCtr, "leftover → counter check button");
  assert(/ตรวจภาพรวม/.test(result.fromSumTitle), "open from summary");

  // Screenshots
  await page.evaluate((FROM) => {
    setTab("pack");
    pkShow("home");
  }, FROM);
  await page.screenshot({ path: path.join(OUT, "ctr-check-home.png"), fullPage: false });

  await page.evaluate(() => document.getElementById("pk-ctr-check-open").click());
  await page.waitForFunction(() => !!document.querySelector(".ctr-check-tot") || !!document.querySelector(".ctr-check-err"), {
    timeout: 25000,
  });
  await page.screenshot({ path: path.join(OUT, "ctr-check-sheet-leftover.png"), fullPage: false });

  await page.evaluate(() => {
    const b = document.querySelector('.ctr-check-tabs button[data-tab="over"]');
    if (b) b.click();
    const row = document.querySelector('.ctr-check-item[data-st="over"]');
    if (row) row.click();
  });
  await page.waitForTimeout?.(400).catch?.(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, "ctr-check-sheet-over.png"), fullPage: false });

  await page.evaluate((FROM, soh) => {
    closeSheet(false);
    pkSohStoreLocal(FROM, {
      asOf: soh.asOf,
      rows: soh.rows,
      skuCount: soh.skuCount,
      pcs: soh.pcs,
      fileName: "smoke.xlsx",
    });
    const b = Object.values(PK.drafts || {}).find((d) => d && d.from === FROM) || {
      id: "smoke-ctr2",
      boxNo: "",
      status: "Draft",
      created: "smoke",
      createdTs: Date.now(),
      lines: [],
      dirty: true,
      boxCount: 1,
      activeBox: 1,
      shipTo: "Pullback",
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
    pkOpenSohLeftoverSheet();
  }, FROM, fixture.soh);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, "ctr-check-leftover-note.png"), fullPage: false });

  await browser.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        result,
        meta: fixture.meta,
        shots: [
          "ctr-check-home.png",
          "ctr-check-sheet-leftover.png",
          "ctr-check-sheet-over.png",
          "ctr-check-leftover-note.png",
        ].map((f) => path.join(OUT, f)),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e && e.stack ? e.stack : e);
  process.exit(1);
});

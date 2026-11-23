# Multi-device packing + counter-wide SOH (deploy notes)

## What the app does (after this PR)

1. **Delta ops** — each scan/qty change enqueues `{opId, deviceId, deltaQty, …}` and POSTs `appendpackops` (idempotent). Pending ops stay in `localStorage` if offline.
2. **Poll (~8s)** while a PK is open + visible: pull `api=box`, refresh `api=packtotals`, heartbeat `packpresence`. Peer banner: «อีก N เครื่องกำลังแพ็คกล่องนี้».
3. **Counter-wide line SOH** — `POS 6 · แพ็คแล้ว 3 (กล่องนี้ 1) · เหลือ 3` using `packtotals` (other PKs) + open draft. Summary bar uses the same numbers. Over = red.
4. **Close/save** — flush pending ops first; `savebox` sends `expectedRev` when known. `STALE_VERSION` → merge + ask to save again (no silent overwrite).

## Apps Script (manual — keep same `/exec` URL)

1. Open the existing ITEM MASTER Apps Script project.
2. Add file from repo: `product-info/app/packing-multi-device.gs` (paste contents).
3. Wire `doGet` / `doPost` as documented at the top of that file:
   - `api=packtotals`
   - enrich `api=box` with `rev` + `peers`
   - `action=appendpackops`, `packpresence`
   - wrap `savebox` with `saveBoxWithRev_`
4. **Adapt** `packListLineRowsForCounter_` / `packApplyOpsToLines_` to your Boxes/Lines column names (helpers are stubbed with clear ADAPT comments). Prefer implementing `applyLinesDelta_(boxNo, opRows)` in the live project.
5. Deploy → **Edit existing** web app → New version → Deploy (do **not** create a new URL).
6. Smoke:
   - `GET …/exec?api=packtotals&counter=FM%20x%20GD%20POPUP…` → `{ok:true, skuQty:{…}}`
   - Open a PK on two phones; both should show peer banner and shared packed totals after deploy.

Until backend is deployed, the app **falls back** to this-box-only SOH text and classic `savebox` (no data loss vs today).

## Version bump

`APP_VER` / `CatalogCore.VERSION` = **20261123b** (cache-bust).

## Frontend safety (v6 → v7 cutover)

- Poll/`api=box` only replaces local lines when `supportsDelta` is true (v6 empty draft responses must not wipe scans).
- Ignore server `rev` older than local (slow GET after flush).
- `packpresence` updates peers only — never `rev`.
- On first delta contact / after `newbox` assigns `boxNo`, seed `(local − server)` qty as append ops before adopting server lines.
- `appendpackops` `ok:false` (deleted/missing) drops that box’s queued ops and toasts; does not retry forever.

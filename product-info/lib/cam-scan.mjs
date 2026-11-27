/**
 * Shared live camera barcode scanner for Price Check + Item Master.
 * Sets window.CamScan when loaded as a browser module.
 *
 * Uses html5-qrcode for camera stream (+ fallback decode) and prefers
 * native BarcodeDetector on video frames when available.
 */
import {
  normalizeBarcode,
  barcodeConsensusPush,
  barcodeFormatsForMode,
  stripBarcodeRaw,
  gtinChecksumOk,
  expandUpce,
  CAM_BARCODE,
} from "./cam-barcode.mjs";

var LIB_CDN = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
var LIB_FALLBACK = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

var nativeTried = false;
var nativeDet = null;
var libPromise = null;

function ensureLib() {
  if (typeof window !== "undefined" && window.Html5Qrcode) {
    return Promise.resolve(window.Html5Qrcode);
  }
  if (libPromise) return libPromise;
  libPromise = new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = LIB_CDN;
    s.onload = function () {
      if (window.Html5Qrcode) resolve(window.Html5Qrcode);
      else reject(new Error("lib"));
    };
    s.onerror = function () {
      var s2 = document.createElement("script");
      s2.src = LIB_FALLBACK;
      s2.onload = function () {
        if (window.Html5Qrcode) resolve(window.Html5Qrcode);
        else reject(new Error("lib"));
      };
      s2.onerror = function () {
        reject(new Error("lib"));
      };
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
  return libPromise;
}

function mapHtml5Formats(keys) {
  var F = typeof window !== "undefined" ? window.Html5QrcodeSupportedFormats : null;
  if (!F) return undefined;
  var map = {
    ean_13: F.EAN_13,
    ean_8: F.EAN_8,
    upc_a: F.UPC_A,
    upc_e: F.UPC_E,
    code_128: F.CODE_128,
    qr_code: F.QR_CODE,
    data_matrix: F.DATA_MATRIX,
  };
  var out = [];
  (keys || []).forEach(function (k) {
    if (map[k] != null) out.push(map[k]);
  });
  return out.length ? out : undefined;
}

function getNativeDetector(formatKeys) {
  if (nativeTried) return Promise.resolve(nativeDet);
  nativeTried = true;
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
    return Promise.resolve(null);
  }
  var want = formatKeys || barcodeFormatsForMode("retail");
  var mk = function (list) {
    try {
      nativeDet = new window.BarcodeDetector({ formats: list });
    } catch (e) {
      nativeDet = null;
    }
    return nativeDet;
  };
  try {
    if (window.BarcodeDetector.getSupportedFormats) {
      return window.BarcodeDetector.getSupportedFormats()
        .then(function (sup) {
          var list = want.filter(function (f) {
            return sup.indexOf(f) >= 0;
          });
          return list.length ? mk(list) : null;
        })
        .catch(function () {
          return mk(want);
        });
    }
  } catch (e) {}
  return Promise.resolve(mk(want));
}

function camBad(l) {
  return /wide|ultra|tele|depth|macro|infrared|\bir\b/i.test(l || "");
}
function camRearLabel(l) {
  return /back|rear|environment|หลัง|ท้าย|world/i.test(l || "");
}
function camNum(l) {
  var m = /camera2?\s*(\d+)/i.exec(l || "") || /(\d+)/.exec(l || "");
  return m ? parseInt(m[1], 10) : 99;
}
function rearList(cams) {
  if (!cams || !cams.length) return [];
  var r = cams.filter(function (c) {
    return camRearLabel(c.label);
  });
  if (!r.length) r = cams.length > 1 ? cams.slice(1) : cams.slice();
  r.sort(function (a, b) {
    var ba = camBad(a.label) ? 1 : 0;
    var bb = camBad(b.label) ? 1 : 0;
    if (ba !== bb) return ba - bb;
    return camNum(a.label) - camNum(b.label);
  });
  return r;
}

/**
 * @param {object} opts
 * @param {string} opts.readerId
 * @param {string} [opts.fileReaderId]
 * @param {string} [opts.camKey]
 * @param {() => string} [opts.getMode] - 'oneshot'|'info'|'pack'|'count'
 * @param {(text:string, meta:object) => void} opts.onHit
 * @param {(text:string) => boolean} [opts.shouldAccept] - return false to ignore (dup)
 * @param {() => boolean} [opts.isBlocked]
 * @param {() => boolean} [opts.isEnabled] - camUserOn
 * @param {(err:string) => void} [opts.onError]
 * @param {(s:object) => void} [opts.onLive]
 * @param {HTMLElement|string} [opts.camEl] - for tap-to-focus
 */
export function createCamController(opts) {
  opts = opts || {};
  var readerId = opts.readerId || "reader";
  var fileReaderId = opts.fileReaderId || "file-reader";
  var camKey = opts.camKey || "priceCheck.camId.v1";
  var getMode = opts.getMode || function () {
    return "oneshot";
  };

  var scanner = null;
  var scanning = false;
  var starting = false;
  var camOk = false;
  var camPaused = false;
  var torchOn = false;
  var rearCams = [];
  var curCamId = "";
  var zoomCaps = null;
  var zoomDefault = 1;
  var zoomCur = 1;
  var focusTimer = 0;
  var loopHandle = 0;
  var loopBusy = false;
  var loopCanvas = null;
  var useRvfc = false;
  var consensusState = null;
  var libScanMuted = false; // true when native path owns decode

  function mode() {
    return String(getMode() || "oneshot").toLowerCase();
  }
  function formatKeys() {
    var m = mode();
    if (m === "pack") return barcodeFormatsForMode("pack");
    if (m === "all") return barcodeFormatsForMode("all");
    return barcodeFormatsForMode("retail");
  }
  function isSquareRoi() {
    return mode() === "count";
  }
  function hitIsContinuous() {
    return mode() === "count";
  }
  function consensusNeed(src) {
    // Native BarcodeDetector is reliable — 1 hit; ZXing/lib needs 2
    if (src === "native") return Number(opts.nativeConsensus) || 1;
    return Number(opts.zxingConsensus) || 2;
  }
  function enabled() {
    if (typeof opts.isEnabled === "function") return !!opts.isEnabled();
    return true;
  }
  function blocked() {
    return typeof opts.isBlocked === "function" && !!opts.isBlocked();
  }

  function $(id) {
    return typeof id === "string" ? document.getElementById(id) : id;
  }

  function trackCaps() {
    try {
      return (scanner && scanner.getRunningTrackCapabilities && scanner.getRunningTrackCapabilities()) || {};
    } catch (e) {
      return {};
    }
  }
  function trackSettings() {
    try {
      return (scanner && scanner.getRunningTrackSettings && scanner.getRunningTrackSettings()) || {};
    } catch (e) {
      return {};
    }
  }
  function applyC(c) {
    try {
      if (!scanner || !scanner.applyVideoConstraints) return Promise.reject(new Error("na"));
      return Promise.resolve(scanner.applyVideoConstraints({ advanced: [c] }));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function hasMode(caps, m) {
    return !!(caps && caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf(m) >= 0);
  }
  function applyContinuousFocus() {
    var caps = trackCaps();
    if (hasMode(caps, "continuous")) return applyC({ focusMode: "continuous" }).catch(function () {});
    return Promise.resolve();
  }

  function saveCam(id) {
    try {
      if (id) localStorage.setItem(camKey, id);
    } catch (e) {}
  }
  function pickRear(cams) {
    rearCams = rearList(cams);
    if (!rearCams.length) return null;
    var saved = "";
    try {
      saved = localStorage.getItem(camKey) || "";
    } catch (e) {}
    for (var i = 0; i < rearCams.length; i++) if (rearCams[i].id === saved) return saved;
    return rearCams[0].id;
  }

  function camVideo() {
    return document.querySelector("#" + readerId + " video");
  }

  function bandCanvas(v) {
    var vw = v.videoWidth,
      vh = v.videoHeight,
      cw = v.clientWidth || vw,
      ch = v.clientHeight || vh;
    if (!vw || !vh) return null;
    var sc = Math.max(cw / vw, ch / vh);
    var visW = cw / sc,
      visH = ch / sc;
    var sw, sh;
    if (isSquareRoi()) {
      var side = Math.min(vw, vh) * 0.85;
      sw = side;
      sh = side;
    } else {
      sw = visW * 0.94;
      sh = Math.min(vh, visH * 0.6);
    }
    var sx = (vw - sw) / 2,
      sy = (vh - sh) / 2;
    var k = Math.min(1, 1280 / sw);
    var c = loopCanvas || (loopCanvas = document.createElement("canvas"));
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function emitHit(text, meta) {
    if (!text || blocked()) return;
    if (typeof opts.shouldAccept === "function" && !opts.shouldAccept(text)) return;
    if (!hitIsContinuous()) {
      scanning = false;
      stopLoop();
      pause();
    }
    if (typeof opts.onHit === "function") opts.onHit(text, meta || {});
  }

  function considerText(raw, src) {
    if (!scanning || blocked()) return;
    var need = consensusNeed(src);
    var res = barcodeConsensusPush(consensusState, raw, {
      need: need,
      windowMs: Number(opts.consensusWindowMs) || 450,
    });
    consensusState = res.state || consensusState;
    if (res.rejected) return;
    if (!res.accept) return;
    consensusState = { text: "", times: [] };
    window.__lastSrc = src;
    emitHit(res.text, { src: src, kind: res.kind, hits: res.hits });
  }

  function stopLoop() {
    if (loopHandle) {
      clearTimeout(loopHandle);
      loopHandle = 0;
    }
    useRvfc = false;
  }

  function scheduleLoop(ms) {
    if (!scanning) return;
    if (loopHandle) clearTimeout(loopHandle);
    loopHandle = setTimeout(loopTick, ms == null ? 120 : ms);
  }

  function loopTick() {
    loopHandle = 0;
    if (!scanning || !scanner) return;
    var v = camVideo();
    if (loopBusy || !v || v.readyState < 2) {
      scheduleLoop(120);
      return;
    }
    loopBusy = true;
    var p;
    if (nativeDet) {
      // Prefer full video frame; fall back to ROI canvas
      p = nativeDet.detect(v).then(function (r) {
        if (r && r.length) return r[0].rawValue;
        var c = bandCanvas(v);
        return c
          ? nativeDet.detect(c).then(function (r2) {
              return r2 && r2.length ? r2[0].rawValue : "";
            })
          : "";
      });
    } else {
      var c = bandCanvas(v);
      p =
        c && scanner.qrcode && scanner.qrcode.decodeAsync
          ? scanner.qrcode.decodeAsync(c).then(function (res) {
              return res && res.text;
            })
          : Promise.resolve("");
    }
    Promise.resolve(p)
      .catch(function () {
        return "";
      })
      .then(function (text) {
        loopBusy = false;
        if (text && scanning) {
          considerText(text, nativeDet ? "native" : "loop");
          if (scanning) scheduleLoop(nativeDet ? 80 : 200);
          return;
        }
        if (scanning) scheduleLoop(nativeDet ? 100 : 220);
      });
  }

  function startLoop() {
    stopLoop();
    consensusState = { text: "", times: [] };
    getNativeDetector(formatKeys()).then(function (det) {
      libScanMuted = !!det;
      if (!scanning) return;
      var v = camVideo();
      // Prefer requestVideoFrameCallback cadence when native path owns decode
      if (det && v && typeof v.requestVideoFrameCallback === "function") {
        useRvfc = true;
        var pending = false;
        var onFrame = function () {
          if (!scanning || !useRvfc) return;
          if (pending) {
            v.requestVideoFrameCallback(onFrame);
            return;
          }
          pending = true;
          var p;
          if (nativeDet) {
            p = nativeDet.detect(v).then(function (r) {
              if (r && r.length) return r[0].rawValue;
              var c = bandCanvas(v);
              return c
                ? nativeDet.detect(c).then(function (r2) {
                    return r2 && r2.length ? r2[0].rawValue : "";
                  })
                : "";
            });
          } else {
            p = Promise.resolve("");
          }
          Promise.resolve(p)
            .catch(function () {
              return "";
            })
            .then(function (text) {
              pending = false;
              if (text && scanning) considerText(text, "native");
              if (scanning && useRvfc) v.requestVideoFrameCallback(onFrame);
            });
        };
        v.requestVideoFrameCallback(onFrame);
      } else {
        scheduleLoop(nativeDet ? 80 : 160);
      }
    });
  }

  function setupTorchUi() {
    try {
      var caps = trackCaps();
      if (caps && caps.torch && typeof opts.onTorchAvailable === "function") opts.onTorchAvailable(true);
    } catch (e) {}
  }

  function setupZoom() {
    var caps = trackCaps();
    zoomCaps = caps && caps.zoom && typeof caps.zoom.max === "number" ? caps.zoom : null;
    if (!zoomCaps || zoomCaps.max <= 1.05) {
      zoomCaps = null;
      if (typeof opts.onZoomAvailable === "function") opts.onZoomAvailable(false, 1);
      return Promise.resolve();
    }
    var lo = Math.max(1, zoomCaps.min || 1);
    zoomDefault = Math.min(zoomCaps.max, Math.max(lo, 1.8));
    zoomCur = zoomDefault;
    if (typeof opts.onZoomAvailable === "function") opts.onZoomAvailable(true, zoomCur);
    return applyC({ zoom: zoomCur }).catch(function () {
      zoomCur = trackSettings().zoom || 1;
      if (typeof opts.onZoomAvailable === "function") opts.onZoomAvailable(true, zoomCur);
    });
  }

  function tuneCam() {
    return applyContinuousFocus()
      .then(setupZoom)
      .then(function () {
        var st = trackSettings();
        if (st && st.deviceId) curCamId = st.deviceId;
        if (typeof opts.onCams === "function") opts.onCams(rearCams, curCamId);
      })
      .catch(function () {
        if (typeof opts.onCams === "function") opts.onCams(rearCams, curCamId);
      });
  }

  function camConfig(id, low) {
    var vc = {
      width: { ideal: low ? 1280 : 1920 },
      height: { ideal: low ? 720 : 1080 },
      frameRate: { ideal: nativeDet ? 24 : 15 },
    };
    if (id) vc.deviceId = { exact: id };
    else vc.facingMode = { ideal: "environment" };
    return {
      fps: libScanMuted || nativeDet ? 2 : 12, // when native owns decode, starve lib fps
      qrbox: function (w, h) {
        if (isSquareRoi()) {
          var s = Math.max(180, Math.floor(Math.min(w, h) * 0.72));
          return { width: s, height: s };
        }
        return {
          width: Math.max(200, Math.floor(w * 0.9)),
          height: Math.max(90, Math.floor(h * 0.45)),
        };
      },
      experimentalFeatures: { useBarCodeDetectorIfSupported: false }, // we drive native ourselves
      rememberLastUsedCamera: true,
      videoConstraints: vc,
    };
  }

  function onLibScan(text) {
    if (!scanning || libScanMuted) return; // avoid double-decode when native path is active
    considerText(text, "lib");
  }

  function camLive() {
    setupTorchUi();
    tuneCam();
    if (scanning) startLoop();
    if (typeof opts.onLive === "function") opts.onLive({ scanning: scanning, camOk: camOk });
  }

  function stop() {
    stopLoop();
    camPaused = false;
    torchOn = false;
    if (!scanner) {
      scanning = false;
      starting = false;
      return Promise.resolve();
    }
    var s = scanner;
    scanning = false;
    starting = false;
    return s
      .stop()
      .then(function () {
        return s.clear();
      })
      .catch(function () {})
      .then(function () {
        if (scanner === s) scanner = null;
      });
  }

  function pause() {
    stopLoop();
    scanning = false;
    try {
      if (scanner && scanner.pause) {
        scanner.pause(true);
        camPaused = true;
        return;
      }
    } catch (e) {}
    camPaused = false;
    stop();
  }

  function resume() {
    if (!enabled()) {
      if (typeof opts.onDisabled === "function") opts.onDisabled();
      return;
    }
    if (camPaused && scanner && scanner.resume) {
      try {
        scanner.resume();
        scanning = true;
        camPaused = false;
        camOk = true;
        camLive();
        return;
      } catch (e) {}
    }
    start();
  }

  function start() {
    if (!enabled()) {
      if (typeof opts.onDisabled === "function") opts.onDisabled();
      return;
    }
    if (starting || scanning) return;
    starting = true;
    camPaused = false;
    if (typeof opts.onStarting === "function") opts.onStarting();
    ensureLib()
      .then(function () {
        return getNativeDetector(formatKeys());
      })
      .then(function (det) {
        libScanMuted = !!det;
        return stop();
      })
      .then(function () {
        if (!enabled()) {
          starting = false;
          if (typeof opts.onDisabled === "function") opts.onDisabled();
          return Promise.reject({ name: "CamOff" });
        }
        starting = true;
        var holder = $(readerId);
        if (holder) holder.innerHTML = "";
        var Html5Qrcode = window.Html5Qrcode;
        scanner = new Html5Qrcode(readerId, {
          formatsToSupport: mapHtml5Formats(formatKeys()),
          verbose: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: false },
        });
        function tryCfg(id, low) {
          curCamId = id || "";
          var src = id ? id : { facingMode: { ideal: "environment" } };
          return scanner.start(src, camConfig(id, low), onLibScan, function () {});
        }
        function tryAll(id) {
          return tryCfg(id, false).catch(function () {
            return tryCfg(id, true);
          });
        }
        return Html5Qrcode.getCameras()
          .catch(function () {
            return [];
          })
          .then(function (cams) {
            var id = pickRear(cams);
            if (!id) return tryAll(null);
            return tryAll(id).catch(function () {
              return tryAll(null);
            });
          });
      })
      .then(function () {
        starting = false;
        scanning = true;
        camOk = true;
        camLive();
      })
      .catch(function (err) {
        starting = false;
        scanning = false;
        if (!enabled() || (err && err.name === "CamOff")) {
          camOk = false;
          if (typeof opts.onDisabled === "function") opts.onDisabled();
          return;
        }
        camOk = false;
        var msg = String((err && (err.message || err.name)) || err || "");
        var low = msg.toLowerCase();
        var text =
          "เปิดกล้องไม่ได้ ใช้ปุ่มถ่ายรูปได้เลย / Camera failed — use the photo button.";
        if (/notallowed|permission|denied/i.test(low)) {
          text =
            "ไม่ได้รับสิทธิ์ใช้กล้อง · Camera permission denied. ใช้ปุ่มถ่ายรูป หรืออนุญาตกล้องแล้วกดเปิดกล้องอีกครั้ง";
        }
        stop().then(function () {
          if (typeof opts.onError === "function") opts.onError(text);
        });
      });
  }

  function toggleTorch() {
    if (!scanner || !scanning) return;
    var next = !torchOn;
    Promise.resolve(scanner.applyVideoConstraints({ advanced: [{ torch: next }] }))
      .then(function () {
        torchOn = next;
        if (typeof opts.onTorch === "function") opts.onTorch(torchOn);
      })
      .catch(function () {});
  }

  function toggleZoom() {
    if (!scanner || !scanning || !zoomCaps) return;
    var lo = Math.max(1, zoomCaps.min || 1);
    var next = zoomCur > lo + 0.05 ? lo : Math.min(zoomCaps.max, Math.max(zoomDefault, 2));
    applyC({ zoom: next })
      .then(function () {
        zoomCur = next;
        if (typeof opts.onZoom === "function") opts.onZoom(zoomCur);
        refocus();
      })
      .catch(function () {});
  }

  function refocus(x, y) {
    var caps = trackCaps();
    var c = {};
    var sup = {};
    try {
      sup = navigator.mediaDevices.getSupportedConstraints() || {};
    } catch (e) {}
    if (typeof x === "number" && sup.pointsOfInterest) c.pointsOfInterest = [{ x: x, y: y }];
    if (hasMode(caps, "single-shot")) c.focusMode = "single-shot";
    else if (hasMode(caps, "continuous")) c.focusMode = "continuous";
    if (!c.focusMode && !c.pointsOfInterest) return;
    clearTimeout(focusTimer);
    applyC(c)
      .catch(function () {
        if (c.pointsOfInterest) {
          delete c.pointsOfInterest;
          if (c.focusMode) return applyC(c);
        }
      })
      .catch(function () {})
      .then(function () {
        if (c.focusMode === "single-shot" && hasMode(caps, "continuous")) {
          focusTimer = setTimeout(function () {
            if (scanning) applyContinuousFocus();
          }, 1200);
        }
      });
  }

  function onCamTap(ev) {
    if (!scanner || !scanning) return;
    var cam =
      typeof opts.camEl === "string"
        ? document.getElementById(opts.camEl)
        : opts.camEl || document.getElementById("cam");
    if (!cam) return;
    var r = cam.getBoundingClientRect();
    var t = (ev.touches && ev.touches[0]) || ev;
    var px = t.clientX - r.left,
      py = t.clientY - r.top;
    if (typeof opts.onFocusRing === "function") opts.onFocusRing(px, py);
    refocus(Math.min(1, Math.max(0, px / r.width)), Math.min(1, Math.max(0, py / r.height)));
  }

  function switchCam() {
    if (!rearCams.length || starting) return;
    var idx = -1;
    for (var i = 0; i < rearCams.length; i++) if (rearCams[i].id === curCamId) idx = i;
    var next = rearCams[(idx + 1) % rearCams.length];
    if (!next) return;
    saveCam(next.id);
    stop().then(function () {
      start();
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  }
  function canvasToFile(canvas, name) {
    return new Promise(function (resolve, reject) {
      function toFile(blob) {
        if (!blob) {
          reject(new Error("blob"));
          return;
        }
        try {
          resolve(new File([blob], name || "scan.jpg", { type: "image/jpeg" }));
        } catch (e) {
          resolve(blob);
        }
      }
      if (canvas.toBlob) canvas.toBlob(toFile, "image/jpeg", 0.92);
      else {
        var data = canvas.toDataURL("image/jpeg", 0.92);
        var m = data.split(",");
        var b = atob(m[1] || "");
        var arr = new Uint8Array(b.length);
        for (var i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
        toFile(new Blob([arr], { type: "image/jpeg" }));
      }
    });
  }
  function drawToFile(img, sx, sy, sw, sh, dw, dh, rotate90, name) {
    var c = document.createElement("canvas");
    if (rotate90) {
      c.width = dh;
      c.height = dw;
    } else {
      c.width = dw;
      c.height = dh;
    }
    var ctx = c.getContext("2d");
    if (rotate90) {
      ctx.translate(dh, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    return canvasToFile(c, name);
  }
  function downscaleFile(file, maxSide) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height;
      var long = Math.max(w, h) || 1;
      if (long <= maxSide) return file;
      var scale = maxSide / long;
      var dw = Math.max(1, Math.round(w * scale)),
        dh = Math.max(1, Math.round(h * scale));
      return drawToFile(img, 0, 0, w, h, dw, dh, false, "scan.jpg");
    });
  }
  function centerCropFile(file) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height;
      var cw = Math.max(1, Math.round(w * 0.7)),
        ch = Math.max(1, Math.round(h * 0.7));
      var x = Math.round((w - cw) / 2),
        y = Math.round((h - ch) / 2);
      return drawToFile(img, x, y, cw, ch, cw, ch, false, "crop.jpg");
    });
  }
  function rotate90File(file) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height;
      return drawToFile(img, 0, 0, w, h, w, h, true, "rot.jpg");
    });
  }
  function scanFileOnce(file) {
    return ensureLib().then(function () {
      var holder = $(fileReaderId);
      if (holder) holder.innerHTML = "";
      var qr = new window.Html5Qrcode(fileReaderId, {
        formatsToSupport: mapHtml5Formats(formatKeys()),
        verbose: false,
      });
      return qr.scanFile(file, false).then(
        function (text) {
          try {
            qr.clear();
          } catch (e) {}
          if (holder) holder.innerHTML = "";
          return text;
        },
        function () {
          try {
            qr.clear();
          } catch (e) {}
          if (holder) holder.innerHTML = "";
          return "";
        }
      );
    });
  }

  function decodeImage(file) {
    if (!file) return Promise.resolve("");
    return downscaleFile(file, 1600)
      .then(function (prepared) {
        return scanFileOnce(prepared).then(function (text) {
          if (text) return text;
          return centerCropFile(prepared)
            .then(function (crop) {
              return scanFileOnce(crop);
            })
            .then(function (text) {
              if (text) return text;
              return rotate90File(prepared).then(function (rot) {
                return scanFileOnce(rot);
              });
            });
        });
      })
      .then(function (text) {
        if (!text) return "";
        var n = normalizeBarcode(text);
        return n.ok ? n.text : "";
      })
      .catch(function () {
        return "";
      });
  }

  function warmUp() {
    return ensureLib()
      .then(function () {
        return getNativeDetector(formatKeys());
      })
      .catch(function () {
        return null;
      });
  }

  function getState() {
    return {
      scanning: scanning,
      starting: starting,
      camOk: camOk,
      camPaused: camPaused,
      torchOn: torchOn,
      zoomCur: zoomCur,
      curCamId: curCamId,
      rearCams: rearCams.slice(),
      native: !!nativeDet,
    };
  }

  return {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    switchCam: switchCam,
    toggleTorch: toggleTorch,
    toggleZoom: toggleZoom,
    onCamTap: onCamTap,
    decodeImage: decodeImage,
    warmUp: warmUp,
    getState: getState,
    refocus: refocus,
  };
}

export function warmUpCamScan() {
  return ensureLib()
    .then(function () {
      return getNativeDetector(barcodeFormatsForMode("retail"));
    })
    .catch(function () {
      return null;
    });
}

export var CamScan = {
  VERSION: "20261127a",
  create: createCamController,
  warmUp: warmUpCamScan,
  ensureLib: ensureLib,
  barcode: CAM_BARCODE,
  normalizeBarcode: normalizeBarcode,
  barcodeConsensusPush: barcodeConsensusPush,
  barcodeFormatsForMode: barcodeFormatsForMode,
  stripBarcodeRaw: stripBarcodeRaw,
  gtinChecksumOk: gtinChecksumOk,
  expandUpce: expandUpce,
};

if (typeof window !== "undefined") {
  window.CamScan = CamScan;
}

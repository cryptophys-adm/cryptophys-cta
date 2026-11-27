// The short video for YouTube Shorts and TikTok (owner 2026-11-15: Threads, Instagram, X, Telegram channel,
// YouTube & TikTok; "lanjutkan semua"). A 1080 x 1920 (9:16) video of VIDEO_SECONDS, made in the browser (Browser
// Run) from the draft's card (src/card.mjs: our schematic of the draft's numbers, the panel), so the video carries
// exactly what the guardian checked and nothing more:
//   - the cover, from the first frame: the brand, what the post is, the card and the title (2026-11-18: the platforms
//     take the first frame as the thumbnail, and a fade-in from black gave YouTube and TikTok a dark one);
//   - the card, slowly closing in, with the draft's lines appearing one by one under it;
//   - the end: "Chart by Cryptophys", the disclaimer and cta.cryptophys.work.
// The page draws on a canvas and records it with the browser's MediaRecorder (WebM, VP9 or VP8, 30 fps); the
// recorder writes no duration, so src/webm.mjs adds it. Pure: the page is built from the card, the draft and the brand.
import { panelLines } from "./card.mjs";

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_SECONDS = 14;
export const VIDEO_FPS = 30;
export const VIDEO_VERSION = "cryptophys.cta-video.v1";
const KIND_LABEL = { pattern: "Chart pattern", key_levels: "Key-level map", daily_recap: "Daily recap", warroom: "War Room reading" };

/** The words of a video: the title, the lines shown one by one (at most six), the end card. */
export function videoScript(draft, brand, { disclaimers = [] } = {}) {
  const [title = "", ...body] = panelLines(draft?.text, { disclaimers });
  const lines = body.filter((l) => l.trim() && !/^(supply|demand) zones? \(/i.test(l.trim())).slice(0, 6);
  return {
    brand: brand.name,
    kind: `Education · ${KIND_LABEL[draft?.kind] ?? "Analysis"}`,
    title: title.replace(/^Education\s*[·-]\s*/i, ""),
    lines,
    end: [brand.chart_attribution, brand.card_disclaimer, "cta.cryptophys.work"]
  };
}

/**
 * Pure: the page that records the video. `cardDataUrl` is the card JPEG as a data: URL (no network needed). When done
 * it sets body[data-video] to "ok:<mime>" (window.__video holds the base64) or "error:<reason>".
 */
export function videoHtml(cardDataUrl, script, { seconds = VIDEO_SECONDS, fps = VIDEO_FPS } = {}) {
  const data = JSON.stringify({ card: cardDataUrl, script, seconds, fps, w: VIDEO_WIDTH, h: VIDEO_HEIGHT }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>video</title>
<style>html,body{margin:0;background:#0b0f17}canvas{display:block}</style></head>
<body><canvas id="c" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}"></canvas>
<script>
(function () {
  var D = ${data};
  var c = document.getElementById("c"), g = c.getContext("2d"), img = new Image();
  var GOLD = "#d4af37", INK = "#e6e9ef", MUTED = "#8b93a3", BG = "#0b0f17";
  function fail(r) { document.body.setAttribute("data-video", "error:" + r); }
  function wrap(text, x, y, max, lh) {
    var words = String(text).split(" "), line = "", n = 0;
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + " " + words[i] : words[i];
      if (g.measureText(t).width > max && line) { g.fillText(line, x, y + n * lh); n++; line = words[i]; } else line = t;
    }
    if (line) { g.fillText(line, x, y + n * lh); n++; }
    return n;
  }
  var ease = function (t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); };
  function frame(t) {
    var S = D.script, W = D.w, H = D.h, end = D.seconds - 3;
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    // The header, always.
    g.fillStyle = INK; g.font = "700 54px Inter, Segoe UI, Arial, sans-serif"; g.fillText(S.brand, 60, 120);
    g.fillStyle = GOLD; g.font = "600 36px Inter, Segoe UI, Arial, sans-serif"; g.fillText(S.kind, 60, 180);
    if (t < end) {
      // The card: there from the first frame (the cover), slowly closer.
      var a = 1, z = 1 + 0.035 * Math.min(1, Math.max(0, t - 1) / (end - 1));
      var cw = W * z, ch = 1350 * z, top = 230;
      g.save(); g.globalAlpha = a; g.beginPath(); g.rect(0, top, W, 1350); g.clip();
      g.drawImage(img, (W - cw) / 2, top - (ch - 1350) / 2, cw, ch); g.restore();
      // The title (on the cover too), then the lines one by one.
      g.globalAlpha = 1; g.fillStyle = "#ffffff"; g.font = "700 44px Inter, Segoe UI, Arial, sans-serif";
      var used = wrap(S.title, 60, 1655, W - 120, 54); g.globalAlpha = 1;
      var per = Math.max(1.1, (end - 2.6) / Math.max(1, S.lines.length));
      var shown = Math.min(S.lines.length, Math.floor((t - 2.2) / per) + 1);
      if (shown > 0) {
        var i = shown - 1, ta = ease((t - 2.2 - i * per) / 0.4);
        g.globalAlpha = ta; g.fillStyle = INK; g.font = "500 40px Inter, Segoe UI, Arial, sans-serif";
        wrap(S.lines[i], 60, 1655 + used * 54 + 20, W - 120, 50); g.globalAlpha = 1;
      }
    } else {
      // The end card.
      var e = ease((t - end) / 0.6); g.globalAlpha = e;
      g.fillStyle = GOLD; g.font = "700 52px Inter, Segoe UI, Arial, sans-serif"; g.fillText(S.end[0], 60, 760);
      g.fillStyle = INK; g.font = "500 42px Inter, Segoe UI, Arial, sans-serif"; var n = wrap(S.end[1], 60, 860, W - 120, 56);
      g.fillStyle = MUTED; g.font = "600 44px Inter, Segoe UI, Arial, sans-serif"; g.fillText(S.end[2], 60, 900 + n * 56 + 40);
      g.globalAlpha = 1;
    }
  }
  img.onload = function () {
    if (!window.MediaRecorder || !c.captureStream) return fail("no recorder");
    var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
    if (!mime) return fail("no webm codec");
    var rec = new MediaRecorder(c.captureStream(D.fps), { mimeType: mime, videoBitsPerSecond: 3000000 }), parts = [];
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) parts.push(ev.data); };
    rec.onerror = function () { fail("recorder error"); };
    rec.onstop = function () {
      new Blob(parts, { type: "video/webm" }).arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf), s = "";
        for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
        window.__video = btoa(s); document.body.setAttribute("data-video", "ok:" + mime);
      }, function () { fail("no bytes"); });
    };
    frame(0); rec.start(500);
    var t0 = performance.now();
    (function tick() {
      var t = (performance.now() - t0) / 1000;
      if (t >= D.seconds) { frame(D.seconds); rec.stop(); return; }
      frame(t); setTimeout(tick, 1000 / D.fps);
    })();
  };
  img.onerror = function () { fail("card did not load"); };
  img.src = D.card;
})();
</script></body></html>`;
}

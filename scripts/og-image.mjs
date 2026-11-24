// Draws the share card, scripts/og/card.html, into public/og.png at 1200 x 630 (owner 2026-11-24, "setuju").
// Run by hand when the card changes: `node scripts/og-image.mjs` (needs Playwright's Chromium; CI only checks the
// file, test/meta.test.mjs MD4). The card uses the site's own fonts from public/fonts. The screenshot (about 580 KB,
// for the gradient) is then quantized to 256 colours with Python's Pillow, about 100 KB.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const at = (p) => fileURLToPath(new URL(p, import.meta.url));

export const OG = Object.freeze({ path: "public/og.png", width: 1200, height: 630 });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: OG.width, height: OG.height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(at("./og/card.html")).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: at(`../${OG.path}`), type: "png" });
  await browser.close();
  execFileSync("python3", ["-c", "import sys; from PIL import Image; p = sys.argv[1]; Image.open(p).convert('RGB').quantize(colors=256).save(p, optimize=True)", at(`../${OG.path}`)]);
  console.log(`wrote ${OG.path}`);
}

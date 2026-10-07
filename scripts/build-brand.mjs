/**
 * D3 · Brand assets, drawn in code from the palette (no borrowed art): the ASCENTRA mark (an ascent, "Λ" with a frost
 * line, in Frozen on Black Iris), as the SVG favicon, favicon.ico, the Apple touch icon, app icons (incl. maskable)
 * and the social preview image.
 *   node scripts/build-brand.mjs            icons only (sharp)
 *   OG_FROM=http://localhost:3000 node scripts/build-brand.mjs   also the social preview, rendered with Playwright from a
 *                                           running local build so it uses the real Instrument Serif and Geist fonts.
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const IRIS = "#080813", FROZEN = "#A0BDDB", ICE = "#D6E4F2", STEEL = "#6886AA";

/** The mark on a rounded tile. `pad` shrinks the mark for maskable icons (safe zone). */
export const mark = ({ size = 64, pad = 0, rounded = true } = {}) => {
  const s = 64, k = 1 - pad;
  const t = (x, y) => `${(32 + (x - 32) * k).toFixed(2)} ${(32 + (y - 32) * k).toFixed(2)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${FROZEN}" stop-opacity=".75"/><stop offset=".5" stop-color="${FROZEN}" stop-opacity=".12"/><stop offset="1" stop-color="${FROZEN}" stop-opacity=".35"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${STEEL}"/><stop offset=".55" stop-color="${FROZEN}"/><stop offset="1" stop-color="${ICE}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".3" r=".6"><stop offset="0" stop-color="${FROZEN}" stop-opacity=".22"/><stop offset="1" stop-color="${FROZEN}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="${rounded ? 0.5 : 0}" y="${rounded ? 0.5 : 0}" width="${rounded ? 63 : 64}" height="${rounded ? 63 : 64}" rx="${rounded ? 14 : 0}" fill="${IRIS}" stroke="${rounded ? "url(#edge)" : "none"}"/>
  <rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="url(#glow)"/>
  <path d="M${t(15, 47)} L${t(32, 15)} L${t(49, 47)}" fill="none" stroke="url(#ink)" stroke-width="${(4.6 * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M${t(23.5, 37)} L${t(40.5, 37)}" fill="none" stroke="${ICE}" stroke-opacity=".9" stroke-width="${(2 * k).toFixed(2)}" stroke-linecap="round"/>
</svg>`;
};

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * (size / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** A minimal ICO holding PNG images (supported by every current browser). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

writeFileSync("app/icon.svg", mark());
writeFileSync("app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await png(mark(), size) })))));
writeFileSync("app/apple-icon.png", await png(mark({ rounded: false }), 180));
writeFileSync("public/icons/icon-192.png", await png(mark(), 192));
writeFileSync("public/icons/icon-512.png", await png(mark(), 512));
writeFileSync("public/icons/maskable-512.png", await png(mark({ rounded: false, pad: 0.22 }), 512));
console.log("icons written");

if (process.env.OG_FROM) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route(/clerk|\/api\//, (r) => r.fulfill({ status: 204, body: "" }));
  await page.goto(`${process.env.OG_FROM}/credits`, { waitUntil: "networkidle" });
  await page.evaluate((m) => {
    document.body.innerHTML = `<div style="position:fixed;inset:0;overflow:hidden;background:
      radial-gradient(60% 70% at 78% 30%, rgb(160 189 219 / .16), transparent 70%),
      radial-gradient(40% 50% at 15% 100%, rgb(104 134 170 / .14), transparent 70%),
      linear-gradient(180deg, #0b0c1a, #080813);font-family:var(--font-sans)">
      <div style="position:absolute;inset:0;background:linear-gradient(rgb(160 189 219 / .05) 1px, transparent 1px) 0 0/48px 48px, linear-gradient(90deg, rgb(160 189 219 / .05) 1px, transparent 1px) 0 0/48px 48px;mask-image:radial-gradient(70% 80% at 70% 40%, #000, transparent 75%)"></div>
      <div style="position:absolute;left:84px;top:80px;width:96px;height:96px">${m}</div>
      <div style="position:absolute;left:84px;bottom:92px;right:84px;color:#e8edf5">
        <div style="font-family:var(--font-mono);font-size:20px;letter-spacing:.18em;color:#9aa6ba">ASCENTRA</div>
        <div style="margin-top:14px;font-family:var(--font-instrument-serif), serif;font-size:96px;line-height:.95;letter-spacing:-.03em">Learning you can <em style="color:#bdd2e8">check</em>.</div>
        <div style="margin-top:22px;font-size:26px;color:#c3ccda">Courses written from reviewed sources, cited line by line.</div>
      </div>
      <div style="position:absolute;inset:0;border:1px solid rgb(160 189 219 / .18)"></div></div>`;
  }, mark({ size: 96 }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "app/opengraph-image.jpg", type: "jpeg", quality: 86 });
  await browser.close();
  console.log("opengraph-image.jpg written");
}

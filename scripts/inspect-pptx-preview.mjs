import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp-pptx-inspect");
mkdirSync(outDir, { recursive: true });

function save(name, data) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2), "utf8");
}

async function dumpPreview(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".file-preview-header__name")?.textContent?.trim() ?? null;
    const badge = document.querySelector(".file-preview-header__badge")?.textContent?.trim() ?? null;
    const empty = document.querySelector(".file-preview-empty")?.textContent?.trim() ?? null;
    const loading = document.querySelector(".file-office-loading")?.textContent?.trim() ?? null;
    const errorText = document.querySelector(".file-office-error")?.textContent?.trim() ?? null;
    const wrap = document.querySelector(".file-pptx-wrap");
    const canvas = document.querySelector("canvas.file-pptx-canvas");
    let canvasStats = null;
    if (canvas instanceof HTMLCanvasElement) {
      const ctx = canvas.getContext("2d");
      const { width, height } = canvas;
      const rect = canvas.getBoundingClientRect();
      let black = 0;
      let white = 0;
      let other = 0;
      let pixels = 0;
      if (ctx && width > 0 && height > 0) {
        const sample = ctx.getImageData(0, 0, Math.min(width, 80), Math.min(height, 80)).data;
        pixels = sample.length / 4;
        for (let i = 0; i < sample.length; i += 4) {
          const r = sample[i];
          const g = sample[i + 1];
          const b = sample[i + 2];
          const a = sample[i + 3];
          if (a < 10 && r + g + b < 10) black += 1;
          else if (r + g + b < 30) black += 1;
          else if (r + g + b > 720) white += 1;
          else other += 1;
        }
      }
      canvasStats = {
        width,
        height,
        rect: { w: rect.width, h: rect.height },
        cssWidth: getComputedStyle(canvas).width,
        cssHeight: getComputedStyle(canvas).height,
        cssBg: getComputedStyle(canvas).backgroundColor,
        black,
        white,
        other,
        pixels,
      };
    }
    return {
      title: document.title,
      bodyTextLen: document.body?.innerText?.length ?? 0,
      header,
      badge,
      empty,
      loading,
      errorText,
      wrapClass: wrap?.className ?? null,
      canvasCount: document.querySelectorAll("canvas.file-pptx-canvas").length,
      canvasStats,
      previewHtml: document.querySelector(".file-preview-surface")?.innerHTML?.slice(0, 1500) ?? null,
    };
  });
}

async function inspectFile(page, name, network, logs) {
  const row = page.locator(".file-tree__row", { hasText: name }).first();
  await row.scrollIntoViewIfNeeded();
  await row.waitFor({ state: "attached", timeout: 15000 });
  await row.click({ force: true });

  const polls = [];
  const started = Date.now();
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(i === 0 ? 800 : 2000);
    const dump = await dumpPreview(page).catch((err) => ({ evaluateError: String(err) }));
    polls.push({ t: Date.now() - started, ...dump });
    await page.screenshot({
      path: join(outDir, `${name.replaceAll(".", "_")}-t${i}.png`),
    });
    if (dump.canvasCount > 0 || dump.errorText || dump.evaluateError) break;
  }

  const result = {
    name,
    polls,
    logs: logs.slice(-50),
    recentNetwork: network.slice(-25),
  };
  save(`${name.replaceAll(".", "_")}.json`, result);
  return result;
}

const network = [];
const logs = [];
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || "chrome",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));
page.on("crash", () => logs.push("[crash] page crashed"));
page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/v1/")) network.push({ url, status: res.status() });
});
page.on("requestfailed", (req) => {
  network.push({ url: req.url(), status: "failed", error: req.failure()?.errorText });
});

await page.goto(process.env.PW_URL || "http://127.0.0.1:5173/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.locator(".file-label", { hasText: "math_lesson_plan.pptx" }).waitFor({ timeout: 20000 });
await page.screenshot({ path: join(outDir, "after-load.png") });

let knownGood;
let generated;
try {
  knownGood = await inspectFile(page, "FlintLoom_Design_Presentation.pptx", network, logs);
} catch (err) {
  knownGood = { error: String(err), logs: logs.slice(-50), recentNetwork: network.slice(-25) };
  save("known-good-error.json", knownGood);
}

try {
  generated = await inspectFile(page, "math_lesson_plan.pptx", network, logs);
} catch (err) {
  generated = { error: String(err), logs: logs.slice(-50), recentNetwork: network.slice(-25) };
  save("generated-error.json", generated);
}

await browser.close();
const out = { generated, knownGood };
save("results.json", out);
console.log(JSON.stringify(out, null, 2));

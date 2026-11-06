import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(
  "/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs"
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>body{margin:0}svg{display:block}</style>${await readFile(resolve(web, "design/social.svg"), "utf8")}`,
  );
  await page.screenshot({ path: resolve(web, "public/social.png") });
} finally {
  await browser.close();
}

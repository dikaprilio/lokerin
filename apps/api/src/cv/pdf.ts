import { chromium, type Browser } from "playwright-core";

let browser: Promise<Browser> | null = null;

async function launch(executablePath?: string) {
  const args = ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"];
  try {
    return await chromium.launch({ headless: true, args, ...(executablePath ? { executablePath } : {}) });
  } catch (error) {
    if (executablePath) throw error;
    // Pengembangan lokal: pakai Google Chrome yang terpasang bila browser Playwright belum diunduh.
    return chromium.launch({ headless: true, args, channel: "chrome" });
  }
}

function getBrowser(executablePath?: string) {
  if (!browser) {
    browser = launch(executablePath).catch((error) => {
      browser = null;
      throw error;
    });
  }
  return browser;
}

/** Mencetak HTML yang sama dengan editor menjadi PDF bertag dengan teks yang bisa dipilih. */
export async function htmlToPdf(html: string, executablePath?: string) {
  const instance = await getBrowser(executablePath);
  const page = await instance.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    return await page.pdf({ format: "A4", printBackground: true, tagged: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  const current = browser;
  browser = null;
  if (current) await (await current).close().catch(() => {});
}

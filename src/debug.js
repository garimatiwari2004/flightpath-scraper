import fs from 'node:fs';
import path from 'node:path';

const DEBUG_DIR = path.resolve('debug');

export function ensureDebugDir() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

/**
 * Saves a full-page screenshot + HTML dump for the given page, tagged with a step name.
 * Used when a click/fill/wait fails, so selector mismatches can be diagnosed from real
 * evidence instead of guessing.
 * @param {import('playwright').Page} page
 * @param {string} stepName
 * @returns {Promise<string>} base path (without extension) of the saved artifacts
 */
export async function captureDebugArtifacts(page, stepName) {
  ensureDebugDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(DEBUG_DIR, `${stepName}-${timestamp}`);

  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) fs.writeFileSync(`${base}.html`, html);

  return base;
}

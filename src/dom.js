/**
 * Polls every candidate selector in priority order and returns the first one that's visible,
 * within a single shared timeout budget (NOT one full timeout per candidate — waiting the
 * full timeout on each wrong guess before trying the next would make N guesses take N times
 * as long as one). Priority order matters because a single comma-joined CSS selector's
 * `.first()` resolves in DOM order, not list order — e.g. on Flipkart, a broad selector like
 * `input[type="text"]` can match an unrelated header search box ahead of the real target.
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {number} [timeoutMs] total time budget shared across all candidates
 * @param {string} [label] optional prefix for a console.log when a candidate matches
 * @returns {Promise<import('playwright').Locator|null>}
 */
export async function firstVisibleLocator(page, selectors, timeoutMs = 10_000, label = '') {
  const started = Date.now();
  const pollIntervalMs = 300;

  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        if (label) console.log(`${label} matched selector: ${selector}`);
        return locator;
      }
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  return null;
}

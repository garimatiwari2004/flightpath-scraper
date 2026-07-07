import { FLIPKART } from './config.js';
import { captureDebugArtifacts } from './debug.js';
import { firstVisibleLocator } from './dom.js';

/**
 * Strips "bank" and non-letters so "Axis Bank", "AXIS", "axis" all compare equal,
 * and so it lines up with the bare keyword parseOfferText pulls out of offer text.
 * @param {string} name
 * @returns {string}
 */
export function normalizeBankName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\bbank\b/g, '')
    .replace(/[^a-z]/g, '')
    .trim();
}

/**
 * @param {import('playwright').Browser} browser
 * @returns {Promise<import('playwright').BrowserContext>}
 */
export async function createFlipkartContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-IN',
  });
  return context;
}

/**
 * @param {import('playwright').Page} page
 */
async function dismissFlipkartPopups(page) {
  const selectors = [
    'button:has-text("✕")',
    'span:has-text("✕")',
    'button:has-text("Not now")',
    'button:has-text("Later")',
    '.css-1qs8yn2', // login overlay close
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} mailId
 */
// Flipkart's real login field has no name/placeholder/autocomplete of its own (verified by
// dumping the live page's inputs) — it's a bare `input[type="text"]`. The header search box
// (`name="q"`) is the only other visible type="text" input and sits earlier in the DOM, so it
// must be excluded explicitly rather than relying on a positive attribute match.
const EMAIL_INPUT_CANDIDATES = [
  'input[type="text"]:not([name="q"])',
  'input[autocomplete="username"]',
  'input[placeholder*="Email" i]',
  'input[placeholder*="Mobile" i]',
];
const CONTINUE_BTN_CANDIDATES = ['button:has-text("Request OTP")', 'button:has-text("Continue")'];

// Flipkart's OTP screen renders one single-digit box per input (verified from a real
// captured OTP screen: `<input maxlength="1" autocomplete="off" type="text" ...>` x6) —
// it is NOT type="password"/"tel" or inputmode="numeric" as commonly assumed.
const OTP_BOX_SELECTOR = 'input[maxlength="1"]';

export async function requestFlipkartOtp(page, mailId) {
  console.log('[flipkart] navigating to login page...');
  await page.goto(FLIPKART.loginUrl, { waitUntil: 'domcontentloaded', timeout: FLIPKART.pageTimeoutMs });
  await dismissFlipkartPopups(page);

  try {
    console.log('[flipkart] waiting for email field...');
    const emailInput = await firstVisibleLocator(page, EMAIL_INPUT_CANDIDATES, 20_000, '[flipkart] email field');
    if (!emailInput) throw new Error('no email field candidate became visible');

    console.log('[flipkart] filling email field...');
    await emailInput.scrollIntoViewIfNeeded();
    await emailInput.fill(mailId);
    await page.waitForTimeout(500);
    await captureDebugArtifacts(page, 'flipkart-email-filled');

    const continueBtn = await firstVisibleLocator(page, CONTINUE_BTN_CANDIDATES, 10_000, '[flipkart] Continue button');
    if (!continueBtn) throw new Error('no Continue/Request OTP button became visible');

    await continueBtn.scrollIntoViewIfNeeded();
    console.log('[flipkart] clicking Continue/Request OTP...');
    await continueBtn.click();
    await page.waitForTimeout(1_500);

    console.log('[flipkart] waiting for OTP-sent confirmation...');
    const otpInputAppeared = await page
      .locator(OTP_BOX_SELECTOR)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!otpInputAppeared) {
      throw new Error(
        'clicked Continue/Request OTP but no OTP input field appeared afterward — the OTP request likely did not go through (wrong field/button clicked, or email invalid)'
      );
    }
  } catch (err) {
    const artifactBase = await captureDebugArtifacts(page, 'flipkart-request-otp');
    throw new Error(
      `Flipkart OTP request failed. See ${artifactBase}.png/.html. Original: ${err.message}`
    );
  }

  console.log('[flipkart] OTP requested.');
}

/**
 * @param {import('playwright').Page} page
 * @param {string} otp
 */
export async function submitFlipkartOtp(page, otp) {
  const otpInputs = page.locator(OTP_BOX_SELECTOR);
  const submit = page.locator('button:has-text("Verify"), button:has-text("Login"), button[type="submit"]').first();

  try {
    console.log('[flipkart] waiting for OTP input field(s)...');
    await otpInputs.first().waitFor({ state: 'visible', timeout: 30_000 });
    const count = await otpInputs.count();

    console.log('[flipkart] entering OTP...');
    if (count >= 4) {
      const digits = otp.split('');
      for (let i = 0; i < Math.min(count, digits.length); i++) {
        await otpInputs.nth(i).fill(digits[i]);
      }
    } else {
      await otpInputs.first().fill(otp);
    }
    await page.waitForTimeout(500);
    await captureDebugArtifacts(page, 'flipkart-otp-filled');

    await submit.waitFor({ state: 'visible', timeout: 15_000 });
    await submit.scrollIntoViewIfNeeded();
    console.log('[flipkart] clicking Login/Verify...');
    await submit.click();
  } catch (err) {
    const artifactBase = await captureDebugArtifacts(page, 'flipkart-submit-otp');
    throw new Error(
      `Flipkart OTP submission failed — could not find/click the OTP field(s) or submit button. See ${artifactBase}.png/.html. Original: ${err.message}`
    );
  }

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  console.log('[flipkart] login complete.');
}

/**
 * @param {import('playwright').Page} page
 * @param {string} productUrl
 * @returns {Promise<number>}
 */
export async function getProductPrice(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: FLIPKART.pageTimeoutMs });
  await dismissFlipkartPopups(page);
  await page.waitForTimeout(2_000);

  // Flipkart's product page is now React-Native-Web rendered — every wrapper div shares
  // the same couple of hashed classes (`css-g5y9jx`/`css-146c3p1`), so class selectors
  // can't distinguish anything (confirmed from a real captured page dump). Match by exact
  // text shape instead: the selling price is the only element whose own text is just
  // "₹<digits>" with nothing else — bank-offer amounts always have a suffix like " off",
  // and EMI amounts have "x <n>m" or a "Pay " prefix.
  const priceLocator = page.locator('div, span').filter({ hasText: /^₹[\d,]+$/ }).first();

  try {
    await priceLocator.waitFor({ state: 'visible', timeout: 30_000 });
  } catch (err) {
    const artifactBase = await captureDebugArtifacts(page, 'flipkart-price-not-found');
    throw new Error(
      `Could not find the product price on the page. See ${artifactBase}.png/.html. Original: ${err.message}`
    );
  }

  const priceText = await priceLocator.innerText();
  const price = parsePrice(priceText);
  if (!price) throw new Error(`Could not parse product price from: ${priceText}`);
  return price;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function parsePrice(text) {
  const cleaned = String(text).replace(/[^\d.]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * @typedef {{ raw: string, bankHint: string, percent?: number, flat?: number, maxDiscount?: number, isEmiOnly: boolean }} ParsedOffer
 */

/**
 * @param {string} offerText
 * @returns {ParsedOffer|null}
 */
export function parseOfferText(offerText) {
  const raw = offerText.replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const bankMatch = lower.match(
    /(hdfc|icici|sbi|axis|kotak|indusind|yes bank|rbl|idfc|federal|pnb|bob|canara|amex|american express|citibank|standard chartered|hsbc)/i
  );
  const bankHint = bankMatch?.[1]?.toLowerCase() ?? '';

  const percentMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
  const flatMatch = lower.match(/(?:flat|upto|up to|rs\.?|inr|₹)\s*(\d[\d,]*)/i);
  const maxMatch = lower.match(/max(?:imum)?\s*(?:discount|off|cashback)?\s*(?:of\s*)?(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/i);

  const percent = percentMatch ? Number(percentMatch[1]) : undefined;
  const flat = flatMatch ? Number(flatMatch[1].replace(/,/g, '')) : undefined;
  const maxDiscount = maxMatch ? Number(maxMatch[1].replace(/,/g, '')) : undefined;

  if (!percent && !flat) return null;

  // Flipkart's offer tile footer names the payment methods it applies to (e.g. "Credit,
  // Debit" or "EMI"). An offer whose footer says EMI without also saying Credit/Debit
  // only pays out on EMI transactions, so it's not a real discount on a straight purchase.
  const mentionsCreditOrDebit = /\bcredit\b|\bdebit\b/.test(lower);
  const mentionsEmi = /\bemi\b/.test(lower);
  const isEmiOnly = mentionsEmi && !mentionsCreditOrDebit;

  return { raw, bankHint, percent, flat, maxDiscount, isEmiOnly };
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<ParsedOffer[]>}
 */
export async function scrapeProductOffers(page) {
  // Same React-Native-Web markup as the price (shared hashed classes, no stable hooks).
  // Each bank/wallet offer renders as a tile with an amount div whose own text is exactly
  // "₹<amount> off". The issuer name sits a few ancestor levels up in the same tile, and
  // the "Credit, Debit"/"EMI" payment-type footer sits one level above that (verified from
  // a real captured offer tile — footer is a sibling subtree of the amount+issuer content
  // row, both hanging off the outer card div). Walk up levels until the payment-type text
  // shows up so parseOfferText can see it and flag EMI-only offers.
  const amountLocator = page.locator('div, span').filter({ hasText: /^₹[\d,]+\s*off$/i });
  const count = await amountLocator.count();
  const offers = [];

  for (let i = 0; i < count; i++) {
    const amountEl = amountLocator.nth(i);
    let cardText = '';
    for (const depth of [5, 6, 4, 7]) {
      const text = await amountEl
        .locator(`xpath=ancestor::div[${depth}]`)
        .first()
        .innerText()
        .catch(() => '');
      if (text) {
        cardText = text;
        if (/\b(credit|debit|emi)\b/i.test(text)) break;
      }
    }
    if (!cardText) cardText = await amountEl.innerText().catch(() => '');

    const parsed = parseOfferText(cardText);
    if (parsed && !parsed.isEmiOnly) offers.push(parsed);
  }

  if (offers.length === 0) {
    const bodyText = await page.locator('body').innerText();
    const lines = bodyText.split('\n').filter((line) => /%|₹|off|cashback|discount/i.test(line));
    for (const line of lines.slice(0, 40)) {
      const parsed = parseOfferText(line);
      if (parsed && !parsed.isEmiOnly) offers.push(parsed);
    }
  }

  return dedupeOffers(offers);
}

/**
 * @param {ParsedOffer[]} offers
 * @returns {ParsedOffer[]}
 */
function dedupeOffers(offers) {
  const seen = new Set();
  return offers.filter((offer) => {
    const key = offer.raw.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {ParsedOffer[]} offers
 * @param {string} bankName
 * @returns {ParsedOffer|null}
 */
export function matchOfferForBank(offers, bankName) {
  const needle = normalizeBankName(bankName);
  if (!needle) return null;

  let best = null;
  let bestScore = 0;

  for (const offer of offers) {
    if (offer.isEmiOnly) continue;

    let score = 0;
    const hintNormalized = normalizeBankName(offer.bankHint);
    const rawNormalized = normalizeBankName(offer.raw);
    if (hintNormalized && (hintNormalized.includes(needle) || needle.includes(hintNormalized))) score += 3;
    if (rawNormalized.includes(needle)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = offer;
    }
  }

  return bestScore > 0 ? best : null;
}

/**
 * @param {ParsedOffer|null} offer
 * @param {number} productPrice
 * @returns {{ discountAmount: number, label: string }}
 */
export function calculateDiscount(offer, productPrice) {
  if (!offer) return { discountAmount: 0, label: 'No offer found' };

  let discountAmount = 0;
  if (offer.flat) discountAmount = offer.flat;
  if (offer.percent) {
    discountAmount = Math.max(discountAmount, (productPrice * offer.percent) / 100);
  }
  if (offer.maxDiscount) {
    discountAmount = Math.min(discountAmount, offer.maxDiscount);
  }

  const labelParts = [];
  if (offer.percent) labelParts.push(`${offer.percent}%`);
  if (offer.flat) labelParts.push(`₹${offer.flat} off`);
  if (offer.maxDiscount) labelParts.push(`max ₹${offer.maxDiscount}`);
  const label = labelParts.length ? labelParts.join(', ') : offer.raw;

  return { discountAmount: Math.round(discountAmount), label };
}

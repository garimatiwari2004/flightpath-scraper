import { FLIPKART } from './config.js';
import { cardBin } from './excel.js';

/** Common Indian card BIN prefixes → bank keyword used in Flipkart offers */
const BIN_BANK_HINTS = {
  '411111': 'visa',
  '437551': 'hdfc',
  '524368': 'hdfc',
  '485498': 'icici',
  '524193': 'icici',
  '459150': 'sbi',
  '420858': 'axis',
  '524178': 'axis',
  '540282': 'kotak',
  '416021': 'indusind',
  '436534': 'yes bank',
  '457274': 'rbl',
  '524254': 'idfc',
};

/**
 * @param {string} cardNumber
 * @returns {string[]}
 */
export function bankHintsForCard(cardNumber) {
  const bin = cardBin(cardNumber);
  const hints = new Set();
  if (BIN_BANK_HINTS[bin]) hints.add(BIN_BANK_HINTS[bin]);
  const prefix4 = bin.slice(0, 4);
  if (prefix4 === '4375' || prefix4 === '5243') hints.add('hdfc');
  if (prefix4 === '4854' || prefix4 === '5241') hints.add('icici');
  if (prefix4 === '4591') hints.add('sbi');
  if (prefix4 === '4208' || prefix4 === '5241') hints.add('axis');
  hints.add(bin);
  return [...hints];
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
export async function requestFlipkartOtp(page, mailId) {
  await page.goto(FLIPKART.loginUrl, { waitUntil: 'domcontentloaded', timeout: FLIPKART.pageTimeoutMs });
  await dismissFlipkartPopups(page);

  const emailInput = page.locator(
    'input[type="text"], input[class*="r4vIwl"], input[autocomplete="username"]'
  ).first();
  await emailInput.waitFor({ state: 'visible', timeout: 30_000 });
  await emailInput.fill(mailId);

  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Request OTP")').first();
  await continueBtn.click();
  await page.waitForTimeout(2_000);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} otp
 */
export async function submitFlipkartOtp(page, otp) {
  const otpInputs = page.locator('input[type="password"], input[type="tel"], input[inputmode="numeric"]');
  const count = await otpInputs.count();

  if (count >= 4) {
    const digits = otp.split('');
    for (let i = 0; i < Math.min(count, digits.length); i++) {
      await otpInputs.nth(i).fill(digits[i]);
    }
  } else {
    await otpInputs.first().fill(otp);
  }

  const submit = page.locator('button:has-text("Login"), button:has-text("Verify"), button[type="submit"]').first();
  await submit.click();
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
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

  const priceLocator = page.locator(
    'div[class*="_30jeq3"], div[class*="_16Jk6d"] span, div[class*="_25b18c"] div[class*="_30jeq3"]'
  ).first();

  await priceLocator.waitFor({ state: 'visible', timeout: 30_000 });
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
 * @typedef {{ raw: string, bankHint: string, percent?: number, flat?: number, maxDiscount?: number }} ParsedOffer
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
  return { raw, bankHint, percent, flat, maxDiscount };
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<ParsedOffer[]>}
 */
export async function scrapeProductOffers(page) {
  const offerBlocks = page.locator(
    'div[class*="_1rc91D"], div[class*="_3Djpdu"] li, div[class*="offer"], li:has-text("off")'
  );
  const count = await offerBlocks.count();
  const offers = [];

  for (let i = 0; i < count; i++) {
    const text = await offerBlocks.nth(i).innerText().catch(() => '');
    const parsed = parseOfferText(text);
    if (parsed) offers.push(parsed);
  }

  if (offers.length === 0) {
    const bodyText = await page.locator('body').innerText();
    const lines = bodyText.split('\n').filter((line) => /%|₹|off|cashback|discount/i.test(line));
    for (const line of lines.slice(0, 40)) {
      const parsed = parseOfferText(line);
      if (parsed) offers.push(parsed);
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
 * @param {string} cardNumber
 * @returns {ParsedOffer|null}
 */
export function matchOfferForCard(offers, cardNumber) {
  const hints = bankHintsForCard(cardNumber);
  let best = null;
  let bestScore = 0;

  for (const offer of offers) {
    let score = 0;
    for (const hint of hints) {
      if (offer.bankHint && offer.bankHint.includes(hint)) score += 3;
      if (offer.raw.toLowerCase().includes(hint)) score += 2;
    }
    if (!offer.bankHint && hints.length === 1 && offer.raw.includes(hints[0])) score += 1;
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

/**
 * @param {import('playwright').Page} page
 * @param {string} productUrl
 * @param {string} cardNumber
 * @returns {Promise<ParsedOffer|null>}
 */
export async function checkPaymentPageOffer(page, productUrl, cardNumber) {
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: FLIPKART.pageTimeoutMs });
    await dismissFlipkartPopups(page);

    const buyBtn = page.locator('button:has-text("Buy Now"), button:has-text("ADD TO CART")').first();
    if (!(await buyBtn.isVisible().catch(() => false))) return null;
    await buyBtn.click();
    await page.waitForTimeout(3_000);

    const placeOrder = page.locator('button:has-text("Place Order"), button:has-text("Continue")').first();
    if (await placeOrder.isVisible().catch(() => false)) {
      await placeOrder.click();
      await page.waitForTimeout(3_000);
    }

    const cardInput = page.locator(
      'input[name*="card"], input[placeholder*="Card"], input[autocomplete="cc-number"]'
    ).first();
    if (!(await cardInput.isVisible().catch(() => false))) return null;

    await cardInput.fill(cardNumber.replace(/\D/g, '').slice(0, 16));
    await page.waitForTimeout(2_500);

    const offerText = await page.locator(
      'div:has-text("instant discount"), div:has-text("cashback"), div:has-text("off on")'
    ).first().innerText().catch(() => '');

    return parseOfferText(offerText);
  } catch {
    return null;
  }
}

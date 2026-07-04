import { MAIL_TYPES } from './config.js';
import { captureDebugArtifacts } from './debug.js';
import { firstVisibleLocator } from './dom.js';

// Confirmed from the real login form's captured HTML: it's a custom cPanel-style skin with
// data-testid attributes (not Roundcube) — `<input name="user" id="user" data-testid="user">`,
// `<input name="pass" id="pass" data-testid="pass" type="password">`,
// `<button id="login_submit" data-testid="login_submit">Log in</button>`. The data-testid
// candidates are listed first since they're the most stable; Roundcube-style guesses are kept
// as a fallback in case this ever runs against a different host.
const USER_FIELD_CANDIDATES = [
  'input[data-testid="user"]',
  '#user',
  'input[name="user"]',
  '#rcmloginuser',
  'input[name="login_username"]',
  'input[type="email"]',
];
const PASS_FIELD_CANDIDATES = [
  'input[data-testid="pass"]',
  '#pass',
  'input[name="pass"]',
  '#rcmloginpwd',
  'input[name="login_password"]',
  'input[type="password"]',
];
const LOGIN_BUTTON_CANDIDATES = [
  'button[data-testid="login_submit"]',
  '#login_submit',
  'button:has-text("Log in")',
  '#rcmloginsubmit',
  'button:has-text("Login")',
  'button[type="submit"]',
  'input[type="submit"]',
];

/**
 * @param {import('playwright').Page} page
 * @param {string} webmailUrl
 * @param {string} mailId
 * @param {string} mailPassword
 */
export async function loginWebmail(page, webmailUrl, mailId, mailPassword) {
  const baseUrl = webmailUrl.replace(/webmaillogout\.cgi\/?$/i, '').replace(/\/?$/, '/');
  console.log('[webmail] navigating to webmail login page...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Some cPanel hosts show a "choose your webmail client" page before any login form.
  const chooserLink = page.locator(
    'a:has-text("Roundcube"), a[href*="roundcube"], a:has-text("Horde"), a[href*="horde"]'
  ).first();
  if (await chooserLink.isVisible().catch(() => false)) {
    console.log('[webmail] webmail chooser page detected, clicking through...');
    await chooserLink.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  }

  let userField;
  try {
    console.log('[webmail] waiting for login form to appear...');
    userField = await firstVisibleLocator(page, USER_FIELD_CANDIDATES, 20_000, '[webmail] user field');
    const passField = await firstVisibleLocator(page, PASS_FIELD_CANDIDATES, 10_000, '[webmail] password field');
    if (!userField || !passField) throw new Error('no username/password field candidate became visible');

    console.log('[webmail] filling in credentials...');
    await userField.fill(mailId);
    await passField.fill(mailPassword);
    await page.waitForTimeout(500);
    await captureDebugArtifacts(page, 'webmail-before-login-click');

    const loginButton = await firstVisibleLocator(page, LOGIN_BUTTON_CANDIDATES, 10_000, '[webmail] login button');
    if (!loginButton) throw new Error('no login button candidate became visible');

    await loginButton.scrollIntoViewIfNeeded();
    console.log('[webmail] clicking login button...');
    await loginButton.click();
  } catch (err) {
    const artifactBase = await captureDebugArtifacts(page, 'webmail-login-form');
    throw new Error(
      `Webmail login form interaction failed — selector chain may not match this webmail's real login page. See ${artifactBase}.png/.html. Original: ${err.message}`
    );
  }

  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await captureDebugArtifacts(page, 'webmail-after-login-click');

  const stillOnLoginForm = await userField.isVisible().catch(() => false);
  if (stillOnLoginForm) {
    const artifactBase = await captureDebugArtifacts(page, 'webmail-login-failed');
    throw new Error(
      `Webmail login form still visible after clicking login — credentials may be wrong or the login button selector didn't match the real button. See ${artifactBase}.png/.html.`
    );
  }

  console.log('[webmail] login successful, inbox loaded.');
}

/**
 * @param {string} subject
 * @param {string} body
 * @param {number} mailType
 * @returns {string|null}
 */
export function extractOtpFromEmail(subject, body, mailType) {
  const config = MAIL_TYPES[mailType];
  if (!config) return null;

  const text = `${subject}\n${body}`;
  for (const pattern of config.otpPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  const fallback = text.match(/\b(\d{6})\b/);
  return fallback?.[1] ?? null;
}

/**
 * @param {import('playwright').Page} page
 * @param {number} mailType
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function waitForOtpEmail(page, mailType, timeoutMs = 120_000) {
  const config = MAIL_TYPES[mailType];
  const started = Date.now();
  const seenSubjects = new Set();
  let iteration = 0;
  let lastRowCount = 0;

  while (Date.now() - started < timeoutMs) {
    iteration += 1;
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3_000);

    const mailRows = page.locator(
      'tr.message, tr[id^="rcmrow"], tr.msgline, .message-list tr, #messagelist tbody tr, table#messagelist tr'
    );
    const count = await mailRows.count();
    lastRowCount = count;
    console.log(`[webmail] poll #${iteration} (${elapsedSec}s elapsed): ${count} row(s) in inbox`);

    for (let i = 0; i < Math.min(count, 8); i++) {
      const row = mailRows.nth(i);
      const rowText = ((await row.innerText().catch(() => '')) || '').toLowerCase();
      const isFlipkart = config.otpSenders.some((sender) => rowText.includes(sender));
      if (!isFlipkart) continue;

      const subjectKey = rowText.slice(0, 80);
      if (seenSubjects.has(subjectKey)) continue;

      // Flipkart's OTP mail typically embeds the code directly in the subject line (e.g.
      // "736192 is your verification code"), which the list row's text already contains —
      // try that before opening the message, since reading the message body reliably
      // requires selectors that vary a lot between webmail skins.
      const subjectOtp = extractOtpFromEmail(rowText, '', mailType);
      if (subjectOtp) {
        console.log('[webmail] OTP found directly in the message subject — no need to open it.');
        return subjectOtp;
      }

      console.log('[webmail] found a Flipkart mail candidate, opening it...');
      await row.click().catch(() => {});
      await page.waitForTimeout(2_000);

      const bodyLocator = page.locator(
        '.message-part, #messagebody, .mail-body, .message-htmlpart, .message'
      ).first();
      const hasBodyLocator = await bodyLocator.isVisible().catch(() => false);
      if (!hasBodyLocator) {
        console.log('[webmail] configured message-body selector not found, falling back to full page text.');
      }
      const bodyText = hasBodyLocator
        ? await bodyLocator.innerText().catch(() => page.locator('body').innerText())
        : await page.locator('body').innerText();

      const subject = rowText;
      const otp = extractOtpFromEmail(subject, bodyText, mailType);
      if (otp) {
        console.log('[webmail] OTP extracted from email.');
        return otp;
      }

      seenSubjects.add(subjectKey);
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    const refresh = page.locator(
      'a[title="Refresh"], button[title="Refresh"], #rcmbtn100, .button.refresh'
    ).first();
    if (await refresh.isVisible().catch(() => false)) {
      await refresh.click().catch(() => {});
    }

    await page.waitForTimeout(5_000);
  }

  const artifactBase = await captureDebugArtifacts(page, 'webmail-otp-timeout');
  throw new Error(
    `Timed out waiting for OTP email in webmail after ${Math.round(timeoutMs / 1000)}s (last poll saw ${lastRowCount} row(s), none matched the configured sender/OTP patterns). See ${artifactBase}.png/.html.`
  );
}

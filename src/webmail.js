import { MAIL_TYPES } from './config.js';

/**
 * @param {import('playwright').Page} page
 * @param {string} webmailUrl
 * @param {string} mailId
 * @param {string} mailPassword
 */
export async function loginWebmail(page, webmailUrl, mailId, mailPassword) {
  const baseUrl = webmailUrl.replace(/webmaillogout\.cgi\/?$/i, '').replace(/\/?$/, '/');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const userField = page.locator(
    'input[name="user"], input[name="login_username"], input#user, input[type="email"]'
  ).first();
  const passField = page.locator(
    'input[name="pass"], input[name="login_password"], input#pass, input[type="password"]'
  ).first();

  await userField.waitFor({ state: 'visible', timeout: 30_000 });
  await userField.fill(mailId);
  await passField.fill(mailPassword);

  const loginButton = page.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Login"), #login_submit'
  ).first();
  await loginButton.click();

  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
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

  while (Date.now() - started < timeoutMs) {
    await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3_000);

    const mailRows = page.locator(
      'tr.message, tr.msgline, .message-list tr, #messagelist tbody tr, table#messagelist tr'
    );
    const count = await mailRows.count();

    for (let i = 0; i < Math.min(count, 8); i++) {
      const row = mailRows.nth(i);
      const rowText = ((await row.innerText().catch(() => '')) || '').toLowerCase();
      const isFlipkart = config.otpSenders.some((sender) => rowText.includes(sender));
      if (!isFlipkart) continue;

      const subjectKey = rowText.slice(0, 80);
      if (seenSubjects.has(subjectKey)) continue;

      await row.click().catch(() => {});
      await page.waitForTimeout(2_000);

      const bodyText = await page.locator(
        '.message-part, #messagebody, .mail-body, .message-htmlpart, .message'
      ).first().innerText().catch(async () => {
        return page.locator('body').innerText();
      });

      const subject = rowText;
      const otp = extractOtpFromEmail(subject, bodyText, mailType);
      if (otp) return otp;

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

  throw new Error('Timed out waiting for OTP email in webmail.');
}

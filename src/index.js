import { chromium } from 'playwright';
import { collectInputs } from './prompts.js';
import { loadCardSheet, saveWorkbook, writeRowResult } from './excel.js';
import { loginWebmail, waitForOtpEmail } from './webmail.js';
import {
  calculateDiscount,
  createFlipkartContext,
  getProductPrice,
  matchOfferForBank,
  requestFlipkartOtp,
  scrapeProductOffers,
  submitFlipkartOtp,
} from './flipkart.js';
import { FLIPKART } from './config.js';
import { ensureDebugDir } from './debug.js';

async function main() {
  ensureDebugDir();
  const inputs = await collectInputs();
  const { workbook, worksheet, columns, rows } = await loadCardSheet(inputs.excelPath);

  console.log(`\nLoaded ${rows.length} bank row(s) from Excel.`);
  console.log('Launching browser...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 400,
  });

  try {
    const flipkartContext = await createFlipkartContext(browser);
    const webmailContext = await browser.newContext();
    const flipkartPage = await flipkartContext.newPage();
    const webmailPage = await webmailContext.newPage();

    await flipkartPage.bringToFront();
    console.log('Requesting Flipkart OTP...');
    await requestFlipkartOtp(flipkartPage, inputs.mailId);

    await webmailPage.bringToFront();
    console.log('Logging into webmail...');
    await loginWebmail(webmailPage, inputs.webmailUrl, inputs.mailId, inputs.mailPassword);

    console.log('Waiting for OTP in webmail inbox...');
    const otp = await waitForOtpEmail(webmailPage, inputs.mailType, FLIPKART.otpWaitMs);
    console.log('OTP received.');

    await flipkartPage.bringToFront();
    console.log('Submitting OTP to Flipkart...');
    await submitFlipkartOtp(flipkartPage, otp);
    console.log('Logged into Flipkart.');

    console.log('Fetching product price and offers...');
    const productPrice = await getProductPrice(flipkartPage, inputs.productUrl);
    console.log(`Product price: ₹${productPrice}`);

    const offers = await scrapeProductOffers(flipkartPage);
    console.log(`Found ${offers.length} non-EMI offer(s) on product page.`);

    let eligibleCount = 0;

    for (const row of rows) {
      process.stdout.write(`Checking bank ${row.bank}... `);

      const offer = matchOfferForBank(offers, row.bank);
      const { discountAmount, label } = calculateDiscount(offer, productPrice);
      const finalPrice = Math.max(0, productPrice - discountAmount);
      const eligible = finalPrice <= inputs.maxPrice ? 'YES' : 'NO';
      if (eligible === 'YES') eligibleCount += 1;

      writeRowResult(worksheet, columns, {
        ...row,
        discount: label,
        finalPrice,
        eligible,
      });

      console.log(`${label} → final ₹${finalPrice} [${eligible}]`);
    }

    await saveWorkbook(workbook, inputs.excelPath);

    console.log('\n=== Done ===');
    console.log(`Excel updated: ${inputs.excelPath}`);
    console.log(`Banks within max price ₹${inputs.maxPrice}: ${eligibleCount}/${rows.length}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nError:', error.message);
  process.exit(1);
});

import { chromium } from 'playwright';
import { collectInputs } from './prompts.js';
import { loadCardSheet, saveWorkbook, writeRowResult } from './excel.js';
import { loginWebmail, waitForOtpEmail } from './webmail.js';
import {
  calculateDiscount,
  checkPaymentPageOffer,
  createFlipkartContext,
  getProductPrice,
  matchOfferForCard,
  requestFlipkartOtp,
  scrapeProductOffers,
  submitFlipkartOtp,
} from './flipkart.js';
import { FLIPKART } from './config.js';

async function main() {
  const inputs = await collectInputs();
  const { workbook, worksheet, columns, rows } = await loadCardSheet(inputs.excelPath);

  console.log(`\nLoaded ${rows.length} card row(s) from Excel.`);
  console.log('Launching browser...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
  });

  try {
    const flipkartContext = await createFlipkartContext(browser);
    const webmailContext = await browser.newContext();
    const flipkartPage = await flipkartContext.newPage();
    const webmailPage = await webmailContext.newPage();

    console.log('Logging into webmail...');
    await loginWebmail(webmailPage, inputs.webmailUrl, inputs.mailId, inputs.mailPassword);

    console.log('Requesting Flipkart OTP...');
    await requestFlipkartOtp(flipkartPage, inputs.mailId);

    console.log('Waiting for OTP in webmail inbox...');
    const otp = await waitForOtpEmail(webmailPage, inputs.mailType, FLIPKART.otpWaitMs);
    console.log('OTP received. Logging into Flipkart...');

    await submitFlipkartOtp(flipkartPage, otp);

    console.log('Fetching product price and offers...');
    const productPrice = await getProductPrice(flipkartPage, inputs.productUrl);
    console.log(`Product price: ₹${productPrice}`);

    let offers = await scrapeProductOffers(flipkartPage);
    console.log(`Found ${offers.length} offer(s) on product page.`);

    let eligibleCount = 0;

    for (const row of rows) {
      process.stdout.write(`Checking card ending ${row.cardNumber.slice(-4)}... `);

      let offer = matchOfferForCard(offers, row.cardNumber);
      if (!offer) {
        offer = await checkPaymentPageOffer(flipkartPage, inputs.productUrl, row.cardNumber);
        if (offer) offers.push(offer);
      }

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
    console.log(`Cards within max price ₹${inputs.maxPrice}: ${eligibleCount}/${rows.length}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nError:', error.message);
  process.exit(1);
});

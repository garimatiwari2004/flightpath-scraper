# Flipkart Discount Checker

Node.js script that logs into Flipkart using OTP from cPanel webmail, reads card numbers from an Excel sheet, checks applicable bank/card offers for a product, and fills in discount + final price columns.

## Setup

```bash
npm install
npm run install-browser
```

## Excel format

First worksheet, row 1 = headers:

| Card Number | Discount | Final Price | Eligible |
|-------------|----------|-------------|----------|
| 437551xxxxxx1234 | *(filled by script)* | *(filled)* | YES/NO |

- **Card Number** — full or partial card number (BIN is used for bank matching)
- **Discount** — written by the script (e.g. `10%, max ₹1500`)
- **Final Price** — product price minus discount
- **Eligible** — `YES` if final price ≤ your maximum price, else `NO`

## Run

```bash
npm start
```

You will be prompted for:

1. **Product URL** — Flipkart product link
2. **Maximum price** — budget cap in INR
3. **Mail ID** — email used for Flipkart login
4. **Mail password** — webmail password
5. **Mail type** — use `4` for cPanel webmail (`https://s784.bom1.mysecurecloudhost.com:2096/`)
6. **Webmail URL** — press Enter to use the default above
7. **Excel file path** — press Enter to use `cards.xlsx` in the project folder

## Flow

1. Opens browser (visible, not headless)
2. Logs into webmail (mailtype=4)
3. Requests Flipkart OTP on the login email
4. Polls webmail inbox for the OTP email
5. Completes Flipkart login
6. Reads product price and scrapes bank offers
7. For each card row: matches offer → calculates discount → writes Excel
8. Marks rows **Eligible** when `final price ≤ maximum price`

## Notes

- Flipkart UI selectors can change; you may need to update `src/flipkart.js` if login or offer scraping breaks.
- Payment-page card checks are attempted when product-page offer matching fails (slower but more accurate).
- Keep the browser window unobstructed while the script runs.

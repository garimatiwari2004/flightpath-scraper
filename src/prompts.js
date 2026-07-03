import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_EXCEL = path.join(PROJECT_DIR, 'cards.xlsx');

/**
 * @typedef {Object} UserInputs
 * @property {string} productUrl
 * @property {number} maxPrice
 * @property {string} mailId
 * @property {string} mailPassword
 * @property {number} mailType
 * @property {string} webmailUrl
 * @property {string} excelPath
 */

/**
 * @param {readline.Interface} rl
 * @param {string} question
 * @returns {Promise<string>}
 */
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
function askSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value.trim());
        return;
      }
      if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.on('data', onData);
  });
}

/**
 * @returns {Promise<UserInputs>}
 */
export async function collectInputs() {
  console.log('\n=== Flipkart Discount Checker ===\n');

  const rl = readline.createInterface({ input, output });

  try {
    const productUrl = await ask(rl, 'Product URL: ');
    const maxPriceRaw = await ask(rl, 'Maximum price (INR): ');
    const maxPrice = Number(maxPriceRaw);
    if (!productUrl || Number.isNaN(maxPrice) || maxPrice <= 0) {
      throw new Error('Invalid product URL or maximum price.');
    }

    const mailId = await ask(rl, 'Mail ID: ');
    rl.close();
    const mailPassword = await askSecret('Mail password: ');
    if (!mailId || !mailPassword) {
      throw new Error('Mail ID and password are required.');
    }

    const rl2 = readline.createInterface({ input, output });
    try {
      const mailTypeRaw = await ask(rl2, 'Mail type [4 = cPanel webmail]: ');
      const mailType = Number(mailTypeRaw || '4');
      if (mailType !== 4) {
        throw new Error('Only mailtype=4 (cPanel webmail) is supported right now.');
      }

      const defaultWebmail = 'https://s784.bom1.mysecurecloudhost.com:2096/';
      const webmailUrl = (await ask(rl2, `Webmail URL [${defaultWebmail}]: `)) || defaultWebmail;

      const excelPrompt = fs.existsSync(DEFAULT_EXCEL)
        ? `Excel file path [${DEFAULT_EXCEL}]: `
        : 'Excel file path (card number + discount columns): ';
      let excelPath = await ask(rl2, excelPrompt);
      excelPath = path.resolve((excelPath || DEFAULT_EXCEL).replace(/^["']|["']$/g, ''));
      if (!fs.existsSync(excelPath)) {
        throw new Error(`Excel file not found: ${excelPath}`);
      }

      return { productUrl, maxPrice, mailId, mailPassword, mailType, webmailUrl, excelPath };
    } finally {
      rl2.close();
    }
  } finally {
    if (!rl.closed) rl.close();
  }
}

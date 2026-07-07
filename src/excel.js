import ExcelJS from 'exceljs';

const BANK_HEADERS = ['bank', 'bank name', 'issuer', 'card bank'];
const DISCOUNT_HEADERS = ['discount', 'offer', 'cashback', 'savings'];
const FINAL_PRICE_HEADERS = ['final price', 'final_price', 'price after discount'];
const ELIGIBLE_HEADERS = ['eligible', 'within budget', 'status'];

/**
 * @typedef {Object} BankRow
 * @property {number} rowNumber - 1-based Excel row index
 * @property {string} bank
 * @property {string} [discount]
 * @property {number} [finalPrice]
 * @property {string} [eligible]
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {ExcelJS.Row} headerRow
 * @returns {{ bankCol: number, discountCol: number, finalPriceCol: number, eligibleCol: number }}
 */
function detectColumns(headerRow) {
  let bankCol = 1;
  let discountCol = 2;
  let finalPriceCol = 0;
  let eligibleCol = 0;

  headerRow.eachCell((cell, col) => {
    const header = normalizeHeader(cell.value);
    if (BANK_HEADERS.some((h) => header.includes(h))) bankCol = col;
    if (DISCOUNT_HEADERS.some((h) => header.includes(h))) discountCol = col;
    if (FINAL_PRICE_HEADERS.some((h) => header.includes(h))) finalPriceCol = col;
    if (ELIGIBLE_HEADERS.some((h) => header.includes(h))) eligibleCol = col;
  });

  return { bankCol, discountCol, finalPriceCol, eligibleCol };
}

/**
 * @param {string} filePath
 * @returns {Promise<{ workbook: ExcelJS.Workbook, worksheet: ExcelJS.Worksheet, columns: ReturnType<typeof detectColumns>, rows: BankRow[] }>}
 */
export async function loadCardSheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel file has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const columns = detectColumns(headerRow);

  if (!columns.finalPriceCol) {
    columns.finalPriceCol = Math.max(...Object.values(columns)) + 1;
    worksheet.getCell(1, columns.finalPriceCol).value = 'Final Price';
  }
  if (!columns.eligibleCol) {
    columns.eligibleCol = columns.finalPriceCol + 1;
    worksheet.getCell(1, columns.eligibleCol).value = 'Eligible';
  }

  /** @type {BankRow[]} */
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const bank = String(row.getCell(columns.bankCol).value || '').trim();
    if (!bank) return;
    rows.push({
      rowNumber,
      bank,
      discount: String(row.getCell(columns.discountCol).value || '').trim() || undefined,
    });
  });

  if (rows.length === 0) {
    throw new Error('No bank names found in the Excel sheet.');
  }

  return { workbook, worksheet, columns, rows };
}

/**
 * @param {ExcelJS.Worksheet} worksheet
 * @param {ReturnType<typeof detectColumns>} columns
 * @param {BankRow & { discount: string, finalPrice: number, eligible: string }} row
 */
export function writeRowResult(worksheet, columns, row) {
  worksheet.getCell(row.rowNumber, columns.discountCol).value = row.discount;
  worksheet.getCell(row.rowNumber, columns.finalPriceCol).value = row.finalPrice;
  worksheet.getCell(row.rowNumber, columns.eligibleCol).value = row.eligible;
}

/**
 * @param {ExcelJS.Workbook} workbook
 * @param {string} filePath
 */
export async function saveWorkbook(workbook, filePath) {
  await workbook.xlsx.writeFile(filePath);
}

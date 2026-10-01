import { createSalesLeadRecord, parseSalesLeadRecord } from "./sales-lead-record.js";

export const MAX_SALES_BULK_IMPORT_ROWS = 50;
export const MAX_SALES_BULK_IMPORT_LENGTH = 100_000;

const HEADER_FIRST_CELL = "企業名";

export function prepareSalesBulkImport(rawText, existingCompanyNames = []) {
  try {
    if (typeof rawText !== "string" || rawText.length === 0
      || rawText.length > MAX_SALES_BULK_IMPORT_LENGTH
      || !Array.isArray(existingCompanyNames) || existingCompanyNames.length > 500) return null;

    const lines = rawText.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n")
      .split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;

    const firstCells = lines[0].split("\t").map((cell) => cell.trim());
    if (firstCells[0] === HEADER_FIRST_CELL) {
      if (!validHeader(firstCells)) return null;
      lines.shift();
    }
    if (lines.length === 0 || lines.length > MAX_SALES_BULK_IMPORT_ROWS) return null;

    const companyNames = new Set();
    for (const name of existingCompanyNames) {
      const key = companyNameKey(name);
      if (!key) return null;
      companyNames.add(key);
    }

    const rows = [];
    for (const [index, line] of lines.entries()) {
      const cells = line.split("\t");
      if (cells.length !== 4) return null;
      const content = createSalesLeadRecord({
        companyName: cells[0], website: cells[1], contact: cells[2], proposalFit: cells[3],
      });
      const lead = content ? parseSalesLeadRecord(`bulk-${index + 1}`, content) : null;
      const key = lead ? companyNameKey(lead.companyName) : null;
      if (!lead || !key || companyNames.has(key)) return null;
      companyNames.add(key);
      rows.push(Object.freeze({
        title: `営業見込み：${lead.companyName}`,
        content,
        priority: "高",
        status: "NEW",
      }));
    }

    return Object.freeze(rows);
  } catch {
    return null;
  }
}

export function companyNameKey(value) {
  if (typeof value !== "string") return null;
  const key = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return key.length > 0 && key.length <= 160 ? key : null;
}

function validHeader(cells) {
  return cells.length === 4
    && cells[0] === "企業名"
    && cells[1] === "Webサイト"
    && (cells[2] === "窓口" || cells[2] === "連絡先")
    && (cells[3] === "提案理由" || cells[3] === "提案できそうな理由");
}

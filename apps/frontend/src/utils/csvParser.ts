import { z } from 'zod';

const emailSchema = z.string().trim().email();

export interface ParsedRecipientResult {
  totalDetected: number;
  validEmails: string[];
  invalidEntries: string[];
  duplicateCount: number;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses CSV or plain TXT recipient lists, validates email addresses,
 * and removes duplicates case-insensitively while preserving order.
 */
export function parseRecipientsContent(
  content: string,
  fileName = 'recipients.csv',
): ParsedRecipientResult {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rawLines.length === 0) {
    return {
      totalDetected: 0,
      validEmails: [],
      invalidEntries: [],
      duplicateCount: 0,
    };
  }

  const isCsv = fileName.toLowerCase().endsWith('.csv') || rawLines[0].includes(',');
  const candidates: string[] = [];

  if (isCsv) {
    const firstRowFields = parseCsvLine(rawLines[0]);
    const headerIndex = firstRowFields.findIndex((col) =>
      /^(e-?mail|email_address|recipient|recipients)$/i.test(col.trim()),
    );
    const hasHeader =
      headerIndex !== -1 ||
      firstRowFields.some((col) => /^(name|first_name|last_name|company)$/i.test(col.trim()));

    const startIdx = hasHeader ? 1 : 0;
    const emailColIdx = headerIndex !== -1 ? headerIndex : 0;

    for (let i = startIdx; i < rawLines.length; i += 1) {
      const fields = parseCsvLine(rawLines[i]);
      if (headerIndex !== -1) {
        const val = fields[emailColIdx]?.trim();
        if (val) candidates.push(val);
      } else {
        // Scan all columns in case CSV has multiple emails or single column
        const emailLike = fields.find((f) => f.includes('@'));
        if (emailLike) {
          candidates.push(emailLike.trim());
        } else if (fields[0]) {
          candidates.push(fields[0].trim());
        }
      }
    }
  } else {
    // Plain TXT: split by newline, semicolon, comma, tab, or whitespace
    for (const line of rawLines) {
      const tokens = line
        .split(/[,\t;\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      candidates.push(...tokens);
    }
  }

  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidEntries: string[] = [];
  let duplicateCount = 0;

  for (const raw of candidates) {
    const cleaned = raw.replace(/^["'<]+|[>"']+$/g, '').trim();
    if (!cleaned) continue;

    const parsed = emailSchema.safeParse(cleaned);
    if (!parsed.success) {
      invalidEntries.push(cleaned);
      continue;
    }

    const lower = parsed.data.toLowerCase();
    if (seen.has(lower)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(lower);
    validEmails.push(lower);
  }

  return {
    totalDetected: candidates.length,
    validEmails,
    invalidEntries,
    duplicateCount,
  };
}

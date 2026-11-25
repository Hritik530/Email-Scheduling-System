import { describe, expect, it } from 'vitest';
import { parseRecipientsContent } from '../csvParser';

describe('CSV / TXT Recipient Parser', () => {
  it('parses CSV with header, removes case-insensitive duplicates, and flags invalid entries', () => {
    const csv = [
      'name,email,company',
      'Alice,Alice@Example.com,Acme',
      'Bob,bob@example.com,Beta',
      'Alice Dup,alice@example.com,Acme',
      'Bad User,not-an-email,Gamma',
    ].join('\n');

    const result = parseRecipientsContent(csv, 'leads.csv');
    expect(result.totalDetected).toBe(4);
    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.invalidEntries).toEqual(['not-an-email']);
    expect(result.duplicateCount).toBe(1);
  });

  it('parses plain TXT files separated by newlines, commas, or semicolons', () => {
    const txt = 'user1@test.io; user2@test.io\nuser3@test.io, bad@@domain';
    const result = parseRecipientsContent(txt, 'list.txt');
    expect(result.totalDetected).toBe(4);
    expect(result.validEmails).toEqual(['user1@test.io', 'user2@test.io', 'user3@test.io']);
    expect(result.invalidEntries).toEqual(['bad@@domain']);
  });
});

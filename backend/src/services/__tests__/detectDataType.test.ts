/**
 * Contract tests for column-based import-type detection.
 *
 * No DB. Workbooks are generated in-memory rather than checked in as fixtures,
 * so the column lists under test read as the assertion instead of hiding in a
 * binary nobody can review.
 *
 * The case that earns this file is the subset hazard: `ticket_task` requires only
 * Email/ReportDate/Status, which is a strict subset of several other types. If
 * the most-specific tie-break ever regresses, a sales-margin file silently loads
 * as ticket tasks — a wrong-table write with no error to notice.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { detectDataType } from '../importService';

function workbook(rows: Record<string, any>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** One row with the given columns, all filled with a harmless value. */
const rowWith = (...columns: string[]) =>
  workbook([Object.fromEntries(columns.map(c => [c, 1]))]);

describe('detectDataType', () => {
  it('recognises the Paychex punch export', () => {
    const buffer = rowWith('Post ID', 'Alert Email', 'Actual Date/Time In', 'Regular Duration', 'Pay Type');
    expect(detectDataType(buffer).dataType).toBe('punch_data');
  });

  it('recognises each remaining type from its own columns', () => {
    const cases: Array<[string, string[]]> = [
      ['call_activity',     ['Email', 'ReportDate', 'CallsOffered', 'CallsHandled', 'HoldMinutes', 'LineMinutes']],
      ['sales_margin',      ['Email', 'ReportDate', 'OrderCount', 'Revenue', 'COGS', 'GrossMargin']],
      ['lead_sales_margin', ['Email', 'ReportDate', 'LeadsAssigned', 'LeadsContacted', 'Orders', 'LeadRevenue', 'LeadMargin']],
      ['lead_source',       ['Email', 'ReportDate', 'SourceName', 'LeadsReceived', 'Converted']],
      ['ticket_task',       ['Email', 'ReportDate', 'Status']],
      ['email_stats',       ['Email', 'ReportDate', 'EmailsSent', 'EmailsReceived']],
    ];
    for (const [expected, columns] of cases) {
      expect(detectDataType(rowWith(...columns)).dataType, expected).toBe(expected);
    }
  });

  it('prefers the more specific type when one type is a subset of another', () => {
    // Carries everything email_stats needs, and therefore everything
    // ticket_task needs too. The four-column match must win the three.
    const buffer = rowWith('Email', 'ReportDate', 'Status', 'EmailsSent', 'EmailsReceived');
    expect(detectDataType(buffer).dataType).toBe('email_stats');
  });

  it('tolerates extra columns it does not know about', () => {
    const buffer = rowWith('Email', 'ReportDate', 'Status', 'Assignee', 'Priority', 'Notes');
    expect(detectDataType(buffer).dataType).toBe('ticket_task');
  });

  it('refuses a workbook whose columns match nothing, and says which columns', () => {
    const result = detectDataType(rowWith('Widget', 'Sprocket'));
    expect(result.dataType).toBeNull();
    expect(result.reason).toContain('Widget');
  });

  it('refuses a workbook with headers but no data rows', () => {
    const result = detectDataType(workbook([]));
    expect(result.dataType).toBeNull();
    expect(result.reason).toMatch(/no data rows/i);
  });

  it('reports the columns it saw even when detection fails', () => {
    const result = detectDataType(rowWith('Widget', 'Sprocket'));
    expect(result.columns).toEqual(['Widget', 'Sprocket']);
  });
});

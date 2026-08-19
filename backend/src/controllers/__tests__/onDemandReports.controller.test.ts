/**
 * Controller/HTTP-layer tests for the on-demand-reports controller (Phase 2.2
 * error-envelope migration). The repeated auth / lookup / role-gate preamble was
 * extracted into `requireUser` + `requireReportForUser` and the handlers moved
 * onto `asyncHandler` + thrown `AppError`. These drive the 401 / 404 / 403 / 400
 * branches and assert the forwarded `AppError` keeps the original status code and
 * message. The registry is mocked, so they run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/onDemandReportsRegistry', () => ({
  getOnDemandReport: vi.fn(),
  getOnDemandFilterOptions: vi.fn(),
  listOnDemandReportsForRole: vi.fn(() => []),
}));

import { getOnDemandReport } from '../../services/onDemandReportsRegistry';
import { AppError, ErrorType } from '../../utils/errorHandler';
import { listReports, getReport, getReportData } from '../onDemandReports.controller';

const getReportMock = getOnDemandReport as unknown as ReturnType<typeof vi.fn>;

function mockRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

async function runExpectError(
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
): Promise<AppError> {
  const res = mockRes();
  const next = vi.fn();
  await handler(req as never, res as never, next as never);
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

// role 'Admin' -> role_id 1 (see ROLE_NAME_TO_ID in the controller).
const adminUser = { user_id: 1, role: 'Admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listReports', () => {
  it('401 when there is no authenticated user', async () => {
    const err = await runExpectError(listReports, { user: undefined });
    expect(err.statusCode).toBe(401);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Unauthorized');
  });
});

describe('getReport', () => {
  it('404 when the report id is unknown', async () => {
    getReportMock.mockReturnValueOnce(undefined);
    const err = await runExpectError(getReport, { user: adminUser, params: { id: 'nope' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Report not found');
  });

  it("403 when the user's role can't run the report", async () => {
    getReportMock.mockReturnValueOnce({ id: 'r1', roles: [5], columns: [] });
    const err = await runExpectError(getReport, { user: adminUser, params: { id: 'r1' } });
    expect(err.statusCode).toBe(403);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Access denied for this report');
  });
});

describe('getReportData', () => {
  it('400 when the period/date filters are missing', async () => {
    getReportMock.mockReturnValueOnce({ id: 'r1', roles: [1], columns: [], getRows: vi.fn() });
    const err = await runExpectError(getReportData, { user: adminUser, params: { id: 'r1' }, body: {} });
    expect(err.statusCode).toBe(400);
    expect(err.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(err.message).toBe('period is required (or pass start_date+end_date directly).');
  });
});

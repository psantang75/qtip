/**
 * Per-department queue configuration: which queues the department staffs, its
 * rules for them, and who may take them.
 *
 * Every handler re-resolves scope and passes the department id to the service,
 * which re-checks it. Page-level `edit` only says the viewer MAY edit something,
 * never whose department.
 */
import { Response } from 'express';
import { asyncHandler, createValidationError } from '../../utils/errorHandler';
import {
  resolveScope, listScopedDepartments,
  listDepartmentQueues, saveDepartmentQueues,
  listDepartmentMembers, listQueueMembers, saveQueueMembers,
  getPolicy, upsertPolicy,
} from '../../services/queues';
import type { AuthReq } from '../../services/queues';

function intParam(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw createValidationError(`Invalid ${label}`);
  return n;
}

const departmentId = (req: AuthReq): number =>
  intParam(req.params.departmentId ?? req.query.department_id, 'department id');

export const getDepartments = asyncHandler(async (req: AuthReq, res: Response) => {
  const { departments } = await listScopedDepartments(req);
  res.json({ departments });
});

export const getDepartmentQueues = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await listDepartmentQueues(scope, departmentId(req)));
});

export const putDepartmentQueues = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await saveDepartmentQueues(scope, departmentId(req), req.body.queues));
});

export const getDepartmentPolicy = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json({ policy: await getPolicy(scope, departmentId(req)) });
});

export const putDepartmentPolicy = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json({ policy: await upsertPolicy(scope, departmentId(req), req.body) });
});

export const getDepartmentRoster = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await listDepartmentMembers(scope, departmentId(req)));
});

export const getQueueMembers = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await listQueueMembers(scope, intParam(req.params.queueId, 'queue id')));
});

export const putQueueMembers = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await saveQueueMembers(scope, intParam(req.params.queueId, 'queue id'), req.body.members));
});

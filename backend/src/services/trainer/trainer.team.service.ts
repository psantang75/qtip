/**
 * Team-CSR roster for trainers.
 *
 * Powers `GET /api/trainer/team-csrs`. Trainers can coach any active CSR
 * regardless of department, so this returns every active user in role
 * `id = 3` (CSR) with their department label. Role lookup is by ID — not
 * by `role_name` string — to avoid drift if the role row is renamed.
 *
 * Extracted from the old `controllers/trainer.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

export interface TrainerTeamCSR {
  id:         number
  name:       string
  email:      string
  department: string
}

export async function getTrainerTeamCSRs(): Promise<TrainerTeamCSR[]> {
  return prisma.$queryRaw<TrainerTeamCSR[]>(Prisma.sql`
    SELECT
      u.id,
      u.username AS name,
      u.email,
      COALESCE(d.department_name, '') AS department
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE u.role_id = 3
      AND u.is_active = 1
    ORDER BY u.username
  `)
}

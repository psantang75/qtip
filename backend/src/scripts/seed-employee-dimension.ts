import dotenv from 'dotenv';
dotenv.config();

import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

async function seedEmployeeDimension(): Promise<void> {
  console.log('Seeding ie_dim_employee from existing users...');

  const [countRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) as cnt FROM ie_dim_employee'
  );
  if (countRows[0].cnt > 0) {
    console.log(`ie_dim_employee already has ${countRows[0].cnt} rows. Skipping seed.`);
    return;
  }

  const [users] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.username, u.email, u.department_id, u.manager_id, u.title, u.is_active,
            r.role_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     ORDER BY u.id ASC`
  );

  if (users.length === 0) {
    console.log('No users found in Qtip. Nothing to seed.');
    return;
  }

  const [deptDimRows] = await pool.execute<RowDataPacket[]>(
    'SELECT department_key, department_id FROM ie_dim_department WHERE is_current = 1'
  );
  const deptIdToKey = new Map<number, number>(
    deptDimRows.map((r) => [r.department_id, r.department_key])
  );

  const today = new Date().toISOString().split('T')[0];

  const values = users.map((user) => {
    const username = user.username.replace(/'/g, "''");
    const email = user.email ? `'${user.email.replace(/'/g, "''")}'` : 'NULL';
    const roleName = user.role_name.replace(/'/g, "''");
    const deptKey = user.department_id ? (deptIdToKey.get(user.department_id) ?? 'NULL') : 'NULL';
    const managerId = user.manager_id ?? 'NULL';
    const title = user.title ? `'${user.title.replace(/'/g, "''")}'` : 'NULL';

    return (
      `(${user.id}, '${username}', ${email}, '${roleName}', ${deptKey}, ` +
      `${managerId}, ${title}, ${user.is_active ? 1 : 0}, '${today}', NULL, 1)`
    );
  });

  const BATCH_SIZE = 500;
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    await pool.execute(
      `INSERT INTO ie_dim_employee ` +
      `(user_id, username, email, role_name, department_key, ` +
      `manager_user_id, title, is_active, effective_from, effective_to, is_current) ` +
      `VALUES ${batch.join(',\n')}`
    );
    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${Math.min(i + BATCH_SIZE, values.length)}/${values.length} users)`);
  }

  console.log(`  Done. Inserted ${users.length} rows into ie_dim_employee.`);
}

seedEmployeeDimension()
  .then(() => {
    console.log('Employee dimension seed complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Employee dimension seed failed:', err);
    process.exit(1);
  });

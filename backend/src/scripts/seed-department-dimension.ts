import dotenv from 'dotenv';
dotenv.config();

import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

async function seedDepartmentDimension(): Promise<void> {
  console.log('Seeding ie_dim_department from existing departments...');

  const [countRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) as cnt FROM ie_dim_department'
  );
  if (countRows[0].cnt > 0) {
    console.log(`ie_dim_department already has ${countRows[0].cnt} rows. Skipping seed.`);
    return;
  }

  const [departments] = await pool.execute<RowDataPacket[]>(
    'SELECT id, department_name, is_active FROM departments ORDER BY id ASC'
  );

  if (departments.length === 0) {
    console.log('No departments found in Qtip. Nothing to seed.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const values = departments.map((dept) => {
    const name = dept.department_name.replace(/'/g, "''");
    const path = `/${name}`;
    return (
      `(${dept.id}, '${name}', NULL, 0, '${path}', ` +
      `${dept.is_active ? 1 : 0}, '${today}', NULL, 1)`
    );
  });

  await pool.execute(
    `INSERT INTO ie_dim_department ` +
    `(department_id, department_name, parent_id, hierarchy_level, hierarchy_path, ` +
    `is_active, effective_from, effective_to, is_current) ` +
    `VALUES ${values.join(',\n')}`
  );

  console.log(`  Done. Inserted ${departments.length} rows into ie_dim_department.`);
}

seedDepartmentDimension()
  .then(() => {
    console.log('Department dimension seed complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Department dimension seed failed:', err);
    process.exit(1);
  });

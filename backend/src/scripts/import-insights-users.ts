import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Insights users to import into QTIP.
// EMPLOYEE → CSR, MANAGER → Manager, DIRECTOR → Manager, ADMIN → Admin
// Pete Santangelo: update existing admin email instead of inserting a duplicate.
const INSIGHTS_USERS = [
  { name: 'Pete Santangelo',      email: 'petes@dm-us.com',          role: 'Admin',   department: null,             isAdminUpdate: true  },
  { name: 'Ryan Santangelo',      email: 'ryans@dm-us.com',          role: 'Admin',   department: null,             isAdminUpdate: false },
  { name: 'Levi Roose',           email: 'LRoose@dm-us.com',         role: 'Manager', department: null,             isAdminUpdate: false },
  { name: 'Nicholas Robinson',    email: 'NRobinson@dm-us.com',      role: 'Manager', department: null,             isAdminUpdate: false },
  { name: 'Vince Deleon',         email: 'VDeleon@dm-us.com',        role: 'CSR',     department: 'Sales - Inbound', isAdminUpdate: false },
  { name: 'Jamie Waldie',         email: 'JWaldie@dm-us.com',        role: 'CSR',     department: 'Sales - Inbound', isAdminUpdate: false },
  { name: 'Megan Foti',           email: 'MFoti@dm-us.com',          role: 'CSR',     department: 'Sales - Inbound', isAdminUpdate: false },
  { name: 'Steven Selley',        email: 'SSelley@dm-us.com',        role: 'CSR',     department: 'Sales - Inbound', isAdminUpdate: false },
  { name: 'Mitchell Stempowski',  email: 'MStempowski@dm-us.com',    role: 'CSR',     department: 'Sales - Inbound', isAdminUpdate: false },
  { name: 'Jason Spangler',       email: 'JSpangler@dm-us.com',      role: 'CSR',     department: 'Sales - Outbound', isAdminUpdate: false },
  { name: 'Joshua Barber',        email: 'JBarber@dm-us.com',        role: 'CSR',     department: 'Sales - Outbound', isAdminUpdate: false },
];

// Temporary password — users should reset on first login
const TEMP_PASSWORD = 'ChangeMe123!';

async function ensureDepartment(
  conn: mysql.Connection,
  deptName: string
): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT id FROM departments WHERE department_name = ? LIMIT 1',
    [deptName]
  );
  if (rows.length > 0) return rows[0].id as number;

  const [result] = await conn.execute<mysql.ResultSetHeader>(
    'INSERT INTO departments (department_name, is_active) VALUES (?, 1)',
    [deptName]
  );
  console.log(`  [NEW DEPT] Created department: ${deptName} (id=${result.insertId})`);
  return result.insertId;
}

async function getRoleId(conn: mysql.Connection, roleName: string): Promise<number | null> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT id FROM roles WHERE role_name = ? LIMIT 1',
    [roleName]
  );
  return rows.length > 0 ? (rows[0].id as number) : null;
}

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306', 10),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME     ?? 'qtip',
  });

  try {
    console.log('Importing Insights users into QTIP...\n');

    const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);
    let imported = 0;
    let skipped  = 0;
    let updated  = 0;

    for (const u of INSIGHTS_USERS) {
      // Check if this user already exists by username (came from prod CSV)
      const [byUsername] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id, email, role_id FROM users WHERE username = ? LIMIT 1',
        [u.name]
      );
      if (byUsername.length > 0) {
        const existingId    = byUsername[0].id as number;
        const existingEmail = byUsername[0].email as string;
        const roleId        = await getRoleId(conn, u.role);
        // Update email and role if they differ
        if (existingEmail.toLowerCase() !== u.email.toLowerCase() || byUsername[0].role_id !== roleId) {
          await conn.execute(
            'UPDATE users SET email = ?, role_id = ? WHERE id = ?',
            [u.email, roleId, existingId]
          );
          console.log(`  [UPDATED]  ${u.name} → email: ${existingEmail} → ${u.email}, role_id: ${roleId}`);
        } else {
          console.log(`  [SKIP]     ${u.name} already up to date (id=${existingId})`);
        }
        updated++;
        continue;
      }

      // Check if email already exists under a different username
      const [byEmail] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [u.email]
      );
      if (byEmail.length > 0) {
        console.log(`  [SKIP]     Email already exists: ${u.email}`);
        skipped++;
        continue;
      }

      const roleId = await getRoleId(conn, u.role);
      if (roleId === null) {
        console.log(`  [ERROR]    Role not found: ${u.role} — skipping ${u.name}`);
        skipped++;
        continue;
      }

      let deptId: number | null = null;
      if (u.department) {
        deptId = await ensureDepartment(conn, u.department);
      }

      await conn.execute(
        `INSERT INTO users (username, email, password_hash, role_id, department_id, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [u.name, u.email, passwordHash, roleId, deptId]
      );
      console.log(`  [IMPORTED] ${u.name} (${u.role}${u.department ? ' / ' + u.department : ''})`);
      imported++;
    }

    console.log('\n--- Summary ---');
    console.log(`  Imported : ${imported}`);
    console.log(`  Updated  : ${updated}`);
    console.log(`  Skipped  : ${skipped}`);
    console.log(`\nTemp password for new users: ${TEMP_PASSWORD}`);
    console.log('Users should change their password on first login.');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});

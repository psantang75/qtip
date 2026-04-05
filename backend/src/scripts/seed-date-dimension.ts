import dotenv from 'dotenv';
dotenv.config();

import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

async function seedDateDimension(): Promise<void> {
  console.log('Seeding ie_dim_date (2024-01-01 through 2028-12-31)...');

  const [countRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) as cnt FROM ie_dim_date'
  );
  if (countRows[0].cnt > 0) {
    console.log(`ie_dim_date already has ${countRows[0].cnt} rows. Skipping seed.`);
    return;
  }

  const [holidayRows] = await pool.execute<RowDataPacket[]>(
    `SELECT calendar_date FROM business_calendar_days WHERE day_type IN ('HOLIDAY', 'CLOSURE')`
  );
  const holidaySet = new Set(
    holidayRows.map((h) => {
      const d = new Date(h.calendar_date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })
  );

  const startDate = new Date(2024, 0, 1);
  const endDate = new Date(2028, 11, 31);
  const rows: string[] = [];
  let totalRows = 0;
  const BATCH_SIZE = 500;

  const current = new Date(startDate);
  while (current <= endDate) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const day = current.getDate();
    const dateKey = year * 10000 + month * 100 + day;
    const fullDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const jsDay = current.getDay();
    const isoDow = jsDay === 0 ? 7 : jsDay;
    const dayName = DAY_NAMES[isoDow - 1];
    const dayOfMonth = day;
    const dayOfYear = getDayOfYear(current);
    const weekOfYear = getISOWeekNumber(current);
    const monthName = MONTH_NAMES[month - 1];
    const quarter = Math.ceil(month / 3);
    const isWeekend = isoDow >= 6;
    const isBusinessDay = !isWeekend && !holidaySet.has(fullDate);

    rows.push(
      `(${dateKey}, '${fullDate}', ${isoDow}, '${dayName}', ${dayOfMonth}, ${dayOfYear}, ` +
      `${weekOfYear}, ${month}, '${monthName}', ${quarter}, ${year}, ` +
      `${isWeekend ? 1 : 0}, ${isBusinessDay ? 1 : 0}, NULL, NULL)`
    );
    totalRows++;

    if (rows.length >= BATCH_SIZE) {
      await pool.execute(
        `INSERT INTO ie_dim_date (date_key, full_date, day_of_week, day_name, day_of_month, day_of_year, ` +
        `week_of_year, month_number, month_name, quarter, year, is_weekend, is_business_day, fiscal_year, fiscal_quarter) ` +
        `VALUES ${rows.join(',\n')}`
      );
      rows.length = 0;
      process.stdout.write(`\r  Inserted ${totalRows} rows...`);
    }

    current.setDate(current.getDate() + 1);
  }

  if (rows.length > 0) {
    await pool.execute(
      `INSERT INTO ie_dim_date (date_key, full_date, day_of_week, day_name, day_of_month, day_of_year, ` +
      `week_of_year, month_number, month_name, quarter, year, is_weekend, is_business_day, fiscal_year, fiscal_quarter) ` +
      `VALUES ${rows.join(',\n')}`
    );
  }

  console.log(`\n  Done. Inserted ${totalRows} rows into ie_dim_date.`);
}

seedDateDimension()
  .then(() => {
    console.log('Date dimension seed complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Date dimension seed failed:', err);
    process.exit(1);
  });

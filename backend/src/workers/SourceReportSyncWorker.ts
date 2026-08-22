import fs from 'fs';
import path from 'path';
import { RowDataPacket, ResultSetHeader, FieldPacket } from 'mysql2';
import pool, { getDatabasePool, DatabasePoolName } from '../config/database';
import logger from '../config/logger';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';

const SERVICE = 'SourceReportSyncWorker';
const STAGING_BATCH = 500;

/** One registry row from ie_source_report. */
export interface SourceReportConfig {
  id: number;
  report_code: string;
  report_name: string;
  source_pool: DatabasePoolName;
  extract_sql_file: string;
  transform_sql_file: string | null;
  staging_table: string;
  target_fact_table: string;
  load_mode: 'INCREMENTAL_WINDOW' | 'FULL_RELOAD_WINDOW' | 'SNAPSHOT';
  window_months: number;
  incremental_days: number;
}

/** Date-window params bound into every extract/transform query (named placeholders). */
export interface WindowParams {
  pFromDate: string;
  pToDate: string;
  pMonths: number;
  // Indexable so the object satisfies mysql2's namedPlaceholders `values` type
  // (`{ [param: string]: ... }`) directly — avoids a cast at each query call site
  // and keeps the fresh-install Docker build's stricter @types resolution happy.
  [param: string]: string | number;
}

/**
 * Generic source-report ingestion worker.
 *
 * Pipeline (identical for every report; the per-report specifics live in the two
 * checked-in SQL files referenced by the registry row):
 *   1. extract  — run `extract_sql_file` on the report's source pool (crm/phone).
 *   2. stage    — TRUNCATE the staging table, bulk-insert the extract rows
 *                 (staging columns must match the extract's output column names).
 *   3. transform— run `transform_sql_file` on the primary pool: it conforms
 *                 identities by email (JOIN ie_dim_employee) and loads the fact
 *                 table per the load mode (delete-window/insert, or snapshot).
 *
 * Locking + run logging are inherited from BaseInsightsWorker, keyed per report
 * (`source-<report_code>`) so reports never block one another.
 */
export class SourceReportSyncWorker extends BaseInsightsWorker {
  private cfg: SourceReportConfig;
  private windowOverride?: WindowParams;

  /**
   * `windowOverride` forces an explicit date window instead of the registry-
   * derived rolling window — used by the backfill runner to re-extract a fixed
   * historical range in chunks (each chunk small enough to clear the engine's
   * per-statement timeout). The transform's delete-window+insert is per-window,
   * so chunked backfills are idempotent and never collide.
   */
  constructor(cfg: SourceReportConfig, windowOverride?: WindowParams) {
    super(`source-${cfg.report_code}`, cfg.source_pool);
    this.cfg = cfg;
    this.windowOverride = windowOverride;
  }

  protected async execute(): Promise<WorkerResult> {
    const params = this.windowOverride ?? this.buildWindow();

    const { rows, columns } = await this.runExtract(params);
    const loaded = await this.loadStaging(columns, rows);
    await this.logUnmatchedEmails();
    const factRows = await this.runTransform(params);

    return {
      rowsExtracted: rows.length,
      rowsLoaded: factRows ?? loaded,
      rowsSkipped: 0,
      rowsErrored: 0,
      batchIdentifier: `${this.cfg.load_mode}:${params.pFromDate}..${params.pToDate}`,
    };
  }

  /** Compute the date window for this run based on the load mode. */
  private buildWindow(): WindowParams {
    const now = new Date();
    const to = now;
    const from = new Date(now);

    if (this.cfg.load_mode === 'INCREMENTAL_WINDOW') {
      from.setDate(from.getDate() - this.cfg.incremental_days);
    } else {
      from.setMonth(from.getMonth() - this.cfg.window_months);
    }

    return {
      pFromDate: fmtDate(from),
      pToDate: fmtDate(to),
      pMonths: this.cfg.load_mode === 'SNAPSHOT' ? this.cfg.window_months : this.cfg.window_months,
    };
  }

  private loadSqlFile(fileName: string): string {
    const filePath = path.resolve(__dirname, 'sql', fileName);
    return fs.readFileSync(filePath, 'utf8');
  }

  /** Run the extract SQL on the source pool and return rows + ordered column names. */
  private async runExtract(params: WindowParams): Promise<{ rows: RowDataPacket[]; columns: string[] }> {
    const sql = this.loadSqlFile(this.cfg.extract_sql_file);
    const sourcePool = getDatabasePool(this.cfg.source_pool);
    const statements = splitSqlStatements(sql);

    // Single-statement extracts (the common case: one SELECT) run on the pool
    // unchanged. Procedure-style extracts that build temporary tables before a
    // final SELECT must run every statement on ONE dedicated connection, because
    // MySQL temporary tables are connection-scoped; the last result-set-producing
    // statement supplies the rows + columns loaded into staging.
    let rows: RowDataPacket[] = [];
    let fields: FieldPacket[] = [];

    if (statements.length <= 1) {
      // Use the comment-stripped statement, not the raw file: mysql2's
      // named-placeholder parser leaves :params unbound when comments are present
      // (e.g. a `:pFromDate` mention in the header comment), sending literal
      // `:pFromDate` to MySQL. splitSqlStatements already strips comments.
      const single = statements[0] ?? sql;
      [rows, fields] = (await sourcePool.query({ sql: single, namedPlaceholders: true }, params)) as [
        RowDataPacket[],
        FieldPacket[],
      ];
    } else {
      const conn = await sourcePool.getConnection();
      try {
        for (const stmt of statements) {
          const [res, fld] = (await conn.query({ sql: stmt, namedPlaceholders: true }, params)) as [
            RowDataPacket[] | ResultSetHeader,
            FieldPacket[],
          ];
          if (Array.isArray(res)) {
            rows = res;
            fields = fld ?? [];
          }
        }
      } finally {
        conn.release();
      }
    }

    const columns = (fields ?? []).map((f) => f.name);
    logger.info('Source extract complete', {
      service: SERVICE, report: this.cfg.report_code, rows: rows.length, columns: columns.length,
    });
    return { rows, columns };
  }

  /** Truncate staging and bulk-insert the extracted rows. */
  private async loadStaging(columns: string[], rows: RowDataPacket[]): Promise<number> {
    await pool.query(`TRUNCATE TABLE \`${this.cfg.staging_table}\``);
    if (rows.length === 0 || columns.length === 0) return 0;

    const colList = columns.map((c) => `\`${c}\``).join(', ');
    let loaded = 0;

    for (let i = 0; i < rows.length; i += STAGING_BATCH) {
      const batch = rows.slice(i, i + STAGING_BATCH);
      const values = batch.map((row) => columns.map((c) => (row as Record<string, unknown>)[c] ?? null));
      const [res] = (await pool.query(
        `INSERT INTO \`${this.cfg.staging_table}\` (${colList}) VALUES ?`,
        [values],
      )) as [ResultSetHeader, FieldPacket[]];
      loaded += res.affectedRows ?? batch.length;
    }

    logger.info('Staging load complete', {
      service: SERVICE, report: this.cfg.report_code, table: this.cfg.staging_table, loaded,
    });
    return loaded;
  }

  /**
   * Best-effort identity-quality check: if the staging table has an `email`
   * column, count rows whose email does not resolve to a current employee so
   * unmatched users are visible in the run log instead of silently dropped.
   */
  private async logUnmatchedEmails(): Promise<void> {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS unmatched
         FROM \`${this.cfg.staging_table}\` s
         LEFT JOIN ie_dim_employee e
           ON e.is_current = 1 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email))
         WHERE s.email IS NOT NULL AND s.email <> '' AND e.employee_key IS NULL`,
      );
      const unmatched = Number(rows?.[0]?.unmatched ?? 0);
      if (unmatched > 0) {
        logger.warn('Source report has unmatched emails (not mapped to an employee)', {
          service: SERVICE, report: this.cfg.report_code, unmatched,
        });
      }
    } catch {
      // Staging table has no `email` column (e.g. non-user report) — nothing to check.
    }
  }

  /** Run the transform SQL on primary (staging -> fact). Returns affected rows if known. */
  private async runTransform(params: WindowParams): Promise<number | null> {
    if (!this.cfg.transform_sql_file) return null;

    const sql = this.loadSqlFile(this.cfg.transform_sql_file);
    const statements = splitSqlStatements(sql);

    const conn = await pool.getConnection();
    let affected = 0;
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        const [res] = (await conn.query({ sql: stmt, namedPlaceholders: true }, params)) as [
          ResultSetHeader,
          FieldPacket[],
        ];
        if (res && typeof res.affectedRows === 'number') affected += res.affectedRows;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    logger.info('Transform/fact load complete', {
      service: SERVICE, report: this.cfg.report_code, table: this.cfg.target_fact_table, affected,
    });
    return affected;
  }
}

/** Format a Date as YYYY-MM-DD using local components (date-handling convention). */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Split a multi-statement transform file on semicolons. Transform files are
 * authored in-repo (not user input), kept simple (no stored routines, no
 * semicolons inside string literals), so a top-level split is sufficient.
 *
 * Comments are stripped BEFORE splitting so that (a) a statement preceded by a
 * comment isn't discarded, and (b) C-style block comments never reach mysql2's
 * named-placeholder parser, which only skips line comments and would otherwise
 * leave :param tokens unbound. Safe because in-repo SQL never puts comment
 * delimiters inside string literals.
 */
function splitSqlStatements(sql: string): string[] {
  const stripped = sql
    // Strip regular block comments but PRESERVE MySQL optimizer hints
    // (`/*+ ... */`), which share the same delimiters. A blanket strip silently
    // removed task_open's `/*+ MAX_EXECUTION_TIME(120000) */`, dropping that
    // extract back onto the pool's 25s session cap and causing intermittent
    // "Query execution was interrupted" failures when the CRM source was slow.
    // The negative lookahead on `+` keeps hints; hints carry no `:param` tokens,
    // so mysql2's named-placeholder parser is unaffected.
    .replace(/\/\*(?!\+)[\s\S]*?\*\//g, ' ')   // block comments (not /*+ hints */)
    .replace(/--[^\n]*$/gm, '');               // line comments
  return stripped
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

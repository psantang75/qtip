import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

export const getReportsSummary = async (req: AuthReq, res: Response) => {
  try {
    const { date_from, date_to, csr_ids, topic_ids, coaching_types, created_by } = req.query;

    const conditions: Prisma.Sql[] = [];
    if (date_from) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${date_from}`);
    if (date_to) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${date_to}`);
    if (created_by) conditions.push(Prisma.sql`cs.created_by = ${parseInt(created_by as string)}`);
    if (csr_ids) {
      const ids = (csr_ids as string).split(',').map(Number).filter(Boolean);
      if (ids.length) conditions.push(Prisma.sql`cs.csr_id IN (${Prisma.join(ids)})`);
    }
    if (coaching_types) {
      const types = (coaching_types as string).split(',').filter(Boolean);
      if (types.length) conditions.push(Prisma.sql`cs.coaching_purpose IN (${Prisma.join(types)})`);
    }
    if (topic_ids) {
      const ids = (topic_ids as string).split(',').map(Number).filter(Boolean);
      if (ids.length) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM coaching_session_topics x WHERE x.coaching_session_id = cs.id AND x.topic_id IN (${Prisma.join(ids)}))`);
    }

    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;

    const [totals, byStatus, byType, topTopics, byWeek, quizStats] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT COUNT(*) as total_sessions,
            SUM(CASE WHEN cs.status IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) as completed_count,
            AVG(CASE WHEN cs.completed_at IS NOT NULL AND cs.delivered_at IS NOT NULL
              THEN DATEDIFF(cs.completed_at, cs.delivered_at) END) as avg_days_to_completion
          FROM coaching_sessions cs ${whereClause}
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT cs.status, COUNT(*) as count FROM coaching_sessions cs ${whereClause} GROUP BY cs.status`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT cs.coaching_purpose, COUNT(*) as count FROM coaching_sessions cs ${whereClause} GROUP BY cs.coaching_purpose ORDER BY count DESC`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT li_t.label as topic_name, COUNT(DISTINCT cst.coaching_session_id) as count
          FROM coaching_session_topics cst
          JOIN list_items li_t ON cst.topic_id = li_t.id
          JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
          ${whereClause}
          GROUP BY li_t.id ORDER BY count DESC LIMIT 10
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT DATE_FORMAT(cs.session_date, '%Y-%u') as week, COUNT(*) as count
          FROM coaching_sessions cs ${whereClause}
          GROUP BY week ORDER BY week ASC
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT COUNT(*) as total_attempts,
            SUM(CASE WHEN qa.passed = 1 THEN 1 ELSE 0 END) as passed_count
          FROM quiz_attempts qa
          JOIN coaching_sessions cs ON qa.coaching_session_id = cs.id
          ${whereClause}
        `
      ),
    ]);

    const total = totals[0] || {};
    const totalSessions = Number(total.total_sessions ?? 0);
    const completedCount = Number(total.completed_count ?? 0);
    const completionRate = totalSessions > 0 ? parseFloat(((completedCount / totalSessions) * 100).toFixed(1)) : 0;

    const totalAttempts = Number(quizStats[0]?.total_attempts ?? 0);
    const passedAttempts = Number(quizStats[0]?.passed_count ?? 0);
    const quizPassRate = totalAttempts > 0 ? parseFloat(((passedAttempts / totalAttempts) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        total_sessions: totalSessions,
        completion_rate: completionRate,
        avg_days_to_completion: total.avg_days_to_completion != null ? parseFloat(Number(total.avg_days_to_completion).toFixed(1)) : null,
        quiz_pass_rate: quizPassRate,
        sessions_by_status: byStatus.map((r: any) => ({ status: r.status, count: Number(r.count) })),
        sessions_by_type: byType.map((r: any) => ({ coaching_purpose: r.coaching_purpose, count: Number(r.count) })),
        top_topics: topTopics.map((r: any) => ({ topic_name: r.topic_name, count: Number(r.count) })),
        sessions_by_week: byWeek.map((r: any) => ({ week: r.week, count: Number(r.count) })),
      },
    });
  } catch (error) {
    console.error('[REPORT] getReportsSummary error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCSRCoachingList = async (req: AuthReq, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const { date_from, date_to } = req.query;

    const dateConditions: Prisma.Sql[] = [];
    if (date_from) dateConditions.push(Prisma.sql`cs.session_date >= ${date_from}`);
    if (date_to) dateConditions.push(Prisma.sql`cs.session_date <= ${date_to}`);
    const dateWhere = dateConditions.length ? Prisma.sql`AND ${Prisma.join(dateConditions, ' AND ')}` : Prisma.sql``;

    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(DISTINCT cs.csr_id) as total FROM coaching_sessions cs ${dateConditions.length ? Prisma.sql`WHERE ${Prisma.join(dateConditions, ' AND ')}` : Prisma.sql``}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT u.id as user_id, u.username as csr_name,
            COUNT(cs.id) as total_sessions,
            SUM(CASE WHEN cs.status IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) as completed_sessions,
            AVG(CASE WHEN cs.completed_at IS NOT NULL AND cs.delivered_at IS NOT NULL
              THEN DATEDIFF(cs.completed_at, cs.delivered_at) END) as avg_days_to_completion,
            SUM(CASE WHEN qa.passed = 1 THEN 1 ELSE 0 END) as quizzes_passed,
            MAX(cs.session_date) as last_session_date
          FROM users u
          JOIN coaching_sessions cs ON u.id = cs.csr_id ${dateWhere}
          LEFT JOIN quiz_attempts qa ON qa.coaching_session_id = cs.id AND qa.user_id = u.id
          WHERE u.role_id = 3 AND u.is_active = 1
          GROUP BY u.id
          ORDER BY total_sessions DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ]);

    const csrIds = rows.map((r: any) => r.user_id);

    let topicMap: Map<number, string> = new Map();
    if (csrIds.length) {
      const topicRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT cs.csr_id, li_t.label as topic_name, COUNT(*) as cnt
          FROM coaching_sessions cs
          JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
          JOIN list_items li_t ON cst.topic_id = li_t.id
          WHERE cs.csr_id IN (${Prisma.join(csrIds)})
          GROUP BY cs.csr_id, li_t.id
          ORDER BY cs.csr_id, cnt DESC
        `
      );
      for (const row of topicRows) {
        if (!topicMap.has(row.csr_id)) topicMap.set(row.csr_id, row.topic_name);
      }
    }

    const data = rows.map((r: any) => {
      const total = Number(r.total_sessions);
      const completed = Number(r.completed_sessions ?? 0);
      return {
        user_id: r.user_id,
        csr_name: r.csr_name,
        total_sessions: total,
        completed_sessions: completed,
        completion_rate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
        avg_days_to_completion: r.avg_days_to_completion != null ? parseFloat(Number(r.avg_days_to_completion).toFixed(1)) : null,
        quizzes_passed: Number(r.quizzes_passed ?? 0),
        most_common_topic: topicMap.get(r.user_id) || null,
        last_session_date: r.last_session_date,
      };
    });

    res.json({ success: true, data: { csrs: data, totalCount: Number(countRows[0]?.total ?? 0), page, limit } });
  } catch (error) {
    console.error('[REPORT] getCSRCoachingList error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

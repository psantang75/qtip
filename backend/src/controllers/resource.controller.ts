import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

export const getResources = async (req: AuthReq, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const { topic_id, is_active, search } = req.query;

    const conditions: Prisma.Sql[] = [];
    if (topic_id) conditions.push(Prisma.sql`tr.topic_id = ${parseInt(topic_id as string)}`);
    if (is_active !== undefined) conditions.push(Prisma.sql`tr.is_active = ${is_active === 'true' ? 1 : 0}`);
    if (search) conditions.push(Prisma.sql`tr.title LIKE ${'%' + search + '%'}`);

    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;

    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) as total FROM training_resources tr ${whereClause}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT tr.id, tr.title, tr.url, tr.description, tr.topic_id, tr.is_active, tr.created_at,
            t.topic_name, u.username as created_by_name
          FROM training_resources tr
          LEFT JOIN topics t ON tr.topic_id = t.id
          LEFT JOIN users u ON tr.created_by = u.id
          ${whereClause}
          ORDER BY tr.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ]);

    res.json({ success: true, data: { resources: rows, totalCount: Number(countRows[0]?.total ?? 0), page, limit } });
  } catch (error) {
    console.error('[RESOURCE] getResources error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createResource = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { title, url, description, topic_id, is_active } = req.body;

    if (!title || !url) return res.status(400).json({ success: false, message: 'title and url are required' });

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO training_resources (title, url, description, topic_id, is_active, created_by)
        VALUES (${title}, ${url}, ${description || null}, ${topic_id ? parseInt(topic_id) : null}, ${is_active === false || is_active === 'false' ? 0 : 1}, ${userId})`
    );

    const [{ id }] = await prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
    res.status(201).json({ success: true, data: { id: Number(id) }, message: 'Resource created' });
  } catch (error) {
    console.error('[RESOURCE] createResource error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateResource = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { title, url, description, topic_id, is_active } = req.body;

    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM training_resources WHERE id = ${resourceId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Resource not found' });

    const parts: Prisma.Sql[] = [];
    if (title !== undefined) parts.push(Prisma.sql`title = ${title}`);
    if (url !== undefined) parts.push(Prisma.sql`url = ${url}`);
    if (description !== undefined) parts.push(Prisma.sql`description = ${description || null}`);
    if (topic_id !== undefined) parts.push(Prisma.sql`topic_id = ${topic_id ? parseInt(topic_id) : null}`);
    if (is_active !== undefined) parts.push(Prisma.sql`is_active = ${is_active === false || is_active === 'false' ? 0 : 1}`);

    if (!parts.length) return res.status(400).json({ success: false, message: 'No fields to update' });

    await prisma.$executeRaw(Prisma.sql`UPDATE training_resources SET ${Prisma.join(parts, ', ')}, updated_at = NOW() WHERE id = ${resourceId}`);
    res.json({ success: true, message: 'Resource updated' });
  } catch (error) {
    console.error('[RESOURCE] updateResource error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const toggleResourceStatus = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { is_active } = req.body;

    if (is_active === undefined) return res.status(400).json({ success: false, message: 'is_active is required' });

    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM training_resources WHERE id = ${resourceId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Resource not found' });

    await prisma.$executeRaw(
      Prisma.sql`UPDATE training_resources SET is_active = ${is_active === true || is_active === 'true' ? 1 : 0}, updated_at = NOW() WHERE id = ${resourceId}`
    );
    res.json({ success: true, message: 'Resource status updated' });
  } catch (error) {
    console.error('[RESOURCE] toggleResourceStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

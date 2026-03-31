import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

/**
 * Get all topics with pagination and filtering
 * @route GET /api/topics
 */
export const getTopics = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const search = req.query.search as string || '';
    const is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;


    const whereClauses: string[] = [];
    const whereParams: any[] = [];
    if (search) { whereClauses.push('topic_name LIKE ?'); whereParams.push(`%${search}%`); }
    if (is_active !== undefined) { whereClauses.push('is_active = ?'); whereParams.push(is_active ? 1 : 0); }
    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [totalRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe<{ total: bigint }[]>(`SELECT COUNT(*) as total FROM topics ${whereSQL}`, ...whereParams),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT id, topic_name, is_active, sort_order, category, created_at, updated_at FROM topics ${whereSQL} ORDER BY sort_order ASC, topic_name ASC LIMIT ? OFFSET ?`,
        ...whereParams, limit, offset
      ),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);

    const totalPages = Math.ceil(total / limit);
    const topics = rows.map(row => ({ ...row, is_active: Boolean(row.is_active) }));

    res.status(200).json({ items: topics, totalItems: total, totalPages, currentPage: page });
  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({ message: 'Failed to retrieve topics' });
  }
};

/**
 * Get a single topic by ID
 * @route GET /api/topics/:id
 */
export const getTopicById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, topic_name, is_active, sort_order, category, created_at, updated_at FROM topics WHERE id = ${id}`
    );

    if (rows.length === 0) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    res.status(200).json({ ...rows[0], is_active: Boolean(rows[0].is_active) });
  } catch (error) {
    console.error('Error fetching topic:', error);
    res.status(500).json({ message: 'Failed to retrieve topic' });
  }
};

/**
 * Create a new topic
 * @route POST /api/topics
 */
export const createTopic = async (req: Request, res: Response): Promise<void> => {
  try {
    const { topic_name, is_active, sort_order, category } = req.body;

    if (!topic_name || topic_name.trim().length === 0) {
      res.status(400).json({ message: 'Topic name is required' });
      return;
    }

    const existing = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM topics WHERE topic_name = ${topic_name.trim()} LIMIT 1`
    );
    if (existing.length > 0) {
      res.status(409).json({ message: 'Topic name already exists' });
      return;
    }

    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const [agg] = await prisma.$queryRaw<{ max_order: number }[]>(
        Prisma.sql`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM topics`
      );
      finalSortOrder = (agg.max_order ?? 0) + 1;
    }

    const isActiveVal = is_active !== undefined ? (is_active === true || is_active === 'true' ? 1 : 0) : 1;
    const categoryVal = category || null;

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO topics (topic_name, is_active, sort_order, category) VALUES (${topic_name.trim()}, ${isActiveVal}, ${finalSortOrder}, ${categoryVal})`
    );
    const [row] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, topic_name, is_active, sort_order, category, created_at, updated_at FROM topics WHERE topic_name = ${topic_name.trim()} ORDER BY id DESC LIMIT 1`
    );

    res.status(201).json({ ...row, is_active: Boolean(row.is_active) });
  } catch (error: any) {
    console.error('Error creating topic:', error);
    if (error.code === 'ER_DUP_ENTRY' || error.message?.includes('Duplicate entry')) {
      res.status(409).json({ message: 'Topic name already exists' });
    } else {
      res.status(500).json({ message: 'Failed to create topic' });
    }
  }
};

/**
 * Update a topic
 * @route PUT /api/topics/:id
 */
export const updateTopic = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { topic_name, is_active, sort_order, category } = req.body;

    const existingRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id FROM topics WHERE id = ${id} LIMIT 1`
    );
    if (existingRows.length === 0) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];

    if (topic_name !== undefined) {
      if (!topic_name || topic_name.trim().length === 0) {
        res.status(400).json({ message: 'Topic name cannot be empty' });
        return;
      }
      const dup = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id FROM topics WHERE topic_name = ${topic_name.trim()} AND id != ${id} LIMIT 1`
      );
      if (dup.length > 0) {
        res.status(409).json({ message: 'Topic name already exists' });
        return;
      }
      sets.push('topic_name = ?');
      params.push(topic_name.trim());
    }
    if (is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(is_active === true || is_active === 'true' ? 1 : 0);
    }
    if (sort_order !== undefined) {
      sets.push('sort_order = ?');
      params.push(Number(sort_order));
    }
    if (category !== undefined) {
      sets.push('category = ?');
      params.push(category || null);
    }

    if (sets.length <= 1) {
      res.status(400).json({ message: 'No fields to update' });
      return;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE topics SET ${sets.join(', ')} WHERE id = ?`,
      ...params, id
    );

    const [row] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, topic_name, is_active, sort_order, category, created_at, updated_at FROM topics WHERE id = ${id}`
    );

    res.status(200).json({ ...row, is_active: Boolean(row.is_active) });
  } catch (error: any) {
    console.error('Error updating topic:', error);
    if (error.code === 'ER_DUP_ENTRY' || error.message?.includes('Duplicate entry')) {
      res.status(409).json({ message: 'Topic name already exists' });
    } else {
      res.status(500).json({ message: 'Failed to update topic' });
    }
  }
};

/**
 * Toggle topic active status
 * @route PUT /api/topics/:id/status
 */
export const toggleTopicStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { is_active } = req.body;

    if (is_active === undefined) {
      res.status(400).json({ message: 'is_active field is required' });
      return;
    }

    const existingRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id FROM topics WHERE id = ${id} LIMIT 1`
    );
    if (existingRows.length === 0) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    const isActiveVal = is_active === true || is_active === 'true' ? 1 : 0;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE topics SET is_active = ${isActiveVal}, updated_at = NOW() WHERE id = ${id}`
    );
    const [row] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, topic_name, is_active, sort_order, category, created_at, updated_at FROM topics WHERE id = ${id}`
    );

    res.status(200).json({ ...row, is_active: Boolean(row.is_active) });
  } catch (error) {
    console.error('Error toggling topic status:', error);
    res.status(500).json({ message: 'Failed to toggle topic status' });
  }
};

/**
 * Update sort order for multiple topics
 * @route PUT /api/topics/sort-order
 */
export const updateSortOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { topics } = req.body;

    if (!Array.isArray(topics) || topics.length === 0) {
      res.status(400).json({ message: 'Topics array is required' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const item of topics) {
        if (!item.id || item.sort_order === undefined) {
          throw new Error('Each topic must have id and sort_order');
        }
        await tx.topic.update({
          where: { id: item.id },
          data: { sort_order: item.sort_order, updated_at: new Date() }
        });
      }
    });

    res.status(200).json({ message: 'Sort order updated successfully' });
  } catch (error) {
    console.error('Error updating sort order:', error);
    res.status(500).json({ message: 'Failed to update sort order' });
  }
};

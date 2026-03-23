import { Request, Response } from 'express';
import prisma from '../config/prisma';

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

    const where: any = {};
    if (search) where.topic_name = { contains: search };
    if (is_active !== undefined) where.is_active = is_active;

    const [total, rows] = await Promise.all([
      prisma.topic.count({ where }),
      prisma.topic.findMany({
        where,
        select: { id: true, topic_name: true, is_active: true, sort_order: true, created_at: true, updated_at: true },
        orderBy: [{ sort_order: 'asc' }, { topic_name: 'asc' }],
        skip: offset,
        take: limit
      })
    ]);

    const totalPages = Math.ceil(total / limit);
    const topics = rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active)
    }));

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

    const row = await prisma.topic.findUnique({
      where: { id },
      select: { id: true, topic_name: true, is_active: true, sort_order: true, created_at: true, updated_at: true }
    });

    if (!row) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    res.status(200).json({ ...row, is_active: Boolean(row.is_active) });
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
    const { topic_name, is_active, sort_order } = req.body;

    if (!topic_name || topic_name.trim().length === 0) {
      res.status(400).json({ message: 'Topic name is required' });
      return;
    }

    const existing = await prisma.topic.findFirst({ where: { topic_name: topic_name.trim() } });
    if (existing) {
      res.status(409).json({ message: 'Topic name already exists' });
      return;
    }

    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const agg = await prisma.topic.aggregate({ _max: { sort_order: true } });
      finalSortOrder = (agg._max.sort_order ?? 0) + 1;
    }

    const row = await prisma.topic.create({
      data: {
        topic_name: topic_name.trim(),
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        sort_order: finalSortOrder
      },
      select: { id: true, topic_name: true, is_active: true, sort_order: true, created_at: true, updated_at: true }
    });

    res.status(201).json({ ...row, is_active: Boolean(row.is_active) });
  } catch (error: any) {
    console.error('Error creating topic:', error);
    if (error.code === 'P2002') {
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
    const { topic_name, is_active, sort_order } = req.body;

    const existing = await prisma.topic.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    const data: any = { updated_at: new Date() };

    if (topic_name !== undefined) {
      if (!topic_name || topic_name.trim().length === 0) {
        res.status(400).json({ message: 'Topic name cannot be empty' });
        return;
      }

      const duplicate = await prisma.topic.findFirst({
        where: { topic_name: topic_name.trim(), NOT: { id } }
      });
      if (duplicate) {
        res.status(409).json({ message: 'Topic name already exists' });
        return;
      }

      data.topic_name = topic_name.trim();
    }

    if (is_active !== undefined) data.is_active = Boolean(is_active);
    if (sort_order !== undefined) data.sort_order = sort_order;

    if (Object.keys(data).length <= 1) {
      res.status(400).json({ message: 'No fields to update' });
      return;
    }

    const row = await prisma.topic.update({
      where: { id },
      data,
      select: { id: true, topic_name: true, is_active: true, sort_order: true, created_at: true, updated_at: true }
    });

    res.status(200).json({ ...row, is_active: Boolean(row.is_active) });
  } catch (error: any) {
    console.error('Error updating topic:', error);
    if (error.code === 'P2002') {
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

    const existing = await prisma.topic.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Topic not found' });
      return;
    }

    const row = await prisma.topic.update({
      where: { id },
      data: { is_active: Boolean(is_active), updated_at: new Date() },
      select: { id: true, topic_name: true, is_active: true, sort_order: true, created_at: true, updated_at: true }
    });

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

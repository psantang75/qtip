import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

/**
 * Get all training paths with pagination and search
 * @route GET /api/training-paths
 */
export const getTrainingPaths = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
    const search = (req.query.search as string || '').trim();
    const offset = (page - 1) * limit;

    console.log('getTrainingPaths params:', { page, limit, search, offset });

    const whereCondition = search ? Prisma.sql`WHERE tp.path_name LIKE ${`%${search}%`}` : Prisma.sql``;

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as total FROM training_paths tp
      ${whereCondition}
    `);
    const total = Number(countResult[0]?.total || 0);

    const paths = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        tp.id,
        tp.path_name,
        tp.created_by,
        tp.created_at
      FROM training_paths tp
      ${whereCondition}
      ORDER BY tp.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const formattedPaths = [];
    for (const path of paths) {
      const courseRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT
          tpc.course_id,
          tpc.course_order,
          c.course_name
        FROM training_path_courses tpc
        JOIN courses c ON tpc.course_id = c.id
        WHERE tpc.path_id = ${path.id}
        ORDER BY tpc.course_order ASC
      `);

      formattedPaths.push({
        id: path.id,
        path_name: path.path_name,
        created_by: path.created_by,
        created_at: path.created_at,
        courses: courseRows
      });
    }

    res.status(200).json({
      data: formattedPaths,
      total,
      page,
      perPage: limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching training paths:', error);
    res.status(500).json({ message: 'Failed to fetch training paths' });
  }
};

/**
 * Get a specific training path by ID
 * @route GET /api/training-paths/:path_id
 */
export const getTrainingPathById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { path_id } = req.params;

    const pathRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        tp.id,
        tp.path_name,
        tp.created_by,
        tp.created_at
      FROM training_paths tp
      WHERE tp.id = ${Number(path_id)}
    `);

    if (pathRows.length === 0) {
      res.status(404).json({ message: 'Training path not found' });
      return;
    }

    const courseRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        tpc.course_id,
        tpc.course_order,
        c.course_name,
        c.description
      FROM training_path_courses tpc
      JOIN courses c ON tpc.course_id = c.id
      WHERE tpc.path_id = ${Number(path_id)}
      ORDER BY tpc.course_order ASC
    `);

    const path = {
      ...pathRows[0],
      courses: courseRows
    };

    res.status(200).json(path);
  } catch (error) {
    console.error('Error fetching training path:', error);
    res.status(500).json({ message: 'Failed to fetch training path' });
  }
};

/**
 * Create a new training path
 * @route POST /api/training-paths
 */
export const createTrainingPath = async (req: Request, res: Response): Promise<void> => {
  try {
    const { path_name, courses } = req.body;
    const user_id = req.user?.user_id;

    if (!path_name || !courses || courses.length === 0) {
      res.status(400).json({ message: 'Path name and courses are required' });
      return;
    }

    let path_id: number;

    await prisma.$transaction(async (tx) => {
      const created = await tx.trainingPath.create({
        data: {
          path_name: path_name,
          created_by: user_id!
        }
      });

      path_id = created.id;

      for (const course of courses) {
        await tx.trainingPathCourse.create({
          data: {
            path_id: path_id,
            course_id: course.course_id,
            course_order: course.course_order
          }
        });
      }
    });

    res.status(201).json({
      id: path_id!,
      path_name,
      created_by: user_id,
      courses
    });
  } catch (error) {
    console.error('Error creating training path:', error);
    res.status(500).json({ message: 'Failed to create training path' });
  }
};

/**
 * Update an existing training path
 * @route PUT /api/training-paths/:path_id
 */
export const updateTrainingPath = async (req: Request, res: Response): Promise<void> => {
  try {
    const { path_id } = req.params;
    const { path_name, courses } = req.body;

    if (!path_name || !courses) {
      res.status(400).json({ message: 'Path name and courses are required' });
      return;
    }

    const existingPath = await prisma.trainingPath.findUnique({
      where: { id: Number(path_id) },
      select: { id: true }
    });

    if (!existingPath) {
      res.status(404).json({ message: 'Training path not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.trainingPath.update({
        where: { id: Number(path_id) },
        data: { path_name: path_name }
      });

      await tx.trainingPathCourse.deleteMany({ where: { path_id: Number(path_id) } });

      for (const course of courses) {
        await tx.trainingPathCourse.create({
          data: {
            path_id: Number(path_id),
            course_id: course.course_id,
            course_order: course.course_order
          }
        });
      }
    });

    res.status(200).json({
      id: path_id,
      path_name,
      courses
    });
  } catch (error) {
    console.error('Error updating training path:', error);
    res.status(500).json({ message: 'Failed to update training path' });
  }
};

/**
 * Delete a training path
 * @route DELETE /api/training-paths/:path_id
 */
export const deleteTrainingPath = async (req: Request, res: Response): Promise<void> => {
  try {
    const { path_id } = req.params;

    const existingPath = await prisma.trainingPath.findUnique({
      where: { id: Number(path_id) },
      select: { id: true }
    });

    if (!existingPath) {
      res.status(404).json({ message: 'Training path not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.trainingPathCourse.deleteMany({ where: { path_id: Number(path_id) } });
      await tx.trainingPath.delete({ where: { id: Number(path_id) } });
    });

    res.status(200).json({ message: 'Training path deleted successfully' });
  } catch (error) {
    console.error('Error deleting training path:', error);
    res.status(500).json({ message: 'Failed to delete training path' });
  }
};

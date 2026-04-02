import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  content_type, 
  CourseDetailResponse, 
  CourseListItem, 
  CourseStatus, 
  CreateCourseDTO, 
  PaginatedResponse
} from '../types/course.types';

/**
 * Get all courses with pagination and search
 * @route GET /api/courses
 */
export const getCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.perPage as string) || 10;
    const search = req.query.search as string || '';
    const offset = (page - 1) * perPage;

    console.log('getCourses params:', { page, perPage, search, offset });

    const whereCondition = search ? Prisma.sql`WHERE c.course_name LIKE ${`%${search}%`}` : Prisma.sql``;

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as total
      FROM courses c
      ${whereCondition}
    `);
    const total = Number(countResult[0]?.total || 0);
    const totalPages = Math.ceil(total / perPage);

    console.log('Query params: search:', search, 'LIMIT:', perPage, 'OFFSET:', offset);

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        c.id,
        c.course_name,
        c.created_by,
        c.created_at,
        c.description,
        c.is_draft,
        u.username as creator_name,
        CASE
          WHEN c.is_draft = 1 THEN 'DRAFT'
          ELSE 'PUBLISHED'
        END as status
      FROM courses c
      JOIN users u ON c.created_by = u.id
      ${whereCondition}
      ORDER BY c.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const courses: CourseListItem[] = rows.map((row: any) => ({
      id: row.id,
      course_name: row.course_name,
      description: row.description,
      created_by: row.created_by,
      creator_name: row.creator_name,
      created_at: row.created_at,
      status: row.status as CourseStatus
    }));

    const response: PaginatedResponse<CourseListItem> = {
      data: courses,
      total,
      page,
      perPage,
      totalPages
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ message: 'Failed to retrieve courses' });
  }
};

/**
 * Get a specific course by ID with its pages and quiz
 * @route GET /api/courses/:course_id
 */
export const getCourseById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;

    const courseRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        c.*,
        u.username as creator_name,
        CASE
          WHEN c.is_draft = 1 THEN 'DRAFT'
          ELSE 'PUBLISHED'
        END as status
      FROM courses c
      JOIN users u ON c.created_by = u.id
      WHERE c.id = ${Number(course_id)}
    `);

    if (courseRows.length === 0) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const course = courseRows[0];

    const pageRows = await prisma.coursePage.findMany({
      where: { course_id: Number(course_id) },
      orderBy: { page_order: 'asc' }
    });

    const pages = pageRows.map((row: any) => ({
      id: row.id,
      page_title: row.page_title,
      content_type: row.content_type,
      content_url: row.content_url,
      content_text: row.content_text,
      page_order: row.page_order
    }));

    const quizData = await prisma.quiz.findFirst({
      where: { course_id: Number(course_id) }
    });

    let quiz = null;
    if (quizData) {
      const questionRows = await prisma.quizQuestion.findMany({
        where: { quiz_id: quizData.id }
      });

      const questions = questionRows.map((row: any) => ({
        id: row.id,
        question_text: row.question_text,
        options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
        correct_option: row.correct_option
      }));

      quiz = {
        id: quizData.id,
        quiz_title: quizData.quiz_title,
        pass_score: Number(quizData.pass_score),
        questions
      };
    }

    const courseDetail: CourseDetailResponse = {
      id: course.id,
      course_name: course.course_name,
      description: course.description,
      created_by: course.created_by,
      creator_name: course.creator_name,
      created_at: course.created_at,
      status: course.status as CourseStatus,
      pages,
      quiz: quiz || undefined
    };

    res.status(200).json(courseDetail);
  } catch (error) {
    console.error('Error fetching course details:', error);
    res.status(500).json({ message: 'Failed to retrieve course details' });
  }
};

/**
 * Create a new course with pages and quiz
 * @route POST /api/courses
 */
export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const courseData: CreateCourseDTO = req.body;

    if (!courseData.course_name || !courseData.created_by || !courseData.pages) {
      res.status(400).json({ error: 'Missing required fields: course_name, created_by, and pages are required' });
      return;
    }

    const existingCourse = await prisma.course.findFirst({
      where: { course_name: courseData.course_name },
      select: { id: true }
    });

    if (existingCourse) {
      res.status(400).json({ error: 'Course name already exists' });
      return;
    }

    let course_id: number;

    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.course.create({
          data: {
            course_name: courseData.course_name,
            description: courseData.description || null,
            created_by: courseData.created_by,
            is_draft: courseData.is_draft ? true : false
          }
        });

        course_id = created.id;

        if (courseData.pages && courseData.pages.length > 0) {
          for (const page of courseData.pages) {
            await tx.$executeRaw`
              INSERT INTO course_pages (course_id, page_title, content_type, content_url, content_text, page_order)
              VALUES (${course_id}, ${page.page_title}, ${page.content_type}, ${page.content_url || null}, ${page.content_text || null}, ${page.page_order})
            `;
          }
        }

        if (courseData.quiz && courseData.quiz.quiz_title && courseData.quiz.quiz_title.trim() !== '') {
          await tx.$executeRaw`
            INSERT INTO quizzes (course_id, quiz_title, pass_score)
            VALUES (${course_id}, ${courseData.quiz.quiz_title}, ${courseData.quiz.pass_score})
          `;

          const quizIdResult = await tx.$queryRaw<{ id: bigint }[]>`SELECT LAST_INSERT_ID() as id`;
          const quiz_id = Number(quizIdResult[0].id);

          if (courseData.quiz.questions && courseData.quiz.questions.length > 0) {
            for (const question of courseData.quiz.questions) {
              await tx.$executeRaw`
                INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option)
                VALUES (${quiz_id}, ${question.question_text}, ${JSON.stringify(question.options)}, ${question.correct_option})
              `;
            }
          }
        }

        await tx.$executeRaw`
          INSERT INTO audit_logs (user_id, action, target_id, target_type, details, created_at)
          VALUES (${courseData.created_by}, ${'CREATE'}, ${course_id}, ${'courses'}, ${JSON.stringify({ course_name: courseData.course_name, is_draft: courseData.is_draft ? 1 : 0 })}, NOW())
        `;
      });

      res.status(201).json({
        id: course_id!,
        course_name: courseData.course_name,
        description: courseData.description,
        created_by: courseData.created_by,
        is_draft: courseData.is_draft ? 1 : 0,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      throw error;
    }
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update an existing course
 * @route PUT /api/courses/:course_id
 */
export const updateCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;
    const courseData: CreateCourseDTO = req.body;
    const user_id = req.user?.user_id || courseData.created_by;

    const existingCourse = await prisma.course.findUnique({
      where: { id: Number(course_id) },
      select: { id: true, created_by: true }
    });

    if (!existingCourse) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const duplicateCourse = await prisma.course.findFirst({
      where: { course_name: courseData.course_name, NOT: { id: Number(course_id) } },
      select: { id: true }
    });

    if (duplicateCourse) {
      res.status(400).json({ message: 'Course name already exists' });
      return;
    }

    if (!courseData.pages || courseData.pages.length === 0) {
      res.status(400).json({ message: 'Course must have at least one page' });
      return;
    }

    for (const page of courseData.pages) {
      if ((page.content_type === content_type.VIDEO || page.content_type === content_type.PDF) && !page.content_url) {
        res.status(400).json({ message: `${page.content_type} page must have a content URL` });
        return;
      }
      if (page.content_type === content_type.TEXT && !page.content_text) {
        res.status(400).json({ message: 'Text page must have content' });
        return;
      }
    }

    if (courseData.quiz) {
      if (courseData.quiz.pass_score < 0 || courseData.quiz.pass_score > 1) {
        res.status(400).json({ message: 'Quiz pass score must be between 0 and 1' });
        return;
      }
      if (courseData.quiz.questions && courseData.quiz.questions.length > 0) {
        for (const question of courseData.quiz.questions) {
          if (!question.options || question.options.length < 2) {
            res.status(400).json({ message: 'Quiz questions must have at least two options' });
            return;
          }
          if (question.correct_option < 0 || question.correct_option >= question.options.length) {
            res.status(400).json({ message: 'Correct option index is out of bounds' });
            return;
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id: Number(course_id) },
        data: {
          course_name: courseData.course_name,
          description: courseData.description || null,
          is_draft: courseData.is_draft ? true : false
        }
      });

      await tx.coursePage.deleteMany({ where: { course_id: Number(course_id) } });

      for (const page of courseData.pages) {
        await tx.$executeRaw`
          INSERT INTO course_pages (course_id, page_title, content_type, content_url, content_text, page_order)
          VALUES (${Number(course_id)}, ${page.page_title}, ${page.content_type}, ${page.content_url || null}, ${page.content_text || null}, ${page.page_order})
        `;
      }

      const existingQuiz = await tx.quiz.findFirst({
        where: { course_id: Number(course_id) },
        select: { id: true }
      });

      if (existingQuiz) {
        await tx.quizQuestion.deleteMany({ where: { quiz_id: existingQuiz.id } });
        await tx.quiz.delete({ where: { id: existingQuiz.id } });
      }

      if (courseData.quiz && courseData.quiz.quiz_title && courseData.quiz.quiz_title.trim() !== '') {
        await tx.$executeRaw`
          INSERT INTO quizzes (course_id, quiz_title, pass_score)
          VALUES (${Number(course_id)}, ${courseData.quiz.quiz_title}, ${courseData.quiz.pass_score})
        `;

        const quizIdResult = await tx.$queryRaw<{ id: bigint }[]>`SELECT LAST_INSERT_ID() as id`;
        const quiz_id = Number(quizIdResult[0].id);

        if (courseData.quiz.questions && courseData.quiz.questions.length > 0) {
          for (const question of courseData.quiz.questions) {
            await tx.$executeRaw`
              INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option)
              VALUES (${quiz_id}, ${question.question_text}, ${JSON.stringify(question.options)}, ${question.correct_option})
            `;
          }
        }
      }

      await tx.$executeRaw`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${Number(user_id)}, ${'Updated course'}, ${Number(course_id)}, ${'COURSE'}, ${JSON.stringify({
          course_name: courseData.course_name,
          pages_count: courseData.pages.length,
          has_quiz: courseData.quiz ? true : false
        })})
      `;
    });

    res.status(200).json({
      message: 'Course updated successfully',
      course_id: course_id
    });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ message: 'Failed to update course' });
  }
};

/**
 * Publish a course (make it available to CSRs)
 * @route PATCH /api/courses/:course_id/publish
 */
export const publishCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;
    const user_id = req.user?.user_id;

    console.log('[PUBLISH COURSE] Starting publish for course:', course_id);
    console.log('[PUBLISH COURSE] User ID:', user_id);
    console.log('[PUBLISH COURSE] Request user object:', req.user);

    if (!user_id) {
      console.error('[PUBLISH COURSE] No user ID found in request');
      res.status(401).json({ message: 'User authentication required' });
      return;
    }

    const existingCourse = await prisma.course.findUnique({
      where: { id: Number(course_id) },
      select: { id: true, created_by: true, is_draft: true }
    });

    console.log('[PUBLISH COURSE] Course query result:', existingCourse);

    if (!existingCourse) {
      console.error('[PUBLISH COURSE] Course not found:', course_id);
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    console.log('[PUBLISH COURSE] Found course:', existingCourse);

    const pageCount = await prisma.coursePage.count({
      where: { course_id: Number(course_id) }
    });

    console.log('[PUBLISH COURSE] Page count result:', pageCount);

    if (pageCount === 0) {
      console.error('[PUBLISH COURSE] Course has no pages:', course_id);
      res.status(400).json({ message: 'Cannot publish a course without pages' });
      return;
    }

    console.log('[PUBLISH COURSE] Course has', pageCount, 'pages, proceeding with publish');

    await prisma.course.update({
      where: { id: Number(course_id) },
      data: { is_draft: false }
    });

    console.log('[PUBLISH COURSE] Updated course draft status');

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${Number(user_id)}, ${'PUBLISH'}, ${Number(course_id)}, ${'courses'}, ${JSON.stringify({ status: 'PUBLISHED', previous_draft_status: existingCourse.is_draft })})
    `;

    console.log('[PUBLISH COURSE] Added audit log');

    res.status(200).json({
      message: 'Course published successfully',
      course_id: course_id
    });

    console.log('[PUBLISH COURSE] Success response sent');
  } catch (error) {
    console.error('[PUBLISH COURSE] Error publishing course:', error);
    res.status(500).json({
      message: 'Failed to publish course',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Delete a course if it has no enrollments
 * @route DELETE /api/courses/:course_id
 */
export const deleteCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;
    const user_id = req.user?.user_id;

    const existingCourse = await prisma.course.findUnique({
      where: { id: Number(course_id) },
      select: { id: true, course_name: true }
    });

    if (!existingCourse) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const course_name = existingCourse.course_name;

    const enrollmentResult = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as count FROM enrollments
      WHERE course_id = ${Number(course_id)} AND NOT (user_id = ${user_id ? Number(user_id) : null} AND status = 'COMPLETED')
    `);
    const enrollmentCount = Number(enrollmentResult[0]?.count || 0);

    if (enrollmentCount > 0) {
      res.status(400).json({ message: 'Cannot delete course with active enrollments' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const existingQuiz = await tx.quiz.findFirst({
        where: { course_id: Number(course_id) },
        select: { id: true }
      });

      if (existingQuiz) {
        await tx.quizQuestion.deleteMany({ where: { quiz_id: existingQuiz.id } });
        await tx.quiz.delete({ where: { id: existingQuiz.id } });
      }

      await tx.coursePage.deleteMany({ where: { course_id: Number(course_id) } });
      await tx.enrollment.deleteMany({ where: { course_id: Number(course_id) } });
      await tx.course.delete({ where: { id: Number(course_id) } });

      await tx.$executeRaw`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${Number(user_id)}, ${'Deleted course'}, ${Number(course_id)}, ${'COURSE'}, ${JSON.stringify({ course_name: course_name })})
      `;
    });

    res.status(200).json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ message: 'Failed to delete course' });
  }
};

/**
 * Get all pages for a specific course
 * @route GET /api/courses/:course_id/pages
 */
export const getCoursePages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;

    const courseExists = await prisma.course.findUnique({
      where: { id: Number(course_id) },
      select: { id: true }
    });

    if (!courseExists) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const pageRows = await prisma.coursePage.findMany({
      where: { course_id: Number(course_id) },
      orderBy: { page_order: 'asc' }
    });

    const pages = pageRows.map((row: any) => ({
      id: row.id,
      course_id: row.course_id,
      page_title: row.page_title,
      content_type: row.content_type,
      content_url: row.content_url,
      content_text: row.content_text,
      page_order: row.page_order
    }));

    res.status(200).json(pages);
  } catch (error) {
    console.error('Error fetching course pages:', error);
    res.status(500).json({ message: 'Failed to fetch course pages' });
  }
};

/**
 * Create a new page for a course
 * @route POST /api/courses/:course_id/pages
 */
export const createCoursePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id } = req.params;
    const pageData = req.body;
    const user_id = req.user?.user_id;

    const courseExists = await prisma.course.findUnique({
      where: { id: Number(course_id) },
      select: { id: true, created_by: true }
    });

    if (!courseExists) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    if (!pageData.page_title || !pageData.content_type || pageData.page_order === undefined) {
      res.status(400).json({ message: 'Missing required fields: page_title, content_type, page_order' });
      return;
    }

    if ((pageData.content_type === 'VIDEO' || pageData.content_type === 'PDF') && !pageData.content_url) {
      res.status(400).json({ message: `${pageData.content_type} page must have a content URL` });
      return;
    }

    if (pageData.content_type === 'TEXT' && !pageData.content_text) {
      res.status(400).json({ message: 'Text page must have content' });
      return;
    }

    let pageId: number;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO course_pages (course_id, page_title, content_type, content_url, content_text, page_order)
        VALUES (${Number(course_id)}, ${pageData.page_title}, ${pageData.content_type}, ${pageData.content_url || null}, ${pageData.content_text || null}, ${pageData.page_order})
      `;

      const idResult = await tx.$queryRaw<{ id: bigint }[]>`SELECT LAST_INSERT_ID() as id`;
      pageId = Number(idResult[0].id);

      await tx.$executeRaw`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${Number(user_id)}, ${'Created page'}, ${pageId}, ${'COURSE_PAGE'}, ${JSON.stringify({ course_id: course_id, page_title: pageData.page_title, content_type: pageData.content_type })})
      `;
    });

    const newPage = {
      id: pageId!,
      course_id: parseInt(course_id),
      page_title: pageData.page_title,
      content_type: pageData.content_type,
      content_url: pageData.content_url,
      content_text: pageData.content_text,
      page_order: pageData.page_order
    };

    res.status(201).json(newPage);
  } catch (error) {
    console.error('Error creating course page:', error);
    res.status(500).json({ message: 'Failed to create course page' });
  }
};

/**
 * Update a specific course page
 * @route PUT /api/courses/:course_id/pages/:pageId
 */
export const updateCoursePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id, pageId } = req.params;
    const pageData = req.body;
    const user_id = req.user?.user_id;

    const existingPage = await prisma.coursePage.findFirst({
      where: { id: Number(pageId), course_id: Number(course_id) }
    });

    if (!existingPage) {
      res.status(404).json({ message: 'Page not found' });
      return;
    }

    const updatedData = {
      page_title: pageData.page_title ?? existingPage.page_title,
      content_type: pageData.content_type ?? existingPage.content_type,
      content_url: pageData.content_url ?? existingPage.content_url,
      content_text: pageData.content_text ?? existingPage.content_text,
      page_order: pageData.page_order ?? existingPage.page_order
    };

    if ((updatedData.content_type === 'VIDEO' || updatedData.content_type === 'PDF') && !updatedData.content_url) {
      res.status(400).json({ message: `${updatedData.content_type} page must have a content URL` });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.coursePage.update({
        where: { id: Number(pageId) },
        data: {
          page_title: updatedData.page_title,
          content_type: updatedData.content_type,
          content_url: updatedData.content_url,
          content_text: updatedData.content_text,
          page_order: updatedData.page_order
        }
      });

      await tx.$executeRaw`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${Number(user_id)}, ${'Updated page'}, ${Number(pageId)}, ${'COURSE_PAGE'}, ${JSON.stringify({ course_id: course_id, page_title: updatedData.page_title, content_type: updatedData.content_type })})
      `;
    });

    const updatedPage = {
      id: parseInt(pageId),
      course_id: parseInt(course_id),
      ...updatedData
    };

    res.status(200).json(updatedPage);
  } catch (error) {
    console.error('Error updating course page:', error);
    res.status(500).json({ message: 'Failed to update course page' });
  }
};

/**
 * Delete a specific course page
 * @route DELETE /api/courses/:course_id/pages/:pageId
 */
export const deleteCoursePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id, pageId } = req.params;
    const user_id = req.user?.user_id;

    const existingPage = await prisma.coursePage.findFirst({
      where: { id: Number(pageId), course_id: Number(course_id) },
      select: { page_title: true, page_order: true }
    });

    if (!existingPage) {
      res.status(404).json({ message: 'Page not found' });
      return;
    }

    const page_title = existingPage.page_title;
    const page_order = existingPage.page_order;

    await prisma.$transaction(async (tx) => {
      await tx.coursePage.delete({ where: { id: Number(pageId) } });

      await tx.$executeRaw`
        UPDATE course_pages
        SET page_order = page_order - 1
        WHERE course_id = ${Number(course_id)} AND page_order > ${page_order}
      `;

      await tx.$executeRaw`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${Number(user_id)}, ${'Deleted page'}, ${Number(pageId)}, ${'COURSE_PAGE'}, ${JSON.stringify({ course_id: course_id, page_title: page_title })})
      `;
    });

    res.status(200).json({ message: 'Page deleted successfully' });
  } catch (error) {
    console.error('Error deleting course page:', error);
    res.status(500).json({ message: 'Failed to delete course page' });
  }
};

/**
 * Auto-save a course page (for visual editor)
 * @route PATCH /api/courses/:course_id/pages/:pageId/autosave
 */
export const autoSaveCoursePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { course_id, pageId } = req.params;
    const pageData = req.body;

    const existingPage = await prisma.coursePage.findFirst({
      where: { id: Number(pageId), course_id: Number(course_id) },
      select: { id: true }
    });

    if (!existingPage) {
      res.status(404).json({ message: 'Page not found' });
      return;
    }

    const updateData: Record<string, any> = {};

    if (pageData.page_title !== undefined) {
      updateData.page_title = pageData.page_title;
    }
    if (pageData.content_text !== undefined) {
      updateData.content_text = pageData.content_text;
    }
    if (pageData.content_url !== undefined) {
      updateData.content_url = pageData.content_url;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: 'No fields to update' });
      return;
    }

    await prisma.coursePage.update({
      where: { id: Number(pageId) },
      data: updateData
    });

    res.status(200).json({ message: 'Page auto-saved successfully' });
  } catch (error) {
    console.error('Error auto-saving course page:', error);
    res.status(500).json({ message: 'Failed to auto-save course page' });
  }
};

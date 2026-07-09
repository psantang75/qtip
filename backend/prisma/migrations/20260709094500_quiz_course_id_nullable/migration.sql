-- Courses were removed from the product; quizzes are now categorized by
-- training topics (the quiz_topics join table) instead of a parent course.
-- Make quizzes.course_id nullable so a quiz can be created without one.
--
-- The FK to courses (ON DELETE CASCADE) is intentionally retained so the
-- legacy rows that still point at a course keep their referential integrity.
-- MySQL keeps the existing `quizzes_course_id_fkey` constraint across a
-- plain column MODIFY, so no drop/recreate is required.
ALTER TABLE `quizzes` MODIFY COLUMN `course_id` INT NULL;

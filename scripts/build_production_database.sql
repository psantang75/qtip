-- Production Database Build Script
-- Date: 2025-06-27
-- Description: Clean database setup for production deployment
-- Preserves: users, roles, departments
-- Removes: all transactional/test data

-- Use the qtip database
USE qtip;

-- Disable foreign key checks to allow truncation
SET FOREIGN_KEY_CHECKS = 0;

-- Clear all transactional and test data
-- Keep users, roles, departments tables intact

-- Authentication and logging data
TRUNCATE TABLE auth_logs;
TRUNCATE TABLE audit_logs;

-- QA and submission data
TRUNCATE TABLE free_text_answers;
TRUNCATE TABLE submission_answers;
TRUNCATE TABLE submission_metadata;
TRUNCATE TABLE submission_calls;
TRUNCATE TABLE dispute_score_history;
TRUNCATE TABLE submissions;
TRUNCATE TABLE disputes;
TRUNCATE TABLE score_snapshots;

-- Form data (these are likely test forms)
TRUNCATE TABLE form_question_conditions;
TRUNCATE TABLE radio_options;
TRUNCATE TABLE form_questions;
TRUNCATE TABLE form_categories;
TRUNCATE TABLE form_metadata_fields;
TRUNCATE TABLE forms;

-- Training and coaching data
TRUNCATE TABLE training_logs;
TRUNCATE TABLE certificates;
TRUNCATE TABLE enrollments;
TRUNCATE TABLE training_path_courses;
TRUNCATE TABLE training_paths;
TRUNCATE TABLE course_pages;
TRUNCATE TABLE quiz_questions;
TRUNCATE TABLE quizzes;
TRUNCATE TABLE courses;
TRUNCATE TABLE coaching_sessions;

-- Performance and assignment data
TRUNCATE TABLE audit_assignments;
TRUNCATE TABLE performance_goal_users;
TRUNCATE TABLE performance_goal_departments;
TRUNCATE TABLE performance_goals;

-- Call data
TRUNCATE TABLE calls;
TRUNCATE TABLE agent_activity;

-- Department managers (may want to preserve some, but clearing for clean start)
TRUNCATE TABLE department_managers;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- Insert essential department managers if needed
-- (You may want to add specific manager assignments here)

-- Production data validation
SELECT 'Production Database Setup Complete' as Status;
SELECT 'Users preserved:', COUNT(*) as Count FROM users;
SELECT 'Roles preserved:', COUNT(*) as Count FROM roles;
SELECT 'Departments preserved:', COUNT(*) as Count FROM departments;
SELECT 'All transactional data cleared' as Note;

-- Reset auto-increment values for clean production start
ALTER TABLE forms AUTO_INCREMENT = 1;
ALTER TABLE submissions AUTO_INCREMENT = 1;
ALTER TABLE courses AUTO_INCREMENT = 1;
ALTER TABLE coaching_sessions AUTO_INCREMENT = 1;
ALTER TABLE audit_assignments AUTO_INCREMENT = 1;
ALTER TABLE performance_goals AUTO_INCREMENT = 1;
ALTER TABLE calls AUTO_INCREMENT = 1;
ALTER TABLE certificates AUTO_INCREMENT = 1;
ALTER TABLE enrollments AUTO_INCREMENT = 1;
ALTER TABLE training_paths AUTO_INCREMENT = 1;
ALTER TABLE disputes AUTO_INCREMENT = 1;
ALTER TABLE dispute_score_history AUTO_INCREMENT = 1;
ALTER TABLE audit_logs AUTO_INCREMENT = 1;
ALTER TABLE auth_logs AUTO_INCREMENT = 1; 
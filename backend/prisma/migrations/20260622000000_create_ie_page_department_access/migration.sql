-- ie_page_department_access: additive department-level access grants per page.
--
-- Mirrors ie_page_role_access, but keyed on a conformed department
-- (ie_dim_department.department_key) instead of a role. Resolution is additive:
-- a user can open a page if their ROLE grant OR any matching DEPARTMENT grant
-- allows it; user overrides still take absolute precedence. A grant on a parent
-- department cascades to every descendant department at resolution time (see
-- InsightsPermissionService + getAncestorDepartmentKeys). Purely additive — no
-- existing table or data is touched.
CREATE TABLE `ie_page_department_access` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `page_id`        INT NOT NULL,
  `department_key` INT NOT NULL,
  `can_access`     BOOLEAN NOT NULL DEFAULT FALSE,
  `data_scope`     ENUM('ALL','DIVISION','DEPARTMENT','SELF') NOT NULL DEFAULT 'DEPARTMENT',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_department` (`page_id`, `department_key`),
  INDEX `idx_page_dept_dept` (`department_key`),
  CONSTRAINT `fk_page_dept_page` FOREIGN KEY (`page_id`) REFERENCES `ie_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_dept_dept` FOREIGN KEY (`department_key`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

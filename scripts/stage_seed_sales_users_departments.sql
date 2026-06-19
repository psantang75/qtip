-- ─────────────────────────────────────────────────────────────────────────────
-- Stage/Prod reference-data seed: Sales department hierarchy + Sales CSR users
--
-- Idempotent and PURELY ADDITIVE. Every statement is INSERT IGNORE keyed on a
-- UNIQUE column (departments.department_name, users.email / users.username), so
-- a row that already exists is SKIPPED and never modified. This script will NOT
-- touch any existing user, department, QA form, or other data. Safe to re-run.
--
-- Stage/prod auto-increment ids differ from dev, so role_id and department_id
-- are resolved BY NAME at run time (never copied from dev). Generated from the
-- dev "Sales Department - All" subtree (4 departments, 8 CSRs).
--
-- Run (PowerShell):
--   mysql -h <host> -u <user> -p"<pw>" <db> -e "source scripts/stage_seed_sales_users_departments.sql"
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Sales department hierarchy (parent first, then children) ─────────
-- Parent. If it already exists, this is a no-op and @sda picks up the live id.
INSERT IGNORE INTO departments (department_name, is_active) VALUES
  ('Sales Department - All', 1);

SET @sda := (SELECT id FROM departments WHERE department_name = 'Sales Department - All');

-- Children under Sales Department - All. New rows get parent_id = @sda; any that
-- already exist are skipped (their existing parent is left untouched).
INSERT IGNORE INTO departments (department_name, is_active, parent_id) VALUES
  ('Sales Team - Inbound', 1, @sda),
  ('Sales Team - Growth',  1, @sda),
  ('Sales Team - BDR',     1, @sda);

-- ── Step 2: Sales CSR users ──────────────────────────────────────────────────
-- role_id / department_id resolved by name for this environment. Passwords are
-- the dev bcrypt hashes (carried over so existing dev logins keep working). Any
-- email/username already present on stage is skipped (existing user untouched).
SET @csr        := (SELECT id FROM roles WHERE role_name = 'CSR');
SET @d_inbound  := (SELECT id FROM departments WHERE department_name = 'Sales Team - Inbound');
SET @d_bdr      := (SELECT id FROM departments WHERE department_name = 'Sales Team - BDR');

INSERT IGNORE INTO users (username, email, password_hash, role_id, department_id, is_active) VALUES
  ('Vince Deleon',        'VDeleon@dm-us.com',     '$2b$10$WJr.oH1BGAUvyikjNCLdH.rwmBzO5cZIp2OsNYg0ydDLrSMpRTk0C', @csr, @d_inbound, 1),
  ('Jamie Waldie',        'JWaldie@dm-us.com',     '$2b$10$f52cFox5aUdOXnW3ZrR/5.0yv86jMnxhufKmioAoCDe1bOZr59XtO', @csr, @d_inbound, 1),
  ('Megan Foti',          'MFoti@dm-us.com',       '$2b$10$K4aYZOHAUAnwzt/fj6FBaOkZxAfWZJm0rP8H11/ZU/hGNqW9QdPgy', @csr, @d_inbound, 1),
  ('Steven Selley',       'SSelley@dm-us.com',     '$2b$10$eGuiKXWi/LfG3oT/WwN5y.nR0caKprxuCKHeexQ/iTGISi3XvSu9u', @csr, @d_inbound, 1),
  ('Mitchell Stempowski', 'MStempowski@dm-us.com', '$2b$10$rvqhEYegMxMYXPyxrpJCuOJEFfK/C37bK6cO/ITMoQrUfoMFKMYSG', @csr, @d_inbound, 1),
  ('Jason Spangler',      'JSpangler@dm-us.com',   '$2b$10$P0BmkCC6ghlGuijKSSF6SeLLNhQEvB48fO8Cgt/J/bgScxpVMXXH6', @csr, @d_inbound, 1),
  ('Joshua Barber',       'JBarber@dm-us.com',     '$2b$10$FCZ4C6.33OwDdWN/FlMOSuIe3nRTvhQ2/0.vDbCyzOm3N2GGeKrNK', @csr, @d_bdr,     1),
  ('Drew Feely',          'dfeely@dm-us.com',      '$2b$10$.IJQIBrVKqDI5CVKi/SMuu.s6v4hJuvxXCAixb9mdtQ2sYY0Ny8u6', @csr, @d_bdr,     1);

-- ── Step 3: Verification (read-only) ─────────────────────────────────────────
SELECT d.department_name, p.department_name AS parent, d.is_active
FROM departments d
LEFT JOIN departments p ON p.id = d.parent_id
WHERE d.department_name IN
  ('Sales Department - All','Sales Team - Inbound','Sales Team - Growth','Sales Team - BDR')
ORDER BY d.parent_id IS NOT NULL, d.department_name;

SELECT u.username, u.email, r.role_name, d.department_name AS dept, u.is_active
FROM users u
JOIN roles r ON r.id = u.role_id
LEFT JOIN departments d ON d.id = u.department_id
WHERE u.email IN
  ('VDeleon@dm-us.com','JWaldie@dm-us.com','MFoti@dm-us.com','SSelley@dm-us.com',
   'MStempowski@dm-us.com','JSpangler@dm-us.com','JBarber@dm-us.com','dfeely@dm-us.com')
ORDER BY d.department_name, u.username;

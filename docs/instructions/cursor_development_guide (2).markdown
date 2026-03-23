# Cursor Development Guide for QTIP

## 📜 Purpose
This document provides precise, step-by-step instructions for building the Quality and Training Insight Platform (QTIP) using Cursor, with each step referencing exactly one `.md` file (or a small, logical group for a single task) to prevent confusion and errors. Each step includes a "query" to enter into Cursor's Composer chat interface (`Ctrl + K` or `Cmd + K`) to generate code or perform tasks. The guide ensures Cursor's AI-assisted features are used effectively to implement the frontend (React + Vite + Tailwind CSS + TypeScript), backend (Node.js + Express + TypeScript), and database (MySQL 8.x).

## 🛠️ Prerequisites
- **Cursor**: Latest version installed ([cursor.sh](https://cursor.sh)).
- **Node.js**: Version 18.x or higher.
- **MySQL**: Version 8.x, with a user account and password.
- **Git**: For version control.
- **Project Files**: All 37 `.md` files and `database_schema.sql` from the QTIP documentation set.
- **VS Code Extensions** (optional): Prettier, ESLint, Tailwind CSS IntelliSense in Cursor.

## 📁 Project Setup (Steps 1–4)
These steps set up the project structure and import files into Cursor.

### Step 1: Create Project Folder
- **File to Reference**: None.
- **Actions**:
  1. Open a terminal and create a project folder:
     ```
     mkdir qtip
     cd qtip
     ```
  2. Initialize a Git repository:
     ```
     git init
     ```
- **Validation**:
  - Confirm the `qtip` folder exists and contains a `.git` folder.

### Step 2: Organize Documentation Files
- **File to Reference**: None.
- **Actions**:
  1. Create subfolders:
     ```
     mkdir docs database
     ```
  2. Copy all 37 `.md` files into `qtip/docs`:
     - `project_overview.md`, `cursor_build_instructions.md`, `navigation_overview.md`, `test_plan.md`
     - `admin_dashboard.md`, `user_management.md`, `department_management.md`, `form_builder_instructions.md`, `audit_assignment.md`, `performance_goals.md`
     - `qa_dashboard.md`, `qa_assigned_reviews.md`, `qa_manual_reviews.md`, `qa_completed_reviews.md`, `qa_form_reference.md`
     - `csr_dashboard.md`, `csr_my_audits.md`, `csr_dispute_history.md`, `csr_training_dashboard.md`, `csr_certificates.md`
     - `trainer_dashboard.md`, `lms_trainer_workflow.md`, `trainer_assign_training.md`, `trainer_reports.md`, `trainer_feedback_review.md`
     - `manager_dashboard.md`, `manager_team_audits.md`, `manager_team_training.md`, `manager_dispute_resolution.md`, `manager_coaching_sessions.md`
     - `director_dashboard.md`, `manager_performance_reports.md`, `director_dispute_resolution.md`
     - `analytics_builder.md`, `audit_logging.md`, `help_center.md`, `profile_settings.md`
  3. Copy `database_schema.sql` into `qtip/database`.
- **Validation**:
  - Check that `qtip/docs` contains all 37 `.md` files and `qtip/database` contains `database_schema.sql`.

### Step 3: Import Files into Cursor
- **File to Reference**: None.
- **Actions**:
  1. Open Cursor and select `File > Open Folder`.
  2. Choose the `qtip` folder.
  3. Verify `docs` and `database` folders appear in Cursor's sidebar.
  4. Pin `project_overview.md` and `database_schema.sql` in the sidebar for quick access.
- **Validation**:
  - Ensure Cursor indexes all `.md` files (visible in the sidebar).
  - Confirm `project_overview.md` and `database_schema.sql` are pinned.

### Step 4: Initialize Project Structure
- **File to Reference**: `project_overview.md`.
- **Actions**:
  1. Create frontend and backend folders:
     ```
     mkdir frontend backend
     ```
  2. Set up the frontend (React + Vite + TypeScript):
     ```
     cd frontend
     npm create vite@latest . -- --template react-ts
     npm install tailwindcss postcss autoprefixer axios react-router-dom @types/react-router-dom
     npx tailwindcss init -p
     ```
     - Update `tailwind.config.js`:
       ```javascript
       /** @type {import('tailwindcss').Config} */
       export default {
         content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
         theme: { extend: {} },
         plugins: [],
       }
       ```
     - Update `src/index.css`:
       ```css
       @tailwind base;
       @tailwind components;
       @tailwind utilities;
       ```
  3. Set up the backend (Node.js + Express + TypeScript):
     ```
     cd ../backend
     npm init -y
     npm install express typescript ts-node @types/express @types/node mysql2 jsonwebtoken @types/jsonwebtoken
     npx tsc --init
     ```
     - Create `src/index.ts`:
       ```typescript
       import express from 'express';
       const app = express();
       const port = 3000;

       app.use(express.json());

       app.get('/', (req, res) => {
         res.send('QTIP Backend');
       });

       app.listen(port, () => {
         console.log(`Server running at http://localhost:${port}`);
       });
       ```
     - Update `package.json` scripts:
       ```json
       "scripts": {
         "start": "ts-node src/index.ts",
         "build": "tsc"
       }
       ```
  4. Open `project_overview.md` in Cursor and review the architecture.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` (or `Cmd + K`) to open the Composer chat interface.
  2. Type or paste:
     ```
     Using project_overview.md, confirm the tech stack for QTIP.
     ```
  3. Press Enter and verify the response: "Frontend: React + Vite + Tailwind CSS + TypeScript; Backend: Node.js + Express + TypeScript; Database: MySQL 8.x; Auth: JWT + Role-based access."
- **Validation**:
  - Run `npm run dev` in `frontend` to start the React app (`http://localhost:5173`).
  - Run `npm start` in `backend` to start the Express server (`http://localhost:3000`).
  - Ensure no errors in the terminal.

## 🚀 Database Setup (Step 5)
Set up the MySQL database before building backend APIs.

### Step 5: Create Database Schema
- **File to Reference**: `database_schema.sql`.
- **Actions**:
  1. Open `database_schema.sql` in Cursor.
  2. Run the schema in MySQL:
     ```
     mysql -u <username> -p qtip < database/database_schema.sql
     ```
  3. Connect to MySQL and verify tables (`roles`, `users`, `calls`, `agent_activity`, etc.).
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using database_schema.sql, generate TypeScript interfaces for the users and calls tables.
     ```
  3. Press Enter and copy the output to `backend/src/types/db.ts`:
     ```typescript
     export interface User {
       id: number;
       username: string;
       email: string;
       password_hash: string;
       role_id: number;
       department_id: number | null;
       created_at: string;
       updated_at: string;
     }

     export interface Call {
       id: number;
       call_id: string;
       csr_id: number;
       department_id: number | null;
       call_date: string;
       direction: 'inbound' | 'outbound';
       talk_time: number;
       start_time: string;
       end_time: string;
       call_transcript: string | null;
       call_recording: string | null;
       submission_id: number | null;
       created_at: string;
       updated_at: string;
     }
     ```
- **Validation**:
  - Run `mysql -u <username> -p qtip` and execute `SHOW TABLES;` to confirm all tables exist.
  - Check `DESCRIBE calls;` to verify columns like `call_transcript` and `talk_time`.

## 🚀 Backend Development (Steps 6–14)
Build backend APIs for authentication and core modules, one module per step.

### Step 6: Build Authentication Routes
- **File to Reference**: `user_management.md`.
- **Actions**:
  1. Open `user_management.md` in Cursor.
  2. Create authentication routes for login and user creation.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using user_management.md and database_schema.sql, create Express routes for user login and user creation with JWT authentication, TypeScript types, and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/auth.ts`:
     ```typescript
     import express from 'express';
     import jwt from 'jsonwebtoken';
     import mysql from 'mysql2/promise';
     import { User } from '../types/db';

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config: host, user, password, database: qtip */ });

     router.post('/login', async (req, res) => {
       const { email, password } = req.body;
       try {
         const [rows] = await db.query<User[]>('SELECT * FROM users WHERE email = ?', [email]);
         const user = rows[0];
         if (!user || user.password_hash !== password /* Replace with bcrypt */) {
           return res.status(401).json({ error: 'Invalid credentials' });
         }
         const token = jwt.sign({ userId: user.id, roleId: user.role_id }, 'secret', { expiresIn: '1h' });
         res.json({ token });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     router.post('/users', async (req, res) => {
       const { username, email, password_hash, role_id, department_id } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO users (username, email, password_hash, role_id, department_id) VALUES (?, ?, ?, ?, ?)',
           [username, email, password_hash, role_id, department_id]
         );
         res.status(201).json({ id: result.insertId, username });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
  4. Mount in `src/index.ts`:
     ```typescript
     import authRoutes from './routes/auth';
     app.use('/api/auth', authRoutes);
     ```
- **Validation**:
  - Run `npm start` in `backend` and test with Postman:
    ```
    POST http://localhost:3000/api/auth/login
    Body: { "email": "test@qtip.com", "password": "test" }
    ```
    Expect a JWT token or a 401 error if credentials are invalid.

### Step 7: Build QA Form Routes
- **File to Reference**: `form_builder_instructions.md`.
- **Actions**:
  1. Open `form_builder_instructions.md` in Cursor.
  2. Create routes for QA form creation and listing.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using form_builder_instructions.md and database_schema.sql, create Express routes for creating and listing QA forms, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/forms.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Form {
       id: number;
       form_name: string;
       version: number;
       created_by: number;
       created_at: string;
       is_active: boolean;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { form_name, created_by } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO forms (form_name, created_by) VALUES (?, ?)',
           [form_name, created_by]
         );
         res.status(201).json({ id: result.insertId, form_name });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     router.get('/', async (req, res) => {
       try {
         const [rows] = await db.query<Form[]>('SELECT * FROM forms WHERE is_active = true');
         res.json(rows);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
  4. Mount in `src/index.ts`:
     ```typescript
     import formRoutes from './routes/forms';
     app.use('/api/forms', formRoutes);
     ```
- **Validation**:
  - Test with Postman:
    ```
    POST http://localhost:3000/api/forms
    Body: { "form_name": "Test Form", "created_by": 1 }
    ```
    Expect a 201 response with the form ID.

### Step 8: Build Audit Assignment Routes
- **File to Reference**: `audit_assignment.md`.
- **Actions**:
  1. Open `audit_assignment.md` in Cursor.
  2. Create routes for audit scheduling.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using audit_assignment.md and database_schema.sql, create Express routes for creating audit assignments, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/auditAssignments.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface AuditAssignment {
       id: number;
       form_id: number;
       target_id: number;
       target_type: 'USER' | 'DEPARTMENT';
       schedule: string;
       created_by: number;
       created_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { form_id, target_id, target_type, schedule, created_by } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO audit_assignments (form_id, target_id, target_type, schedule, created_by) VALUES (?, ?, ?, ?, ?)',
           [form_id, target_id, target_type, schedule, created_by]
         );
         res.status(201).json({ id: result.insertId });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
  4. Mount in `src/index.ts`.
- **Validation**:
  - Test with Postman:
    ```
    POST http://localhost:3000/api/audit-assignments
    Body: { "form_id": 1, "target_id": 1, "target_type": "USER", "schedule": "5 audits/week", "created_by": 1 }
    ```

### Step 9: Build Audit Submission Routes
- **File to Reference**: `qa_assigned_reviews.md`.
- **Actions**:
  1. Open `qa_assigned_reviews.md` in Cursor.
  2. Create routes for audit submission.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_assigned_reviews.md and database_schema.sql, create Express routes for submitting QA audits, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/submissions.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Submission {
       id: number;
       form_id: number;
       qa_id: number;
       csr_id: number;
       call_id: number | null;
       score: number;
       submitted_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { form_id, qa_id, csr_id, call_id, score } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO submissions (form_id, qa_id, csr_id, call_id, score) VALUES (?, ?, ?, ?, ?)',
           [form_id, qa_id, csr_id, call_id, score]
         );
         res.status(201).json({ id: result.insertId });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman, ensuring `call_id` references a valid `calls.id`.

### Step 10: Build Dispute Routes
- **File to Reference**: `csr_dispute_history.md`.
- **Actions**:
  1. Open `csr_dispute_history.md` in Cursor.
  2. Create routes for dispute submission.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_dispute_history.md and database_schema.sql, create Express routes for submitting disputes, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/disputes.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Dispute {
       id: number;
       submission_id: number;
       csr_id: number;
       dispute_text: string;
       status: 'PENDING' | 'RESOLVED' | 'ESCALATED';
       created_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { submission_id, csr_id, dispute_text } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO disputes (submission_id, csr_id, dispute_text) VALUES (?, ?, ?)',
           [submission_id, csr_id, dispute_text]
         );
         res.status(201).json({ id: result.insertId });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman:
    ```
    POST http://localhost:3000/api/disputes
    Body: { "submission_id": 1, "csr_id": 1, "dispute_text": "Incorrect score" }
    ```

### Step 11: Build Course Creation Routes
- **File to Reference**: `lms_trainer_workflow.md`.
- **Actions**:
  1. Open `lms_trainer_workflow.md` in Cursor.
  2. Create routes for course creation.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using lms_trainer_workflow.md and database_schema.sql, create Express routes for creating courses, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/courses.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Course {
       id: number;
       course_name: string;
       created_by: number;
       created_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { course_name, created_by } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO courses (course_name, created_by) VALUES (?, ?)',
           [course_name, created_by]
         );
         res.status(201).json({ id: result.insertId });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman.

### Step 12: Build Training Assignment Routes
- **File to Reference**: `trainer_assign_training.md`.
- **Actions**:
  1. Open `trainer_assign_training.md` in Cursor.
  2. Create routes for training assignments.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using trainer_assign_training.md and database_schema.sql, create Express routes for assigning training, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/enrollments.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Enrollment {
       id: number;
       course_id: number;
       user_id: number;
       status: 'IN_PROGRESS' | 'COMPLETED';
       progress: number;
       created_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/', async (req, res) => {
       const { course_id, user_id } = req.body;
       try {
         const [result] = await db.query(
           'INSERT INTO enrollments (course_id, user_id) VALUES (?, ?)',
           [course_id, user_id]
         );
         res.status(201).json({ id: result.insertId });
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman.

### Step 13: Build Analytics Routes
- **File to Reference**: `analytics_builder.md`.
- **Actions**:
  1. Open `analytics_builder.md` in Cursor.
  2. Create routes for analytics reports.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using analytics_builder.md and database_schema.sql, create Express routes for generating QA score reports, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/analytics.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface Report {
       department_id: number;
       average_score: number;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.post('/qa-scores', async (req, res) => {
       const { date_start, date_end } = req.body;
       try {
         const [rows] = await db.query<Report[]>(
           'SELECT department_id, AVG(score) as average_score FROM submissions WHERE submitted_at BETWEEN ? AND ? GROUP BY department_id',
           [date_start, date_end]
         );
         res.json(rows);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman, ensuring data aligns with `submissions`.

### Step 14: Build Audit Log Routes
- **File to Reference**: `audit_logging.md`.
- **Actions**:
  1. Open `audit_logging.md` in Cursor.
  2. Create routes for audit logs.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using audit_logging.md and database_schema.sql, create Express routes for listing audit logs, including TypeScript types and MySQL queries.
     ```
  3. Press Enter and copy the output to `backend/src/routes/auditLogs.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';

     interface AuditLog {
       id: number;
       user_id: number;
       action: string;
       target_id: number | null;
       target_type: string | null;
       details: string | null;
       created_at: string;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config */ });

     router.get('/', async (req, res) => {
       try {
         const [rows] = await db.query<AuditLog[]>('SELECT * FROM audit_logs');
         res.json(rows);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman.

## 🚀 Frontend Development (Steps 15–29)
Build frontend components for each role, one screen or module per step.

### Step 15: Build Login Component
- **File to Reference**: `profile_settings.md`.
- **Actions**:
  1. Open `profile_settings.md` in Cursor.
  2. Create a login component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using profile_settings.md, create a React login component with TypeScript, Tailwind CSS, and Axios for JWT authentication.
     ```
  3. Press Enter and copy the output to `frontend/src/components/Login.tsx`:
     ```typescript
     import React, { useState } from 'react';
     import axios from 'axios';
     import { useNavigate } from 'react-router-dom';

     const Login: React.FC = () => {
       const [email, setEmail] = useState('');
       const [password, setPassword] = useState('');
       const navigate = useNavigate();

       const handleLogin = async () => {
         try {
           const response = await axios.post('http://localhost:3000/api/auth/login', { email, password });
           localStorage.setItem('token', response.data.token);
           navigate('/dashboard');
         } catch (error) {
           console.error('Login failed', error);
         }
       };

       return (
         <div className="p-4 max-w-md mx-auto">
           <input
             type="email"
             value={email}
             onChange={(e) => setEmail(e.target.value)}
             className="border p-2 w-full mb-2"
             placeholder="Email"
           />
           <input
             type="password"
             value={password}
             onChange={(e) => setPassword(e.target.value)}
             className="border p-2 w-full mb-2"
             placeholder="Password"
           />
           <button onClick={handleLogin} className="bg-blue-500 text-white p-2 w-full">
             Login
           </button>
         </div>
       );
     };

     export default Login;
     ```
- **Validation**:
  - Run `npm run dev` in `frontend` and test the login form at `http://localhost:5173`.

### Step 16: Build Admin Dashboard Component
- **File to Reference**: `admin_dashboard.md`.
- **Actions**:
  1. Open `admin_dashboard.md` in Cursor.
  2. Create the Admin dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using admin_dashboard.md and database_schema.sql, create a React component for the Admin dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/AdminDashboard.tsx`:
     ```typescript
     import React, { useEffect, useState } from 'react';
     import axios from 'axios';

     interface Stats {
       total_users: number;
       pending_audits: number;
     }

     const AdminDashboard: React.FC = () => {
       const [stats, setStats] = useState<Stats | null>(null);

       useEffect(() => {
         axios.get('http://localhost:3000/api/admin/stats', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => setStats(response.data));
       }, []);

       return (
         <div className="p-4">
           <h1 className="text-2xl">Admin Dashboard</h1>
           {stats && (
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-gray-100 p-4">Total Users: {stats.total_users}</div>
               <div className="bg-gray-100 p-4">Pending Audits: {stats.pending_audits}</div>
             </div>
           )}
         </div>
       );
     };

     export default AdminDashboard;
     ```
- **Validation**:
  - Test the dashboard UI and API integration.

### Step 17: Build User Management Component
- **File to Reference**: `user_management.md`.
- **Actions**:
  1. Open `user_management.md` in Cursor.
  2. Create the user management component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using user_management.md, create a React component for user management with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/UserManagement.tsx`.
- **Validation**:
  - Verify the component displays a user list and form.

### Step 18: Build Department Management Component
- **File to Reference**: `department_management.md`.
- **Actions**:
  1. Open `department_management.md` in Cursor.
  2. Create the department management component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using department_management.md, create a React component for department management with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/DepartmentManagement.tsx`.
- **Validation**:
  - Test department creation and user assignment.

### Step 19: Build QA Form Builder Component
- **File to Reference**: `form_builder_instructions.md`.
- **Actions**:
  1. Open `form_builder_instructions.md` in Cursor.
  2. Create the QA form builder component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using form_builder_instructions.md, create a React component for the QA form builder with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/FormBuilder.tsx`.
- **Validation**:
  - Ensure the form wizard supports all question types (Yes/No, Scale, Text, Info).

### Step 20: Build Audit Assignment Component
- **File to Reference**: `audit_assignment.md`.
- **Actions**:
  1. Open `audit_assignment.md` in Cursor.
  2. Create the audit assignment component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using audit_assignment.md, create a React component for audit assignment with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/AuditAssignment.tsx`.
- **Validation**:
  - Test audit scheduling for CSRs and departments.

### Step 21: Build Performance Goals Component
- **File to Reference**: `performance_goals.md`.
- **Actions**:
  1. Open `performance_goals.md` in Cursor.
  2. Create the performance goals component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using performance_goals.md, create a React component for performance goals with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/PerformanceGoals.tsx`.
- **Validation**:
  - Verify goal creation and display.

### Step 22: Build QA Dashboard Component
- **File to Reference**: `qa_dashboard.md`.
- **Actions**:
  1. Open `qa_dashboard.md` in Cursor.
  2. Create the QA dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_dashboard.md and database_schema.sql, create a React component for the QA dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/QADashboard.tsx`.
- **Validation**:
  - Test audit counts and navigation.

### Step 23: Build QA Assigned Reviews Component
- **File to Reference**: `qa_assigned_reviews.md`.
- **Actions**:
  1. Open `qa_assigned_reviews.md` in Cursor.
  2. Create the QA assigned reviews component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_assigned_reviews.md, create a React component for QA assigned reviews with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/QAAssignedReviews.tsx`.
- **Validation**:
  - Ensure split-screen view with `calls.call_transcript` and `calls.call_recording`.

### Step 24: Build QA Manual Reviews Component
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Open `qa_manual_reviews.md` in Cursor.
  2. Create the QA manual reviews component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_manual_reviews.md, create a React component for QA manual reviews with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/QAManualReviews.tsx`.
- **Validation**:
  - Test ad-hoc audit initiation.

### Step 25: Build QA Completed Reviews Component
- **File to Reference**: `qa_completed_reviews.md`.
- **Actions**:
  1. Open `qa_completed_reviews.md` in Cursor.
  2. Create the QA completed reviews component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_completed_reviews.md, create a React component for QA completed reviews with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/QACompletedReviews.tsx`.
- **Validation**:
  - Verify audit history display.

### Step 26: Build QA Form Reference Component
- **File to Reference**: `qa_form_reference.md`.
- **Actions**:
  1. Open `qa_form_reference.md` in Cursor.
  2. Create the QA form reference component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using qa_form_reference.md, create a React component for QA form reference with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/QAFormReference.tsx`.
- **Validation**:
  - Test read-only form display.

### Step 27: Build CSR Dashboard Component
- **File to Reference**: `csr_dashboard.md`.
- **Actions**:
  1. Open `csr_dashboard.md` in Cursor.
  2. Create the CSR dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_dashboard.md, create a React component for the CSR dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/CSRDashboard.tsx`.
- **Validation**:
  - Verify score and training display.

### Step 28: Build CSR My Audits Component
- **File to Reference**: `csr_my_audits.md`.
- **Actions**:
  1. Open `csr_my_audits.md` in Cursor.
  2. Create the CSR my audits component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_my_audits.md, create a React component for CSR my audits with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/CSRMyAudits.tsx`.
- **Validation**:
  - Test audit list and details modal.

### Step 29: Build CSR Dispute History Component
- **File to Reference**: `csr_dispute_history.md`.
- **Actions**:
  1. Open `csr_dispute_history.md` in Cursor.
  2. Create the CSR dispute history component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_dispute_history.md, create a React component for CSR dispute history with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/CSRDisputeHistory.tsx`.
- **Validation**:
  - Test dispute submission and tracking.

### Step 30: Build CSR Training Dashboard Component
- **File to Reference**: `csr_training_dashboard.md`.
- **Actions**:
  1. Open `csr_training_dashboard.md` in Cursor.
  2. Create the CSR training dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_training_dashboard.md, create a React component for CSR training dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/CSRTrainingDashboard.tsx`.
- **Validation**:
  - Verify course progress and quiz submission.

### Step 31: Build CSR Certificates Component
- **File to Reference**: `csr_certificates.md`.
- **Actions**:
  1. Open `csr_certificates.md` in Cursor.
  2. Create the CSR certificates component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using csr_certificates.md, create a React component for CSR certificates with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/CSRCertificates.tsx`.
- **Validation**:
  - Test certificate display and download.

### Step 32: Build Trainer Dashboard Component
- **File to Reference**: `trainer_dashboard.md`.
- **Actions**:
  1. Open `trainer_dashboard.md` in Cursor.
  2. Create the Trainer dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using trainer_dashboard.md, create a React component for the Trainer dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/TrainerDashboard.tsx`.
- **Validation**:
  - Verify course and enrollment stats.

### Step 33: Build Trainer Course Builder Component
- **File to Reference**: `lms_trainer_workflow.md`.
- **Actions**:
  1. Open `lms_trainer_workflow.md` in Cursor.
  2. Create the Trainer course builder component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using lms_trainer_workflow.md, create a React component for the Trainer course builder with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/TrainerCourseBuilder.tsx`.
- **Validation**:
  - Test course and page creation.

### Step 34: Build Trainer Assign Training Component
- **File to Reference**: `trainer_assign_training.md`.
- **Actions**:
  1. Open `trainer_assign_training.md` in Cursor.
  2. Create the Trainer assign training component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using trainer_assign_training.md, create a React component for Trainer assign training with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/TrainerAssignTraining.tsx`.
- **Validation**:
  - Test training assignment.

### Step 35: Build Trainer Reports Component
- **File to Reference**: `trainer_reports.md`.
- **Actions**:
  1. Open `trainer_reports.md` in Cursor.
  2. Create the Trainer reports component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using trainer_reports.md, create a React component for Trainer reports with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/TrainerReports.tsx`.
- **Validation**:
  - Verify report generation.

### Step 36: Build Trainer Feedback Review Component
- **File to Reference**: `trainer_feedback_review.md`.
- **Actions**:
  1. Open `trainer_feedback_review.md` in Cursor.
  2. Create the Trainer feedback review component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using trainer_feedback_review.md, create a React component for Trainer feedback review with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/TrainerFeedbackReview.tsx`.
- **Validation**:
  - Test feedback display.

### Step 37: Build Manager Dashboard Component
- **File to Reference**: `manager_dashboard.md`.
- **Actions**:
  1. Open `manager_dashboard.md` in Cursor.
  2. Create the Manager dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_dashboard.md, create a React component for the Manager dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerDashboard.tsx`.
- **Validation**:
  - Verify team performance stats.

### Step 38: Build Manager Team Audits Component
- **File to Reference**: `manager_team_audits.md`.
- **Actions**:
  1. Open `manager_team_audits.md` in Cursor.
  2. Create the Manager team audits component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_team_audits.md, create a React component for Manager team audits with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerTeamAudits.tsx`.
- **Validation**:
  - Test team audit history.

### Step 39: Build Manager Team Training Component
- **File to Reference**: `manager_team_training.md`.
- **Actions**:
  1. Open `manager_team_training.md` in Cursor.
  2. Create the Manager team training component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_team_training.md, create a React component for Manager team training with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerTeamTraining.tsx`.
- **Validation**:
  - Verify team training progress.

### Step 40: Build Manager Dispute Resolution Component
- **File to Reference**: `manager_dispute_resolution.md`.
- **Actions**:
  1. Open `manager_dispute_resolution.md` in Cursor.
  2. Create the Manager dispute resolution component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_dispute_resolution.md, create a React component for Manager dispute resolution with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerDisputeResolution.tsx`.
- **Validation**:
  - Test dispute resolution workflow.

### Step 41: Build Manager Coaching Sessions Component
- **File to Reference**: `manager_coaching_sessions.md`.
- **Actions**:
  1. Open `manager_coaching_sessions.md` in Cursor.
  2. Create the Manager coaching sessions component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_coaching_sessions.md, create a React component for Manager coaching sessions with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerCoachingSessions.tsx`.
- **Validation**:
  - Test coaching session logging.

### Step 42: Build Director Dashboard Component
- **File to Reference**: `director_dashboard.md`.
- **Actions**:
  1. Open `director_dashboard.md` in Cursor.
  2. Create the Director dashboard component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using director_dashboard.md, create a React component for the Director dashboard with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/DirectorDashboard.tsx`.
- **Validation**:
  - Verify cross-team metrics.

### Step 43: Build Manager Performance Reports Component
- **File to Reference**: `manager_performance_reports.md`.
- **Actions**:
  1. Open `manager_performance_reports.md` in Cursor.
  2. Create the Manager performance reports component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using manager_performance_reports.md, create a React component for Manager performance reports with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ManagerPerformanceReports.tsx`.
- **Validation**:
  - Test department comparison reports.

### Step 44: Build Director Dispute Resolution Component
- **File to Reference**: `director_dispute_resolution.md`.
- **Actions**:
  1. Open `director_dispute_resolution.md` in Cursor.
  2. Create the Director dispute resolution component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using director_dispute_resolution.md, create a React component for Director dispute resolution with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/DirectorDisputeResolution.tsx`.
- **Validation**:
  - Test escalated dispute resolution.

### Step 45: Build Help Center Component
- **File to Reference**: `help_center.md`.
- **Actions**:
  1. Open `help_center.md` in Cursor.
  2. Create the Help Center component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using help_center.md, create a React component for the Help Center with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/HelpCenter.tsx`.
- **Validation**:
  - Verify FAQ and resource display.

### Step 46: Build Profile Settings Component
- **File to Reference**: `profile_settings.md`.
- **Actions**:
  1. Open `profile_settings.md` in Cursor.
  2. Create the Profile Settings component.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using profile_settings.md, create a React component for Profile Settings with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Press Enter and copy the output to `frontend/src/components/ProfileSettings.tsx`.
- **Validation**:
  - Test profile updates.

## 🚀 Navigation and Routing (Step 47)
Set up role-based navigation after building all components.

### Step 47: Build Navigation and Routing
- **File to Reference**: `navigation_overview.md`.
- **Actions**:
  1. Open `navigation_overview.md` in Cursor.
  2. Create React Router configuration.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using navigation_overview.md, create a React Router configuration for role-based navigation with TypeScript.
     ```
  3. Press Enter and copy the output to `frontend/src/App.tsx`:
     ```typescript
     import { BrowserRouter, Routes, Route } from 'react-router-dom';
     import Login from './components/Login';
     import AdminDashboard from './components/AdminDashboard';
     import QADashboard from './components/QADashboard';
     import CSRDashboard from './components/CSRDashboard';
     import TrainerDashboard from './components/TrainerDashboard';
     import ManagerDashboard from './components/ManagerDashboard';
     import DirectorDashboard from './components/DirectorDashboard';
     // Import other components

     const App: React.FC = () => {
       return (
         <BrowserRouter>
           <Routes>
             <Route path="/login" element={<Login />} />
             <Route path="/admin/dashboard" element={<AdminDashboard />} />
             <Route path="/qa/dashboard" element={<QADashboard />} />
             <Route path="/csr/dashboard" element={<CSRDashboard />} />
             <Route path="/trainer/dashboard" element={<TrainerDashboard />} />
             <Route path="/manager/dashboard" element={<ManagerDashboard />} />
             <Route path="/director/dashboard" element={<DirectorDashboard />} />
             {/* Add routes for other components */}
           </Routes>
         </BrowserRouter>
       );
     };

     export default App;
     ```
- **Validation**:
  - Run `npm run dev` in `frontend` and test navigation for each role.

## 🚀 Testing (Step 48)
Test the system using seed data and test cases.

### Step 48: Generate Seed Data and Tests
- **File to Reference**: `test_plan.md`.
- **Actions**:
  1. Open `test_plan.md` in Cursor.
  2. Generate seed data and tests.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Type or paste:
     ```
     Using test_plan.md, generate a SQL seed script for the QTIP database to test QA form creation.
     ```
  3. Press Enter and copy the output to `database/seed.sql`:
     ```sql
     INSERT INTO roles (role_name) VALUES ('Admin'), ('QA'), ('CSR');
     INSERT INTO departments (department_name) VALUES ('Sales');
     INSERT INTO users (username, email, password_hash, role_id, department_id) VALUES
       ('admin', 'admin@qtip.com', 'hashed_password', 1, 1),
       ('qa', 'qa@qtip.com', 'hashed_password', 2, 1),
       ('csr', 'csr@qtip.com', 'hashed_password', 3, 1);
     INSERT INTO forms (form_name, created_by) VALUES ('Test Form', 1);
     ```
  4. Run the seed script:
     ```
     mysql -u <username> -p qtip < database/seed.sql
     ```
  5. Generate tests:
     - Press `Ctrl + K` to open the Composer chat.
     - Type or paste:
       ```
       Using test_plan.md, generate Jest tests for the QA form creation endpoint.
       ```
     - Press Enter and copy the output to `backend/src/routes/__tests__/forms.test.ts`:
       ```typescript
       import request from 'supertest';
       import app from '../index';

       describe('Forms API', () => {
         it('should create a new form', async () => {
           const response = await request(app)
             .post('/api/forms')
             .send({ form_name: 'Test Form', created_by: 1 });
           expect(response.status).toBe(201);
           expect(response.body).toHaveProperty('id');
         });
       });
       ```
- **Validation**:
  - Run `npm test` in `backend` to execute Jest tests.
  - Manually test QA form creation in the frontend.

## 💡 Tips to Avoid Errors
- **Enter Queries Exactly**: Copy and paste the query text into Cursor's Composer chat (`Ctrl + K`) to ensure accuracy.
- **Use One File per Step**: Reference only the specified `.md` file in each step to keep Cursor's context focused.
- **Pin Key Files**: Keep `project_overview.md` and `database_schema.sql` pinned in Cursor's sidebar for reference.
- **Validate Database First**: Ensure the database is set up (Step 5) before backend routes to avoid query errors.
- **Test Incrementally**: After each step, validate the output (e.g., test API routes with Postman, check frontend UI).
- **Clear Composer Context**: If Cursor generates incorrect code, reset the Composer history (`Ctrl + K`, then reset) and re-enter the query.
- **Check Schema Columns**: Use `calls.call_transcript` and `calls.call_recording` (not `transcript` or `audio_url`) in queries, as per the updated schema.

## ✅ Testing Notes
- Use `test_plan.md` for manual and automated testing.
- Verify role-based access using `navigation_overview.md`.
- Test database queries with seed data, ensuring `calls.call_transcript` and `agent_activity.status_switches` are handled correctly.
- Check frontend responsiveness with Tailwind CSS classes.

## 📌 Next Steps
- Start with Step 1 to set up the project.
- Follow each step sequentially, entering the provided query into Cursor's Composer chat (`Ctrl + K`).
- If errors occur, reset Composer and re-enter the query with the exact file reference.
- For deployment, consult `project_overview.md` for architecture details.
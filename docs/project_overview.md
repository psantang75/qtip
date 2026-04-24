# QTIP Project Overview

## 🎯 System Objective
The **Quality and Training Insight Platform (QTIP)** is a role-based platform for call centers, designed to manage:
- **QA Form Creation and Manual Audits**: Customizable QA forms with weighted categories and question types (Yes/No, Scale, N/A, Text Box, Informational Block).
- **Transcript and Audio-Assisted Scoring**: Split-screen interface for scoring calls.
- **CSR Dispute Resolution**: Workflow for CSRs to dispute audits, handled by Managers/Directors.
- **LMS-Based Training**: Course creation, assignment, and tracking with quizzes and certificates.
- **Configurable Performance Minimums**: Define QA score, audit rate, and dispute rate goals.
- **Cross-Role Analytics**: Role-specific dashboards for performance and training insights.

The system emphasizes manual control, role-specific views, and seamless integration between QA, training, and reporting.

## 🧱 Architecture Overview
| Layer       | Stack                              |
|-------------|------------------------------------|
| **Frontend** | React + Vite + Tailwind CSS + TypeScript |
| **Backend**  | Node.js + Express + TypeScript     |
| **Database** | MySQL 8.x (schema: `qtip`)         |
| **Auth**     | JWT + Role-based access            |

## 👥 User Roles & Permissions
| Role       | Core Capabilities                                                                 |
|------------|-----------------------------------------------------------------------------------|
| **Admin**  | Manage users, departments, QA forms, assign audits, set performance goals, full analytics |
| **QA Analyst** | Score calls, run manual audits, view assigned audits, access full analytics       |
| **CSR**    | View own audits, submit disputes, complete training, see personal goals           |
| **Trainer** | Create/assign courses, track training, access full analytics                      |
| **Manager** | Resolve disputes, track team performance, view team analytics                     |
| **Director** | Monitor CSRs under managers, resolve disputes, access cross-team analytics        |

## 🔧 Core Modules
1. **QA Form Management**  
   - Admins create/edit versioned QA forms with weighted categories and question types.  
   - Stored in: `forms`, `form_categories`, `form_questions`.

2. **Manual Audit Assignment**  
   - Admins assign audits by QA form, CSR/department, and schedule.  
   - Stored in: `audit_assignments`.

3. **QA Review Process**  
   - Split-screen view for transcript/audio and form scoring.  
   - Submissions linked to `submissions` and `calls`.

4. **Dispute Management**  
   - CSRs submit disputes; Managers/Directors resolve (uphold, adjust, assign training).  
   - Stored in: `disputes`, `audit_logs`.

5. **LMS Training**  
   - Trainers create courses with text, video, PDFs, and quizzes.  
   - Training paths and assignments stored in: `courses`, `course_pages`, `quizzes`, `enrollments`.

6. **Performance Minimums**  
   - Admins set QA score, audit rate, and dispute rate goals.  
   - Stored in: `performance_goals`.

7. **Reporting & Analytics**  
   - Role-based dashboards with filters for scores, training, and activity.  
   - Stored in: `score_snapshots`, `training_logs`, `agent_activity`.

## 🗂️ Key Tables
| Table                  | Purpose                              |
|------------------------|--------------------------------------|
| `users`, `roles`, `departments` | User and access control             |
| `forms`, `form_questions`, `form_categories` | QA form structure                   |
| `submissions`, `submission_answers` | Completed audits                    |
| `calls`                | Call data, transcripts, recordings  |
| `audit_assignments`    | Audit schedules                     |
| `disputes`, `audit_logs` | Dispute tracking                    |
| `courses`, `course_pages`, `quizzes`, `enrollments` | LMS functionality                   |
| `certificates`, `training_paths` | Training completion                 |
| `performance_goals`    | Performance targets                 |
| `coaching_sessions`    | Trainer-led coaching logs           |
| `agent_activity`       | CSR activity tracking                |

## 🚫 Excluded Features
- AI transcript scoring
- Automated audit assignment
- Keyword/regex auto-flagging
- Write-up module (deferred)

## 🛠️ Development Notes
- Use `backend/prisma/schema.prisma` (and `backend/prisma/migrations/`) as the canonical database source-of-truth; `prisma migrate dev` applies migrations locally.
- See the top-level [`README.md`](../README.md) for setup, dev, build, and test commands.
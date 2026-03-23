# Cursor Build Instructions for QTIP

## 📜 Purpose
This document guides developers on setting up and using the QTIP project documentation within Cursor, a code editor with AI-assisted features, to streamline development of the Quality and Training Insight Platform.

## 🛠️ Prerequisites
- **Cursor**: Install the latest version of Cursor (available at [cursor.sh](https://cursor.sh)).
- **Node.js**: Version 18.x or higher for backend development.
- **MySQL**: Version 8.x for the database (schema: `qtip`).
- **Git**: For version control and cloning the project repo.
- **Project Files**: All `.md` files and `database_schema.sql` from this set.

## 📁 Project Setup
1. **Clone the Repository**  
   - Create a Git repository for QTIP (e.g., on GitHub).
   - Clone it locally:  
     ```bash
     git clone <repository-url>
     cd qtip
     ```

2. **Organize Documentation**  
   - Create a `/docs` folder in the project root.
   - Copy all `.md` files (e.g., `project_overview.md`, `form_builder_instructions.md`) into `/docs`.
   - Place `database_schema.sql` in a `/database` folder.

3. **Set Up the Database**  
   - Install MySQL and create the `qtip` schema:  
     ```sql
     CREATE SCHEMA qtip;
     ```
   - Run `database_schema.sql` to initialize tables:  
     ```bash
     mysql -u <username> -p qtip < database/database_schema.sql
     ```

4. **Initialize Frontend and Backend**  
   - **Frontend**:  
     ```bash
     cd frontend
     npm create vite@latest . -- --template react-ts
     npm install tailwindcss postcss autoprefixer
     npx tailwindcss init -p
     ```
   - **Backend**:  
     ```bash
     cd backend
     npm init -y
     npm install express typescript ts-node @types/express @types/node mysql2
     npx tsc --init
     ```

## 🚀 Using Documentation in Cursor
1. **Import Files into Cursor**  
   - Open Cursor and load the project folder (`qtip`).
   - Drag the `/docs` folder into Cursor’s sidebar or use `File > Open Folder`.
   - Cursor will index the `.md` files for quick reference.

2. **Reference Documentation**  
   - Use Cursor’s **Composer** feature to query documentation:
     - Press `Ctrl + K` (or equivalent) to open Composer.
     - Ask questions like: “What’s the schema for QA forms?” or “How does the dispute workflow work?”
     - Cursor will reference files like `database_schema.sql` or `csr_dispute_history.md`.
   - Pin key files (e.g., `project_overview.md`) in Cursor’s sidebar for quick access.

3. **Implement Features**  
   - For each module (e.g., QA Form Builder), open the corresponding `.md` file (e.g., `form_builder_instructions.md`).
   - Use Cursor’s autocomplete and code suggestions to build React components or Express routes based on the specs.
   - Example: For the QA form builder, Cursor can generate TypeScript interfaces for `form_questions` based on the schema.

4. **Validate with Test Plan**  
   - Refer to `test_plan.md` for test cases.
   - Use Cursor to generate unit tests (e.g., with Jest) by querying: “Generate tests for audit assignment.”

## 💡 Tips for Cursor
- **Search Across Docs**: Use `Ctrl + T` to search all `.md` files for terms like “QA form” or “dispute resolution.”
- **Code Generation**: Ask Cursor to generate code snippets based on `.md` descriptions (e.g., “Create a React component for the QA split-screen view”).
- **Schema Reference**: Keep `database_schema.sql` open in Cursor to auto-suggest table names and fields during backend development.

## 📌 Next Steps
- Start with `project_overview.md` to understand the system.
- Implement the database using `database_schema.sql`.
- Build the QA form builder first, referencing `form_builder_instructions.md`.
- Use role-specific `.md` files (e.g., `admin_dashboard.md`, `csr_dashboard.md`) to develop UI components.
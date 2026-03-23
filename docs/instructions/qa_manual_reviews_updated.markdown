# QA Manual Reviews Updated Instructions

## 📜 Purpose
This document provides specific, step-by-step instructions for updating the QA Manual Reviews functionality in the QTIP platform using Cursor, focusing exclusively on enhancing the manual audit form process. The updated process allows QA users to:
- Select a form with a preview of metadata fields and questions.
- Choose a CSR from a dropdown.
- Add multiple call IDs via manual entry or search by CSR, date range, or customer ID.
- Display calls in an accordion with transcripts and recording links.
- Review the form, calls, metadata, and answers before submission.

It assumes the form builder and other functionalities are complete, with `form_metadata_fields`, `submission_metadata`, and `submission_calls` tables in the database. Instructions are tailored for Cursor’s Composer chat interface (`Ctrl + K`) to ensure precise implementation without affecting other components.

## 🛠️ Prerequisites
- **Cursor**: Latest version installed ([cursor.sh](https://cursor.sh)).
- **Node.js**: Version 18.x or higher.
- **MySQL**: Version 9.x, with `qtip` database including `submission_calls` table.
- **Project Files**: `qa_manual_reviews.md`, `form_builder_instructions.md`, and `qtip_database_schema_5.12.25.sql` in `qtip/docs` and `qtip/database`.
- **Existing Setup**: Form builder and QA Assigned Reviews implemented and tested.
- **Model**: Preferably Claude 3.5 Sonnet; Grok-3-Beta if limited by model list.

## 📁 Setup
Ensure the following files are in your project:
```
qtip/
├── docs/
│   ├── qa_manual_reviews.md
│   ├── form_builder_instructions.md
│   ├── qa_manual_reviews_updated.md  ← New file
│   ├── ... (other .md files)
├── database/
│   ├── qtip_database_schema_5.12.25.sql
│   ├── database_schema_addition.sql  ← New file
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── submissions.ts
│   │   │   ├── calls.ts  ← New file
│   │   ├── types/
│   │   │   ├── db.ts
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── QAManualReviews.tsx
```

## 🚀 Implementation Steps
Follow these steps to update the QA Manual Reviews process using Cursor’s Composer chat (`Ctrl + K`). Each step focuses on a single task to avoid errors.

### Step 1: Add Submission Calls Table
- **File to Reference**: `database_schema_addition.sql`.
- **Actions**:
  1. Save the `submission_calls` table definition to `qtip/database/database_schema_addition.sql`.
  2. Append it to `qtip_database_schema_5.12.25.sql` after `submissions` (before `submission_metadata`).
  3. Run the schema update:
     ```
     mysql -u <username> -p qtip < database/database_schema_addition.sql
     ```
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using database_schema_addition.sql, confirm the structure of the submission_calls table.
     ```
  3. Verify the response matches:
     ```sql
     CREATE TABLE submission_calls (
       id INT NOT NULL AUTO_INCREMENT,
       submission_id INT NOT NULL,
       call_id INT NOT NULL,
       sort_order INT NOT NULL DEFAULT 0,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
       FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
       UNIQUE KEY unique_submission_call (submission_id, call_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
     ```
- **Validation**:
  - Run `DESCRIBE submission_calls;` in MySQL to confirm the table exists.
  - Check foreign keys with:
    ```
    SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_NAME = 'submission_calls';
    ```

### Step 2: Update TypeScript Interfaces
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Open `backend/src/types/db.ts` in Cursor.
  2. Add an interface for `SubmissionCall`.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_manual_reviews.md, generate a TypeScript interface for the submission_calls table, using Date for DATETIME fields.
     ```
  3. Append the output to `backend/src/types/db.ts`:
     ```typescript
     export interface SubmissionCall {
       id: number;
       submission_id: number;
       call_id: number;
       sort_order: number;
       created_at: Date;
     }
     ```
- **Validation**:
  - Confirm `db.ts` includes `SubmissionCall` alongside `User`, `Call`, `FormMetadataField`, and others.
  - Run `tsc` in `backend` to check for syntax errors:
    ```
    cd backend
    npx tsc
    ```

### Step 3: Create Backend Call Search Route
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Create a new file `backend/src/routes/calls.ts` in Cursor.
  2. Add a search endpoint to find calls by CSR, date range, or customer ID.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_manual_reviews.md and qtip_database_schema_5.12.25.sql, create an Express route in calls.ts for searching calls by csr_id, date range, or customer_id, with TypeScript types and MySQL queries.
     ```
  3. Save the output to `backend/src/routes/calls.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';
     import { Call } from '../types/db';

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config: host, user, password, database: qtip */ });

     router.get('/search', async (req, res) => {
       const { csr_id, date_start, date_end, customer_id } = req.query;
       try {
         let query = 'SELECT * FROM calls WHERE 1=1';
         const params: (string | number)[] = [];

         if (csr_id) {
           query += ' AND csr_id = ?';
           params.push(parseInt(csr_id as string));
         }
         if (date_start && date_end) {
           query += ' AND call_date BETWEEN ? AND ?';
           params.push(date_start as string, date_end as string);
         }
         if (customer_id) {
           query += ' AND customer_id = ?';
           params.push(customer_id as string);
         }

         const [rows] = await db.query<Call[]>(query, params);
         res.json(rows);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     router.get('/:call_id', async (req, res) => {
       const { call_id } = req.params;
       try {
         const [rows] = await db.query<Call[]>('SELECT * FROM calls WHERE call_id = ?', [call_id]);
         if (rows.length === 0) {
           return res.status(404).json({ error: 'Call not found' });
         }
         res.json(rows[0]);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
  4. Mount in `src/index.ts`:
     ```typescript
     import callRoutes from './routes/calls';
     app.use('/api/calls', callRoutes);
     ```
- **Validation**:
  - Test with Postman:
    ```
    GET http://localhost:3000/api/calls/search?csr_id=3&date_start=2025-05-01&date_end=2025-05-13
    ```
    Expect a JSON array of matching calls.
  - Test single call retrieval:
    ```
    GET http://localhost:3000/api/calls/123
    ```
    Expect a single call object or 404 if not found.

### Step 4: Update Backend Submission Routes
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Open `backend/src/routes/submissions.ts` in Cursor.
  2. Update the submission creation route to support multiple calls via `submission_calls`.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_manual_reviews.md and qtip_database_schema_5.12.25.sql, update Express routes in submissions.ts to support creating manual audit submissions with multiple call IDs stored in submission_calls, with TypeScript types and MySQL queries.
     ```
  3. Update `backend/src/routes/submissions.ts`:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';
     import { Submission, SubmissionMetadata, SubmissionCall } from '../types/db';

     interface Submission {
       id: number;
       form_id: number;
       call_id: number | null;
       submitted_by: number;
       submitted_at: string;
       total_score: number | null;
       status: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config: host, user, password, database: qtip */ });

     router.post('/', async (req, res) => {
       const { form_id, submitted_by, metadata, call_ids, answers } = req.body;
       try {
         await db.query('START TRANSACTION');
         const [submissionResult] = await db.query(
           'INSERT INTO submissions (form_id, submitted_by, status) VALUES (?, ?, ?)',
           [form_id, submitted_by, 'DRAFT']
         );
         const submissionId = submissionResult.insertId;

         // Save metadata
         for (const meta of metadata) {
           await db.query(
             'INSERT INTO submission_metadata (submission_id, field_id, value) VALUES (?, ?, ?)',
             [submissionId, meta.field_id, meta.value]
           );
         }

         // Save calls
         call_ids.forEach(async (call_id: number, index: number) => {
           await db.query(
             'INSERT INTO submission_calls (submission_id, call_id, sort_order) VALUES (?, ?, ?)',
             [submissionId, call_id, index]
           );
         });

         // Save answers
         for (const answer of answers) {
           await db.query(
             'INSERT INTO submission_answers (submission_id, question_id, answer, notes) VALUES (?, ?, ?, ?)',
             [submissionId, answer.question_id, answer.answer, answer.notes]
           );
         }

         await db.query('COMMIT');
         res.status(201).json({ id: submissionId });
       } catch (error) {
         await db.query('ROLLBACK');
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman:
    ```
    POST http://localhost:3000/api/submissions
    Body: {
      "form_id": 1,
      "submitted_by": 2,
      "call_ids": [1, 2],
      "metadata": [
        { "field_id": 7, "value": "QA User" },
        { "field_id": 8, "value": "2025-05-13" },
        { "field_id": 9, "value": "3" },
        { "field_id": 10, "value": "CUST123" },
        { "field_id": 11, "value": "John Doe" },
        { "field_id": 12, "value": "TICKET456" },
        { "field_id": 13, "value": "REC789" },
        { "field_id": 14, "value": "2025-05-13" }
      ],
      "answers": []
    }
    ```
    Expect a 201 response. Verify `submission_calls` has entries for `call_id: 1` and `2` with `sort_order: 0, 1`.

### Step 5: Update Frontend QA Manual Reviews Component
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Open `frontend/src/components/QAManualReviews.tsx` in Cursor.
  2. Update the component to support form selection with preview, CSR selection, call ID input/search, accordion display, and a review step.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_manual_reviews.md and form_builder_instructions.md, update the React QAManualReviews component to allow QA users to select a form with a preview, choose a CSR, add multiple call IDs via manual entry or search by CSR/date range/customer ID, display calls in an accordion, and include a review step before submission, with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Replace `frontend/src/components/QAManualReviews.tsx`:
     ```typescript
     import React, { useState, useEffect } from 'react';
     import axios from 'axios';
     import { useForm } from 'react-hook-form';

     interface Form {
       id: number;
       form_name: string;
       interaction_type: string;
       metadata_fields: MetadataField[];
       categories: { id: number; category_name: string; questions: Question[] }[];
     }

     interface MetadataField {
       id: number;
       field_name: string;
       field_type: string;
       is_required: boolean;
       dropdown_source: string | null;
     }

     interface Question {
       id: number;
       question_text: string;
       question_type: string;
     }

     interface Call {
       id: number;
       call_id: string;
       csr_id: number;
       call_date: string;
       customer_id: string | null;
       recording_url: string | null;
       transcript: string | null;
     }

     interface FormData {
       form_id: string;
       csr_id: string;
       [key: string]: string;
     }

     const QAManualReviews: React.FC = () => {
       const { register, handleSubmit, setValue, watch } = useForm<FormData>();
       const [forms, setForms] = useState<Form[]>([]);
       const [selectedForm, setSelectedForm] = useState<Form | null>(null);
       const [csrs, setCsrs] = useState<{ id: number; username: string }[]>([]);
       const [calls, setCalls] = useState<Call[]>([]);
       const [callIdInput, setCallIdInput] = useState('');
       const [searchParams, setSearchParams] = useState({ csr_id: '', date_start: '', date_end: '', customer_id: '' });
       const [searchResults, setSearchResults] = useState<Call[]>([]);
       const [user, setUser] = useState<{ id: number; username: string } | null>(null);
       const [step, setStep] = useState<'select' | 'preview' | 'input' | 'review'>('select');

       useEffect(() => {
         // Fetch logged-in user
         axios.get('http://localhost:3000/api/auth/me', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => {
           setUser(response.data);
           setValue('auditor_name', response.data.username);
           setValue('audit_date', new Date().toISOString().split('T')[0]);
         });

         // Fetch forms
         axios.get('http://localhost:3000/api/forms', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => setForms(response.data));

         // Fetch CSRs
         axios.get('http://localhost:3000/api/users', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           params: { role_id: 3 },
         }).then((response) => setCsrs(response.data));
       }, [setValue]);

       const handleFormSelect = async (formId: string) => {
         try {
           const response = await axios.get(`http://localhost:3000/api/forms/${formId}`, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           setSelectedForm(response.data);
           setStep('preview');
         } catch (error) {
           console.error('Form fetch failed', error);
         }
       };

       const addCall = async () => {
         if (!callIdInput) return;
         try {
           const response = await axios.get(`http://localhost:3000/api/calls/${callIdInput}`, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           setCalls([...calls, response.data]);
           setCallIdInput('');
         } catch (error) {
           alert('Invalid Call ID');
         }
       };

       const addCallFromSearch = (call: Call) => {
         if (!calls.find((c) => c.id === call.id)) {
           setCalls([...calls, call]);
         }
       };

       const removeCall = (index: number) => {
         setCalls(calls.filter((_, i) => i !== index));
       };

       const handleSearch = async () => {
         try {
           const response = await axios.get('http://localhost:3000/api/calls/search', {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
             params: searchParams,
           });
           setSearchResults(response.data);
         } catch (error) {
           console.error('Search failed', error);
         }
       };

       const onSubmit = async (data: FormData) => {
         if (step === 'input') {
           setStep('review');
           return;
         }
         try {
           const metadata = selectedForm?.metadata_fields
             .filter((f) => f.interaction_type === 'CALL')
             .map((field) => ({
               field_id: field.id,
               value: data[field.id.toString()] || data[field.field_name.toLowerCase().replace(' ', '_')],
             })) || [];
           await axios.post('http://localhost:3000/api/submissions', {
             form_id: parseInt(data.form_id),
             submitted_by: user?.id || 1,
             call_ids: calls.map((call) => call.id),
             metadata,
             answers: [], // Integrate with existing answer logic
           }, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           alert('Audit submitted successfully');
         } catch (error) {
           console.error('Submission failed', error);
         }
       };

       return (
         <div className="p-4">
           <h1 className="text-2xl mb-4">Manual Audit</h1>
           <form onSubmit={handleSubmit(onSubmit)}>
             {step === 'select' && (
               <div className="mb-4">
                 <label className="block">Select Form</label>
                 <select
                   {...register('form_id', { required: true })}
                   onChange={(e) => handleFormSelect(e.target.value)}
                   className="border p-2 w-full"
                 >
                   <option value="">Select a form</option>
                   {forms.map((form) => (
                     <option key={form.id} value={form.id}>{form.form_name}</option>
                   ))}
                 </select>
               </div>
             )}
             {step === 'preview' && selectedForm && (
               <div className="mb-4">
                 <h2 className="text-xl">Form Preview: {selectedForm.form_name}</h2>
                 <p><strong>Interaction Type:</strong> {selectedForm.interaction_type}</p>
                 <p><strong>Metadata Fields:</strong> {selectedForm.metadata_fields.map((f) => f.field_name).join(', ')}</p>
                 <p><strong>Categories and Questions:</strong></p>
                 <ul>
                   {selectedForm.categories.map((cat) => (
                     <li key={cat.id}>
                       {cat.category_name}
                       <ul>
                         {cat.questions.map((q) => (
                           <li key={q.id}>{q.question_text} ({q.question_type})</li>
                         ))}
                       </ul>
                     </li>
                   ))}
                 </ul>
                 <button
                   type="button"
                   onClick={() => setStep('input')}
                   className="bg-blue-500 text-white p-2 mt-2"
                 >
                   Proceed
                 </button>
                 <button
                   type="button"
                   onClick={() => setStep('select')}
                   className="bg-gray-500 text-white p-2 mt-2 ml-2"
                 >
                   Back
                 </button>
               </div>
             )}
             {(step === 'input' || step === 'review') && selectedForm && (
               <>
                 <div className="mb-4">
                   <label className="block">CSR</label>
                   <select
                     {...register('csr_id', { required: true })}
                     className="border p-2 w-full"
                     disabled={step === 'review'}
                   >
                     <option value="">Select CSR</option>
                     {csrs.map((csr) => (
                       <option key={csr.id} value={csr.id}>{csr.username}</option>
                     ))}
                   </select>
                 </div>
                 {step === 'input' && (
                   <>
                     <div className="mb-4">
                       <label className="block">Call ID</label>
                       <div className="flex gap-2">
                         <input
                           type="text"
                           value={callIdInput}
                           onChange={(e) => setCallIdInput(e.target.value)}
                           className="border p-2 flex-grow"
                           placeholder="Enter Call ID"
                         />
                         <button
                           type="button"
                           onClick={addCall}
                           className="bg-blue-500 text-white p-2"
                         >
                           Add Call
                         </button>
                       </div>
                     </div>
                     <div className="mb-4">
                       <h2 className="text-xl">Search Calls</h2>
                       <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block">CSR</label>
                           <select
                             value={searchParams.csr_id}
                             onChange={(e) => setSearchParams({ ...searchParams, csr_id: e.target.value })}
                             className="border p-2 w-full"
                           >
                             <option value="">Any CSR</option>
                             {csrs.map((csr) => (
                               <option key={csr.id} value={csr.id}>{csr.username}</option>
                             ))}
                           </select>
                         </div>
                         <div>
                           <label className="block">Date Range</label>
                           <input
                             type="date"
                             value={searchParams.date_start}
                             onChange={(e) => setSearchParams({ ...searchParams, date_start: e.target.value })}
                             className="border p-2 w-full"
                           />
                           <input
                             type="date"
                             value={searchParams.date_end}
                             onChange={(e) => setSearchParams({ ...searchParams, date_end: e.target.value })}
                             className="border p-2 w-full mt-2"
                           />
                         </div>
                         <div>
                           <label className="block">Customer ID</label>
                           <input
                             type="text"
                             value={searchParams.customer_id}
                             onChange={(e) => setSearchParams({ ...searchParams, customer_id: e.target.value })}
                             className="border p-2 w-full"
                             placeholder="Enter Customer ID"
                           />
                         </div>
                       </div>
                       <button
                         type="button"
                         onClick={handleSearch}
                         className="bg-blue-500 text-white p-2 mt-2"
                       >
                         Search
                       </button>
                     </div>
                     {searchResults.length > 0 && (
                       <div className="mb-4">
                         <h2 className="text-xl">Search Results</h2>
                         <table className="w-full">
                           <thead>
                             <tr>
                               <th>Call ID</th>
                               <th>Date</th>
                               <th>Customer ID</th>
                               <th>Action</th>
                             </tr>
                           </thead>
                           <tbody>
                             {searchResults.map((call) => (
                               <tr key={call.id}>
                                 <td>{call.call_id}</td>
                                 <td>{new Date(call.call_date).toLocaleDateString()}</td>
                                 <td>{call.customer_id || 'N/A'}</td>
                                 <td>
                                   <button
                                     type="button"
                                     onClick={() => addCallFromSearch(call)}
                                     className="bg-green-500 text-white p-1"
                                     disabled={calls.find((c) => c.id === call.id)}
                                   >
                                     Add
                                   </button>
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                     )}
                   </>
                 )}
                 {calls.length > 0 && (
                   <div className="mb-4">
                     <h2 className="text-xl">Selected Calls</h2>
                     <div className="accordion">
                       {calls.map((call, index) => (
                         <div key={call.id} className="border mb-2">
                           <button
                             type="button"
                             className="w-full p-2 bg-gray-200 text-left"
                             onClick={() => document.getElementById(`call-${index}`)?.classList.toggle('hidden')}
                             disabled={step === 'review'}
                           >
                             Call {index + 1}: {new Date(call.call_date).toLocaleDateString()}
                           </button>
                           <div id={`call-${index}`} className="p-2 hidden">
                             <p><strong>Call ID:</strong> {call.call_id}</p>
                             <p><strong>Customer ID:</strong> {call.customer_id || 'N/A'}</p>
                             <p><strong>Transcript:</strong> {call.transcript || 'N/A'}</p>
                             {call.recording_url && (
                               <a href={call.recording_url} target="_blank" className="text-blue-500">Listen to Call</a>
                             )}
                             {step !== 'review' && (
                               <button
                                 type="button"
                                 onClick={() => removeCall(index)}
                                 className="bg-red-500 text-white p-1 mt-2"
                               >
                                 Remove
                               </button>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
                 {(step === 'input' || step === 'review') && (
                   <div className="mb-4">
                     <h2 className="text-xl">Metadata</h2>
                     {selectedForm.metadata_fields
                       .filter((f) => f.interaction_type === 'CALL')
                       .map((field) => (
                         <div key={field.id} className="mb-2">
                           <label className="block">{field.field_name}</label>
                           {field.field_name === 'Auditor Name' ? (
                             <input
                               type="text"
                               value={user?.username || ''}
                               readOnly
                               className="border p-2 w-full bg-gray-100"
                             />
                           ) : field.field_name === 'Audit Date' ? (
                             <input
                               type="date"
                               {...register('audit_date', { required: field.is_required })}
                               className="border p-2 w-full bg-gray-100"
                               disabled={step === 'review'}
                             />
                           ) : field.field_name === 'CSR' ? (
                             <select
                               {...register(field.id.toString(), { required: field.is_required })}
                               className="border p-2 w-full"
                               disabled={step === 'review'}
                             >
                               <option value="">Select CSR</option>
                               {csrs.map((csr) => (
                                 <option key={csr.id} value={csr.id}>{csr.username}</option>
                               ))}
                             </select>
                           ) : field.field_type === 'DATE' ? (
                             <input
                               type="date"
                               {...register(field.id.toString(), { required: field.is_required })}
                               className="border p-2 w-full"
                               disabled={step === 'review'}
                             />
                           ) : (
                             <input
                               type="text"
                               {...register(field.id.toString(), { required: field.is_required })}
                               className="border p-2 w-full"
                               disabled={step === 'review'}
                             />
                           )}
                         </div>
                       ))}
                   </div>
                 )}
                 {step === 'review' && (
                   <div className="mb-4">
                     <h2 className="text-xl">Review Submission</h2>
                     <p><strong>Form:</strong> {selectedForm.form_name}</p>
                     <p><strong>CSR:</strong> {csrs.find((c) => c.id === parseInt(watch('csr_id')))?.username || 'N/A'}</p>
                     <p><strong>Calls:</strong> {calls.length} selected</p>
                     <p><strong>Metadata:</strong></p>
                     <ul>
                       {selectedForm.metadata_fields
                         .filter((f) => f.interaction_type === 'CALL')
                         .map((field) => (
                           <li key={field.id}>
                             {field.field_name}: {watch(field.id.toString()) || watch(field.field_name.toLowerCase().replace(' ', '_')) || 'N/A'}
                           </li>
                         ))}
                     </ul>
                     <button
                       type="button"
                       onClick={() => setStep('input')}
                       className="bg-gray-500 text-white p-2 mt-2"
                     >
                       Edit
                     </button>
                   </div>
                 )}
                 <button
                   type="submit"
                   className="bg-green-500 text-white p-2"
                   disabled={calls.length === 0}
                 >
                   {step === 'input' ? 'Review' : 'Submit Audit'}
                 </button>
               </>
             )}
           </form>
         </div>
       );
     };

     export default QAManualReviews;
     ```
- **Validation**:
  - Run `npm run dev` in `frontend` and navigate to the QA Manual Reviews screen (e.g., `http://localhost:5173/qa/manual`).
  - Test:
    1. Select a form and verify the preview shows metadata and questions.
    2. Choose a CSR and add calls via ID or search (e.g., by CSR or date).
    3. Confirm calls appear in an accordion with transcripts and recording links.
    4. Proceed to the review step, edit if needed, and submit.
  - Check `submissions` and `submission_calls` in MySQL to verify data.

## 💡 Tips to Avoid Errors
- **Focus on Manual Reviews**: Use only `qa_manual_reviews.md` and `form_builder_instructions.md` in queries to keep Cursor focused.
- **Verify Schema**: Confirm `submission_calls` exists (`DESCRIBE submission_calls;`).
- **Test Incrementally**: Test each step (backend with Postman, frontend UI) to ensure calls are saved and displayed correctly.
- **Clear Composer Context**: If Cursor generates incorrect code, reset Composer (`Ctrl + K`, then reset) and re-enter the query.
- **Use Precise Queries**: Copy queries exactly to avoid context drift with Grok-3-Beta’s slower responses.

## 📌 Addressing Slow Responses and Model List
To optimize with Claude 3.5 Sonnet:
- **Switch to Claude**:
  - Go to `File > Settings > AI Model`. If Claude 3.5 Sonnet isn’t listed, add an Anthropic API key in Settings > Integrations or contact Cursor support, referencing your Pro plan.
- **Mitigate Grok-3-Beta Slowness**:
  - Enable usage-based pricing in Settings > Billing to reduce latency (~3.7 min).
  - Clear Cursor’s cache: Close Cursor, delete `qtip/.cursor`, and reopen.
- **Test Claude**:
  - If switched, test:
    ```
    Using qa_manual_reviews_updated.md, summarize the updated manual audit process.
    ```

## ✅ Testing Notes
- Verify QA users can select a form, view a preview, and choose a CSR.
- Test adding calls via manual ID entry and search, ensuring accordion display with transcripts and recording links.
- Confirm the review step shows form, CSR, calls, and metadata, with an edit option.
- Ensure `submission_calls` stores multiple calls with correct `sort_order`.
- Validate submission saves to `submissions`, `submission_calls`, and `submission_metadata` without affecting existing functionality.

## 📌 Next Steps
- Save `qa_manual_reviews_updated.md` and `database_schema_addition.sql` to the project.
- Start with Step 1 to add the `submission_calls` table.
- Follow steps sequentially, testing each to ensure integration.
- If errors occur, reset Composer and re-enter the query.
- Contact Cursor support if Claude 3.5 Sonnet remains unavailable.
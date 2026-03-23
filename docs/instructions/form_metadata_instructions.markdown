# Form Metadata Instructions

## 📜 Purpose
This document provides specific, step-by-step instructions for adding metadata fields functionality to the QTIP form builder using Cursor, focusing exclusively on configuring and displaying metadata fields (Auditor Name, Audit Date, CSR, Customer ID, Customer Name, Ticket Number, Call Recording ID, Call Date) for the "Call" interaction type. It assumes the existing form builder is complete and tested, with `form_metadata_fields` and `submission_metadata` tables already added to the database. Instructions are tailored for Cursor’s Composer chat interface (`Ctrl + K`) to ensure precise implementation without disrupting other functionality.

## 🛠️ Prerequisites
- **Cursor**: Latest version installed ([cursor.sh](https://cursor.sh)).
- **Node.js**: Version 18.x or higher.
- **MySQL**: Version 8.x, with `form_metadata_fields` and `submission_metadata` tables in the `qtip` database.
- **Project Files**: `form_builder_instructions.md`, `qa_assigned_reviews.md`, `qa_manual_reviews.md`, and `database_schema.sql` in `qtip/docs` and `qtip/database`.
- **Existing Setup**: Form builder backend (`forms` routes) and frontend (FormBuilder component) implemented and tested.
- **Model**: Preferably Claude 3.5 Sonnet; Grok-3-Beta if limited by model list.

## 📁 Setup
Ensure the following files are in your project:
```
qtip/
├── docs/
│   ├── form_builder_instructions.md
│   ├── qa_assigned_reviews.md
│   ├── qa_manual_reviews.md
│   ├── ... (other .md files)
├── database/
│   └── database_schema.sql
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── forms.ts
│   │   ├── types/
│   │   │   ├── db.ts
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FormBuilder.tsx
│   │   │   ├── QAAssignedReviews.tsx
│   │   │   ├── QAManualReviews.tsx
```

## 🚀 Implementation Steps
Follow these steps to add metadata fields functionality using Cursor’s Composer chat (`Ctrl + K`). Each step focuses on a single task to avoid errors.

### Step 1: Update TypeScript Interfaces
- **File to Reference**: `form_builder_instructions.md`.
- **Actions**:
  1. Open `backend/src/types/db.ts` in Cursor.
  2. Add interfaces for `FormMetadataField` and `SubmissionMetadata`.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using form_builder_instructions.md, generate TypeScript interfaces for the form_metadata_fields and submission_metadata tables, using Date for DATETIME fields.
     ```
  3. Append the output to `backend/src/types/db.ts`:
     ```typescript
     export interface FormMetadataField {
       id: number;
       form_id: number;
       interaction_type: 'CALL' | 'EMAIL' | 'CHAT' | 'OTHER';
       field_name: string;
       field_type: 'TEXT' | 'DROPDOWN' | 'DATE' | 'AUTO';
       is_required: boolean;
       dropdown_source: string | null;
       created_at: Date;
     }

     export interface SubmissionMetadata {
       id: number;
       submission_id: number;
       field_id: number;
       value: string | null;
       created_at: Date;
     }
     ```
- **Validation**:
  - Open `db.ts` in Cursor to confirm the new interfaces are added alongside existing ones (e.g., `User`, `Call`).
  - Ensure no syntax errors by running `tsc` in the `backend` directory:
    ```
    cd backend
    npx tsc
    ```

### Step 2: Update Backend Form Routes
- **File to Reference**: `form_builder_instructions.md`.
- **Actions**:
  1. Open `backend/src/routes/forms.ts` in Cursor.
  2. Update the form creation and retrieval routes to handle metadata fields.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using form_builder_instructions.md and database_schema.sql, update Express routes in forms.ts to support creating and listing QA forms with metadata fields for the Call interaction type (fields: Auditor Name, Audit Date, CSR, Customer ID, Customer Name, Ticket Number, Call Recording ID, Call Date), including TypeScript types and MySQL queries.
     ```
  3. Replace the content of `backend/src/routes/forms.ts` with the output:
     ```typescript
     import express from 'express';
     import mysql from 'mysql2/promise';
     import { Form, FormMetadataField } from '../types/db';

     interface Form {
       id: number;
       form_name: string;
       interaction_type: string;
       version: number;
       created_by: number;
       created_at: string;
       is_active: boolean;
     }

     const router = express.Router();
     const db = mysql.createPool({ /* MySQL config: host, user, password, database: qtip */ });

     router.post('/', async (req, res) => {
       const { form_name, interaction_type, version, metadata_fields, categories, created_by } = req.body;
       try {
         await db.query('START TRANSACTION');
         const [formResult] = await db.query(
           'INSERT INTO forms (form_name, interaction_type, version, created_by) VALUES (?, ?, ?, ?)',
           [form_name, interaction_type, version, created_by]
         );
         const formId = formResult.insertId;

         for (const field of metadata_fields) {
           await db.query(
             'INSERT INTO form_metadata_fields (form_id, interaction_type, field_name, field_type, is_required, dropdown_source) VALUES (?, ?, ?, ?, ?, ?)',
             [formId, interaction_type, field.field_name, field.field_type, field.is_required, field.dropdown_source]
           );
         }

         // Handle categories and questions (existing logic)
         for (const category of categories) {
           const [catResult] = await db.query(
             'INSERT INTO form_categories (form_id, category_name, weight) VALUES (?, ?, ?)',
             [formId, category.category_name, category.weight]
           );
           const categoryId = catResult.insertId;
           for (const question of category.questions) {
             await db.query(
               'INSERT INTO form_questions (category_id, question_text, question_type, weight) VALUES (?, ?, ?, ?)',
               [categoryId, question.question_text, question.question_type, question.weight]
             );
           }
         }

         await db.query('COMMIT');
         res.status(201).json({ id: formId, form_name });
       } catch (error) {
         await db.query('ROLLBACK');
         res.status(500).json({ error: 'Server error' });
       }
     });

     router.get('/', async (req, res) => {
       try {
         const [forms] = await db.query<Form[]>('SELECT * FROM forms WHERE is_active = true');
         const [metadata] = await db.query<FormMetadataField[]>('SELECT * FROM form_metadata_fields');
         const formsWithMetadata = forms.map((form) => ({
           ...form,
           metadata_fields: metadata.filter((m) => m.form_id === form.id),
         }));
         res.json(formsWithMetadata);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     router.get('/:id', async (req, res) => {
       const { id } = req.params;
       try {
         const [forms] = await db.query<Form[]>('SELECT * FROM forms WHERE id = ?', [id]);
         const [metadata] = await db.query<FormMetadataField[]>('SELECT * FROM form_metadata_fields WHERE form_id = ?', [id]);
         const [categories] = await db.query('SELECT * FROM form_categories WHERE form_id = ?', [id]);
         const [questions] = await db.query('SELECT * FROM form_questions WHERE category_id IN (SELECT id FROM form_categories WHERE form_id = ?)', [id]);
         const form = forms[0];
         form.metadata_fields = metadata;
         form.categories = categories.map((cat) => ({
           ...cat,
           questions: questions.filter((q) => q.category_id === cat.id),
         }));
         res.json(form);
       } catch (error) {
         res.status(500).json({ error: 'Server error' });
       }
     });

     export default router;
     ```
- **Validation**:
  - Test with Postman:
    ```
    POST http://localhost:3000/api/forms
    Body: {
      "form_name": "Call Audit",
      "interaction_type": "CALL",
      "version": 1,
      "metadata_fields": [
        { "field_name": "Auditor Name", "field_type": "AUTO", "is_required": true, "dropdown_source": null },
        { "field_name": "Audit Date", "field_type": "AUTO", "is_required": true, "dropdown_source": null },
        { "field_name": "CSR", "field_type": "DROPDOWN", "is_required": true, "dropdown_source": "users" },
        { "field_name": "Customer ID", "field_type": "TEXT", "is_required": true, "dropdown_source": null },
        { "field_name": "Customer Name", "field_type": "TEXT", "is_required": true, "dropdown_source": null },
        { "field_name": "Ticket Number", "field_type": "TEXT", "is_required": true, "dropdown_source": null },
        { "field_name": "Call Recording ID", "field_type": "TEXT", "is_required": true, "dropdown_source": null },
        { "field_name": "Call Date", "field_type": "DATE", "is_required": true, "dropdown_source": null }
      ],
      "categories": [], // Add categories and questions as needed
      "created_by": 1
    }
    ```
    Expect a 201 response with the form ID.
  - Test `GET /api/forms` to ensure metadata fields are included in the response.

### Step 3: Update Frontend Form Builder Component
- **File to Reference**: `form_builder_instructions.md`.
- **Actions**:
  1. Open `frontend/src/components/FormBuilder.tsx` in Cursor.
  2. Enhance the component to include metadata field configuration.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using form_builder_instructions.md, update the React FormBuilder component to include metadata field configuration for the Call interaction type (fields: Auditor Name, Audit Date, CSR, Customer ID, Customer Name, Ticket Number, Call Recording ID, Call Date), with TypeScript, Tailwind CSS, and Axios.
     ```
  3. Update `frontend/src/components/FormBuilder.tsx`:
     ```typescript
     import React, { useState } from 'react';
     import axios from 'axios';
     import { useForm } from 'react-hook-form';

     interface FormData {
       form_name: string;
       interaction_type: string;
       version: number;
     }

     interface MetadataField {
       field_name: string;
       field_type: string;
       is_required: boolean;
       dropdown_source: string | null;
     }

     const FormBuilder: React.FC = () => {
       const { register, handleSubmit } = useForm<FormData>();
       const [metadataFields, setMetadataFields] = useState<MetadataField[]>([
         { field_name: 'Auditor Name', field_type: 'AUTO', is_required: true, dropdown_source: null },
         { field_name: 'Audit Date', field_type: 'AUTO', is_required: true, dropdown_source: null },
         { field_name: 'CSR', field_type: 'DROPDOWN', is_required: true, dropdown_source: 'users' },
         { field_name: 'Customer ID', field_type: 'TEXT', is_required: true, dropdown_source: null },
         { field_name: 'Customer Name', field_type: 'TEXT', is_required: true, dropdown_source: null },
         { field_name: 'Ticket Number', field_type: 'TEXT', is_required: true, dropdown_source: null },
         { field_name: 'Call Recording ID', field_type: 'TEXT', is_required: true, dropdown_source: null },
         { field_name: 'Call Date', field_type: 'DATE', is_required: true, dropdown_source: null },
       ]);

       const onSubmit = async (data: FormData) => {
         try {
           await axios.post('http://localhost:3000/api/forms', {
             ...data,
             metadata_fields: metadataFields,
             categories: [], // Integrate with existing category/question logic
             created_by: 1, // Replace with logged-in user ID
           }, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           alert('Form created successfully');
         } catch (error) {
           console.error('Form creation failed', error);
         }
       };

       const addMetadataField = () => {
         setMetadataFields([...metadataFields, {
           field_name: '',
           field_type: 'TEXT',
           is_required: true,
           dropdown_source: null,
         }]);
       };

       const updateMetadataField = (index: number, field: Partial<MetadataField>) => {
         const updated = [...metadataFields];
         updated[index] = { ...updated[index], ...field };
         setMetadataFields(updated);
       };

       const removeMetadataField = (index: number) => {
         setMetadataFields(metadataFields.filter((_, i) => i !== index));
       };

       return (
         <div className="p-4">
           <h1 className="text-2xl mb-4">Form Builder</h1>
           <form onSubmit={handleSubmit(onSubmit)}>
             <div className="mb-4">
               <label className="block">Form Name</label>
               <input {...register('form_name', { required: true })} className="border p-2 w-full" />
             </div>
             <div className="mb-4">
               <label className="block">Interaction Type</label>
               <select {...register('interaction_type', { required: true })} className="border p-2 w-full">
                 <option value="CALL">Call</option>
                 <option value="EMAIL">Email</option>
                 <option value="CHAT">Chat</option>
                 <option value="OTHER">Other</option>
               </select>
             </div>
             <div className="mb-4">
               <label className="block">Version</label>
               <input type="number" {...register('version', { required: true })} defaultValue={1} className="border p-2 w-full" />
             </div>
             <div className="mb-4">
               <h2 className="text-xl mb-2">Metadata Fields</h2>
               <table className="w-full mb-2">
                 <thead>
                   <tr>
                     <th>Field Name</th>
                     <th>Type</th>
                     <th>Required</th>
                     <th>Dropdown Source</th>
                     <th>Actions</th>
                   </tr>
                 </thead>
                 <tbody>
                   {metadataFields.map((field, index) => (
                     <tr key={index}>
                       <td>
                         <input
                           type="text"
                           value={field.field_name}
                           onChange={(e) => updateMetadataField(index, { field_name: e.target.value })}
                           className="border p-1 w-full"
                         />
                       </td>
                       <td>
                         <select
                           value={field.field_type}
                           onChange={(e) => updateMetadataField(index, { field_type: e.target.value })}
                           className="border p-1 w-full"
                         >
                           <option value="TEXT">Text</option>
                           <option value="DROPDOWN">Dropdown</option>
                           <option value="DATE">Date</option>
                           <option value="AUTO">Auto</option>
                         </select>
                       </td>
                       <td>
                         <input
                           type="checkbox"
                           checked={field.is_required}
                           onChange={(e) => updateMetadataField(index, { is_required: e.target.checked })}
                         />
                       </td>
                       <td>
                         <input
                           type="text"
                           value={field.dropdown_source || ''}
                           onChange={(e) => updateMetadataField(index, { dropdown_source: e.target.value || null })}
                           className="border p-1 w-full"
                           disabled={field.field_type !== 'DROPDOWN'}
                         />
                       </td>
                       <td>
                         <button
                           type="button"
                           onClick={() => removeMetadataField(index)}
                           className="bg-red-500 text-white p-1"
                         >
                           Remove
                         </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
               <button type="button" onClick={addMetadataField} className="bg-blue-500 text-white p-2">
                 Add Metadata Field
               </button>
             </div>
             {/* Integrate with existing category/question UI */}
             <button type="submit" className="bg-green-500 text-white p-2">
               Save Form
             </button>
           </form>
         </div>
       );
     };

     export default FormBuilder;
     ```
- **Validation**:
  - Run `npm run dev` in `frontend` and navigate to the Form Builder UI (e.g., `http://localhost:5173/admin/forms`).
  - Test adding metadata fields for "Call" (e.g., Auditor Name, CSR) and saving the form, ensuring they are sent to the backend.

### Step 4: Update QA Assigned Reviews Component
- **File to Reference**: `qa_assigned_reviews.md`.
- **Actions**:
  1. Open `frontend/src/components/QAAssignedReviews.tsx` in Cursor.
  2. Update the component to display metadata fields at the top of audit forms for "Call" interactions.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_assigned_reviews.md and form_builder_instructions.md, update the React QAAssignedReviews component to display metadata fields (Auditor Name, Audit Date, CSR, Customer ID, Customer Name, Ticket Number, Call Recording ID, Call Date) at the top of audit forms for Call interactions, with TypeScript, Tailwind CSS, and Axios, auto-populating fields where possible.
     ```
  3. Update `frontend/src/components/QAAssignedReviews.tsx`:
     ```typescript
     import React, { useState, useEffect } from 'react';
     import axios from 'axios';
     import { useForm } from 'react-hook-form';

     interface MetadataField {
       id: number;
       field_name: string;
       field_type: string;
       is_required: boolean;
       dropdown_source: string | null;
     }

     interface FormData {
       [key: string]: string;
     }

     const QAAssignedReviews: React.FC = () => {
       const { register, handleSubmit, setValue } = useForm<FormData>();
       const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);
       const [auditData, setAuditData] = useState<any>(null);
       const [csrs, setCsrs] = useState<{ id: number; username: string }[]>([]);
       const [user, setUser] = useState<{ id: number; username: string } | null>(null);

       useEffect(() => {
         // Fetch logged-in user
         axios.get('http://localhost:3000/api/auth/me', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => setUser(response.data));

         // Fetch audit data
         axios.get('http://localhost:3000/api/qa/assigned/1', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => {
           setAuditData(response.data);
           setMetadataFields(response.data.form.metadata_fields.filter((f: MetadataField) => f.interaction_type === 'CALL'));
           if (response.data.csr_id) {
             setValue('csr_id', response.data.csr_id.toString());
           }
           setValue('audit_date', new Date().toISOString().split('T')[0]);
           if (response.data.call) {
             setValue('customer_id', response.data.call.customer_id || '');
             setValue('call_date', response.data.call.call_date.split('T')[0]);
             setValue('call_recording_id', response.data.call.recording_url || '');
           }
         });

         // Fetch CSRs for dropdown
         axios.get('http://localhost:3000/api/users', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           params: { role_id: 3 }, // Assuming CSR role_id is 3
         }).then((response) => setCsrs(response.data));
       }, [setValue]);

       const onSubmit = async (data: FormData) => {
         try {
           const metadata = Object.entries(data).map(([field_id, value]) => ({
             field_id: parseInt(field_id),
             value,
           }));
           await axios.post('http://localhost:3000/api/submissions', {
             form_id: auditData.form.id,
             call_id: auditData.call_id,
             submitted_by: user?.id || 1,
             metadata,
             // Add question answers from existing logic
           }, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           alert('Audit submitted successfully');
         } catch (error) {
           console.error('Submission failed', error);
         }
       };

       if (!auditData || !user) return <div>Loading...</div>;

       return (
         <div className="p-4">
           <h1 className="text-2xl mb-4">Assigned Audit</h1>
           <form onSubmit={handleSubmit(onSubmit)}>
             <div className="mb-4">
               <h2 className="text-xl">Metadata</h2>
               {metadataFields.map((field) => (
                 <div key={field.id} className="mb-2">
                   <label className="block">{field.field_name}</label>
                   {field.field_name === 'Auditor Name' ? (
                     <input
                       type="text"
                       value={user.username}
                       readOnly
                       className="border p-2 w-full bg-gray-100"
                     />
                   ) : field.field_name === 'Audit Date' ? (
                     <input
                       type="date"
                       {...register('audit_date', { required: field.is_required })}
                       className="border p-2 w-full bg-gray-100"
                     />
                   ) : field.field_name === 'CSR' ? (
                     <select
                       {...register(field.id.toString(), { required: field.is_required })}
                       className="border p-2 w-full"
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
                     />
                   ) : (
                     <input
                       type="text"
                       {...register(field.id.toString(), { required: field.is_required })}
                       className="border p-2 w-full"
                     />
                   )}
                 </div>
               ))}
             </div>
             {/* Integrate with existing question fields */}
             <button type="submit" className="bg-blue-500 text-white p-2">
               Submit Audit
             </button>
           </form>
         </div>
       );
     };

     export default QAAssignedReviews;
     ```
- **Validation**:
  - Run `npm run dev` in `frontend` and navigate to the QA Assigned Reviews screen.
  - Verify metadata fields (Auditor Name, CSR, etc.) appear at the top of the form, with auto-populated values (e.g., Auditor Name from logged-in user, CSR preloaded).

### Step 5: Update QA Manual Reviews Component
- **File to Reference**: `qa_manual_reviews.md`.
- **Actions**:
  1. Open `frontend/src/components/QAManualReviews.tsx` in Cursor.
  2. Update the component to include metadata fields for "Call" interactions.
- **Cursor Composer Chat Query**:
  1. Press `Ctrl + K` to open the Composer chat.
  2. Enter:
     ```
     Using qa_manual_reviews.md and form_builder_instructions.md, update the React QAManualReviews component to display metadata fields (Auditor Name, Audit Date, CSR, Customer ID, Customer Name, Ticket Number, Call Recording ID, Call Date) at the top of audit forms for Call interactions, with TypeScript, Tailwind CSS, and Axios, auto-populating fields where possible.
     ```
  3. Update `frontend/src/components/QAManualReviews.tsx`:
     ```typescript
     import React, { useState, useEffect } from 'react';
     import axios from 'axios';
     import { useForm } from 'react-hook-form';

     interface MetadataField {
       id: number;
       field_name: string;
       field_type: string;
       is_required: boolean;
       dropdown_source: string | null;
     }

     interface FormData {
       [key: string]: string;
     }

     const QAManualReviews: React.FC = () => {
       const { register, handleSubmit, setValue } = useForm<FormData>();
       const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);
       const [form, setForm] = useState<any>(null);
       const [csrs, setCsrs] = useState<{ id: number; username: string }[]>([]);
       const [user, setUser] = useState<{ id: number; username: string } | null>(null);

       useEffect(() => {
         // Fetch logged-in user
         axios.get('http://localhost:3000/api/auth/me', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => setUser(response.data));

         // Fetch form (mocked for manual audit)
         axios.get('http://localhost:3000/api/forms/1', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
         }).then((response) => {
           setForm(response.data);
           setMetadataFields(response.data.metadata_fields.filter((f: MetadataField) => f.interaction_type === 'CALL'));
           setValue('audit_date', new Date().toISOString().split('T')[0]);
         });

         // Fetch CSRs
         axios.get('http://localhost:3000/api/users', {
           headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           params: { role_id: 3 },
         }).then((response) => setCsrs(response.data));
       }, [setValue]);

       const onSubmit = async (data: FormData) => {
         try {
           const metadata = Object.entries(data).map(([field_id, value]) => ({
             field_id: parseInt(field_id),
             value,
           }));
           await axios.post('http://localhost:3000/api/submissions', {
             form_id: form.id,
             submitted_by: user?.id || 1,
             metadata,
             // Add question answers from existing logic
           }, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
           });
           alert('Audit submitted successfully');
         } catch (error) {
           console.error('Submission failed', error);
         }
       };

       if (!form || !user) return <div>Loading...</div>;

       return (
         <div className="p-4">
           <h1 className="text-2xl mb-4">Manual Audit</h1>
           <form onSubmit={handleSubmit(onSubmit)}>
             <div className="mb-4">
               <h2 className="text-xl">Metadata</h2>
               {metadataFields.map((field) => (
                 <div key={field.id} className="mb-2">
                   <label className="block">{field.field_name}</label>
                   {field.field_name === 'Auditor Name' ? (
                     <input
                       type="text"
                       value={user.username}
                       readOnly
                       className="border p-2 w-full bg-gray-100"
                     />
                   ) : field.field_name === 'Audit Date' ? (
                     <input
                       type="date"
                       {...register('audit_date', { required: field.is_required })}
                       className="border p-2 w-full bg-gray-100"
                     />
                   ) : field.field_name === 'CSR' ? (
                     <select
                       {...register(field.id.toString(), { required: field.is_required })}
                       className="border p-2 w-full"
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
                     />
                   ) : (
                     <input
                       type="text"
                       {...register(field.id.toString(), { required: field.is_required })}
                       className="border p-2 w-full"
                     />
                   )}
                 </div>
               ))}
             </div>
             {/* Integrate with existing question fields */}
             <button type="submit" className="bg-blue-500 text-white p-2">
               Submit Audit
             </button>
           </form>
         </div>
       );
     };

     export default QAManualReviews;
     ```
- **Validation**:
  - Test the manual audit UI, ensuring metadata fields are displayed and editable (except auto-populated fields).

## 💡 Tips to Avoid Errors
- **Focus on Metadata**: Use only `form_builder_instructions.md`, `qa_assigned_reviews.md`, and `qa_manual_reviews.md` for queries to keep Cursor focused.
- **Verify Schema**: Confirm `form_metadata_fields` and `submission_metadata` tables exist in MySQL (`DESCRIBE form_metadata_fields;`).
- **Test Incrementally**: After each step, test the backend with Postman and frontend UI to ensure metadata fields are saved and displayed correctly.
- **Clear Composer Context**: If Cursor generates incorrect code, reset Composer (`Ctrl + K`, then reset) and re-enter the query.
- **Use Precise Queries**: Copy queries exactly to avoid context drift, especially with Grok-3-Beta’s slower responses.

## 📌 Addressing Slow Responses and Model List
To optimize with Claude 3.5 Sonnet:
- **Switch to Claude**:
  - Go to `File > Settings > AI Model`. If Claude 3.5 Sonnet isn’t listed, add an Anthropic API key in Settings > Integrations or contact Cursor support, referencing your Pro plan.
- **Mitigate Grok-3-Beta Slowness**:
  - Enable usage-based pricing in Settings > Billing to restore fast responses (~3.7 min latency otherwise).
  - Use concise queries to minimize delays.
- **Test Claude**:
  - Once available, test:
    ```
    Using form_builder_instructions.md, summarize the metadata fields functionality.
    ```

## ✅ Testing Notes
- Verify metadata fields for "Call" (Auditor Name, CSR, etc.) are configurable in the Form Builder and saved to `form_metadata_fields`.
- Test auto-populated fields (Auditor Name, Audit Date) in QA Assigned Reviews and Manual Reviews.
- Ensure CSR dropdown is populated from `users` (CSR role) and preloaded for assigned audits.
- Confirm metadata values are saved to `submission_metadata` on audit submission.
- Test UI rendering for "Call" interaction type, ensuring fields are at the top of the form.

## 📌 Next Steps
- Start with Step 1 to update TypeScript interfaces.
- Follow steps sequentially, testing each to ensure integration with the existing form builder.
- If errors occur, reset Composer and re-enter the query with the exact file reference.
- Contact Cursor support if Claude 3.5 Sonnet remains unavailable.
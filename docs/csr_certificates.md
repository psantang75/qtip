# CSR Certificates

## 📜 Purpose
The CSR Certificates screen allows Customer Service Representatives (CSRs) to view and download certificates earned from completing training courses in the QTIP platform’s Learning Management System (LMS). This screen promotes recognition and documentation of training achievements.

## 🖥️ UI Components
### Certificate List
- **Table**: Displays certificates from `certificates` for the logged-in CSR.
  - Columns: Course Name, Completion Date, Certificate ID, Status (Valid/Expired).
  - Actions: View Certificate, Download PDF.
- **Search Bar**: Search by course name.
- **Pagination**: 10 certificates per page.

### Certificate View Modal
- **Details**:
  - **Certificate Info**: Course Name, CSR Name, Completion Date, Certificate ID.
  - **Certificate Image**: Rendered preview of the certificate (e.g., generated template).
- **Download Button**: Downloads certificate as PDF.
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Certificates**  
   - CSR navigates to Certificates from the dashboard.
   - Browses certificate list or searches by course name.

2. **Review Certificate**  
   - Clicks “View Certificate” to open modal with certificate details and preview.
   - Optionally clicks “Download PDF” to save the certificate.

3. **Return to List**  
   - Closes modal to return to the certificate list.

## 🗄️ Backend Integration
- **Tables**:
  - `certificates`: Fetch certificate data.
  - `courses`: Fetch course names.
  - `users`: Fetch CSR name.
- **Endpoints**:
  - `GET /api/csr/certificates`: Fetch CSR’s certificates with pagination.
  - `GET /api/csr/certificates/:certificate_id`: Fetch certificate details.
  - `GET /api/csr/certificates/:certificate_id/pdf`: Generate and download PDF.
- **Validation**:
  - Restrict certificates to the logged-in CSR’s `user_id`.
  - Ensure only valid certificates are shown (not expired, if expiration is implemented).

## 💻 Frontend Implementation
- **React Components**:
  - `CertificateTable`: Paginated table with search and action buttons.
  - `CertificateModal`: Modal for certificate preview and download.
- **State Management**: Use React Query for fetching certificate data.
- **Styling**: Tailwind CSS for table and modal styling.
- **PDF Generation**: Use jsPDF or similar library for client-side PDF generation.

## ✅ Testing Notes
- Verify only the CSR’s certificates are shown.
- Test search functionality by course name.
- Ensure modal displays correct certificate details and preview.
- Confirm PDF download generates a valid file.
- Validate CSR-only access to the screen.
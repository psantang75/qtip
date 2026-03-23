# Help Center

## 📜 Purpose
The Help Center screen provides a shared interface accessible to all user roles (Admin, QA Analyst, CSR, Trainer, Manager, Director) in the QTIP platform, offering FAQs, static support resources, and links to assist users in navigating and troubleshooting the system.

## 🖥️ UI Components
### FAQ Section
- **Accordion List**: Collapsible list of frequently asked questions and answers.
  - Example FAQs:
    - "How do I submit a dispute?" (CSR-specific)
    - "How do I create a QA form?" (Admin-specific)
    - "How do I assign training?" (Trainer-specific)
  - Categories: General, Role-Specific (filtered by user role).
- **Search Bar**: Search FAQs by keyword.

### Support Resources
- **Links**:
  - User Guide: PDF or web link to a comprehensive manual.
  - Contact Support: Email link (e.g., `support@qtip.com`) or ticket submission form.
  - Video Tutorials: Links to role-specific video guides (e.g., “QA Audit Process”).
- **Static Content**: Brief overview of QTIP features and tips.

### Role-Based Guidance
- **Dynamic Section**: Displays tips or links tailored to the user’s role (e.g., “View your audits” for CSRs, “Resolve disputes” for Managers).
- **Call to Action**: Links to relevant screens (e.g., `csr_my_audits.md`, `manager_dispute_resolution.md`).

## 🔄 Workflow
1. **Access Help Center**  
   - User navigates to Help Center from the top bar or sidebar (available to all roles).
   - Views FAQs, resources, or role-based guidance.

2. **Search FAQs**  
   - Uses search bar to find specific answers (e.g., “dispute process”).
   - Expands accordion items to read answers.

3. **Use Resources**  
   - Clicks links to access user guides, contact support, or watch tutorials.
   - Follows role-based guidance to relevant screens.

## 🗄️ Backend Integration
- **Tables**: None (static content, no database dependency).
- **Endpoints**:
  - `GET /api/help/faqs`: Fetch FAQ content (stored as JSON or static file).
  - `GET /api/help/resources`: Fetch resource links and role-based tips.
- **Validation**:
  - Filter FAQs and tips by user role (via JWT `role_id`).
  - Ensure access is available to all authenticated users.

## 💻 Frontend Implementation
- **React Components**:
  - `FAQAccordion`: Collapsible list for FAQs with search functionality.
  - `ResourceLinks`: Grid or list of support links and static content.
  - `RoleGuidance`: Dynamic section for role-specific tips and links.
- **State Management**: Use React Query for fetching FAQ and resource data.
- **Styling**: Tailwind CSS for accordion, grid, and content styling.

## ✅ Testing Notes
- Verify FAQs are filtered by role (e.g., CSRs don’t see Admin FAQs).
- Test search functionality for keyword matches.
- Ensure all links (user guide, support, tutorials) are valid.
- Confirm role-based guidance links to correct screens.
- Validate access for all roles (Admin, QA, CSR, Trainer, Manager, Director).
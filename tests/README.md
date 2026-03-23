# QTIP Test Scripts

This directory contains all test scripts and debugging utilities for the QTIP (Quality Training and Improvement Platform) project.

## 📁 Test Scripts Overview

### **Authentication Tests**
- [`test_auth.ps1`](./test_auth.ps1) - PowerShell authentication test script
- [`test_detailed_login.js`](./test_detailed_login.js) - Detailed login functionality test
- [`test_login_success.js`](./test_login_success.js) - Login success verification test

### **Form Operations Tests**
- [`test_final_form_operations.js`](./test_final_form_operations.js) - Final form operations test suite
- [`test_form_creation_fixed.js`](./test_form_creation_fixed.js) - Form creation test (fixed version)
- [`test_form_operations.js`](./test_form_operations.js) - Basic form operations test
- [`test_form_operations_authenticated.js`](./test_form_operations_authenticated.js) - Authenticated form operations test
- [`test_form_operations_simple.js`](./test_form_operations_simple.js) - Simple form operations test
- [`test_form_operations_working.js`](./test_form_operations_working.js) - Working form operations test

### **Dashboard Tests**
- [`test_admin_dashboard.cjs`](./test_admin_dashboard.cjs) - Admin dashboard functionality test
- [`test_manager_dashboard.cjs`](./test_manager_dashboard.cjs) - Manager dashboard functionality test

### **Analytics Tests**
- [`test_analytics_comparison.js`](./test_analytics_comparison.js) - Analytics comparison test
- [`test_analytics_quick.js`](./test_analytics_quick.js) - Quick analytics test
- [`test_analytics_service.js`](./test_analytics_service.js) - Analytics service test

### **Service Tests**
- [`test_step8_2_services.js`](./test_step8_2_services.js) - Step 8.2 services test
- [`test_phone_system_connection.js`](./test_phone_system_connection.js) - Phone system connection test

### **Component Tests**
- [`test_hooks_implementation.js`](./test_hooks_implementation.js) - React hooks implementation test
- [`test_spinner_sizes.js`](./test_spinner_sizes.js) - UI spinner sizes test

### **Assessment Scripts**
- [`week2_realistic_assessment.js`](./week2_realistic_assessment.js) - Week 2 progress assessment for QTIP refactoring
  - Tests core API endpoints (auth, users, forms, analytics)
  - Evaluates system health and performance metrics
  - Assesses progress against refactoring guide goals
  - Provides recommendations for next steps

### **Debug Utilities**
- [`debug_analytics.js`](./debug_analytics.js) - Analytics debugging utility

## 🚀 Running Tests

### **JavaScript Tests**
```bash
# Run individual test files
node tests/test_form_operations.js
node tests/test_analytics_service.js

# Run all JavaScript tests
for file in tests/test_*.js; do node "$file"; done
```

### **PowerShell Tests**
```powershell
# Run PowerShell test
.\tests\test_auth.ps1
```

### **CommonJS Tests**
```bash
# Run CommonJS test files
node tests/test_admin_dashboard.cjs
node tests/test_manager_dashboard.cjs
```

### **Assessment Scripts**
```bash
# Run Week 2 progress assessment (requires running server)
node tests/week2_realistic_assessment.js
```

## 📝 Test Categories

### **Unit Tests**
- Form operations
- Authentication
- Service functionality
- Component behavior

### **Integration Tests**
- Dashboard functionality
- Analytics services
- Phone system integration
- Cross-service communication

### **Debug Utilities**
- Analytics debugging
- Service debugging
- Performance monitoring

## 🔧 Test Environment Setup

### **Prerequisites**
- Node.js (for JavaScript tests)
- PowerShell (for PowerShell tests)
- Database connection (for integration tests)
- API endpoints (for service tests)

### **Environment Variables**
Most tests require the following environment variables:
- `API_BASE_URL` - Base URL for API endpoints
- `DATABASE_URL` - Database connection string
- `AUTH_TOKEN` - Authentication token for API calls

### **Test Data**
Tests may require specific test data in the database:
- Test users with different roles
- Sample forms and submissions
- Test analytics data
- Mock phone system data

## 📊 Test Results

### **Expected Outcomes**
- All authentication tests should pass
- Form operations should complete successfully
- Dashboard tests should load without errors
- Analytics tests should return expected data
- Service tests should connect successfully

### **Troubleshooting**
- Check database connectivity for integration tests
- Verify API endpoints are accessible
- Ensure test data is properly seeded
- Check authentication tokens are valid

## 🧹 Maintenance

### **Adding New Tests**
1. Create test file with descriptive name
2. Follow existing naming convention (`test_*.js`)
3. Add documentation to this README
4. Include proper error handling
5. Add cleanup procedures if needed

### **Updating Tests**
- Keep tests synchronized with code changes
- Update test data when schema changes
- Maintain test environment consistency
- Document any breaking changes

## 📋 Test Checklist

Before running tests, ensure:
- [ ] Database is accessible
- [ ] API endpoints are running
- [ ] Test data is seeded
- [ ] Authentication is working
- [ ] Environment variables are set
- [ ] Dependencies are installed

## 🔍 Debugging

### **Common Issues**
- **Authentication failures**: Check tokens and credentials
- **Database errors**: Verify connection strings
- **API timeouts**: Check endpoint availability
- **Data inconsistencies**: Verify test data setup

### **Debug Tools**
- Use `debug_analytics.js` for analytics debugging
- Check console logs for error details
- Verify network connectivity
- Test individual components

---

*This test suite ensures the reliability and functionality of the QTIP platform across all major components and integrations.*

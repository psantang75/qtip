# Comprehensive Site-Wide 401 Error Handling Implementation

## Overview
This document tracks the site-wide implementation of proper 401 (session timeout) error handling to prevent users from seeing generic error messages when their session expires.

## Status: IN PROGRESS

### Completed ✅
1. **Core Utility Created** - `frontend/src/utils/errorHandling.ts`
   - `handleErrorIfAuthentication()` - Centralized 401 detection
   - `isAuthenticationError()` - Check if error is 401
   - `isAuthenticationStatus()` - Check HTTP status
   - `handleAuthenticationFailure()` - Manual redirect for fetch() calls
   - `getErrorMessage()` - User-friendly error messages

2. **Already Updated Components**:
   - ✅ `frontend/src/components/QAManualAuditForm.tsx` (submit & save draft)
   - ✅ `frontend/src/components/QAManualReview.tsx` (submit)
   - ✅ `frontend/src/components/ManagerDisputeResolution.tsx` (dispute resolution)
   - ✅ `frontend/src/components/QASubmissionDetails.tsx` (dispute resolution with fetch())
   - ✅ `frontend/src/utils/submissionUtils.ts` (submit & save draft utilities)
   - ✅ `frontend/src/components/UserManagement.tsx` (4 catch blocks)
   - ✅ `frontend/src/components/DepartmentManagement.tsx` (6 catch blocks)

## Implementation Pattern

### Step 1: Add Import
```typescript
import { handleErrorIfAuthentication } from '../utils/errorHandling';
// OR for subdirectories:
import { handleErrorIfAuthentication } from '../../utils/errorHandling';
```

### Step 2: Update Catch Blocks (Axios/Service Calls)
**Before:**
```typescript
} catch (err: any) {
  console.error('Error:', err);
  setError('Failed to perform action. Please try again.');
}
```

**After:**
```typescript
} catch (err: any) {
  console.error('Error:', err);
  
  // Check for authentication errors (401) - let the axios interceptor handle redirect
  if (handleErrorIfAuthentication(err)) {
    return;
  }
  
  setError('Failed to perform action. Please try again.');
}
```

### Step 3: Update fetch() API Calls (Non-Axios)
**Before:**
```typescript
const response = await fetch(url, options);
if (!response.ok) {
  throw new Error('Request failed');
}
```

**After:**
```typescript
import { isAuthenticationStatus, handleAuthenticationFailure } from '../utils/errorHandling';

const response = await fetch(url, options);
if (!response.ok) {
  if (isAuthenticationStatus(response.status)) {
    handleAuthenticationFailure();
    return;
  }
  throw new Error('Request failed');
}
```

### Step 4: Remove Explicit 401 Handling
If a file has explicit 401 checks like:
```typescript
if (err.response && err.response.status === 401) {
  setError('Your session has expired. Please login again.');
}
```

**Remove these** and replace with `handleErrorIfAuthentication(err)`.

## Remaining Components to Update

### Admin Components (High Priority)
- [ ] `frontend/src/components/FormManagement.tsx`
- [ ] `frontend/src/components/FormList.tsx`
- [ ] `frontend/src/components/FormBuilder.tsx`
- [ ] `frontend/src/components/SinglePageFormBuilder.tsx`
- [ ] `frontend/src/components/FormPreviewScreen.tsx`
- [ ] `frontend/src/components/AdminDashboard.tsx`
- [ ] `frontend/src/components/admin/EnhancedPerformanceGoals.tsx`
- [ ] `frontend/src/components/admin/EnhancedPerformanceGoalForm.tsx`

### QA Components
- [ ] `frontend/src/components/QADashboard.tsx`
- [ ] `frontend/src/components/QAFormLibrary.tsx`
- [ ] `frontend/src/components/QAAssignedAuditsList.tsx`
- [ ] `frontend/src/components/QAAssignedReviews.tsx`
- [ ] `frontend/src/components/QAFormPreview.tsx`

### Manager Components
- [ ] `frontend/src/components/ManagerDashboard.tsx`
- [ ] `frontend/src/components/ManagerTeamAudits.tsx`
- [ ] `frontend/src/components/ManagerCoachingSessions.tsx`
- [ ] `frontend/src/components/ManagerTeamTraining.tsx`
- [ ] `frontend/src/components/ManagerTeamGoals.tsx`
- [ ] `frontend/src/components/ManagerPerformanceReports.tsx`
- [ ] `frontend/src/components/ManagerDisputes.tsx`
- [ ] `frontend/src/components/TrainerManagerCoaching.tsx`

### CSR Components
- [ ] `frontend/src/components/CSRDashboard.tsx`
- [ ] `frontend/src/components/CSRMyAudits.tsx`
- [ ] `frontend/src/components/CSRCoaching.tsx`
- [ ] `frontend/src/components/CSRTrainingDashboard.tsx`
- [ ] `frontend/src/components/CSRDisputeHistory.tsx`
- [ ] `frontend/src/components/CSRDisputeDetails.tsx`
- [ ] `frontend/src/components/CSRCourseViewer.tsx`
- [ ] `frontend/src/components/CSRCertificates.tsx`

### Trainer Components
- [ ] `frontend/src/components/TrainerDashboard.tsx`
- [ ] `frontend/src/components/TrainerAssignTraining.tsx`

### Shared/Common Components
- [ ] `frontend/src/components/ProfileSettings.tsx`
- [ ] `frontend/src/components/MultipleCallSelector.tsx`
- [ ] `frontend/src/components/common/CoachingSessionFormModal.tsx`
- [ ] `frontend/src/components/common/CoachingSessionDetailsModal.tsx`
- [ ] `frontend/src/components/ComprehensiveAnalytics.tsx`

### Form/Audit Components
- [ ] `frontend/src/components/AuditSubmissionForm.tsx`
- [ ] `frontend/src/components/AuditAssignmentsManagement.tsx`
- [ ] `frontend/src/components/AuditAssignment.tsx`
- [ ] `frontend/src/components/AuditAssignmentCreation.tsx`
- [ ] `frontend/src/components/DirectorAssignment.tsx`

### Course Components
- [ ] `frontend/src/components/course/SimpleCourseBuilder.tsx`

### Service Files (if they have error handling)
- [ ] Check all files in `frontend/src/services/` for error handling
- Most services use axios which has the interceptor, but check for any explicit 401 handling

## Quick Search Commands

### Find files with catch blocks:
```bash
grep -r "} catch" frontend/src/components --include="*.tsx" --include="*.ts"
```

### Find files with explicit 401 handling:
```bash
grep -r "status === 401" frontend/src/components --include="*.tsx" --include="*.ts"
```

### Find files with setError or setErrorMessage:
```bash
grep -r "setError\|setErrorMessage" frontend/src/components --include="*.tsx" --include="*.ts"
```

### Count remaining catch blocks:
```bash
grep -r "} catch" frontend/src/components --include="*.tsx" | wc -l
```

## Testing Checklist

After implementing, test these scenarios:

### Manual Testing
1. **Login** to the application
2. **Expire the token** (delete from DevTools localStorage or wait 8 hours)
3. **Try these actions** in each role:
   - Submit a form/review
   - Save a draft
   - Update user/department
   - Resolve a dispute
   - Update coaching session
   - Assign training
   - View reports/dashboards

4. **Expected Result**: Clean redirect to `/login` without error messages

### Automated Testing (Recommended)
Create integration tests for:
```typescript
describe('Session Timeout Handling', () => {
  it('should redirect to login on 401 without showing error message', async () => {
    // Set expired token
    // Attempt form submission
    // Verify redirect to /login
    // Verify no error message shown
  });
});
```

## Automation Script

A PowerShell script is available: `Update-ErrorHandlers.ps1`

**Usage:**
```powershell
.\Update-ErrorHandlers.ps1
```

**Note:** This script does basic pattern matching. Manual review is still recommended for:
- Complex error handling logic
- Nested catch blocks
- Custom error processing
- fetch() API calls (need different handling)

## Benefits of This Implementation

1. **Consistent UX**: Users always get redirected to login on session timeout
2. **No Confusing Messages**: Generic errors won't show before redirect
3. **Centralized Logic**: Easy to update behavior in one place
4. **Type-Safe**: TypeScript ensures correct usage
5. **Maintainable**: Clear pattern for all developers to follow

## Future Enhancements

1. **Proactive Session Warning**: Show modal 5-10 minutes before expiry
2. **Activity-Based Extension**: Auto-extend session on user activity
3. **Refresh Token Rotation**: Already supported, ensure it's being used
4. **Error Boundary Integration**: Catch 401s at component boundary level
5. **Service Worker**: Handle 401s for background requests

## Related Documentation

- [Session Timeout Fix Summary](./SESSION_TIMEOUT_FIX_SUMMARY.md)
- Backend JWT Configuration: `backend/src/config/environment.ts`
- Frontend Auth Service: `frontend/src/services/authService.ts`
- Auth Context: `frontend/src/contexts/AuthContext.tsx`

## Questions?

If you encounter:
- **Complex error handling**: Check if the component truly needs custom logic
- **fetch() instead of axios**: Use `isAuthenticationStatus()` and `handleAuthenticationFailure()`
- **Multiple error handlers in one catch**: Add the 401 check at the top, before other logic
- **Third-party integrations**: May need custom handling

## Progress Tracking

**Current Status**: 7 of ~50 files completed (14%)
**Target**: 100% coverage of user-facing components
**Timeline**: Complete within current sprint

**Last Updated**: November 5, 2025


/**
 * ProfileSettings Component
 * 
 * User profile settings interface with password change functionality.
 * 
 * FEATURES:
 * - Change password with validation
 * - Current password verification
 * - Password strength requirements
 * - Real-time validation with field-level error feedback
 * - Responsive design with mobile-first approach
 * - Accessibility support with ARIA labels
 * 
 * @version 1.0.0
 * @author QTIP Development Team
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import userService from '../services/userService';
import { useValidation } from '../hooks/useValidation';
import { FormField } from './forms/FormField';
import Button from './ui/Button';
import Card from './ui/Card';
import ErrorDisplay from './ui/ErrorDisplay';
import PageHeader from './ui/PageHeader';
import type { User } from '../services/userService';
import { handleErrorIfAuthentication } from '../utils/errorHandling';

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const ProfileSettings: React.FC = () => {
  const { user } = useAuth();
  const { forms } = useValidation();
  
  const [userDetails, setUserDetails] = useState<User | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);
  
  const [formData, setFormData] = useState<PasswordFormData>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Fetch user details with role and department names
  useEffect(() => {
    const fetchUserDetails = async () => {
      if (!user?.id) return;
      
      try {
        setIsLoadingDetails(true);
        const details = await userService.getUserById(user.id);
        setUserDetails(details);
      } catch (error: any) {
        if (handleErrorIfAuthentication(error)) {
          return;
        }
        console.error('Error fetching user details:', error);
        // Fallback to basic user info if API fails
        setUserDetails(user as User);
      } finally {
        setIsLoadingDetails(false);
      }
    };

    fetchUserDetails();
  }, [user]);

  const handleChange = (field: keyof PasswordFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    
    // Clear success message when user starts editing
    if (successMessage) {
      setSuccessMessage('');
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }
    
    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword = 'Password must be at least 8 characters';
    } else {
      // Check for uppercase letter
      if (!/[A-Z]/.test(formData.newPassword)) {
        newErrors.newPassword = 'Password must contain at least one uppercase letter';
      }
      // Check for lowercase letter
      else if (!/[a-z]/.test(formData.newPassword)) {
        newErrors.newPassword = 'Password must contain at least one lowercase letter';
      }
      // Check for number
      else if (!/[0-9]/.test(formData.newPassword)) {
        newErrors.newPassword = 'Password must contain at least one number';
      }
      // Check for special character
      else if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(formData.newPassword)) {
        newErrors.newPassword = 'Password must contain at least one special character';
      }
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords don't match";
    }
    
    if (formData.currentPassword && formData.newPassword && formData.currentPassword === formData.newPassword) {
      newErrors.newPassword = 'New password must be different from current password';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    setErrors({});
    setSuccessMessage('');
    
    try {
      await userService.changePassword(formData.currentPassword, formData.newPassword);
      
      // Success - clear form and show success message
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setSuccessMessage('Password changed successfully!');
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 5000);
    } catch (error: any) {
      console.error('Error changing password:', error);
      
      if (handleErrorIfAuthentication(error)) {
        return;
      }
      
      // Extract error message
      let errorMessage = 'Failed to change password. Please try again.';
      
      if (error?.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      // Check for specific error types and map to field errors
      if (errorMessage.toLowerCase().includes('current password')) {
        setErrors({ currentPassword: errorMessage });
      } else if (errorMessage.toLowerCase().includes('new password')) {
        setErrors({ newPassword: errorMessage });
      } else {
        setErrors({ general: errorMessage });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
    setErrors({});
    setSuccessMessage('');
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <PageHeader
        title="Profile Settings"
        description="Manage your account settings and security"
      />

      <div className="mt-8 space-y-8">
        {/* User Info Card */}
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Account Information</h2>
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Username</label>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Email</label>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Role</label>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Department</label>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-900 font-medium">{userDetails?.username || user?.username || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-900 font-medium">{userDetails?.email || user?.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-900 font-medium">
                    {isLoadingDetails ? 'Loading...' : (userDetails?.role_name || 'N/A')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-900 font-medium">
                    {isLoadingDetails ? 'Loading...' : (userDetails?.department_name || 'N/A')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Change Password Card */}
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Change Password</h2>
            
            {successMessage && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800">{successMessage}</p>
              </div>
            )}

            {errors.general && (
              <div className="mb-4">
                <ErrorDisplay message={errors.general} />
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <FormField
                label="Current Password"
                name="currentPassword"
                type="password"
                value={formData.currentPassword}
                onChange={(e) => handleChange('currentPassword', e.target.value)}
                error={errors.currentPassword}
                touched={!!errors.currentPassword}
                required
                placeholder="Enter your current password"
                autoComplete="current-password"
              />

              <FormField
                label="New Password"
                name="newPassword"
                type="password"
                value={formData.newPassword}
                onChange={(e) => handleChange('newPassword', e.target.value)}
                error={errors.newPassword}
                touched={!!errors.newPassword}
                required
                placeholder="Enter your new password"
                autoComplete="new-password"
                helpText="Password must be at least 8 characters with uppercase, lowercase, number, and special character"
              />

              <FormField
                label="Confirm New Password"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                error={errors.confirmPassword}
                touched={!!errors.confirmPassword}
                required
                placeholder="Confirm your new password"
                autoComplete="new-password"
              />

              <div className="flex gap-4 pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting}
                  className="flex-1 sm:flex-initial"
                >
                  {isSubmitting ? 'Changing Password...' : 'Change Password'}
                </Button>
                
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleReset}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </Card>

        {/* Security Tips */}
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Security Tips</h2>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                <span>Use a strong password with at least 8 characters including uppercase, lowercase, number, and special character</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                <span>Don't reuse passwords from other accounts</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                <span>Change your password regularly for better security</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                <span>Never share your password with anyone</span>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ProfileSettings;


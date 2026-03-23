import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Button from './Button';

export interface LogoutButtonProps {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  children?: React.ReactNode;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({
  variant = 'ghost',
  size = 'md',
  className = '',
  children = 'Logout'
}) => {
  const { logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    
    setIsLoggingOut(true);
    try {
      await logout();
      // The AuthContext will handle navigation to login page
    } catch (error) {
      console.error('Logout failed:', error);
      // Still continue with logout even if there's an error
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleLogout}
      disabled={isLoggingOut}
      className={className}
    >
      {isLoggingOut ? 'Logging out...' : children}
    </Button>
  );
};

export default LogoutButton; 
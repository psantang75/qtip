import React, { useEffect, useCallback } from 'react';

/**
 * Props for NavigationPrompt component
 */
interface NavigationPromptProps {
  /** Whether to show the prompt when navigating away */
  when: boolean;
  /** Message to display in the browser's confirmation dialog */
  message?: string;
  /** Optional callback when user attempts to leave */
  onAttemptNavigation?: () => void;
}

const NavigationPrompt: React.FC<NavigationPromptProps> = ({ 
  when, 
  message = "You have unsaved changes. Are you sure you want to leave?",
  onAttemptNavigation 
}) => {
  useEffect(() => {
    if (!when) return;

    // Handler for beforeunload event
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    // Add event listener for page unload
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Clean up
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [when, message]);

  return null; // This component doesn't render anything
};

export default NavigationPrompt; 
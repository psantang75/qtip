import React from 'react';

export interface StatusBadgeProps {
  status: string;
  variant?: 'audit' | 'training' | 'dispute' | 'certificate' | 'general';
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  status, 
  variant = 'general',
  className = '' 
}) => {
  const getStatusStyles = () => {
    const normalizedStatus = status.toUpperCase();
    
    switch (variant) {
      case 'audit':
        switch (normalizedStatus) {
          case 'DRAFT':
            return 'bg-gray-100 text-gray-800';
          case 'SUBMITTED':
            return 'bg-blue-100 text-blue-800';
          case 'DISPUTED':
            return 'bg-purple-100 text-purple-800';
          case 'FINALIZED':
            return 'bg-green-100 text-green-800';
          default:
            return 'bg-gray-100 text-gray-800';
        }
      
      case 'training':
        switch (normalizedStatus) {
          case 'COMPLETED':
            return 'bg-green-100 text-green-800';
          case 'IN PROGRESS':
            return 'bg-blue-100 text-blue-800';
          case 'OVERDUE':
            return 'bg-red-100 text-red-800';
          case 'NOT STARTED':
            return 'bg-gray-100 text-gray-800';
          default:
            return 'bg-gray-100 text-gray-800';
        }
      
      case 'dispute':
        switch (normalizedStatus) {
          case 'OPEN':
            return 'bg-yellow-100 text-yellow-800';
          case 'UPHELD':
            return 'bg-green-100 text-green-800';
          case 'REJECTED':
            return 'bg-red-100 text-red-800';
          case 'ADJUSTED':
            return 'bg-blue-100 text-blue-800';
          case 'RESOLVED':
            return 'bg-gray-100 text-gray-800';
          default:
            return 'bg-gray-100 text-gray-800';
        }
      
      case 'certificate':
        switch (normalizedStatus) {
          case 'VALID':
            return 'bg-green-100 text-green-800';
          case 'EXPIRED':
            return 'bg-red-100 text-red-800';
          default:
            return 'bg-green-100 text-green-800';
        }
      
      case 'general':
      default:
        // Generic status colors
        if (normalizedStatus.includes('SUCCESS') || normalizedStatus.includes('COMPLETE')) {
          return 'bg-green-100 text-green-800';
        } else if (normalizedStatus.includes('WARNING') || normalizedStatus.includes('PENDING')) {
          return 'bg-yellow-100 text-yellow-800';
        } else if (normalizedStatus.includes('ERROR') || normalizedStatus.includes('FAILED')) {
          return 'bg-red-100 text-red-800';
        } else if (normalizedStatus.includes('INFO') || normalizedStatus.includes('PROCESSING')) {
          return 'bg-blue-100 text-blue-800';
        } else {
          return 'bg-gray-100 text-gray-800';
        }
    }
  };

  const getDisplayText = () => {
    const normalizedStatus = status.toUpperCase();
    
    // Convert status to display-friendly format
    switch (normalizedStatus) {
      case 'IN PROGRESS':
        return 'In Progress';
      case 'NOT STARTED':
        return 'Not Started';
      default:
        // Capitalize first letter and lowercase the rest
        return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }
  };

  const colorClass = getStatusStyles();
  const displayText = getDisplayText();

  return (
    <span 
      className={`px-2 py-1 text-xs font-medium rounded-full ${colorClass} ${className}`}
      role="status"
      aria-label={`Status: ${displayText}`}
    >
      {displayText}
    </span>
  );
};

export default StatusBadge; 
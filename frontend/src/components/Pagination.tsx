import React from 'react';
import Button from './ui/Button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const Pagination: React.FC<PaginationProps> = ({ 
  currentPage, 
  totalPages, 
  onPageChange,
  className = '' 
}) => {
  // Don't render pagination if there's only one page
  if (totalPages <= 1) return null;
  
  // Generate page numbers array
  const pageNumbers = [];
  const maxPagesToShow = 5; // Show at most 5 page numbers
  
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
  
  // Adjust if we're near the end
  if (endPage - startPage + 1 < maxPagesToShow && startPage > 1) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }
  
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }
  
  return (
    <div className={`flex justify-center mt-4 ${className}`}>
      <div className="flex items-center gap-2">
        {/* Previous button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          &laquo;
        </Button>
        
        {/* First page if not in view */}
        {startPage > 1 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(1)}
              aria-label="Go to page 1"
            >
              1
            </Button>
            {startPage > 2 && (
              <span className="px-2 text-neutral-500" aria-hidden="true">
                ...
              </span>
            )}
          </>
        )}
        
        {/* Page numbers */}
        {pageNumbers.map(number => (
          <Button
            key={number}
            variant={currentPage === number ? "primary" : "ghost"}
            size="sm"
            onClick={() => onPageChange(number)}
            aria-label={`Go to page ${number}`}
            aria-current={currentPage === number ? "page" : undefined}
          >
            {number}
          </Button>
        ))}
        
        {/* Last page if not in view */}
        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && (
              <span className="px-2 text-neutral-500" aria-hidden="true">
                ...
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(totalPages)}
              aria-label={`Go to page ${totalPages}`}
            >
              {totalPages}
            </Button>
          </>
        )}
        
        {/* Next button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          &raquo;
        </Button>
      </div>
      
      {/* Screen reader info */}
      <div className="sr-only" aria-live="polite">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  );
};

export default Pagination; 
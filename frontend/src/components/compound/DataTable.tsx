// @ts-nocheck
import React, { useState, useMemo } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { cn } from '../../utils/cn';

export interface Column<T> {
  key: keyof T;
  header: string;
  sortable?: boolean;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  sortable?: boolean;
  pagination?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  // External pagination props
  externalPagination?: boolean;
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  // External sorting props
  externalSorting?: boolean;
  sortKey?: keyof T | null;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: (key: keyof T) => void;
}

type SortDirection = 'asc' | 'desc' | null;

function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchable = false,
  searchPlaceholder = 'Search...',
  sortable = true,
  pagination = true,
  pageSize = 10,
  pageSizeOptions = [10, 20, 50, 100],
  loading = false,
  emptyMessage = 'No data available',
  className,
  // External pagination props
  externalPagination = false,
  currentPage: externalCurrentPage = 1,
  totalPages: externalTotalPages = 1,
  totalItems: externalTotalItems,
  onPageChange,
  onPageSizeChange,
  // External sorting props
  externalSorting = false,
  sortKey: externalSortKey = null,
  sortDirection: externalSortDirection = null,
  onSort
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(pageSize);

  // Sync internal page size with prop changes (for persistent pagination)
  React.useEffect(() => {
    setInternalPageSize(pageSize);
  }, [pageSize]);

  // Use external or internal pagination state
  const currentPage = externalPagination ? externalCurrentPage : internalCurrentPage;
  const setCurrentPage = externalPagination ? (onPageChange || (() => {})) : setInternalCurrentPage;
  const currentPageSize = externalPagination ? pageSize : internalPageSize;

  // Filter data based on search (only for internal pagination)
  const filteredData = useMemo(() => {
    const safeData = data || []; // Safety check
    if (externalPagination || !search || !searchable) return safeData;

    return safeData.filter(row =>
      Object.values(row).some(value =>
        String(value).toLowerCase().includes(search.toLowerCase())
      )
    );
  }, [data, search, searchable, externalPagination]);

  // Sort data (only for internal pagination)
  const sortedData = useMemo(() => {
    const safeFilteredData = filteredData || []; // Safety check
    if (externalPagination || !sortKey || !sortDirection) return safeFilteredData;

    return [...safeFilteredData].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortDirection, externalPagination]);

  // Paginate data (only for internal pagination)
  const paginatedData = useMemo(() => {
    const safeData = data || []; // Safety check for external pagination
    const safeSortedData = sortedData || []; // Safety check for internal pagination
    
    if (externalPagination) return safeData; // For external pagination, use data as-is
    if (!pagination) return safeSortedData;

    const startIndex = (currentPage - 1) * currentPageSize;
    return safeSortedData.slice(startIndex, startIndex + currentPageSize);
  }, [sortedData, currentPage, currentPageSize, pagination, externalPagination, data]);

  // Calculate total pages and items
  const totalPages = externalPagination 
    ? externalTotalPages 
    : Math.ceil((sortedData || []).length / currentPageSize);
  
  const totalItems = externalPagination 
    ? externalTotalItems 
    : (sortedData || []).length;

  const handleSort = (key: keyof T) => {
    if (!sortable) return;
    
    // Use external sorting if available
    if (externalSorting && onSort) {
      onSort(key);
      return;
    }
    
    // Use internal sorting for non-external pagination
    if (externalPagination) return; // Disable internal sorting for external pagination

    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handlePageChange = (page: number) => {
    if (externalPagination && onPageChange) {
      onPageChange(page);
    } else {
      setInternalCurrentPage(page);
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    if (externalPagination) {
      // For external pagination, notify parent and let them handle the logic
      if (onPageSizeChange) {
        onPageSizeChange(newPageSize);
      }
      if (onPageChange) {
        onPageChange(1); // Reset to first page when page size changes
      }
    } else {
      // For internal pagination, handle it locally
      setInternalPageSize(newPageSize);
      setInternalCurrentPage(1); // Reset to first page when page size changes
      
      // Also notify parent if callback provided (for persistence)
      if (onPageSizeChange) {
        onPageSizeChange(newPageSize);
      }
    }
  };

  const SortIcon = ({ column }: { column: keyof T }) => {
    // Use external sorting state if available
    const currentSortKey = externalSorting ? externalSortKey : sortKey;
    const currentSortDirection = externalSorting ? externalSortDirection : sortDirection;
    
    if (currentSortKey !== column) {
      return (
        <svg className="w-5 h-5 text-gray-500 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }

    return currentSortDirection === 'asc' ? (
      <svg className="w-5 h-5 text-gray-700 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-5 h-5 text-gray-700 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Search Bar (only for internal pagination) */}
      {searchable && !externalPagination && (
        <div className="flex justify-between items-center">
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
          <div className="text-sm text-gray-600">
            {(sortedData || []).length} {(sortedData || []).length === 1 ? 'result' : 'results'}
          </div>
        </div>
      )}

      {/* Table - Always show table structure */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-700">
            <thead className="text-xs font-semibold uppercase bg-gray-100 border-b border-gray-200">
              <tr>
                {columns.map((column) => (
                  <th
                    key={`${String(column.key)}-${column.header}`}
                    className={cn(
                      "px-6 py-[13px] text-gray-800 font-bold",
                      sortable && (externalSorting || !externalPagination) && column.sortable !== false && 'cursor-pointer hover:bg-gray-200',
                      column.className
                    )}
                    onClick={() => sortable && (externalSorting || !externalPagination) && column.sortable !== false && handleSort(column.key)}
                  >
                    <div className="flex items-center">
                      <span>{column.header}</span>
                      {sortable && column.sortable !== false && <SortIcon column={column.key} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="bg-white">
                  <td colSpan={columns.length} className="px-6 py-16 text-center">
                    <div className="flex items-center justify-center">
                      <div className="w-10 h-10 border-4 border-gray-300 rounded-full animate-spin border-t-indigo-600"></div>
                    </div>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr className="bg-white">
                  <td colSpan={columns.length} className="px-6 py-16 text-center text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, index) => (
                  <tr key={index} className="bg-white border-b hover:bg-gray-50">
                    {columns.map((column) => (
                      <td key={`${String(column.key)}-${column.header}`} className={cn("px-6 py-[13px]", column.className)}>
                        {column.render ? column.render(row[column.key], row) : String(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && (externalPagination || totalPages > 1 || currentPageSize < (totalItems || (sortedData || []).length)) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              {externalPagination && totalItems ? (
                <>Showing {((currentPage - 1) * currentPageSize) + 1} to {Math.min(currentPage * currentPageSize, totalItems)} of {totalItems} results</>
              ) : (
                <>Showing {(currentPage - 1) * currentPageSize + 1} to {Math.min(currentPage * currentPageSize, (sortedData || []).length)} of {(sortedData || []).length} results</>
              )}
            </div>
            
            {/* Page Size Selector */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Show</span>
              <select
                value={currentPageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <span className="text-sm text-gray-600">per page</span>
            </div>
          </div>

          {(externalPagination || totalPages > 1) && (
            <div className="flex items-center space-x-2">
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                .map((page, index, array) => (
                  <React.Fragment key={page}>
                    {index > 0 && array[index - 1] !== page - 1 && (
                      <span className="px-2 text-gray-600">...</span>
                    )}
                    <Button
                      variant={currentPage === page ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                    >
                      {page}
                    </Button>
                  </React.Fragment>
                ))}
              
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => handlePageChange(Math.min(currentPage + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DataTable; 
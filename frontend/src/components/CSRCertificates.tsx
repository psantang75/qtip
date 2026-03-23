import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getCertificates } from '../services/csrTrainingService';
import type { Certificate, PaginatedCertificates } from '../types/csr.types';
import CSRCertificateView from './CSRCertificateView';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

interface FilterState {
  status: string;
  search: string;
  startDate: string;
  endDate: string;
}

const CSRCertificates: React.FC = () => {
  const { user } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  // Prevent duplicate fetches when React StrictMode double-invokes effects
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('CSRCertificates', 1, 10, user?.id);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'CSRCertificates',
    {
      status: '',
      search: '',
      startDate: '',
      endDate: ''
    },
    user?.id
  );

  // Load certificates
  const loadCertificates = async (page = 1, newPageSize = pageSize, newFilters = filters, force = false) => {
    try {
      setLoading(true);
      setError(null);
      const signature = JSON.stringify({
        page,
        pageSize: newPageSize,
        filters: newFilters
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }
      lastFetchSignatureRef.current = signature;

      const response: PaginatedCertificates = await getCertificates(page, newPageSize, newFilters);
      
      setCertificates(response.certificates);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalItems(response.total);
      setPageSize(response.pageSize);
    } catch (err) {
      console.error('Error loading certificates:', err);
      setError('Failed to load certificates. Please try again.');
      // Allow retry for the same signature after error
      lastFetchSignatureRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      loadCertificates(currentPage, pageSize, filters, force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, filters.status, filters.search]);

  // Use refs for pagination setters
  const setCurrentPageRef = React.useRef(setCurrentPage);
  const setPageSizeRef = React.useRef(setPageSize);
  
  React.useEffect(() => {
    setCurrentPageRef.current = setCurrentPage;
    setPageSizeRef.current = setPageSize;
  }, [setCurrentPage, setPageSize]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPageRef.current(page);
    loadCertificates(page, pageSize, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, filters.status, filters.search, loadCertificates]); // Use individual filter properties

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSizeRef.current(newPageSize);
    setCurrentPageRef.current(1);
    loadCertificates(1, newPageSize, filters, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.search, loadCertificates]); // Use individual filter properties
  
  const handleClearFilters = () => {
    // Set flag to force a fresh fetch after clearing
    isClearingRef.current = true;
    clearFilters();
    clearPagination();
  };

  const handleFilterChange = (newFilters: Record<string, any>) => {
    const filterState: FilterState = {
      status: newFilters.status || '',
      search: newFilters.search || '',
      startDate: newFilters.startDate || '',
      endDate: newFilters.endDate || ''
    };
    
    setFilters(filterState);
    setCurrentPage(1);
    loadCertificates(1, pageSize, filterState, true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const StatusBadge: React.FC<{ status?: string }> = ({ status = 'Valid' }) => {
    const styles = {
      'Valid': 'bg-green-100 text-green-800',
      'Expired': 'bg-red-100 text-red-800'
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || styles.Valid}`}>
        {status}
      </span>
    );
  };

  // Define columns for DataTable
  const columns: Column<Certificate>[] = [
    {
      key: 'courseName',
      header: 'Course Name',
      sortable: true,
      render: (value) => (
        <div className="text-sm font-medium text-gray-900">
          {value as string}
        </div>
      )
    },
    {
      key: 'issuedDate',
      header: 'Issued Date',
      sortable: true,
      render: (value) => (
        <span className="text-sm text-gray-500">
          {formatDate(value as string)}
        </span>
      )
    },
    {
      key: 'id',
      header: 'Certificate ID',
      render: (value) => (
        <span className="text-sm text-gray-500">
          CERT-{value}
        </span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (value, row) => <StatusBadge status={row.status} />
    },
    {
      key: 'certificateUrl' as keyof Certificate,
      header: 'Actions',
      sortable: false,
      render: (value, row) => (
        <div className="flex space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedCertificate(row);
              setIsViewModalOpen(true);
            }}
            className="text-blue-600 hover:text-blue-900"
          >
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // TODO: Implement PDF download
              alert(`Download certificate ${row.id} - This feature will be implemented next`);
            }}
            className="text-green-600 hover:text-green-900"
          >
            Download
          </Button>
        </div>
      )
    }
  ];

  // Define filter fields
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      search: filters.search,
      startDate: filters.startDate,
      endDate: filters.endDate
    };
  }, [
    filters.status,
    filters.search,
    filters.startDate,
    filters.endDate
  ]);

  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'Valid', label: 'Valid' },
        { value: 'Expired', label: 'Expired' }
      ]
    },
    {
      key: 'startDate',
      label: 'From Date',
      type: 'text',
      placeholder: 'YYYY-MM-DD'
    },
    {
      key: 'endDate',
      label: 'To Date',
      type: 'text',
      placeholder: 'YYYY-MM-DD'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by course name or certificate ID...'
    }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">My Certificates</h1>
        <p className="text-gray-600">
          View and download certificates for your completed training courses.
        </p>
      </div>

      {error && <ErrorDisplay message={error} />}

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClearFilters}
            aria-label="Clear all filters and reset pagination"
          >
            Clear Filters
          </Button>
        </div>
        <FilterPanel 
          fields={filterFields}
          onFilterChange={handleFilterChange}
          initialValues={filterPanelInitialValues}
        />
      </div>

      <DataTable
        columns={columns}
        data={certificates}
        loading={loading}
        externalPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
        emptyMessage={
          filters.search || filters.status || filters.startDate || filters.endDate
            ? 'No certificates found. Try adjusting your filters.'
            : 'No certificates yet. Complete training courses to earn certificates that will appear here.'
        }
      />

      {/* Certificate View Modal */}
      {selectedCertificate && (
        <CSRCertificateView
          certificate={selectedCertificate}
          isOpen={isViewModalOpen}
          onClose={() => {
            setIsViewModalOpen(false);
            setSelectedCertificate(null);
          }}
        />
      )}
    </div>
  );
};

export default CSRCertificates; 
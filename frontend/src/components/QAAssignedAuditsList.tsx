import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import submissionService from '../services/submissionService';
import type { AssignedAudit } from '../services/submissionService';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

interface FilterState {
  csrId: string;
  departmentId: string;
  formId: string;
  search: string;
}

const QAAssignedAuditsList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [audits, setAudits] = useState<AssignedAudit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef<Promise<void> | null>(null);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('QAAssignedAuditsList', 1, 10, user?.id);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'QAAssignedAuditsList',
    {
      csrId: '',
      departmentId: '',
      formId: '',
      search: ''
    },
    user?.id
  );
  
  // Mock data for dropdowns
  const [csrs, setCsrs] = useState([
    { id: 1, name: 'John Doe' },
    { id: 2, name: 'Jane Smith' },
    { id: 3, name: 'Robert Johnson' }
  ]);
  
  const [departments, setDepartments] = useState([
    { id: 1, name: 'Sales' },
    { id: 2, name: 'Customer Support' },
    { id: 3, name: 'Technical Support' }
  ]);
  
  const [forms, setForms] = useState([
    { id: 1, name: 'Customer Service Evaluation' },
    { id: 2, name: 'Technical Support Assessment' },
    { id: 3, name: 'Call Quality Review' }
  ]);
  
  // Fetch assigned audits
  const fetchAssignedAudits = useCallback(async (force = false) => {
    // Coalesce overlapping identical requests
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (!force) return;
    }

    try {
      setLoading(true);
      setError(null);

      const signatureParams = {
        page: currentPage,
        pageSize,
        filters
      };

      const orderedParams = Object.keys(signatureParams)
        .sort()
        .reduce<Record<string, any>>((acc, key) => {
          acc[key] = (signatureParams as any)[key];
          return acc;
        }, {});

      const signature = JSON.stringify({
        endpoint: '/qa/assigned-audits',
        params: orderedParams
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }

      lastFetchSignatureRef.current = signature;

      const requestPromise = (async () => {
        const response = await submissionService.getAssignedAudits(currentPage, pageSize);
        
        setAudits(response.data);
        setTotalPages(response.pagination.totalPages);
        setTotalItems(response.pagination.total);
      })();

      inFlightRef.current = requestPromise;
      await requestPromise;
    } catch (err) {
      console.error('Error fetching assigned audits:', err);
      setError('Failed to load assigned audits. Please try again.');
      lastFetchSignatureRef.current = null; // allow retry
    } finally {
      setLoading(false);
      inFlightRef.current = null;
    }
  }, [currentPage, pageSize, filters]);
  
  // Effects
  // Use individual filter properties to avoid infinite loops from object reference changes
  const isClearingRef = React.useRef<boolean>(false);
  
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchAssignedAudits(force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, filters.csrId, filters.departmentId, filters.formId, filters.search]);
  
  // Handlers
  // Use refs for pagination setters
  const setCurrentPageRef = React.useRef(setCurrentPage);
  const setPageSizeRef = React.useRef(setPageSize);
  
  React.useEffect(() => {
    setCurrentPageRef.current = setCurrentPage;
    setPageSizeRef.current = setPageSize;
  }, [setCurrentPage, setPageSize]);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPageRef.current(newPage);
  }, []); // Empty deps - uses ref

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSizeRef.current(newPageSize);
    setCurrentPageRef.current(1);
  }, []); // Empty deps - uses refs

  const handleFilterChange = (newFilters: Record<string, any>) => {
    setFilters(newFilters as FilterState);
    setCurrentPage(1);
  };
  
  const handleStartAudit = (audit: AssignedAudit) => {
    navigate(`/qa/assigned-reviews/${audit.call_id}?formId=${audit.form_id}`);
  };
  
  // Format duration from seconds to MM:SS
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  // Format date string to a more readable format
  const formatDate = (dateString: string): string => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  // Define table columns
  const columns: Column<AssignedAudit>[] = [
    {
      key: 'call_external_id',
      header: 'Call ID',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">{audit.call_external_id}</span>
      )
    },
    {
      key: 'csr_name',
      header: 'CSR',
      sortable: true
    },
    {
      key: 'department_name',
      header: 'Department',
      sortable: true,
      render: (value, audit) => audit.department_name || 'N/A'
    },
    {
      key: 'form_name',
      header: 'Form',
      sortable: true
    },
    {
      key: 'call_date',
      header: 'Call Date',
      sortable: true,
      render: (value, audit) => formatDate(audit.call_date)
    },
    {
      key: 'call_duration',
      header: 'Duration',
      sortable: true,
      render: (value, audit) => formatDuration(audit.call_duration)
    },
    {
      key: 'assignment_id',
      header: 'Action',
      sortable: false,
      render: (value, audit) => (
        <Button
          variant="primary"
          size="sm" 
          onClick={() => handleStartAudit(audit)}
        >
          Start Audit
        </Button>
      )
    }
  ];

  // Define filter fields
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      csrId: filters.csrId,
      departmentId: filters.departmentId,
      formId: filters.formId,
      search: filters.search
    };
  }, [
    filters.csrId,
    filters.departmentId,
    filters.formId,
    filters.search
  ]);

  const filterFields: FilterField[] = [
    {
      key: 'csrId',
      label: 'CSR',
      type: 'select',
      options: [
        { value: '', label: 'All CSRs' },
        ...csrs.map(csr => ({ value: csr.id.toString(), label: csr.name }))
      ]
    },
    {
      key: 'departmentId',
      label: 'Department',
      type: 'select',
      options: [
        { value: '', label: 'All Departments' },
        ...departments.map(dept => ({ value: dept.id.toString(), label: dept.name }))
      ]
    },
    {
      key: 'formId',
      label: 'Form',
      type: 'select',
      options: [
        { value: '', label: 'All Forms' },
        ...forms.map(form => ({ value: form.id.toString(), label: form.name }))
      ]
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by CSR name, call ID, or form name...'
    }
  ];

  return (
    <div className="container p-6 mx-auto relative">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900">Assigned Audits</h1>
        <p className="mt-2 text-neutral-700">
          Review and complete your assigned audits
        </p>
      </div>
      
      {error && <ErrorDisplay message={error} />}

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              isClearingRef.current = true;
              clearFilters();
              clearPagination();
            }}
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
        data={audits}
        loading={loading}
        emptyMessage="No assigned audits found."
        externalPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
      />
    </div>
  );
};

export default QAAssignedAuditsList; 
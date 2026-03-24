import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Search } from 'lucide-react';
import managerService from '../services/managerService';
import type { 
  Dispute,
  PaginatedDisputes,
  DisputeFilters,
  CSROption,
  FormOption 
} from '../types/manager.types';
import { getScoreColorClass } from '../utils/scoreUtils';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

const ManagerDisputes: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Simple debounce ref - global deduplication handles the rest
  const fetchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage } = usePersistentPagination('ManagerDisputes', 1, 10, user?.id);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDisputes, setTotalDisputes] = useState(0);
  
  // Filter states - matching team audits structure (search not persisted)
  const [searchTerm, setSearchTerm] = useState('');
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<DisputeFilters>(
    'ManagerDisputes',
    {
      csr_id: '',
      form_id: '',
      status: 'OPEN',
      startDate: '',
      endDate: '',
    },
    user?.id
  );

  // Options for filters
  const [csrOptions, setCsrOptions] = useState<CSROption[]>([]);
  const [formOptions, setFormOptions] = useState<FormOption[]>([]);

  const ITEMS_PER_PAGE = 10;

  // Fetch filter options on component mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Track last fetch to prevent unnecessary calls
  const lastFetchRef = React.useRef<string>('');

  // Fetch disputes when filters change - SIMPLIFIED: rely on global deduplication
  useEffect(() => {
    // Build params signature
    const paramsKey = JSON.stringify({
      page: currentPage,
      search: searchTerm || '',
      csr_id: filters.csr_id || '',
      form_id: filters.form_id || '',
      status: filters.status || '',
      startDate: filters.startDate || '',
      endDate: filters.endDate || ''
    });

    // Skip if params haven't changed
    if (lastFetchRef.current === paramsKey) {
      console.log('[ManagerDisputes] Skipping fetch - params unchanged', paramsKey);
      return;
    }

    lastFetchRef.current = paramsKey;

    // Clear any pending timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    console.log('[ManagerDisputes] Scheduling fetch with params:', paramsKey);

    // Debounce to batch rapid state updates
    fetchTimeoutRef.current = setTimeout(() => {
      console.log('[ManagerDisputes] Executing fetch');
      fetchDisputes(currentPage);
    }, 300);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchTerm, filters.csr_id, filters.form_id, filters.status, filters.startDate, filters.endDate]);

  const fetchFilterOptions = async () => {
    try {
      const [csrResponse, formsResponse] = await Promise.all([
        managerService.getTeamCSRs(),
        managerService.getForms()
      ]);
      
      setCsrOptions(csrResponse.data);
      setFormOptions(formsResponse);
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchDisputes = React.useCallback(async (page = 1) => {
    // Build params
    const params = {
      page,
      limit: ITEMS_PER_PAGE,
      search: searchTerm || '',
      csr_id: filters.csr_id || '',
      form_id: filters.form_id || '',
      status: filters.status || '',
      startDate: filters.startDate || '',
      endDate: filters.endDate || ''
    };

    setIsLoading(true);
    setError(null);

    try {
      const data = await managerService.getTeamDisputes(params);
      setDisputes(data.disputes);
      // Only update currentPage if it actually changed to avoid triggering useEffect
      if (data.page !== page) {
        setCurrentPage(data.page);
      }
      setTotalPages(data.totalPages);
      setTotalDisputes(data.total);
    } catch (err) {
      console.error('Error fetching disputes:', err);
      setError('Failed to fetch team disputes');
    } finally {
      setIsLoading(false);
    }
  }, [
    filters.csr_id,
    filters.endDate,
    filters.form_id,
    filters.startDate,
    filters.status,
    searchTerm,
    setCurrentPage
  ]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when searching
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setCurrentPage(1); // Reset to first page on filter change
  };

  const handleClearFilters = () => {
    console.log('[ManagerDisputes] Clearing filters');
    
    // Clear any pending timeouts first
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }
    
    // Reset last fetch ref to allow new fetch after clearing
    lastFetchRef.current = '';
    
    // Clear all filters and state
    clearFilters();
    setSearchTerm('');
    setCurrentPage(1);
    
    // The useEffect will trigger automatically when state changes
    // Global deduplication will prevent duplicate requests
  };

  const handleViewDispute = (submissionId: number) => {
    navigate(`/manager/team-audits/${submissionId}`);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'bg-red-100 text-red-800';
      case 'ADJUSTED':
        return 'bg-green-100 text-green-800';
      case 'UPHELD':
        return 'bg-blue-100 text-blue-800';
      case 'REJECTED':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading && disputes.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin h-12 w-12 text-[#00aeef]">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-2">Team Dispute Management</h1>
        <p className="text-neutral-600">Review and resolve disputes submitted by your team members</p>
      </div>

      {error && (
        <div className="p-4 mb-6 text-red-700 bg-red-100 rounded-md">
          {error}
          <button 
            className="float-right font-bold" 
            onClick={() => setError('')}
            aria-label="Close error message"
          >
            &times;
          </button>
        </div>
      )}

      {/* Search and Filters - Matching ManagerTeamAudits structure */}
      <div className="mb-6 bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-medium text-gray-700 mb-1">CSR</label>
            <select
              name="csr_id"
              value={filters.csr_id}
              onChange={handleFilterChange}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All CSRs</option>
              {csrOptions.map((csr) => (
                <option key={csr.id} value={csr.id}>
                  {csr.username}
                </option>
              ))}
            </select>
          </div>
          
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Form</label>
            <select
              name="form_id"
              value={filters.form_id}
              onChange={handleFilterChange}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All Forms</option>
              {formOptions.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.form_name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full md:w-1/3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="UPHELD">Upheld</option>
              <option value="REJECTED">Rejected</option>
              <option value="ADJUSTED">Adjusted</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mt-4">
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search by CSR name or dispute ID..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="w-full pl-10 pr-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          
          <div className="w-full md:w-1/2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <div className="flex gap-2">
              <input
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={handleFilterChange}
                className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <span className="self-center">to</span>
              <input
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={handleFilterChange}
                className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          
          <div className="w-full md:w-1/6 flex items-end">
            <button 
              onClick={handleClearFilters}
              className="px-4 py-[9px] bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 ml-auto"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Disputes Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CSR & Form
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Scores
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {disputes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    {isLoading ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin h-6 w-6 text-[#00aeef] mr-3">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        </div>
                        Loading disputes...
                      </div>
                    ) : (
                      "No disputes found"
                    )}
                  </td>
                </tr>
              ) : (
                disputes.map((dispute) => (
                  <tr key={dispute.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {dispute.csr_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {dispute.form_name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="text-gray-500">Current:</span>{' '}
                          <span className={`font-medium ${getScoreColorClass(dispute.total_score, 'text')}`}>
                            {dispute.total_score}%
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Previous:</span>{' '}
                          <span className="font-medium text-gray-900">
                            {dispute.previous_score != null ? `${dispute.previous_score}%` : '-'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(dispute.status)}`}>
                        {dispute.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(dispute.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs truncate">
                        {dispute.reason}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleViewDispute(dispute.submission_id)}
                        className="flex items-center text-blue-600 hover:text-blue-900"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View & Resolve
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium">{Math.min((currentPage - 1) * 10 + 1, totalDisputes)}</span> to{' '}
                  <span className="font-medium">{Math.min(currentPage * 10, totalDisputes)}</span> of{' '}
                  <span className="font-medium">{totalDisputes}</span> disputes
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManagerDisputes; 
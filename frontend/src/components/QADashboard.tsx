// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import qaService from '../services/qaService';
import Card from './ui/Card';
import Button from './ui/Button';
import DataTable, { Column } from './compound/DataTable';
import { cn } from '../utils/cn';

// Updated interfaces for the QA dashboard structure (same as admin but without coaching sessions)
interface WeeklyMonthlyStats {
  thisWeek: number;
  thisMonth: number;
}

interface QACSRActivityData {
  id: number;
  name: string;
  department: string;
  audits: number;
  disputes: number;
  audits_week: number;
  disputes_week: number;
  audits_month: number;
  disputes_month: number;
}

interface QANewDashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
  csrActivity: QACSRActivityData[];
}

type ViewPeriod = 'week' | 'month';

const QADashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<QANewDashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('week');
  // Prevent duplicate fetches (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  
  // Persistent page size for CSR activity table
  const [pageSize, setPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_QADashboard`,
    10
  );
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Filter CSR activity data based on search term and time period
  const filteredCSRActivity = stats?.csrActivity.map(csr => {
    // Apply time period filtering to the data
    let audits = csr.audits;
    let disputes = csr.disputes;
    
    if (viewPeriod === 'week') {
      audits = csr.audits_week;
      disputes = csr.disputes_week;
    } else if (viewPeriod === 'month') {
      audits = csr.audits_month;
      disputes = csr.disputes_month;
    }
    
    return {
      ...csr,
      audits,
      disputes
    };
  }).filter(csr =>
    csr.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    csr.department.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Calculate summary stats for both periods (independent of filter selection)
  const summaryStats = {
    reviewsCompleted: {
      thisWeek: stats?.csrActivity.reduce((sum, csr) => sum + csr.audits_week, 0) || 0,
      thisMonth: stats?.csrActivity.reduce((sum, csr) => sum + csr.audits_month, 0) || 0
    },
    disputes: {
      thisWeek: stats?.csrActivity.reduce((sum, csr) => sum + csr.disputes_week, 0) || 0,
      thisMonth: stats?.csrActivity.reduce((sum, csr) => sum + csr.disputes_month, 0) || 0
    }
  };

  // Define columns for CSR Activity DataTable (without coaching columns)
  const csrActivityColumns: Column<QACSRActivityData>[] = [
    {
      key: 'name',
      header: 'CSR Name',
      sortable: true,
      render: (value) => (
        <span className="font-medium text-gray-900">{value as string}</span>
      )
    },
    {
      key: 'department',
      header: 'Department',
      sortable: true,
      render: (value) => (
        <span className="text-gray-700">{value as string}</span>
      )
    },
    {
      key: 'audits',
      header: 'Total Reviews',
      sortable: true,
      render: (value) => (
        <span className="font-semibold text-neutral-900">{value as number}</span>
      )
    },
    {
      key: 'disputes',
      header: 'Disputes',
      sortable: true,
      render: (value) => (
        <span className="font-semibold text-neutral-900">{value as number}</span>
      )
    }
  ];

  const fetchDashboardData = useCallback(async (retryCount = 0, force = false) => {
    const maxRetries = 3;
    setIsLoading(true);

    const signature = 'qa-dashboard';
    if (!force && retryCount === 0 && lastFetchSignatureRef.current === signature) {
      setIsLoading(false);
      return;
    }
    if (retryCount === 0) {
      lastFetchSignatureRef.current = signature;
    }
    
    try {
      // Fetch dashboard stats and CSR activity data in parallel
      const [dashboardStats, csrActivity] = await Promise.all([
        qaService.getDashboardStats(),
        qaService.getCSRActivity()
      ]);
      
      // Combine the data into the expected format
      const combinedStats: QANewDashboardStats = {
        reviewsCompleted: dashboardStats.reviewsCompleted,
        disputes: dashboardStats.disputes,
        csrActivity: csrActivity
      };
      
      setStats(combinedStats);
      setError(null);
    } catch (err: any) {
      if (retryCount < maxRetries && err?.response?.status >= 500) {
        // Retry on server errors with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        setTimeout(() => {
          fetchDashboardData(retryCount + 1);
        }, delay);
        return;
      }
      
      // Handle different error types
      let errorMessage = 'Failed to load dashboard data. Please try again later.';
      
      if (err?.response?.status === 401) {
        errorMessage = 'Authentication expired. Please log in again.';
      } else if (err?.response?.status === 403) {
        errorMessage = 'Access denied. You may not have QA permissions.';
      } else if (err?.response?.status === 429) {
        errorMessage = 'Too many requests. Please wait a moment before refreshing.';
      } else if (!navigator.onLine) {
        errorMessage = 'Network connection lost. Please check your internet connection.';
      }
      
      setError(errorMessage);
      setStats(null);
      // Allow retry for the same signature after error
      lastFetchSignatureRef.current = null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const refreshData = () => {
    fetchDashboardData(0, true);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-400"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-neutral-900">QA Dashboard</h1>
        <Button 
          variant="secondary"
          onClick={refreshData}
          size="sm"
        >
          Refresh
        </Button>
      </div>
      
      {error && (
        <Card variant="bordered" className="mb-6 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
          <Button 
            variant="primary"
            onClick={refreshData}
            size="sm"
            className="mt-3"
          >
            Try Again
          </Button>
        </Card>
      )}
      
      {/* Top Statistics Cards - Match Admin's 3-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {/* Reviews Completed */}
        <Card variant="bordered" hover>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">Reviews Completed</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Week</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.reviewsCompleted.thisWeek}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Month</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.reviewsCompleted.thisMonth}</span>
            </div>
          </div>
        </Card>
        
        {/* Total Disputes */}
        <Card variant="bordered" hover>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">Total Disputes</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Week</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.disputes.thisWeek}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Month</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.disputes.thisMonth}</span>
            </div>
          </div>
        </Card>

        {/* Empty third card to maintain 3-column layout like Admin */}
        <Card variant="bordered" hover>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">My Activity</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">Reviews This Week</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.reviewsCompleted.thisWeek}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">Disputes This Week</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.disputes.thisWeek}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* CSR Activity Section - Match Admin's layout structure exactly */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-neutral-900">CSR Activity</h2>
        </div>
        
        {/* Custom search and period selector - using improved QA style for both */}
        <div className="mb-4 flex justify-between items-center">
          <input
            type="text"
            placeholder="Search CSR..."
            className="max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00aeef] focus:border-transparent"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="flex bg-gray-100 rounded-md p-1">
            <button
              onClick={() => setViewPeriod('week')}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded transition-colors',
                viewPeriod === 'week'
                  ? 'bg-white text-[#00aeef] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              This Week
            </button>
            <button
              onClick={() => setViewPeriod('month')}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded transition-colors',
                viewPeriod === 'month'
                  ? 'bg-white text-[#00aeef] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              This Month
            </button>
          </div>
        </div>
        
        {/* CSR Activity DataTable - Match Admin's structure */}
        {stats?.csrActivity && (
          <DataTable
            columns={csrActivityColumns}
            data={filteredCSRActivity}
            loading={isLoading}
            emptyMessage="No CSR activity data available for your reviews"
            pagination={true}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
};

export default QADashboard; 
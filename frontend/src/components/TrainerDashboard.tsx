import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import trainerService, { 
  WeeklyMonthlyStats, 
  TrainerCSRActivityData,
  TrainerDashboardStats 
} from '../services/trainerService';
import Card from './ui/Card';
import Button from './ui/Button';
import DataTable, { Column } from './compound/DataTable';
import { cn } from '../utils/cn';

// Updated interfaces for the new dashboard structure
interface NewDashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
  coachingSessions: WeeklyMonthlyStats;
  csrActivity: TrainerCSRActivityData[];
}

type ViewPeriod = 'week' | 'month';

const TrainerDashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<NewDashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('week');
  // Prevent duplicate fetches (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  
  // Persistent page size for CSR activity table
  const [pageSize, setPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_TrainerDashboard`,
    10
  );
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Filter CSR activity data based on search term and time period
  const filteredCSRActivity = stats?.csrActivity.map(csr => {
    // Apply time period filtering to the data
    let audits = csr.audits;
    let disputes = csr.disputes;
    let coachingScheduled = csr.coachingScheduled;
    let coachingCompleted = csr.coachingCompleted;
    
    if (viewPeriod === 'week') {
      audits = csr.audits_week;
      disputes = csr.disputes_week;
      coachingScheduled = csr.coachingScheduled_week;
      coachingCompleted = csr.coachingCompleted_week;
    } else if (viewPeriod === 'month') {
      audits = csr.audits_month;
      disputes = csr.disputes_month;
      coachingScheduled = csr.coachingScheduled_month;
      coachingCompleted = csr.coachingCompleted_month;
    }
    
    return {
      ...csr,
      audits,
      disputes,
      coachingScheduled,
      coachingCompleted
    };
  }).filter(csr =>
    csr.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    csr.department.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Use summary stats directly from dashboard stats (same as admin dashboard)
  // The getDashboardStats() already provides the correct totals using the same queries as admin
  const summaryStats = {
    reviewsCompleted: {
      thisWeek: stats?.reviewsCompleted?.thisWeek || 0,
      thisMonth: stats?.reviewsCompleted?.thisMonth || 0
    },
    disputes: {
      thisWeek: stats?.disputes?.thisWeek || 0,
      thisMonth: stats?.disputes?.thisMonth || 0
    },
    coachingSessions: {
      thisWeek: stats?.coachingSessions?.thisWeek || 0,
      thisMonth: stats?.coachingSessions?.thisMonth || 0
    }
  };

  // Define columns for CSR Activity DataTable
  const csrActivityColumns: Column<TrainerCSRActivityData>[] = [
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
    },
    {
      key: 'coachingScheduled',
      header: 'Coaching Scheduled',
      sortable: true,
      render: (value) => (
        <span className="font-semibold text-neutral-900">{value as number}</span>
      )
    },
    {
      key: 'coachingCompleted',
      header: 'Coaching Completed',
      sortable: true,
      render: (value) => (
        <span className="font-semibold text-neutral-900">{value as number}</span>
      )
    }
  ];

  const fetchDashboardData = useCallback(async (force = false) => {
    setIsLoading(true);
    setError(null);

    const signature = 'trainer-dashboard';
    if (!force && lastFetchSignatureRef.current === signature) {
      setIsLoading(false);
      return;
    }
    lastFetchSignatureRef.current = signature;
    
    try {
      // Fetch dashboard stats and CSR activity data in parallel using trainer service
      const [dashboardStats, csrActivity] = await Promise.all([
        trainerService.getDashboardStats(),
        trainerService.getCSRActivity()
      ]);
      
      // Combine the data into the expected format
      const combinedStats: NewDashboardStats = {
        reviewsCompleted: dashboardStats.reviewsCompleted || { thisWeek: 0, thisMonth: 0 },
        disputes: dashboardStats.disputes || { thisWeek: 0, thisMonth: 0 },
        coachingSessions: dashboardStats.coachingSessions || { thisWeek: 0, thisMonth: 0 },
        csrActivity: Array.isArray(csrActivity) ? csrActivity : []
      };
      
      setStats(combinedStats);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data. Please try again later.');
      
      // Don't set fallback mock data - let the user see the error and try refresh
      setStats(null);
      lastFetchSignatureRef.current = null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const refreshData = () => {
    fetchDashboardData(true);
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
        <h1 className="text-2xl font-bold text-neutral-900">Trainer Dashboard</h1>
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
      
      {/* Top Statistics Cards */}
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
        
        {/* Coaching Sessions */}
        <Card variant="bordered" hover>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">Coaching Sessions</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Week</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.coachingSessions.thisWeek}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-700">This Month</span>
              <span className="text-2xl font-bold text-neutral-900">{summaryStats.coachingSessions.thisMonth}</span>
            </div>
          </div>
        </Card>
      </div>
      
      {/* CSR Activity Section */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-neutral-900">CSR Activity</h2>
        </div>
        
        {/* Custom search and period selector - using improved QA style */}
        <div className="mb-4 flex justify-between items-center">
          <input
            type="text"
            placeholder="Search CSR..."
            className="max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue focus:border-transparent"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="flex bg-gray-100 rounded-md p-1">
            <button
              onClick={() => setViewPeriod('week')}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded transition-colors',
                viewPeriod === 'week'
                  ? 'bg-white text-primary-blue shadow-sm'
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
                  ? 'bg-white text-primary-blue shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              This Month
            </button>
          </div>
        </div>
        
        {/* CSR Activity DataTable */}
        {stats?.csrActivity && (
          <DataTable
            columns={csrActivityColumns}
            data={filteredCSRActivity}
            loading={isLoading}
            emptyMessage="No CSR activity data available"
            pagination={true}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
};

export default TrainerDashboard; 
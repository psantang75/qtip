import React, { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Link } from 'react-router-dom';
import {
  HiOutlineChartBar,
  HiOutlineAcademicCap,
  HiExclamationTriangle,
  HiOutlineChatBubbleLeft,
  HiOutlineEye,
  HiArrowPath
} from 'react-icons/hi2';
import managerService from '../services/managerService';
import type { 
  ManagerStats, 
  TeamAudit, 
  TeamTraining,
  PaginatedAudits,
  PaginatedTraining 
} from '../types/manager.types';
import DataTable, { Column } from './compound/DataTable';
import ErrorDisplay from './ui/ErrorDisplay';
import { useAuth } from '../contexts/AuthContext';
import Card from './ui/Card';
import Button from './ui/Button';
import { cn } from '../utils/cn';
import type { WeeklyMonthlyStats, CSRActivityData, NewDashboardStats } from '../services/managerService';

// Types for the manager dashboard (same as admin but for managers)
type ViewPeriod = 'week' | 'month';

const ManagerDashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<NewDashboardStats | null>(null);
  const [csrActivity, setCSRActivity] = useState<CSRActivityData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Prevent duplicate fetches (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  
  // Persistent page size for CSR activity table
  const [pageSize, setPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_ManagerDashboard`,
    10
  );
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('week');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Filter CSR activity data based on search term and time period
  const filteredCSRActivity = csrActivity.map(csr => {
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
  );

  // Calculate summary stats for both periods (independent of filter selection)
  const summaryStats = {
    reviewsCompleted: {
      thisWeek: csrActivity.reduce((sum, csr) => sum + csr.audits_week, 0),
      thisMonth: csrActivity.reduce((sum, csr) => sum + csr.audits_month, 0)
    },
    disputes: {
      thisWeek: csrActivity.reduce((sum, csr) => sum + csr.disputes_week, 0),
      thisMonth: csrActivity.reduce((sum, csr) => sum + csr.disputes_month, 0)
    },
    coachingSessions: {
      thisWeek: csrActivity.reduce((sum, csr) => sum + csr.coachingScheduled_week + csr.coachingCompleted_week, 0),
      thisMonth: csrActivity.reduce((sum, csr) => sum + csr.coachingScheduled_month + csr.coachingCompleted_month, 0)
    }
  };

  // Define columns for CSR Activity DataTable
  const csrActivityColumns: Column<CSRActivityData>[] = [
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

    const signature = 'manager-dashboard';
    if (!force && lastFetchSignatureRef.current === signature) {
      setIsLoading(false);
      return;
    }
    lastFetchSignatureRef.current = signature;
    
    try {
      // Fetch dashboard stats and CSR activity data in parallel
      const [dashboardStats, csrActivityData] = await Promise.all([
        managerService.getDashboardStats(),
        managerService.getCSRActivity()
      ]);
      
      setStats(dashboardStats);
      setCSRActivity(csrActivityData);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching manager dashboard data:', err);
      setError('Failed to load dashboard data. Please try again later.');
      
      // Reset data on error and allow retry for the same signature
      setStats(null);
      setCSRActivity([]);
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
        <h1 className="text-2xl font-bold text-neutral-900">Manager Dashboard</h1>
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
          <h2 className="text-xl font-semibold text-neutral-900">Team CSR Activity</h2>
        </div>
        
        {/* Custom search and period selector */}
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
        {csrActivity.length > 0 && (
          <DataTable
            columns={csrActivityColumns}
            data={filteredCSRActivity}
            loading={isLoading}
            emptyMessage="No team CSR activity data available"
            pagination={true}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
};

export default ManagerDashboard; 
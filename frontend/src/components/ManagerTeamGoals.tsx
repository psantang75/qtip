import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { 
  HiOutlineChartBar, 
  HiOutlineAcademicCap, 
  HiExclamationTriangle,
  HiOutlineDocumentArrowDown,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiArrowPath,
  HiOutlineUsers
} from 'react-icons/hi2';
import teamReportsService from '../services/teamReportsService';
import type { 
  ManagerReportFilters, 
  ManagerReportData, 
  FilterOptions,
  QAScoreData,
  TrainingCompletionData,
  DisputeTrendData
} from '../types/performance.types';
import { usePersistentFilters } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

const ManagerTeamGoals: React.FC = () => {
  const { user } = useAuth();
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<ManagerReportFilters>(
    'ManagerTeamGoals',
    () => ({
      dateRange: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      },
      departmentIds: [], // Will be populated with manager's department only
      managerIds: [], // Will be populated with current manager only
      metrics: ['QA_SCORES', 'TRAINING_COMPLETION', 'DISPUTE_TRENDS']
    }),
    user?.id
  );

  // Refresh stale date ranges on mount if they're older than 1 day
  React.useEffect(() => {
    const now = new Date();
    const filterEndDate = new Date(filters.dateRange.endDate);
    const daysDiff = Math.floor((now.getTime() - filterEndDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // If date range is stale (more than 1 day old), refresh with current dates
    if (daysDiff >= 1) {
      setFilters(prev => ({
        ...prev,
        dateRange: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0]
        }
      }));
    }
  }, []); // Only run on mount

  const [reportData, setReportData] = useState<ManagerReportData | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    departments: [],
    managers: []
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [reportId, setReportId] = useState<string | null>(null);
  const [teamGoals, setTeamGoals] = useState<any[]>([]);

  // Prevent duplicate fetches on identical params
  const lastLoadFilterOptionsRef = useRef<string | null>(null);
  const lastLoadTeamGoalsRef = useRef<string | null>(null);
  const lastGenerateReportRef = useRef<string | null>(null);

  // Load filter options on component mount
  useEffect(() => {
    loadFilterOptions();
    loadTeamGoals();
  }, []);

  const loadFilterOptions = useCallback(async (force = false) => {
    const signature = 'loadFilterOptions';
    if (!force && signature === lastLoadFilterOptionsRef.current) {
      return;
    }
    lastLoadFilterOptionsRef.current = signature;

    try {
      const options = await teamReportsService.getTeamFilterOptions();
      // For managers, we'll filter to show only their department and team members
      // This would be handled by the backend to return scoped data
      setFilterOptions(options);
    } catch (error) {
      console.error('Failed to load filter options:', error);
      setError('Failed to load filter options');
      lastLoadFilterOptionsRef.current = null; // Allow retry
    }
  }, []);

  const loadTeamGoals = useCallback(async (force = false) => {
    const signature = 'loadTeamGoals';
    if (!force && signature === lastLoadTeamGoalsRef.current) {
      return;
    }
    lastLoadTeamGoalsRef.current = signature;

    try {
      const goals = await teamReportsService.getTeamGoals();
      setTeamGoals(goals || []); // Ensure we always set an array
    } catch (error) {
      console.error('Failed to load team goals:', error);
      setTeamGoals([]); // Set empty array on error to prevent undefined
      lastLoadTeamGoalsRef.current = null; // Allow retry
      // Don't set error state for goals as it's not critical for the component to function
    }
  }, []);

  const handleFilterChange = (field: keyof ManagerReportFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleDatePreset = (preset: string) => {
    const now = new Date();
    const ranges: Record<string, { startDate: string; endDate: string }> = {
      'last7days': {
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'last30days': {
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'last90days': {
        startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'thismonth': {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      }
    };
    
    if (ranges[preset]) {
      handleFilterChange('dateRange', ranges[preset]);
    }
  };

  const generateReport = useCallback(async (force = false) => {
    // Build stable signature with sorted filter keys
    const signatureParams = {
      dateRange: filters.dateRange,
      departmentIds: filters.departmentIds?.slice().sort() || [],
      managerIds: filters.managerIds?.slice().sort() || [],
      metrics: filters.metrics?.slice().sort() || []
    };

    const orderedParams = Object.keys(signatureParams)
      .sort()
      .reduce<Record<string, any>>((acc, key) => {
        acc[key] = (signatureParams as any)[key];
        return acc;
      }, {});

    const signature = JSON.stringify({
      endpoint: 'generateTeamReport',
      params: orderedParams
    });

    if (!force && signature === lastGenerateReportRef.current) {
      return;
    }

    lastGenerateReportRef.current = signature;

    setLoading(true);
    setError(null);
    console.log('🚀 Starting team report generation...');
    console.log('📊 Current filters:', filters);
    
    try {
      // For managers, this would call a different endpoint that returns team-scoped data
      console.log('📡 Calling teamReportsService.generateTeamReport...');
      const data = await teamReportsService.generateTeamReport(filters);
      console.log('✅ API Response received:', data);
      console.log('📋 Data structure:', {
        hasQaScores: !!data?.qaScores,
        qaScoresLength: data?.qaScores?.length || 0,
        hasTrainingCompletion: !!data?.trainingCompletion,
        trainingCompletionLength: data?.trainingCompletion?.length || 0,
        hasDisputeTrends: !!data?.disputeTrends,
        disputeTrendsLength: data?.disputeTrends?.length || 0,
        hasSummaryTable: !!data?.summaryTable,
        summaryTableLength: data?.summaryTable?.length || 0
      });
      console.log('🔍 Detailed data content:');
      console.log('QA Scores:', data?.qaScores);
      console.log('Training Completion:', data?.trainingCompletion);
      console.log('Dispute Trends:', data?.disputeTrends);
      console.log('Summary Table:', data?.summaryTable);
      
      setReportData(data);
      setReportId(`team_report_${Date.now()}`);
      console.log('✨ Report data set successfully');
    } catch (error) {
      console.error('❌ Failed to generate team report:', error);
      console.error('🔍 Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      setError('Failed to generate team report');
      lastGenerateReportRef.current = null; // Allow retry after error
    } finally {
      setLoading(false);
      console.log('🏁 Report generation finished');
    }
  }, [filters]);

  const exportReport = async (format: 'csv' | 'pdf') => {
    if (!reportId) return;
    
    try {
      const blob = await teamReportsService.exportTeamReport(reportId, format);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `team_performance_report_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export team report:', error);
      setError('Failed to export team report');
    }
  };

  const handleMetricChange = (metric: 'QA_SCORES' | 'TRAINING_COMPLETION' | 'DISPUTE_TRENDS') => {
    const currentMetrics = filters.metrics;
    const updatedMetrics = currentMetrics.includes(metric)
      ? currentMetrics.filter(m => m !== metric)
      : [...currentMetrics, metric];
    
    handleFilterChange('metrics', updatedMetrics);
  };

  const renderQAScoreChart = () => {
    console.log('🎯 renderQAScoreChart called');
    console.log('📊 reportData?.qaScores:', reportData?.qaScores);
    
    if (!reportData?.qaScores?.length) {
      console.log('❌ No QA scores data, returning null');
      return null;
    }

    // Show team members if available, otherwise show department data
    const teamData = reportData.qaScores.filter(item => item.type === 'manager');
    const deptData = reportData.qaScores.filter(item => item.type === 'department');
    const chartData = teamData.length > 0 ? teamData : deptData;

    console.log('👥 Team data (manager type):', teamData);
    console.log('🏢 Dept data (department type):', deptData);
    console.log('📈 Chart data selected:', chartData);
    console.log('🔍 First chart item detail:', chartData[0]);
    
    // Log each data item to check for missing fields
    chartData.forEach((item, index) => {
      console.log(`📊 Chart item ${index}:`, {
        name: item.name,
        averageScore: item.averageScore,
        type: item.type,
        hasAverageScore: item.hasOwnProperty('averageScore'),
        averageScoreType: typeof item.averageScore,
        allKeys: Object.keys(item)
      });
    });

    if (chartData.length === 0) {
      console.log('❌ No chart data after filtering, returning null');
      return null;
    }

    console.log('✅ Rendering QA chart with data:', chartData);

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiOutlineChartBar className="h-5 w-5 mr-2 text-blue-600" />
          {teamData.length > 0 ? 'Team QA Score Performance' : 'Department QA Score Performance'}
        </h3>
        {/* Debug information */}
        <div className="mb-2 text-xs text-gray-500">
          Debug: Found {chartData.length} items for chart
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
            <YAxis domain={[0, 100]} />
            <Tooltip 
              formatter={(value: any, name: any) => {
                console.log('🎯 Tooltip triggered with value:', value, 'name:', name);
                return [`${typeof value === 'number' ? value.toFixed(1) : value}%`, 'Average Score'];
              }}
              labelFormatter={(label: any) => `${label}`}
            />
            <Bar dataKey="averageScore" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderTrainingCompletionChart = () => {
    if (!reportData?.trainingCompletion?.length) return null;

    const teamData = reportData.trainingCompletion.filter(item => item.type === 'manager');
    const deptData = reportData.trainingCompletion.filter(item => item.type === 'department');
    const chartData = teamData.length > 0 ? teamData : deptData;

    if (chartData.length === 0) return null;

    const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiOutlineAcademicCap className="h-5 w-5 mr-2 text-green-600" />
          {teamData.length > 0 ? 'Team Training Completion' : 'Department Training Completion'}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="completionRate"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              fill="#8884d8"
              label={({ name, value }) => `${name}: ${value}%`}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: any) => [`${value}%`, 'Completion Rate']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderDisputeTrendsChart = () => {
    if (!reportData?.disputeTrends?.length) return null;

    // Show department-level dispute trends for the manager's department
    const departmentData = reportData.disputeTrends.filter(item => item.type === 'department');

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiExclamationTriangle className="h-5 w-5 mr-2 text-orange-600" />
          Department Dispute Trends
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={departmentData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip 
              formatter={(value: any, name: any) => [`${value}`, 'Dispute Count']}
              labelFormatter={(label: any) => `Date: ${label}`}
            />
            <Line type="monotone" dataKey="disputeCount" stroke="#f59e0b" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderTeamSummaryTable = () => {
    if (!reportData?.summaryTable?.length) return null;

    // Show team members if available, otherwise show department data
    const teamData = reportData.summaryTable.filter(item => item.type === 'manager');
    const deptData = reportData.summaryTable.filter(item => item.type === 'department');
    const tableData = teamData.length > 0 ? teamData : deptData;

    if (tableData.length === 0) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold flex items-center">
            <HiOutlineUsers className="h-5 w-5 mr-2 text-gray-600" />
            {teamData.length > 0 ? 'Team Performance Summary' : 'Department Performance Summary'}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {teamData.length > 0 ? 'Team Member' : 'Department'}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  QA Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Training Completion
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dispute Count
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Performance Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tableData.map((member) => {
                const overallScore = (member.qaScore + member.completionRate) / 2;
                const performanceStatus = overallScore >= 85 ? 'Excellent' : 
                                        overallScore >= 75 ? 'Good' : 
                                        overallScore >= 65 ? 'Needs Improvement' : 'Critical';
                const statusColor = overallScore >= 85 ? 'text-green-600' : 
                                   overallScore >= 75 ? 'text-blue-600' : 
                                   overallScore >= 65 ? 'text-yellow-600' : 'text-red-600';

                return (
                  <tr key={`${member.type}-${member.id}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {member.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span className={`font-medium ${
                        member.qaScore >= 85 ? 'text-green-600' : 
                        member.qaScore >= 70 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {member.qaScore.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span className={`font-medium ${
                        member.completionRate >= 80 ? 'text-green-600' : 
                        member.completionRate >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {member.completionRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span className={`font-medium ${
                        member.disputeCount <= 2 ? 'text-green-600' : 
                        member.disputeCount <= 5 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {member.disputeCount}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor} ${
                        overallScore >= 85 ? 'bg-green-100' : 
                        overallScore >= 75 ? 'bg-blue-100' : 
                        overallScore >= 65 ? 'bg-yellow-100' : 'bg-red-100'
                      }`}>
                        {performanceStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Performance & Goals</h1>
          <p className="text-sm text-gray-600 mt-1">
            Monitor your team's performance metrics and track progress towards departmental goals
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            {showFilters ? <HiOutlineEyeSlash className="h-4 w-4 mr-2" /> : <HiOutlineEye className="h-4 w-4 mr-2" />}
            {showFilters ? 'Hide' : 'Show'} Filters
          </button>
          {reportData && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => exportReport('csv')}
                className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                <HiOutlineDocumentArrowDown className="h-4 w-4 mr-2" />
                Export CSV
              </button>
              <button
                onClick={() => exportReport('pdf')}
                className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
              >
                <HiOutlineDocumentArrowDown className="h-4 w-4 mr-2" />
                Export PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <HiExclamationTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      {showFilters && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center mb-4">
            <HiOutlineAdjustmentsHorizontal className="h-5 w-5 mr-2 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Report Filters</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Date Range */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Range
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    { key: 'last7days', label: 'Last 7 Days' },
                    { key: 'last30days', label: 'Last 30 Days' },
                    { key: 'last90days', label: 'Last 90 Days' },
                    { key: 'thismonth', label: 'This Month' }
                  ].map(preset => (
                    <button
                      key={preset.key}
                      onClick={() => handleDatePreset(preset.key)}
                      className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={filters.dateRange.startDate}
                      onChange={(e) => handleFilterChange('dateRange', {
                        ...filters.dateRange,
                        startDate: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                    <input
                      type="date"
                      value={filters.dateRange.endDate}
                      onChange={(e) => handleFilterChange('dateRange', {
                        ...filters.dateRange,
                        endDate: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Metrics */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Metrics to Include
                </label>
                <div className="space-y-2">
                  {[
                    { key: 'QA_SCORES' as const, label: 'QA Scores', icon: HiOutlineChartBar },
                    { key: 'TRAINING_COMPLETION' as const, label: 'Training Completion', icon: HiOutlineAcademicCap },
                    { key: 'DISPUTE_TRENDS' as const, label: 'Dispute Trends', icon: HiExclamationTriangle }
                  ].map(metric => {
                    const Icon = metric.icon;
                    return (
                      <label key={metric.key} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={filters.metrics.includes(metric.key)}
                          onChange={() => handleMetricChange(metric.key)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <Icon className="h-4 w-4 ml-2 mr-2 text-gray-500" />
                        <span className="text-sm text-gray-700">{metric.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Team Information */}
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="text-sm font-medium text-blue-900 mb-2">Team Scope</h3>
                <p className="text-sm text-blue-700">
                  This report shows performance data for your direct team members and department only.
                </p>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Performance Goals</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  {teamGoals && teamGoals.length > 0 ? (
                    teamGoals.map((goal, index) => (
                      <div key={index} className="flex justify-between">
                        <span>
                          {goal.goal_type === 'QA_SCORE' ? 'QA Score Target:' :
                           goal.goal_type === 'AUDIT_RATE' ? 'Audit Rate Target:' :
                           goal.goal_type === 'DISPUTE_RATE' ? 'Dispute Rate Target:' :
                           goal.goal_type}:
                        </span>
                        <span className="font-medium">
                          {goal.goal_type === 'QA_SCORE' ? `≥ ${goal.target_value}%` :
                           goal.goal_type === 'AUDIT_RATE' ? `≥ ${goal.target_value} audits/month` :
                           goal.goal_type === 'DISPUTE_RATE' ? `≤ ${goal.target_value} per month` :
                           goal.target_value}
                        </span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span>QA Score Target:</span>
                        <span className="font-medium">≥ 85%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Training Completion:</span>
                        <span className="font-medium">≥ 80%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Dispute Rate Target:</span>
                        <span className="font-medium">≤ 5 per month</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Generate Report Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => generateReport()}
              disabled={loading || filters.metrics.length === 0}
              className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <HiArrowPath className="h-4 w-4 mr-2" />
              )}
              {loading ? 'Generating...' : 'Generate Team Report'}
            </button>
          </div>
        </div>
      )}

      {/* Report Content */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Generating team performance report...</p>
          </div>
        </div>
      ) : reportData ? (
        <div className="space-y-6">
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filters.metrics.includes('QA_SCORES') && renderQAScoreChart()}
            {filters.metrics.includes('TRAINING_COMPLETION') && renderTrainingCompletionChart()}
          </div>
          
          {/* Dispute Trends - Full Width */}
          {filters.metrics.includes('DISPUTE_TRENDS') && (
            <div className="grid grid-cols-1">
              {renderDisputeTrendsChart()}
            </div>
          )}

          {/* Team Summary Table */}
          {renderTeamSummaryTable()}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center text-gray-500">
            <HiOutlineUsers className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No team data available. Configure filters and click "Generate Team Report" to view your team's performance metrics.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerTeamGoals; 
import React, { useState, useEffect } from 'react';
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
  HiOutlineCalendar, 
  HiOutlineChartBar, 
  HiOutlineAcademicCap, 
  HiExclamationTriangle,
  HiOutlineDocumentArrowDown,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiArrowPath
} from 'react-icons/hi2';
import managerReportsService from '../services/managerReportsService';
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

const ManagerPerformanceReports: React.FC = () => {
  const { user } = useAuth();
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<ManagerReportFilters>(
    'ManagerPerformanceReports',
    () => ({
      dateRange: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      },
      departmentIds: [],
      managerIds: [],
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

  // Load filter options on component mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    try {
      const options = await managerReportsService.getFilterOptions();
      setFilterOptions(options);
    } catch (error) {
      console.error('Failed to load filter options:', error);
      setError('Failed to load filter options');
    }
  };

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

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await managerReportsService.generateReport(filters);
      setReportData(data);
      setReportId(`report_${Date.now()}`); // Generate a simple report ID
    } catch (error) {
      console.error('Failed to generate report:', error);
      setError('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format: 'csv' | 'pdf') => {
    if (!reportId) return;
    
    try {
      const blob = await managerReportsService.exportReport(reportId, format);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `manager_performance_report_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export report:', error);
      setError('Failed to export report');
    }
  };

  const handleMultiSelectChange = (field: 'departmentIds' | 'managerIds', selectedId: number) => {
    const currentValues = filters[field];
    const updatedValues = currentValues.includes(selectedId)
      ? currentValues.filter(id => id !== selectedId)
      : [...currentValues, selectedId];
    
    handleFilterChange(field, updatedValues);
  };

  const handleMetricChange = (metric: 'QA_SCORES' | 'TRAINING_COMPLETION' | 'DISPUTE_TRENDS') => {
    const currentMetrics = filters.metrics;
    const updatedMetrics = currentMetrics.includes(metric)
      ? currentMetrics.filter(m => m !== metric)
      : [...currentMetrics, metric];
    
    handleFilterChange('metrics', updatedMetrics);
  };

  const renderQAScoreChart = () => {
    if (!reportData?.qaScores.length) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiOutlineChartBar className="h-5 w-5 mr-2 text-blue-600" />
          QA Score Comparison
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={reportData.qaScores}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
            <YAxis domain={[0, 100]} />
            <Tooltip 
              formatter={(value: any, name: any) => [`${value.toFixed(1)}`, 'Average Score']}
              labelFormatter={(label: any) => `${label}`}
            />
            <Bar dataKey="averageScore" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderTrainingCompletionChart = () => {
    if (!reportData?.trainingCompletion.length) return null;

    const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#00aeef', '#06b6d4'];

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiOutlineAcademicCap className="h-5 w-5 mr-2 text-green-600" />
          Training Completion Rates
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={reportData.trainingCompletion}
              dataKey="completionRate"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              fill="#8884d8"
              label={({ name, value }) => `${name}: ${value}%`}
            >
              {reportData.trainingCompletion.map((entry, index) => (
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
    if (!reportData?.disputeTrends.length) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <HiExclamationTriangle className="h-5 w-5 mr-2 text-orange-600" />
          Dispute Trends Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={reportData.disputeTrends}>
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

  const renderSummaryTable = () => {
    if (!reportData?.summaryTable.length) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Performance Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  QA Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Completion Rate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dispute Count
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reportData.summaryTable.map((item) => (
                <tr key={`${item.type}-${item.id}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      item.type === 'department' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {item.type === 'department' ? 'Department' : 'Manager'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`font-medium ${
                      item.qaScore >= 85 ? 'text-green-600' : 
                      item.qaScore >= 70 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {item.qaScore.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`font-medium ${
                      item.completionRate >= 80 ? 'text-green-600' : 
                      item.completionRate >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {item.completionRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`font-medium ${
                      item.disputeCount <= 2 ? 'text-green-600' : 
                      item.disputeCount <= 5 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {item.disputeCount}
                    </span>
                  </td>
                </tr>
              ))}
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
          <h1 className="text-2xl font-bold text-gray-900">Manager Performance Reports</h1>
          <p className="text-sm text-gray-600 mt-1">
            Generate and compare performance reports across departments and managers
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

            {/* Departments and Managers */}
            <div className="space-y-4">
              {/* Departments */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Departments
                </label>
                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2 space-y-1">
                  {filterOptions.departments.map(dept => (
                    <label key={dept.id} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={filters.departmentIds.includes(dept.id)}
                        onChange={() => handleMultiSelectChange('departmentIds', dept.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">{dept.name}</span>
                    </label>
                  ))}
                  {filterOptions.departments.length === 0 && (
                    <p className="text-sm text-gray-500">No departments available</p>
                  )}
                </div>
              </div>

              {/* Managers */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Managers
                </label>
                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2 space-y-1">
                  {filterOptions.managers.map(manager => (
                    <label key={manager.id} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={filters.managerIds.includes(manager.id)}
                        onChange={() => handleMultiSelectChange('managerIds', manager.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">
                        {manager.name}
                        {manager.department && (
                          <span className="text-xs text-gray-500 ml-1">({manager.department})</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {filterOptions.managers.length === 0 && (
                    <p className="text-sm text-gray-500">No managers available</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Generate Report Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={generateReport}
              disabled={loading || filters.metrics.length === 0}
              className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <HiArrowPath className="h-4 w-4 mr-2" />
              )}
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      {/* Report Content */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Generating performance report...</p>
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

          {/* Summary Table */}
          {renderSummaryTable()}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center text-gray-500">
            <HiOutlineChartBar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No report data available. Configure filters and click "Generate Report" to view performance metrics.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerPerformanceReports; 
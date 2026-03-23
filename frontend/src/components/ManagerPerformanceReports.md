# Manager Performance Reports Component

## Overview

The `ManagerPerformanceReports` component provides Directors with the ability to generate and view comprehensive performance reports across departments and managers. This component supports the strategic oversight requirements outlined in the Manager Performance Reports documentation.

## Features

### 🎯 Core Functionality
- **Multi-metric Analysis**: Compare QA scores, training completion rates, and dispute trends
- **Flexible Filtering**: Filter by date range, departments, managers, and specific metrics
- **Interactive Charts**: Visual representation using Recharts library
- **Data Export**: Export reports as CSV or PDF files
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

### 📊 Report Types
1. **QA Score Comparison**: Bar chart showing average QA scores by department or manager
2. **Training Completion**: Pie chart displaying completion rates across entities
3. **Dispute Trends**: Line chart tracking dispute counts over time
4. **Summary Table**: Comprehensive table with sortable performance metrics

### 🔍 Filter Options
- **Date Range**: Predefined presets (Last 7/30/90 days, This Month) or custom date selection
- **Department Selection**: Multi-select dropdown for department filtering
- **Manager Selection**: Multi-select dropdown for manager filtering  
- **Metric Selection**: Choose which metrics to include in the report

## Technical Implementation

### Component Structure
```typescript
const ManagerPerformanceReports: React.FC = () => {
  // State management for filters, data, loading, and UI
  // API integration with managerReportsService
  // Chart rendering with Recharts
  // Export functionality
}
```

### Key Dependencies
- **React**: Component framework
- **TypeScript**: Type safety
- **Recharts**: Chart visualization (BarChart, PieChart, LineChart)
- **Tailwind CSS**: Styling
- **React Icons**: UI icons (HeroIcons v2)
- **Axios**: HTTP client

### API Integration
The component integrates with the following endpoints:
- `GET /api/director/filters` - Fetch available filter options
- `POST /api/director/reports` - Generate performance report
- `GET /api/director/export/:reportId` - Export report files

*Note: Currently using mock data for development/testing*

## Usage

### Access Control
- **Route**: `/director/performance-reports`
- **Permission**: Director role (role_id: 6) required
- **Navigation**: Available in Director Portal sidebar

### User Workflow
1. **Configure Filters**: Select date range, departments, managers, and metrics
2. **Generate Report**: Click "Generate Report" to fetch and display data
3. **View Results**: Analyze charts and summary table
4. **Export Data**: Download reports as CSV or PDF

### Filter Configuration
```typescript
interface ManagerReportFilters {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  departmentIds: number[];
  managerIds: number[];
  metrics: ('QA_SCORES' | 'TRAINING_COMPLETION' | 'DISPUTE_TRENDS')[];
}
```

## Data Types

### Report Data Structure
```typescript
interface ManagerReportData {
  qaScores: QAScoreData[];
  trainingCompletion: TrainingCompletionData[];
  disputeTrends: DisputeTrendData[];
  summaryTable: SummaryTableItem[];
}
```

### Mock Data
The component includes comprehensive mock data for testing:
- 5 departments with realistic performance metrics
- 7 managers across different departments
- Historical dispute trend data
- Varied completion rates and QA scores

## Styling

### Design System
- **Colors**: Blue primary (`#3b82f6`), semantic colors for metrics
- **Typography**: Clear hierarchy with proper font weights
- **Spacing**: Consistent with Tailwind spacing scale
- **Components**: Cards, tables, forms following existing patterns

### Responsive Features
- **Mobile-first**: Responsive grid layouts
- **Adaptive Charts**: Charts resize based on container
- **Collapsible Filters**: Hide/show filter panel on smaller screens
- **Scrollable Tables**: Horizontal scroll for table overflow

## Integration Notes

### Backend Requirements
When implementing the backend:
1. Ensure proper role-based access control for Directors
2. Implement pagination for large datasets
3. Validate date ranges and filter parameters
4. Support both CSV and PDF export formats
5. Include proper error handling and validation

### Database Queries
The component expects data from:
- `submissions` table for QA scores
- `enrollments` table for training completion
- `disputes` table for dispute trends
- `departments` and `users` tables for filter options

### Performance Considerations
- Implement caching for filter options
- Use database indexing for date range queries
- Consider pagination for large result sets
- Optimize chart rendering for large datasets

## Future Enhancements

1. **Real-time Updates**: WebSocket integration for live data
2. **Advanced Filtering**: Department hierarchies, manager reporting chains
3. **Custom Date Ranges**: More flexible date selection options
4. **Drill-down Capabilities**: Click-to-explore functionality
5. **Comparison Mode**: Side-by-side period comparisons
6. **Scheduled Reports**: Automated report generation and delivery

## Testing

### Mock Data
- Located in `/mocks/managerReportsMock.ts`
- Includes realistic performance scenarios
- Covers edge cases and various data distributions

### Component Testing
- Filter functionality validation
- Chart rendering verification
- Export functionality testing
- Responsive design testing
- Error state handling

## Maintenance

- Update mock data as business requirements evolve
- Monitor chart library updates for compatibility
- Ensure accessibility compliance
- Regular performance optimization reviews 
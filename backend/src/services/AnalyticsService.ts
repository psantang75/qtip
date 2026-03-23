import { 
  ReportFilters, 
  ComprehensiveReportFilters,
  QAScoreTrendResponse, 
  ScoreDistributionResponse, 
  PerformanceGoalData,
  GroupedScoreData,
  ScoreTrendDataPoint,
  ScoreDistribution
} from '../types/analytics.types';
import { IAnalyticsRepository } from '../interfaces/IAnalyticsRepository';
import cacheService from './CacheService';
import ExcelJS from 'exceljs';

export interface FilterOptions {
  departments: any[];
  forms: any[];
  csrs: any[];
  datePresets: any[];
}

export class AnalyticsServiceError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'ANALYTICS_ERROR') {
    super(message);
    this.name = 'AnalyticsServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AnalyticsService {
  private analyticsRepository: IAnalyticsRepository;
  private cacheService: typeof cacheService;
  private readonly CACHE_TTL = 300; // 5 minutes default

  constructor(analyticsRepository: IAnalyticsRepository, providedCacheService?: typeof cacheService) {
    this.analyticsRepository = analyticsRepository;
    this.cacheService = providedCacheService || cacheService;
  }

  /**
   * Get filter options for analytics interface
   */
  async getFilterOptions(user_id: number, userRole?: string): Promise<FilterOptions> {
    try {
      const cacheKey = `analytics:filters:${user_id}:${userRole}`;
      
      // Try cache first
      const cached = await this.cacheService.get<FilterOptions>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch from repository
      const filters = await this.analyticsRepository.getFilterOptions(user_id, userRole);
      
      // Cache for 10 minutes (filter options change infrequently)
      await this.cacheService.set(cacheKey, filters, 600);
      
      return filters;
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to get filter options: ${error.message}`,
        500,
        'FILTER_OPTIONS_ERROR'
      );
    }
  }

  /**
   * Get QA score trends with caching and aggregation
   */
  async getQAScoreTrends(
    filters: ReportFilters, 
    user_id: number, 
    userRole?: string
  ): Promise<QAScoreTrendResponse> {
    try {
      // Validate filters
      this.validateDateRange(filters);

      const cacheKey = this.generateCacheKey('qa-score-trends', filters, user_id, userRole);
      
      // Try cache first
      const cached = await this.cacheService.get<QAScoreTrendResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get raw data from repository
      const rawData = await this.analyticsRepository.getQAScoreData(filters, user_id, userRole);
      
      // Aggregate and process data - defaulting to 'csr' grouping
      const trends = this.aggregateScoreTrends(rawData, 'csr');
      
      // Calculate overall metrics
      const overall = this.calculateOverallMetrics(rawData);
      
      const result: QAScoreTrendResponse = {
        trends,
        overall
      };

      // Cache results
      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      
      return result;
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to get QA score trends: ${error.message}`,
        500,
        'QA_SCORE_TRENDS_ERROR'
      );
    }
  }

  /**
   * Get QA score distribution with performance optimization
   */
  async getQAScoreDistribution(
    filters: ReportFilters, 
    user_id: number, 
    userRole?: string
  ): Promise<ScoreDistributionResponse> {
    try {
      this.validateDateRange(filters);

      const cacheKey = this.generateCacheKey('qa-score-distribution', filters, user_id, userRole);
      
      // Try cache first
      const cached = await this.cacheService.get<ScoreDistributionResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get score data
      const rawData = await this.analyticsRepository.getQAScoreData(filters, user_id, userRole);
      
      // Process distribution
      const distributions = this.calculateScoreDistribution(rawData);
      const totalAudits = rawData.length;

      const result: ScoreDistributionResponse = {
        distributions,
        totalAudits
      };

      // Cache results
      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      
      return result;
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to get QA score distribution: ${error.message}`,
        500,
        'QA_SCORE_DISTRIBUTION_ERROR'
      );
    }
  }

  /**
   * Get performance against goals with advanced calculations
   */
  async getPerformanceGoals(
    filters: ReportFilters, 
    user_id: number, 
    userRole?: string
  ): Promise<PerformanceGoalData[]> {
    try {
      this.validateDateRange(filters);

      const cacheKey = this.generateCacheKey('performance-goals', filters, user_id, userRole);
      
      // Try cache first
      const cached = await this.cacheService.get<PerformanceGoalData[]>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get goals and calculate performance
      const goals = await this.analyticsRepository.getActiveGoals(user_id, userRole, filters.department_id);
      const performanceData: PerformanceGoalData[] = [];

      for (const goal of goals) {
        let actualValue = 0;

        switch (goal.goal_type) {
          case 'QA_SCORE':
            actualValue = await this.calculateQAScoreMetric(filters, user_id, userRole, goal);
            break;
          case 'AUDIT_RATE':
            actualValue = await this.calculateAuditRateMetric(filters, user_id, userRole, goal);
            break;
          case 'DISPUTE_RATE':
            actualValue = await this.calculateDisputeRateMetric(filters, user_id, userRole, goal);
            break;
          default:
            // Skip unknown goal types
            continue;
        }

        const percentComplete = this.calculatePercentComplete(actualValue, goal.target_value);

        performanceData.push({
          goal_type: goal.goal_type,
          target_value: goal.target_value,
          actualValue,
          percentComplete
        });
      }

      // Cache results for shorter time (goals are more dynamic)
      await this.cacheService.set(cacheKey, performanceData, 180); // 3 minutes
      
      return performanceData;
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to get performance goals: ${error.message}`,
        500,
        'PERFORMANCE_GOALS_ERROR'
      );
    }
  }

  /**
   * Export QA scores with optimized data retrieval
   */
  async exportQAScores(
    filters: ReportFilters, 
    user_id: number, 
    userRole?: string
  ): Promise<Buffer> {
    try {
      this.validateDateRange(filters);

      // Ensure start_date and end_date are present and are strings
      if (!filters.start_date || !filters.end_date) {
        throw new AnalyticsServiceError('Start date and end date are required', 400, 'INVALID_DATE_RANGE');
      }

      const rawData = await this.analyticsRepository.getDetailedQAScoreData(filters, user_id, userRole);
      return this.generateExcelExport(rawData);
    } catch (error: any) {
      console.error('[ANALYTICS SERVICE] Export QA Scores Error:', error);
      throw new AnalyticsServiceError(
        `Failed to export QA scores: ${error.message}`,
        500,
        'QA_SCORE_EXPORT_ERROR'
      );
    }
  }

  /**
   * Export comprehensive report with optimized data retrieval
   */
  async exportComprehensiveReport(
    filters: ComprehensiveReportFilters, 
    user_id: number, 
    userRole?: string
  ): Promise<Buffer> {
    try {
      this.validateDateRange(filters);

      // Ensure start_date and end_date are present and are strings
      if (!filters.start_date || !filters.end_date) {
        throw new AnalyticsServiceError('Start date and end date are required', 400, 'INVALID_DATE_RANGE');
      }

      const rawData = await this.analyticsRepository.getDetailedSubmissionData(filters, user_id, userRole);
      return this.generateExcelExport(rawData, filters, user_id, userRole);
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to export comprehensive report: ${error.message}`,
        500,
        'COMPREHENSIVE_REPORT_EXPORT_ERROR'
      );
    }
  }

  /**
   * Invalidate cache for specific patterns
   */
  async invalidateCache(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        // Clear specific analytics cache pattern
        this.cacheService.flushAll(); // For now, flush all - can be improved later
      } else {
        this.cacheService.flushAll();
      }
    } catch (error: any) {
      // Cache invalidation failure is not critical - log but don't throw
      // This prevents cache issues from breaking the application
    }
  }

  /**
   * Comprehensive reporting method for query builder
   */
  async getComprehensiveReport(
    filters: ComprehensiveReportFilters,
    user_id: number,
    userRole?: string
  ): Promise<any> {
    try {
      this.validateDateRange(filters);

      //const cacheKey = this.generateCacheKey('comprehensive-report', filters, user_id, userRole);
      
      // Try cache first
      //const cached = await this.cacheService.get<any>(cacheKey);
      //if (cached) {
      //  return cached;
      //}

      let result: any = {};

      switch (filters.reportType) {
        case 'raw_scores':
          result = await this.getRawScoresReport(filters, user_id, userRole);
          break;
        case 'summary':
          result = await this.getSummaryReport(filters, user_id, userRole);
          break;
        default:
          throw new AnalyticsServiceError(
            `Invalid report type: ${filters.reportType}`,
            400,
            'INVALID_REPORT_TYPE'
          );
      }

      // Cache results
      //await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      
      return result;
    } catch (error: any) {
      throw new AnalyticsServiceError(
        `Failed to generate comprehensive report: ${error.message}`,
        500,
        'COMPREHENSIVE_REPORT_ERROR'
      );
    }
  }

  /**
   * Get raw scores with detailed breakdown
   */
  private async getRawScoresReport(
    filters: any,
    user_id: number,
    userRole?: string
  ): Promise<any> {
    
    const rawData = await this.analyticsRepository.getDetailedSubmissionData(filters, user_id, userRole);
    
    // Get breakdowns if requested or if filtering by category/question
    const categoryBreakdown = (filters.includeCategoryBreakdown || filters.category_id || filters.categoryIds || filters.question_id || filters.questionIds) ? 
      await this.getCategoryLevelBreakdown(rawData, filters) : null;
    
    const questionBreakdown = (filters.includeQuestionBreakdown || filters.question_id || filters.questionIds) ? 
      await this.getQuestionLevelBreakdown(rawData, filters) : null;
    
    // ALWAYS calculate form-level statistics from full form data
    // Create a copy of filters without category/question filters to get full form data
    const formLevelFilters = { ...filters };
    delete formLevelFilters.category_id;
    delete formLevelFilters.categoryIds;
    delete formLevelFilters.question_id;
    delete formLevelFilters.questionIds;
    
    const fullFormData = await this.analyticsRepository.getDetailedSubmissionData(formLevelFilters, user_id, userRole);
    const formLevelStatistics = this.calculateRawScoreStatistics(fullFormData);
    
    // Calculate specific level statistics based on the filter level
    let specificLevelStatistics;
    let categoryLevelStatistics;
    
    // Check question filter FIRST (most specific)
    // Handle both questionIds (array) and question_id (singular)
    const hasQuestionFilter = filters.questionIds?.length > 0 || filters.question_id;
    if (hasQuestionFilter && questionBreakdown) {
      console.log('[ANALYTICS SERVICE - getRawScoresReport] ===================');
      console.log('[ANALYTICS SERVICE - getRawScoresReport] Question filter applied');
      console.log('[ANALYTICS SERVICE - getRawScoresReport] filters.questionIds:', filters.questionIds);
      console.log('[ANALYTICS SERVICE - getRawScoresReport] filters.question_id:', filters.question_id);
      console.log('[ANALYTICS SERVICE - getRawScoresReport] questionBreakdown:', JSON.stringify(questionBreakdown, null, 2));
      
      // Use question-level statistics when filtering by question
      // For questionIds array, find a question that includes any of the IDs
      const question = questionBreakdown.questions?.find((q: any) => {
        if (filters.questionIds?.length > 0) {
          // Check if any of the filter questionIds match any of the question's question_ids
          const match = filters.questionIds.some((filterId: number) => 
            q.question_ids?.includes(filterId) || Number(q.question_id) === Number(filterId)
          );
          console.log(`[ANALYTICS SERVICE - getRawScoresReport] Comparing question_ids ${JSON.stringify(q.question_ids)} with filters ${JSON.stringify(filters.questionIds)}: ${match}`);
          return match;
        } else if (filters.question_id) {
          // Fallback to singular question_id
          const match = Number(q.question_id) === Number(filters.question_id);
          console.log(`[ANALYTICS SERVICE - getRawScoresReport] Comparing question ${q.question_id} with filter ${filters.question_id}: ${match}`);
          return match;
        }
        return false;
      });
      
      console.log('[ANALYTICS SERVICE - getRawScoresReport] Found question:', JSON.stringify(question, null, 2));
      
      if (question && question.average_score !== null) {
        specificLevelStatistics = {
          count: question.total_responses,
          mean: question.average_score,
          median: question.average_score,
          mode: question.average_score,
          standardDeviation: question.score_std_dev || 0,
          min: question.min_score || 0,
          max: question.max_score || 0,
          percentiles: {
            p25: question.min_score || 0,
            p50: question.average_score,
            p75: question.max_score || 0,
            p90: question.max_score || 0,
            p95: question.max_score || 0
          }
        };
        console.log('[ANALYTICS SERVICE] Question statistics:', specificLevelStatistics);
      } else {
        console.log('[ANALYTICS SERVICE] No valid question found or average_score is null, using empty statistics');
        specificLevelStatistics = this.getEmptyStatistics();
      }
      
      // ALSO get category-level statistics when question is filtered
      if (categoryBreakdown) {
        const category = categoryBreakdown.categories?.find((c: any) => {
          if (filters.categoryIds?.length > 0) {
            // Check if any of the filter categoryIds match any of the category's category_ids
            return filters.categoryIds.some((filterId: number) => 
              c.category_ids?.includes(filterId) || c.category_id === filterId
            );
          } else if (filters.category_id) {
            return c.category_id === filters.category_id || 
              (c.category_ids && c.category_ids.includes(filters.category_id));
          }
          return false;
        });
        
        if (category && category.category_percentage !== null) {
          // Use category_percentage (which is already in 0-100 range)
          const categoryPercent = category.category_percentage;
          categoryLevelStatistics = {
            count: category.total_responses,
            mean: categoryPercent,
            median: categoryPercent,
            mode: categoryPercent,
            standardDeviation: 0, // Not available at category level
            min: categoryPercent,
            max: categoryPercent,
            percentiles: {
              p25: categoryPercent,
              p50: categoryPercent,
              p75: categoryPercent,
              p90: categoryPercent,
              p95: categoryPercent
            }
          };
        }
      }
    } else if ((filters.categoryIds?.length > 0 || filters.category_id) && categoryBreakdown) {
      // Use category-level statistics when filtering by category (but not question)
      const category = categoryBreakdown.categories?.find((c: any) => {
        if (filters.categoryIds?.length > 0) {
          // Check if any of the filter categoryIds match any of the category's category_ids
          return filters.categoryIds.some((filterId: number) => 
            c.category_ids?.includes(filterId) || c.category_id === filterId
          );
        } else if (filters.category_id) {
          return c.category_id === filters.category_id || 
            (c.category_ids && c.category_ids.includes(filters.category_id));
        }
        return false;
      });
      
      if (category && category.category_percentage !== null) {
        // Use category_percentage (which is already in 0-100 range)
        const categoryPercent = category.category_percentage;
        specificLevelStatistics = {
          count: category.total_responses,
          mean: categoryPercent,
          median: categoryPercent,
          mode: categoryPercent,
          standardDeviation: 0, // Not available at category level
          min: categoryPercent,
          max: categoryPercent,
          percentiles: {
            p25: categoryPercent,
            p50: categoryPercent,
            p75: categoryPercent,
            p90: categoryPercent,
            p95: categoryPercent
          }
        };
      } else {
        specificLevelStatistics = this.getEmptyStatistics();
      }
    } else {
      // No specific filter - use form-level statistics for both
      specificLevelStatistics = formLevelStatistics;
    }
    
    // Process raw data with question and category breakdown if requested
    const processedData = {
      submissions: rawData,
      totalCount: rawData.length,
      questionBreakdown: filters.includeQuestionBreakdown ? questionBreakdown : null,
      categoryBreakdown: filters.includeCategoryBreakdown ? categoryBreakdown : null,
      statistics: formLevelStatistics, // Always use form-level statistics for the main statistics field
      specificLevelStatistics: specificLevelStatistics, // Add specific level statistics as a separate field
      categoryLevelStatistics: categoryLevelStatistics || null // Add category-level statistics when question is filtered
    };

    return processedData;
  }

  private getEmptyStatistics(): any {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: 0,
      standardDeviation: 0,
      min: 0,
      max: 0,
      percentiles: {
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0
      }
    };
  }

  /**
   * Get summary report with high-level insights
   */
  private async getSummaryReport(
    filters: any,
    user_id: number,
    userRole?: string
  ): Promise<any> {
    const rawData = await this.analyticsRepository.getQAScoreData(filters, user_id, userRole);
    
    // For Summary Overview, we don't want category/question breakdown duplicates
    // Remove breakdown flags to get one row per submission
    const summaryFilters = { ...filters };
    delete summaryFilters.includeCategoryBreakdown;
    delete summaryFilters.includeQuestionBreakdown;
    
    const detailedData = await this.analyticsRepository.getDetailedSubmissionData(summaryFilters, user_id, userRole);
    
    return {
      overview: {
        scoreDistribution: this.calculateScoreDistribution(rawData)
      },
      submissions: detailedData,
      totalCount: detailedData.length
    };
  }

  // Private helper methods

  private validateDateRange(filters: ReportFilters | ComprehensiveReportFilters): void {
    if (!filters.start_date || !filters.end_date) {
      throw new AnalyticsServiceError(
        'Start date and end date are required',
        400,
        'INVALID_DATE_RANGE'
      );
    }

    const start = new Date(filters.start_date);
    const end = new Date(filters.end_date);

    if (start > end) {
      throw new AnalyticsServiceError(
        'Start date must be before end date',
        400,
        'INVALID_DATE_RANGE'
      );
    }

    // Prevent queries for more than 1 year of data
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > oneYear) {
      throw new AnalyticsServiceError(
        'Date range cannot exceed one year',
        400,
        'DATE_RANGE_TOO_LARGE'
      );
    }
  }

  private generateCacheKey(
    type: string, 
    filters: ReportFilters | ComprehensiveReportFilters, 
    user_id: number, 
    userRole?: string
  ): string {
    const filterHash = this.hashFilters(filters);
    return `analytics:${type}:${user_id}:${userRole}:${filterHash}`;
  }

  private hashFilters(filters: ReportFilters | ComprehensiveReportFilters): string {
    // Create a consistent hash of the filters
    const keyString = JSON.stringify({
      start_date: filters.start_date,
      end_date: filters.end_date,
      department_id: 'department_id' in filters ? filters.department_id : undefined,
      departmentIds: 'departmentIds' in filters ? filters.departmentIds?.sort() : undefined,
      csrIds: filters.csrIds?.sort(),
      form_id: filters.form_id,
      category_id: 'category_id' in filters ? filters.category_id : undefined,
      question_id: 'question_id' in filters ? filters.question_id : undefined
    });
    
    // Simple hash function (in production, use crypto.createHash)
    let hash = 0;
    for (let i = 0; i < keyString.length; i++) {
      const char = keyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private aggregateScoreTrends(rawData: any[], groupBy: string): GroupedScoreData[] {
    const groups = new Map<string, { name: string; scores: { date: string; score: number }[] }>();

    rawData.forEach(record => {
      const groupKey = groupBy === 'csr' ? record.group_id.toString() 
                     : groupBy === 'department' ? (record.group_id || 'unassigned').toString()
                     : record.group_id.toString();
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { 
          name: record.group_name || 'Unknown', 
          scores: [] 
        });
      }

      groups.get(groupKey)!.scores.push({
        date: record.date,
        score: record.total_score
      });
    });

    const trends: GroupedScoreData[] = [];

    groups.forEach((group, group_id) => {
      // Aggregate scores by date
      const dateScores = new Map<string, { total: number; count: number }>();
      
      group.scores.forEach(score => {
        if (!dateScores.has(score.date)) {
          dateScores.set(score.date, { total: 0, count: 0 });
        }
        const dayData = dateScores.get(score.date)!;
        dayData.total += score.score;
        dayData.count += 1;
      });

      // Create trend data points
      const data: ScoreTrendDataPoint[] = Array.from(dateScores.entries()).map(([date, scores]) => ({
        date,
        score: Math.round((scores.total / scores.count) * 100) / 100, // Round to 2 decimal places
        count: scores.count
      })).sort((a, b) => a.date.localeCompare(b.date));

      // Calculate average score
      const total_score = group.scores.reduce((sum, score) => sum + score.score, 0);
      const averageScore = Math.round((total_score / group.scores.length) * 100) / 100;

      trends.push({
        id: parseInt(group_id),
        name: group.name,
        data,
        averageScore
      });
    });

    return trends.sort((a, b) => a.name.localeCompare(b.name));
  }

  private calculateOverallMetrics(rawData: any[]): { averageScore: number; totalAudits: number } {
    if (rawData.length === 0) {
      return { averageScore: 0, totalAudits: 0 };
    }

    const total_score = rawData.reduce((sum, record) => sum + record.total_score, 0);
    const averageScore = Math.round((total_score / rawData.length) * 100) / 100;

    return {
      averageScore,
      totalAudits: rawData.length
    };
  }

  private calculateScoreDistribution(rawData: any[]): ScoreDistribution[] {
    const ranges = [
      { range: '90-100', min: 90, max: 100 },
      { range: '80-89', min: 80, max: 89.99 },
      { range: '70-79', min: 70, max: 79.99 },
      { range: '60-69', min: 60, max: 69.99 },
      { range: '0-59', min: 0, max: 59.99 }
    ];

    const totalCount = rawData.length;
    
    return ranges.map(range => {
      const count = rawData.filter(record => 
        record.total_score >= range.min && record.total_score <= range.max
      ).length;

      const percentage = totalCount > 0 ? Math.round((count / totalCount) * 100 * 100) / 100 : 0;

      return {
        range: range.range,
        count,
        percentage
      };
    });
  }

  private async calculateQAScoreMetric(
    filters: ReportFilters, 
    user_id: number, 
    userRole: string | undefined, 
    goal: any
  ): Promise<number> {
    const scoreData = await this.analyticsRepository.getAverageQAScore(filters, user_id, userRole, goal);
    return scoreData.averageScore || 0;
  }

  private async calculateAuditRateMetric(
    filters: ReportFilters, 
    user_id: number, 
    userRole: string | undefined, 
    goal: any
  ): Promise<number> {
    const auditData = await this.analyticsRepository.getAuditRateData(filters, user_id, userRole, goal);
    return auditData.auditRate || 0;
  }

  private async calculateDisputeRateMetric(
    filters: ReportFilters, 
    user_id: number, 
    userRole: string | undefined, 
    goal: any
  ): Promise<number> {
    const disputeData = await this.analyticsRepository.getDisputeRateData(filters, user_id, userRole, goal);
    return disputeData.disputeRate || 0;
  }

  private calculatePercentComplete(actualValue: number, target_value: number): number {
    if (target_value === 0) return 0;
    return Math.min(100, Math.round((actualValue / target_value) * 100));
  }

  private async generateExcelExport(
    rawData: any[], 
    filters?: any, 
    user_id?: number, 
    userRole?: string
  ): Promise<Buffer> {
    // Sort the data for proper ordering in Excel export
    const sortedData = rawData.sort((a, b) => {
      // First sort by submission_id ascending
      const submissionIdA = parseInt(a.submission_id) || 0;
      const submissionIdB = parseInt(b.submission_id) || 0;
      
      if (submissionIdA !== submissionIdB) {
        return submissionIdA - submissionIdB;
      }
      
      // Then sort by category_name ascending
      const categoryNameA = String(a.category_name || '').toLowerCase();
      const categoryNameB = String(b.category_name || '').toLowerCase();
      
      if (categoryNameA !== categoryNameB) {
        return categoryNameA < categoryNameB ? -1 : categoryNameA > categoryNameB ? 1 : 0;
      }
      
      // Finally sort by question text ascending
      const questionA = String(a.question_text || a.question || '').toLowerCase();
      const questionB = String(b.question_text || b.question || '').toLowerCase();
      
      return questionA < questionB ? -1 : questionA > questionB ? 1 : 0;
    });
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QTIP Analytics Report');

    // Determine the number of columns to export
    const allHeaders = sortedData && sortedData.length > 0 ? Object.keys(sortedData[0]) : [];
    const baseColumns = ['submission_id', 'submission_date', 'csr_name', 'form_name', 'total_score'];
    const hasCategory = allHeaders.includes('category_name') && sortedData.some(row => row.category_name);
    const hasCategoryScore = allHeaders.includes('category_score') && sortedData.some(row => row.category_score !== undefined && row.category_score !== null);
    const hasQuestion = allHeaders.includes('question') || allHeaders.includes('question_text');
    const hasAnswer = allHeaders.includes('question_answer');
    
    let numColumns = baseColumns.length;
    if (hasCategory) numColumns++;
    if (hasCategoryScore) numColumns++;
    if (hasQuestion) numColumns++;
    if (hasAnswer) numColumns++;

    // Add main header
    let currentRow = 1;
    const mainHeaderRow = worksheet.getRow(currentRow);
    const mainHeaderCell = mainHeaderRow.getCell(1);
    mainHeaderCell.value = 'QTIP ANALYTICS - RAW SCORE DATA';
    mainHeaderCell.font = { bold: true, size: 16, color: { argb: 'FF000000' } }; // Black text, size 16
    mainHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00AEEF' } // Cyan/light blue
    };
    mainHeaderCell.alignment = { vertical: 'middle', horizontal: 'center' };
    mainHeaderRow.height = 30;
    
    // Merge cells for the header based on actual number of columns
    worksheet.mergeCells(currentRow, 1, currentRow, Math.max(numColumns, 5));
    
    currentRow += 2; // Add empty row after main header

    // Export the sorted data, matching the UI table (without section title)
    currentRow = this.addDataRows(worksheet, sortedData, currentRow);

    // Post-process to ensure all cells in score columns are right-aligned
    // Iterate through all columns and right-align score columns
    if (worksheet.columns) {
      worksheet.columns.forEach((column, index) => {
        const header = column.header;
        if (header && (header.toString().includes('Score') || header.toString().includes('score'))) {
          if (column.eachCell) {
            column.eachCell((cell, rowNumber) => {
              if (rowNumber > 1) { // Skip header row
                cell.alignment = { vertical: 'top', horizontal: 'right' };
              }
            });
          }
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private addDataRows(
    worksheet: ExcelJS.Worksheet, 
    data: any[], 
    startRow: number
  ): number {
    let currentRow = startRow;
    
    if (!data || data.length === 0) {
      const noDataRow = worksheet.getRow(currentRow);
      noDataRow.getCell(1).value = 'No data available';
      return currentRow + 1;
    }

    // Get all keys from the first row
    const allHeaders = Object.keys(data[0]);
    
    // Define columns to include based on what's displayed in the UI
    const baseColumns = ['submission_id', 'submission_date', 'csr_name', 'form_name', 'total_score'];
    
    // Determine which additional columns to include based on what's in the data
    const hasCategory = allHeaders.includes('category_name') && data.some(row => row.category_name);
    const hasCategoryScore = allHeaders.includes('category_score') && data.some(row => row.category_score !== undefined && row.category_score !== null);
    const hasQuestion = allHeaders.includes('question') || allHeaders.includes('question_text');
    const hasAnswer = allHeaders.includes('question_answer');
    
    // Build the list of columns to export (matching UI table columns only)
    let headers = [...baseColumns];
    
    if (hasCategory) {
      headers.push('category_name');
    }
    if (hasCategoryScore) {
      headers.push('category_score');
    }
    if (hasQuestion) {
      headers.push(allHeaders.includes('question') ? 'question' : 'question_text');
    }
    if (hasAnswer) {
      headers.push('question_answer');
    }
    
    // Filter to only include headers that actually exist in the data
    headers = headers.filter(h => allHeaders.includes(h));
    
    // Create header mapping with friendly names
    const headerMapping: Record<string, string> = {
      submission_id: 'Submission ID',
      submission_date: 'Date',
      csr_name: 'CSR',
      form_name: 'Form',
      total_score: 'Form Score',
      category_name: 'Category',
      category_id: 'Category ID',
      category_score: 'Category Score',
      question: 'Question',
      question_text: 'Question',
      question_answer: 'Answer',
      question_answer_value: 'Answer Value',
      responses: 'Responses',
      average_score: 'Average Score',
      question_average_score: 'Question Score',
      status: 'Status',
      submitted_at: 'Submitted At',
      form_id: 'Form ID',
      csr_id: 'CSR ID',
      department_id: 'Department ID',
      department_name: 'Department',
      qa_id: 'QA ID',
      qa_name: 'QA Name'
    };
    
    // Set column-level alignment for category_score column
    const categoryScoreColumnIndex = headers.indexOf('category_score');
    if (categoryScoreColumnIndex !== -1) {
      const column = worksheet.getColumn(categoryScoreColumnIndex + 1);
      column.alignment = { vertical: 'top', horizontal: 'right' };
    }

    // Columns that should be left-aligned
    const leftAlignColumns = ['submission_date', 'csr_name', 'form_name', 'category_name', 'question', 'question_text', 'question_answer'];
    
    // Columns that should be right-aligned (scores and numeric data)
    const rightAlignColumns = ['total_score', 'category_score', 'question_average_score', 'average_score'];

    // Add headers
    const headerRow = worksheet.getRow(currentRow);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = headerMapping[header] || header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' } // Black background
      };
      
      // Apply left alignment for specific columns, center for others
      const horizontalAlign = leftAlignColumns.includes(header) ? 'left' : 'center';
      
      // Enable text wrapping for category names and question text headers
      const enableWrap = header === 'category_name' || header === 'question' || header === 'question_text';
      cell.alignment = { 
        vertical: 'middle', 
        horizontal: horizontalAlign,
        wrapText: enableWrap 
      };
      
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      
      // Set column width
      let width = 25; // Default width
      if (header === 'submission_id') {
        width = 15; // Reasonable width for submission ID
      } else if (header.includes('id')) {
        width = 12;
      } else if (header.includes('date')) {
        width = 15;
      } else if (header === 'category_score') {
        width = 15; // Reasonable width for category score
      } else if (header.includes('score')) {
        width = 12;
      } else if (header === 'category_name') {
        width = 30; // Reasonable width with text wrap for category names
      } else if (header === 'question' || header === 'question_text') {
        width = 25; // Reasonable width with text wrap for questions
      }
      worksheet.getColumn(index + 1).width = width;
    });
    currentRow++;

    // Add data rows
    data.forEach((row) => {
      const dataRow = worksheet.getRow(currentRow);
      headers.forEach((header, index) => {
        const cell = dataRow.getCell(index + 1);
        let value = row[header];
        
        // Convert question_average_score from 0-1 range to 0-100 range
        if (header === 'question_average_score' && value !== null && value !== undefined) {
          value = value * 100;
        }
        
        // Set cell value first
        if (header === 'category_score' && (value === 'N/A' || value === null || value === undefined || row.category_possible_points === 0 || (value === 0 && row.category_possible_points === 0))) {
          cell.value = 'N/A';
        } else {
          cell.value = value;
        }
        
        // Format score columns as percentages (skip for N/A values)
        if (header.includes('score') && cell.value !== 'N/A') {
          cell.numFmt = '0.00"%"';
        }
        
        // Format date columns
        if (header.includes('date')) {
          cell.numFmt = 'yyyy-mm-dd';
        }
        
        // Set default alignment for all cells
        cell.alignment = { vertical: 'top', horizontal: 'left' };
        
        // Apply specific alignment for different column types
        if (leftAlignColumns.includes(header)) {
          cell.alignment = { vertical: 'top', horizontal: 'left' };
        } else if (rightAlignColumns.includes(header)) {
          // Right-align score columns (including N/A values)
          cell.alignment = { vertical: 'top', horizontal: 'right' };
        }
        
        // Enable text wrapping for category names and question text
        if (header === 'category_name' || header === 'question' || header === 'question_text') {
          cell.alignment = { 
            vertical: 'top', 
            horizontal: 'left',
            wrapText: true 
          };
        }
        
        // Add borders
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      });
      currentRow++;
    });

    return currentRow;
  }

  private async getQuestionLevelBreakdown(rawData: any[], filters: any): Promise<any> {
    // Get question-level data from repository
    return await this.analyticsRepository.getQuestionLevelAnalytics(filters);
  }

  private async getCategoryLevelBreakdown(rawData: any[], filters: any): Promise<any> {
    // Get category-level data from repository
    return await this.analyticsRepository.getCategoryLevelAnalytics(filters);
  }

  private calculateRawScoreStatistics(rawData: any[]): any {
    
    const scores = rawData.map(r => r.total_score).filter(score => score !== null && score !== undefined && !isNaN(score));
    
    // Handle empty data case
    if (scores.length === 0) {
      return {
        count: 0,
        mean: 0,
        median: 0,
        mode: 0,
        standardDeviation: 0,
        min: 0,
        max: 0,
        percentiles: {
          p25: 0,
          p50: 0,
          p75: 0,
          p90: 0,
          p95: 0
        }
      };
    }

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const median = this.calculateMedian(scores);
    const mode = this.calculateMode(scores);
    const standardDeviation = this.calculateStandardDeviation(scores);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const percentiles = this.calculatePercentiles(scores);

    const result = {
      count: scores.length,
      mean: isNaN(mean) ? 0 : mean,
      median: isNaN(median) ? 0 : median,
      mode: isNaN(mode) ? 0 : mode,
      standardDeviation: isNaN(standardDeviation) ? 0 : standardDeviation,
      min: !isFinite(min) ? 0 : min,
      max: !isFinite(max) ? 0 : max,
      percentiles: percentiles || {
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0
      }
    };

    console.log('[ANALYTICS SERVICE] Raw score statistics result:', result);
    return result;
  }


  private calculateAveragesByDimension(rawData: any[], dimension: string): any[] {
    console.log(`[ANALYTICS SERVICE] calculateAveragesByDimension called for dimension: ${dimension}`);
    console.log(`[ANALYTICS SERVICE] Raw data sample:`, rawData.slice(0, 2));
    
    const grouped: { [key: string]: number[] } = {};
    
    rawData.forEach((item, index) => {
      let key: string;
      
      // Use the correct field names based on dimension
      if (dimension === 'csr') {
        key = item.csr_name || 'Unknown CSR';
      } else if (dimension === 'department') {
        key = item.department_name || 'Unknown Department';
      } else if (dimension === 'form') {
        key = item.form_name || 'Unknown Form';
      } else {
        // Fallback to group_name for backward compatibility
        key = item.group_name || 'Unknown';
      }
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      
      console.log(`[ANALYTICS SERVICE] Item ${index}: key="${key}", total_score=${item.total_score} (type: ${typeof item.total_score})`);
      grouped[key].push(item.total_score);
    });

    console.log(`[ANALYTICS SERVICE] Grouped data for ${dimension}:`, grouped);

    const result = Object.keys(grouped).map(key => {
      const scores = grouped[key];
      const sum = scores.reduce((a, b) => a + b, 0);
      const average = sum / scores.length;
      
      console.log(`[ANALYTICS SERVICE] ${dimension} "${key}": scores=[${scores.join(', ')}], sum=${sum}, average=${average}`);
      
      return {
        name: key,
        averageScore: Math.round(average * 100) / 100,
        count: scores.length,
        standardDeviation: Math.round(this.calculateStandardDeviation(scores) * 100) / 100
      };
    });

    console.log(`[ANALYTICS SERVICE] Final result for ${dimension}:`, result);
    return result;
  }

  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    } else {
      return sorted[middle];
    }
  }

  private calculatePercentiles(values: number[]): { p25: number; p50: number; p75: number; p90: number; p95: number } {
    if (values.length === 0) {
      return { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    
    const percentile = (p: number): number => {
      const index = (p / 100) * (sorted.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index % 1;
      
      if (upper >= sorted.length) return sorted[sorted.length - 1];
      return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };
    
    return {
      p25: percentile(25),
      p50: percentile(50),
      p75: percentile(75),
      p90: percentile(90),
      p95: percentile(95)
    };
  }


  private calculateMode(values: number[]): number {
    if (values.length === 0) return 0;
    
    const frequency: { [key: number]: number } = {};
    values.forEach(value => {
      frequency[value] = (frequency[value] || 0) + 1;
    });
    
    let maxFreq = 0;
    let mode = values[0];
    Object.keys(frequency).forEach(value => {
      if (frequency[Number(value)] > maxFreq) {
        maxFreq = frequency[Number(value)];
        mode = Number(value);
      }
    });
    
    return isNaN(mode) ? 0 : mode;
  }


} 
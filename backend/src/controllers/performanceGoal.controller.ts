import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { PerformanceGoal, PerformanceGoalDTO, PaginatedResponse } from '../types/performanceGoal.types';
import { serviceLogger } from '../config/logger';

/**
 * Get all performance goals with pagination and filtering
 * @route GET /api/performance-goals
 */
export const getPerformanceGoals = async (req: Request, res: Response): Promise<void> => {
  try {
    // Extract query parameters
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const goal_type = req.query.goal_type as string;
    const department_id = req.query.department_id ? parseInt(req.query.department_id as string) : undefined;
    const is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
    
    serviceLogger.operation('performance-goals', 'getPerformanceGoals', req.user?.user_id, {
      page, pageSize, goal_type, department_id, is_active
    });
    
    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;
    
    // Build where conditions
    const where: any = {};
    
    if (goal_type) {
      where.goal_type = goal_type;
    }
    
    if (department_id !== undefined) {
      where.OR = [
        { scope: 'GLOBAL' },
        { scope: 'DEPARTMENT', department_id: department_id }
      ];
    }
    
    if (is_active !== undefined) {
      where.is_active = is_active;
    }
    
    try {
      // Get total count for pagination
      const total = await prisma.performanceGoal.count({ where });
      
      // Validate pagination parameters
      const validatedLimit = Math.min(Math.max(parseInt(String(pageSize)) || 50, 1), 1000);
      const validatedOffset = Math.max(parseInt(String(offset)) || 0, 0);
      
      // Execute the final query
      const rows = await prisma.performanceGoal.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: validatedLimit,
        skip: validatedOffset
      });
      
      // Create the paginated response
      const response: PaginatedResponse<any> = {
        data: rows || [],
        total,
        page,
        pageSize
      };
      
      res.status(200).json(response);
    } catch (error) {
      serviceLogger.error('performance-goals', 'getPerformanceGoals-database', error as Error, req.user?.user_id);
      // Return empty results instead of error
      const response: PaginatedResponse<PerformanceGoal> = {
        data: [],
        total: 0,
        page,
        pageSize
      };
      res.status(200).json(response);
    }
  } catch (error) {
    serviceLogger.error('performance-goals', 'getPerformanceGoals', error as Error, req.user?.user_id);
    // Always return valid data structure even on error
    res.status(200).json({
      data: [],
      total: 0,
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 10
    });
  }
};

/**
 * Get a performance goal by ID
 * @route GET /api/performance-goals/:id
 */
export const getPerformanceGoalById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    
    const goal = await prisma.performanceGoal.findUnique({ where: { id } });
    
    if (!goal) {
      res.status(404).json({ message: 'Performance goal not found' });
      return;
    }
    
    res.status(200).json(goal);
  } catch (error) {
    serviceLogger.error('performance-goals', 'getPerformanceGoalById', error as Error, req.user?.user_id, { goal_id: req.params.id });
    res.status(500).json({ message: 'Failed to fetch performance goal' });
  }
};

/**
 * Create a new performance goal
 * @route POST /api/performance-goals
 */
export const createPerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const goalData: PerformanceGoalDTO = req.body;
    
    // Validate the goal data
    if (!goalData.goal_type || !goalData.scope || goalData.target_value === undefined) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }
    
    // Currently only QA_SCORE is supported - AUDIT_RATE and DISPUTE_RATE are future enhancements
    if (goalData.goal_type !== 'QA_SCORE') {
      res.status(400).json({ message: 'Only QA_SCORE goal type is currently supported' });
      return;
    }
    
    // Validate target value based on goal type
    if (goalData.goal_type === 'QA_SCORE' && (goalData.target_value < 0 || goalData.target_value > 100)) {
      res.status(400).json({ message: 'QA Score target value must be between 0 and 100' });
      return;
    }
    
    // Validate department ID is provided if scope is DEPARTMENT
    if (goalData.scope === 'DEPARTMENT' && !goalData.department_id) {
      res.status(400).json({ message: 'Department ID is required when scope is DEPARTMENT' });
      return;
    }
    
    // Set department_id to null if scope is GLOBAL
    if (goalData.scope === 'GLOBAL') {
      goalData.department_id = null;
    }
    
    // Check if a similar goal already exists and is active
    const existingGoals = await prisma.performanceGoal.findMany({
      where: {
        goal_type: goalData.goal_type as any,
        scope: goalData.scope as any,
        is_active: true,
        ...(goalData.scope === 'DEPARTMENT' ? { department_id: goalData.department_id } : {})
      }
    });
    
    if (existingGoals.length > 0) {
      res.status(409).json({ 
        message: 'An active goal with the same type and scope already exists', 
        existingGoal: existingGoals[0] 
      });
      return;
    }
    
    // Insert the new goal
    const newGoal = await prisma.performanceGoal.create({
      data: {
        goal_type: goalData.goal_type as any,
        target_value: goalData.target_value,
        scope: goalData.scope as any,
        department_id: goalData.department_id ?? null,
        description: goalData.description ?? null,
        is_active: goalData.is_active !== undefined ? goalData.is_active : true
      }
    });
    
    // Log the action in audit_logs
    const user_id = req.user?.user_id || 1;
    await prisma.auditLog.create({
      data: {
        user_id: user_id,
        action: 'CREATE',
        target_id: newGoal.id,
        target_type: 'performance_goals',
        details: JSON.stringify(goalData)
      }
    });
    
    res.status(201).json(newGoal);
  } catch (error) {
    serviceLogger.error('performance-goals', 'createPerformanceGoal', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to create performance goal' });
  }
};

/**
 * Update a performance goal
 * @route PUT /api/performance-goals/:id
 */
export const updatePerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const goalData: Partial<PerformanceGoalDTO> = req.body;
    
    // Retrieve the current goal to validate changes
    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    
    if (!existingGoal) {
      res.status(404).json({ message: 'Performance goal not found' });
      return;
    }
    
    // Apply changes to existing goal data
    const updatedGoal = {
      ...existingGoal,
      ...goalData
    };
    
    // Currently only QA_SCORE is supported - AUDIT_RATE and DISPUTE_RATE are future enhancements
    if (goalData.goal_type && goalData.goal_type !== 'QA_SCORE') {
      res.status(400).json({ message: 'Only QA_SCORE goal type is currently supported' });
      return;
    }
    
    // Validate target value based on goal type
    if (updatedGoal.goal_type === 'QA_SCORE' && (Number(updatedGoal.target_value) < 0 || Number(updatedGoal.target_value) > 100)) {
      res.status(400).json({ message: 'QA Score target value must be between 0 and 100' });
      return;
    }
    
    // Validate department ID is provided if scope is DEPARTMENT
    if (updatedGoal.scope === 'DEPARTMENT' && !updatedGoal.department_id) {
      res.status(400).json({ message: 'Department ID is required when scope is DEPARTMENT' });
      return;
    }
    
    // Set department_id to null if scope is GLOBAL
    if (updatedGoal.scope === 'GLOBAL') {
      updatedGoal.department_id = null;
    }
    
    // Check if a similar goal already exists and is active (only if we're changing key fields)
    if (
      (goalData.goal_type && goalData.goal_type !== existingGoal.goal_type) ||
      (goalData.scope && goalData.scope !== existingGoal.scope) ||
      (goalData.department_id !== undefined && goalData.department_id !== existingGoal.department_id)
    ) {
      const conflictingGoals = await prisma.performanceGoal.findMany({
        where: {
          id: { not: id },
          goal_type: updatedGoal.goal_type as any,
          scope: updatedGoal.scope as any,
          is_active: true,
          ...(updatedGoal.scope === 'DEPARTMENT' ? { department_id: updatedGoal.department_id } : {})
        }
      });
      
      if (conflictingGoals.length > 0) {
        res.status(409).json({ 
          message: 'An active goal with the same type and scope already exists', 
          existingGoal: conflictingGoals[0] 
        });
        return;
      }
    }
    
    // Update the goal
    const updated = await prisma.performanceGoal.update({
      where: { id },
      data: {
        goal_type: updatedGoal.goal_type as any,
        target_value: updatedGoal.target_value,
        scope: updatedGoal.scope as any,
        department_id: updatedGoal.department_id ?? null,
        description: updatedGoal.description ?? null,
        is_active: updatedGoal.is_active
      }
    });
    
    // Log the action in audit_logs
    const user_id = req.user?.user_id || 1;
    await prisma.auditLog.create({
      data: {
        user_id: user_id,
        action: 'UPDATE',
        target_id: id,
        target_type: 'performance_goals',
        details: JSON.stringify(goalData)
      }
    });
    
    res.status(200).json(updated);
  } catch (error) {
    serviceLogger.error('performance-goals', 'updatePerformanceGoal', error as Error, req.user?.user_id, { goal_id: req.params.id });
    res.status(500).json({ message: 'Failed to update performance goal' });
  }
};

/**
 * Delete a performance goal (soft delete by setting is_active to false)
 * @route DELETE /api/performance-goals/:id
 */
export const deletePerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    
    // Check if the goal exists
    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    
    if (!existingGoal) {
      res.status(404).json({ message: 'Performance goal not found' });
      return;
    }
    
    // Soft delete by setting is_active to false
    await prisma.performanceGoal.update({
      where: { id },
      data: { is_active: false }
    });
    
    // Log the action in audit_logs
    const user_id = req.user?.user_id || 1;
    await prisma.auditLog.create({
      data: {
        user_id: user_id,
        action: 'DEACTIVATE',
        target_id: id,
        target_type: 'performance_goals',
        details: JSON.stringify({ is_active: false })
      }
    });
    
    res.status(200).json({ message: 'Performance goal deactivated successfully' });
  } catch (error) {
    serviceLogger.error('performance-goals', 'deletePerformanceGoal', error as Error, req.user?.user_id, { goal_id: req.params.id });
    res.status(500).json({ message: 'Failed to delete performance goal' });
  }
};

/**
 * Activate a performance goal by setting is_active to true
 * @route PATCH /api/performance-goals/:id/activate
 */
export const activatePerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    
    // Check if the goal exists
    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    
    if (!existingGoal) {
      res.status(404).json({ message: 'Performance goal not found' });
      return;
    }
    
    // Check if a similar goal already exists and is active
    const conflictingGoals = await prisma.performanceGoal.findMany({
      where: {
        id: { not: id },
        goal_type: existingGoal.goal_type as any,
        scope: existingGoal.scope as any,
        is_active: true,
        ...(existingGoal.scope === 'DEPARTMENT' ? { department_id: existingGoal.department_id } : {})
      }
    });
    
    if (conflictingGoals.length > 0) {
      res.status(409).json({ 
        message: 'An active goal with the same type and scope already exists', 
        existingGoal: conflictingGoals[0] 
      });
      return;
    }
    
    // Activate the goal
    await prisma.performanceGoal.update({
      where: { id },
      data: { is_active: true }
    });
    
    // Log the action in audit_logs
    const user_id = req.user?.user_id || 1;
    await prisma.auditLog.create({
      data: {
        user_id: user_id,
        action: 'ACTIVATE',
        target_id: id,
        target_type: 'performance_goals',
        details: JSON.stringify({ is_active: true })
      }
    });
    
    res.status(200).json({ message: 'Performance goal activated successfully' });
  } catch (error) {
    serviceLogger.error('performance-goals', 'activatePerformanceGoal', error as Error, req.user?.user_id, { goal_id: req.params.id });
    res.status(500).json({ message: 'Failed to activate performance goal' });
  }
};

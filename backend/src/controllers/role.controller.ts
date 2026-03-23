import { Request, Response } from 'express';
import prisma from '../config/prisma';

/**
 * Get all roles
 */
export const getRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      select: { id: true, role_name: true },
      orderBy: { id: 'asc' }
    });
    res.status(200).json(roles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
};

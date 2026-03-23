import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names using clsx and merges Tailwind classes with tailwind-merge
 * This prevents duplicate Tailwind classes and ensures proper overriding
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
} 
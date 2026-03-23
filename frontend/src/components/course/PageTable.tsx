import React from 'react';
import RichContentDisplay from '../common/RichContentDisplay';
import Button from '../ui/Button';
import type { CoursePage } from '../../types/course.types';

interface PageTableProps {
  pages: CoursePage[];
  onPagesChange: (pages: CoursePage[]) => void;
  onEditPage: (index: number) => void;
  onDeletePage: (index: number) => void;
}

const PageTable: React.FC<PageTableProps> = ({
  pages,
  onPagesChange,
  onEditPage,
  onDeletePage,
}) => {
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    
    const newPages = [...pages];
    [newPages[index - 1], newPages[index]] = [newPages[index], newPages[index - 1]];
    
    // Update page_order
    const updatedPages = newPages.map((page, i) => ({
      ...page,
      page_order: i + 1,
    }));

    onPagesChange(updatedPages);
  };

  const handleMoveDown = (index: number) => {
    if (index === pages.length - 1) return;
    
    const newPages = [...pages];
    [newPages[index], newPages[index + 1]] = [newPages[index + 1], newPages[index]];
    
    // Update page_order
    const updatedPages = newPages.map((page, i) => ({
      ...page,
      page_order: i + 1,
    }));

    onPagesChange(updatedPages);
  };

  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'TEXT':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm2 2h8v2H6V6zm0 4h8v2H6v-2z" />
          </svg>
        );
      case 'VIDEO':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
          </svg>
        );
      case 'PDF':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm3 5a1 1 0 000 2h1a1 1 0 100-2H7zm5.5-1a2.5 2.5 0 100 5H11a1 1 0 110-2h1.5a.5.5 0 000-1H11a1 1 0 110-2h1.5z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getContentPreview = (page: CoursePage) => {
    if (page.content_type === 'TEXT' && page.content_text) {
      // Strip HTML tags for preview and limit length
      const textOnly = page.content_text.replace(/<[^>]*>/g, '').trim();
      return textOnly.length > 50 ? textOnly.substring(0, 50) + '...' : textOnly;
    }
    return page.content_url || 'No content';
  };

  if (pages.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No pages added yet. Click "Add Page" to get started.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Page Title
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Content Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Content Preview
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pages.map((page, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900">
                      {page.page_order}
                    </span>
                    <div className="flex flex-col space-y-1">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="w-4 h-4 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === pages.length - 1}
                        className="w-4 h-4 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {page.page_title}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <span className="mr-2 text-gray-400">
                      {getContentTypeIcon(page.content_type)}
                    </span>
                    <span className="text-sm text-gray-900">
                      {page.content_type === 'TEXT' ? 'Rich Text' : page.content_type}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-500 max-w-xs">
                    <div className="truncate">
                      {getContentPreview(page)}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditPage(index)}
                    className="text-indigo-600 hover:text-indigo-900 mr-4"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeletePage(index)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PageTable; 
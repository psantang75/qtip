import React, { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import SimpleCourseBuilder from './SimpleCourseBuilder';
import type { CoursePage } from '../../types/course.types';

interface PageFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (page: CoursePage) => void;
  page?: CoursePage;
  nextPageOrder: number;
}

const PageForm: React.FC<PageFormProps> = ({
  isOpen,
  onClose,
  onSave,
  page,
  nextPageOrder,
}) => {
  const [showVisualEditor, setShowVisualEditor] = useState(true);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    setValue,
    formState: { errors },
  } = useForm<CoursePage>({
    defaultValues: {
      page_title: '',
      content_type: 'TEXT',
      content_url: '',
      content_text: '',
      page_order: nextPageOrder,
    },
  });

  const contentType = watch('content_type');
  const currentPageData = watch();

  // Reset form when modal opens/closes or page changes
  useEffect(() => {
    if (isOpen) {
      if (page) {
        reset(page);
        setShowVisualEditor(page.content_type === 'TEXT');
      } else {
        reset({
          page_title: '',
          content_type: 'TEXT',
          content_url: '',
          content_text: '',
          page_order: nextPageOrder,
        });
        setShowVisualEditor(true);
      }
    }
  }, [isOpen, page, nextPageOrder, reset]);

  const onSubmit = (data: CoursePage) => {
    onSave(data);
    onClose();
  };

  const validateUrl = (value: string | undefined) => {
    if (!value) return 'URL is required for video and PDF content';
    try {
      new URL(value);
      return true;
    } catch {
      return 'Please enter a valid URL';
    }
  };

  const handleContentTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as 'TEXT' | 'VIDEO' | 'PDF';
    setValue('content_type', newType);
    setShowVisualEditor(newType === 'TEXT');
    
    // Clear content when switching types
    if (newType === 'TEXT') {
      setValue('content_url', '');
    } else {
      setValue('content_text', '');
    }
  };

  const handleVisualEditorChange = (updatedPage: CoursePage) => {
    setValue('page_title', updatedPage.page_title);
    setValue('content_text', updatedPage.content_text || '');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-7xl max-h-[95vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {page ? 'Edit Page' : 'Add Page'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Page Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Title *
            </label>
            <input
              type="text"
              {...register('page_title', {
                required: 'Page title is required',
                maxLength: {
                  value: 100,
                  message: 'Page title must be 100 characters or less',
                },
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter page title"
            />
            {errors.page_title && (
              <p className="mt-1 text-sm text-red-600">{errors.page_title.message}</p>
            )}
          </div>

          {/* Content Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Content Type *
            </label>
            <select
              {...register('content_type', { required: 'Content type is required' })}
              onChange={handleContentTypeChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="TEXT">Text (Visual Page Builder)</option>
              <option value="VIDEO">Video</option>
              <option value="PDF">PDF</option>
            </select>
            {errors.content_type && (
              <p className="mt-1 text-sm text-red-600">{errors.content_type.message}</p>
            )}
          </div>

          {/* Simple Visual Page Builder (for Text) */}
          {showVisualEditor && contentType === 'TEXT' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Page Content - Visual Builder
              </label>
              <div className="border border-gray-300 rounded-lg overflow-hidden bg-gray-50" style={{ height: '600px' }}>
                <SimpleCourseBuilder
                  page={{
                    id: page?.id,
                    course_id: page?.course_id || 0,
                    page_title: currentPageData.page_title || '',
                    content_type: 'TEXT',
                    content_text: currentPageData.content_text,
                    page_order: currentPageData.page_order || nextPageOrder,
                  }}
                  onChange={handleVisualEditorChange}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                🎨 <strong>Simple Visual Builder:</strong> Choose a template from the left, add elements by clicking them, drag to move, double-click to edit text, and use the right panel to customize styling.
              </p>
            </div>
          )}

          {/* Content URL (for Video/PDF) */}
          {(contentType === 'VIDEO' || contentType === 'PDF') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content URL *
              </label>
              <input
                type="url"
                {...register('content_url', {
                  validate: validateUrl,
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder={`Enter ${contentType.toLowerCase()} URL`}
              />
              {errors.content_url && (
                <p className="mt-1 text-sm text-red-600">{errors.content_url.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {contentType === 'VIDEO' ? 
                  'Supported formats: MP4, WebM, YouTube URLs, Vimeo URLs' : 
                  'Supported formats: PDF files hosted online'
                }
              </p>
            </div>
          )}

          {/* Page Order */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Order
            </label>
            <input
              type="number"
              {...register('page_order', {
                required: 'Page order is required',
                min: { value: 1, message: 'Page order must be at least 1' },
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              min="1"
            />
            {errors.page_order && (
              <p className="mt-1 text-sm text-red-600">{errors.page_order.message}</p>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {page ? 'Update Page' : 'Add Page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PageForm; 
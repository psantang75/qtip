import React, { useState } from 'react';
import VisualCoursePageEditor from './VisualCoursePageEditor';

interface CoursePage {
  id?: number;
  course_id: number;
  page_title: string;
  content_type: 'TEXT' | 'VIDEO' | 'PDF';
  content_url?: string;
  content_text?: string;
  page_order: number;
}

const CoursePageDemo: React.FC = () => {
  const [page, setPage] = useState<CoursePage>({
    id: 1,
    course_id: 1,
    page_title: 'Introduction to Customer Service',
    content_type: 'TEXT',
    content_text: '',
    page_order: 1,
  });

  const handlePageChange = (updatedPage: CoursePage) => {
    setPage(updatedPage);
    console.log('Page updated:', updatedPage);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Visual Course Page Editor Demo</h1>
      <p>This shows how your course pages would be built with a PowerPoint-like interface.</p>
      
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '20px' }}>
        <VisualCoursePageEditor
          page={page}
          onChange={handlePageChange}
        />
      </div>

      {/* Show generated HTML */}
      <div style={{ marginTop: '20px' }}>
        <h3>Generated HTML Content:</h3>
        <pre style={{ 
          background: '#f8fafc', 
          padding: '16px', 
          borderRadius: '6px', 
          fontSize: '12px',
          overflow: 'auto',
          maxHeight: '200px'
        }}>
          {page.content_text || 'No content generated yet...'}
        </pre>
      </div>
    </div>
  );
};

export default CoursePageDemo; 
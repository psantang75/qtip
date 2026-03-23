import React from 'react';

interface RichContentDisplayProps {
  content: string;
  className?: string;
}

const RichContentDisplay: React.FC<RichContentDisplayProps> = ({ 
  content, 
  className = '' 
}) => {
  return (
    <div 
      className={`rich-content-display prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: content }}
      style={{
        // Custom styles to match Quill's output
        lineHeight: '1.6',
      }}
    />
  );
};

export default RichContentDisplay; 
import React, { useState, useCallback, useRef } from 'react';
import EnhancedRichTextEditor from '../common/EnhancedRichTextEditor';

interface CoursePage {
  id?: number;
  course_id: number;
  page_title: string;
  content_type: 'TEXT' | 'VIDEO' | 'PDF';
  content_url?: string;
  content_text?: string;
  page_order: number;
}

interface VisualCoursePageEditorProps {
  page: CoursePage;
  onChange: (page: CoursePage) => void;
  onDelete?: () => void;
  className?: string;
}

interface ContentBlock {
  id: string;
  type: 'heading' | 'text' | 'image' | 'video' | 'list' | 'quote' | 'divider' | 'button' | 'info-box';
  content: string;
  style?: {
    textAlign?: 'left' | 'center' | 'right';
    fontSize?: string;
    color?: string;
    backgroundColor?: string;
    padding?: string;
    margin?: string;
  };
  settings?: {
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    listType?: 'bullet' | 'numbered';
    imageAlt?: string;
    videoUrl?: string;
    buttonLink?: string;
    buttonStyle?: 'primary' | 'secondary' | 'outline';
  };
}

const CONTENT_BLOCKS = [
  { type: 'heading', label: 'Heading', icon: '📖', description: 'Add a title or heading' },
  { type: 'text', label: 'Text Block', icon: '📝', description: 'Add paragraphs of text' },
  { type: 'image', label: 'Image', icon: '🖼️', description: 'Insert an image' },
  { type: 'video', label: 'Video', icon: '🎥', description: 'Embed a video' },
  { type: 'list', label: 'List', icon: '📋', description: 'Add bullet or numbered lists' },
  { type: 'quote', label: 'Quote', icon: '💬', description: 'Add a highlighted quote' },
  { type: 'divider', label: 'Divider', icon: '➖', description: 'Add a visual separator' },
  { type: 'button', label: 'Button', icon: '🔘', description: 'Add an action button' },
  { type: 'info-box', label: 'Info Box', icon: 'ℹ️', description: 'Add an information callout' },
];

const VisualCoursePageEditor: React.FC<VisualCoursePageEditorProps> = ({
  page,
  onChange,
  onDelete,
  className = '',
}) => {
  const [currentView, setCurrentView] = useState<'edit' | 'preview'>('edit');
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([
    {
      id: '1',
      type: 'heading',
      content: page.page_title || 'Page Title',
      settings: { headingLevel: 1 },
      style: { textAlign: 'center', fontSize: '2em', color: '#1f2937' }
    }
  ]);

  const generateId = () => `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const addContentBlock = useCallback((blockType: string) => {
    const newBlock: ContentBlock = {
      id: generateId(),
      type: blockType as any,
      content: getDefaultContent(blockType),
      style: getDefaultStyle(blockType),
      settings: getDefaultSettings(blockType),
    };

    setContentBlocks(prev => [...prev, newBlock]);
    setSelectedBlock(newBlock.id);
  }, []);

  const updateBlock = useCallback((blockId: string, updates: Partial<ContentBlock>) => {
    setContentBlocks(prev => prev.map(block =>
      block.id === blockId ? { ...block, ...updates } : block
    ));
  }, []);

  const removeBlock = useCallback((blockId: string) => {
    setContentBlocks(prev => prev.filter(block => block.id !== blockId));
    setSelectedBlock(null);
  }, []);

  const moveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
    setContentBlocks(prev => {
      const index = prev.findIndex(block => block.id === blockId);
      if (index === -1) return prev;
      
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      
      const newBlocks = [...prev];
      [newBlocks[index], newBlocks[newIndex]] = [newBlocks[newIndex], newBlocks[index]];
      return newBlocks;
    });
  }, []);

  // Update the page content when blocks change
  React.useEffect(() => {
    const htmlContent = contentBlocks.map(block => renderBlockAsHTML(block)).join('\n');
    onChange({
      ...page,
      content_text: htmlContent,
      content_type: 'TEXT'
    });
  }, [contentBlocks, page, onChange]);

  const renderBlock = (block: ContentBlock, isEditing: boolean = false) => {
    const blockStyle = {
      ...block.style,
      position: 'relative' as const,
      minHeight: '40px',
      padding: block.style?.padding || '12px',
      margin: block.style?.margin || '8px 0',
    };

    const isSelected = selectedBlock === block.id;
    
    switch (block.type) {
      case 'heading':
        const headingLevel = block.settings?.headingLevel || 1;
        const HeadingElement = React.createElement(
          `h${headingLevel}`,
          {
            key: block.id,
            style: blockStyle,
            className: `content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`,
            onClick: () => isEditing && setSelectedBlock(block.id),
            contentEditable: isEditing && isSelected,
            suppressContentEditableWarning: true,
            onBlur: (e: React.FocusEvent<HTMLElement>) => updateBlock(block.id, { content: e.currentTarget.textContent || '' })
          },
          block.content
        );
        return HeadingElement;

      case 'text':
        return (
          <div
            key={block.id}
            style={blockStyle}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          >
            {isEditing && isSelected ? (
              <EnhancedRichTextEditor
                value={block.content}
                onChange={(content) => updateBlock(block.id, { content })}
                height="200px"
                mode="edit"
                showPreview={false}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: block.content }} />
            )}
          </div>
        );

      case 'image':
        return (
          <div
            key={block.id}
            style={blockStyle}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          >
            {block.content ? (
              <img 
                src={block.content} 
                alt={block.settings?.imageAlt || 'Course image'} 
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            ) : (
              <div className="placeholder-image">
                🖼️ Click to add image URL
              </div>
            )}
          </div>
        );

      case 'video':
        return (
          <div
            key={block.id}
            style={blockStyle}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          >
            {block.content ? (
              <div className="video-container">
                <iframe
                  src={getEmbedUrl(block.content)}
                  width="100%"
                  height="315"
                  frameBorder="0"
                  allowFullScreen
                  title="Course video"
                />
              </div>
            ) : (
              <div className="placeholder-video">
                🎥 Click to add video URL
              </div>
            )}
          </div>
        );

      case 'list':
        const ListTag = block.settings?.listType === 'numbered' ? 'ol' : 'ul';
        const items = block.content.split('\n').filter(item => item.trim());
        return (
          <ListTag
            key={block.id}
            style={blockStyle}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          >
            {items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ListTag>
        );

      case 'quote':
        return (
          <blockquote
            key={block.id}
            style={{
              ...blockStyle,
              borderLeft: '4px solid #3b82f6',
              backgroundColor: '#f8fafc',
              fontStyle: 'italic',
            }}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
            contentEditable={isEditing && isSelected}
            suppressContentEditableWarning
            onBlur={(e) => updateBlock(block.id, { content: e.currentTarget.textContent || '' })}
          >
            {block.content}
          </blockquote>
        );

      case 'divider':
        return (
          <hr
            key={block.id}
            style={{
              ...blockStyle,
              border: 'none',
              height: '1px',
              backgroundColor: '#e2e8f0',
            }}
            className={`content-block ${isSelected ? 'selected' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          />
        );

      case 'button':
        return (
          <div
            key={block.id}
            style={blockStyle}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
          >
            <button
              className={`course-button ${block.settings?.buttonStyle || 'primary'}`}
              onClick={(e) => isEditing && e.preventDefault()}
            >
              {block.content}
            </button>
          </div>
        );

      case 'info-box':
        return (
          <div
            key={block.id}
            style={{
              ...blockStyle,
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '6px',
              color: '#1e40af',
            }}
            className={`content-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editable' : ''}`}
            onClick={() => isEditing && setSelectedBlock(block.id)}
            contentEditable={isEditing && isSelected}
            suppressContentEditableWarning
            onBlur={(e) => updateBlock(block.id, { content: e.currentTarget.textContent || '' })}
          >
            <strong>ℹ️ Information:</strong> {block.content}
          </div>
        );

      default:
        return null;
    }
  };

  const renderPropertyPanel = () => {
    const block = contentBlocks.find(b => b.id === selectedBlock);
    if (!block) return null;

    return (
      <div className="property-panel">
        <h4>Properties</h4>
        
        {/* Content editing */}
        <div className="property-group">
          <label>Content:</label>
          {block.type === 'image' && (
            <input
              type="url"
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Image URL"
            />
          )}
          {block.type === 'video' && (
            <input
              type="url"
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Video URL (YouTube, Vimeo, etc.)"
            />
          )}
          {block.type === 'list' && (
            <textarea
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="One item per line"
              rows={4}
            />
          )}
          {['heading', 'quote', 'button', 'info-box'].includes(block.type) && (
            <input
              type="text"
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Enter text..."
            />
          )}
        </div>

        {/* Style controls */}
        <div className="property-group">
          <label>Text Align:</label>
          <select
            value={block.style?.textAlign || 'left'}
            onChange={(e) => updateBlock(block.id, { 
              style: { ...block.style, textAlign: e.target.value as any }
            })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>

        <div className="property-group">
          <label>Text Color:</label>
          <input
            type="color"
            value={block.style?.color || '#000000'}
            onChange={(e) => updateBlock(block.id, { 
              style: { ...block.style, color: e.target.value }
            })}
          />
        </div>

        <div className="property-group">
          <label>Background:</label>
          <input
            type="color"
            value={block.style?.backgroundColor || '#ffffff'}
            onChange={(e) => updateBlock(block.id, { 
              style: { ...block.style, backgroundColor: e.target.value }
            })}
          />
        </div>

        {/* Type-specific settings */}
        {block.type === 'heading' && (
          <div className="property-group">
            <label>Heading Level:</label>
            <select
              value={block.settings?.headingLevel || 1}
              onChange={(e) => updateBlock(block.id, { 
                settings: { ...block.settings, headingLevel: parseInt(e.target.value) as any }
              })}
            >
              {[1,2,3,4,5,6].map(level => (
                <option key={level} value={level}>H{level}</option>
              ))}
            </select>
          </div>
        )}

        {block.type === 'list' && (
          <div className="property-group">
            <label>List Type:</label>
            <select
              value={block.settings?.listType || 'bullet'}
              onChange={(e) => updateBlock(block.id, { 
                settings: { ...block.settings, listType: e.target.value as any }
              })}
            >
              <option value="bullet">Bullet Points</option>
              <option value="numbered">Numbered</option>
            </select>
          </div>
        )}

        <div className="property-actions">
          <button onClick={() => moveBlock(block.id, 'up')}>↑ Move Up</button>
          <button onClick={() => moveBlock(block.id, 'down')}>↓ Move Down</button>
          <button 
            onClick={() => removeBlock(block.id)}
            className="danger"
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`visual-course-editor ${className}`}>
      <style>
        {`
          .visual-course-editor {
            display: grid;
            grid-template-columns: 200px 1fr 250px;
            height: 100vh;
            max-height: 800px;
            background: #f8fafc;
            border-radius: 8px;
            overflow: hidden;
          }

          /* Left Panel - Content Blocks */
          .content-library {
            background: white;
            border-right: 1px solid #e2e8f0;
            padding: 16px;
            overflow-y: auto;
          }

          .library-header {
            font-weight: 600;
            color: #374151;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e2e8f0;
          }

          .content-block-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            margin-bottom: 8px;
            background: white;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .content-block-option:hover {
            border-color: #3b82f6;
            box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);
            transform: translateY(-1px);
          }

          .block-icon {
            font-size: 16px;
            width: 20px;
            text-align: center;
          }

          .block-info h4 {
            margin: 0;
            font-size: 14px;
            color: #374151;
            font-weight: 500;
          }

          .block-info p {
            margin: 0;
            font-size: 12px;
            color: #6b7280;
          }

          /* Center Panel - Editor */
          .editor-panel {
            background: white;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .editor-toolbar {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .page-title-input {
            border: none;
            background: transparent;
            font-size: 18px;
            font-weight: 600;
            color: #374151;
            flex: 1;
            padding: 8px;
          }

          .view-toggle {
            display: flex;
            gap: 4px;
          }

          .view-btn {
            padding: 6px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #374151;
            transition: all 0.15s ease;
          }

          .view-btn:hover {
            background: #f3f4f6;
            border-color: #9ca3af;
          }

          .view-btn.active {
            background: #3b82f6;
            color: white;
            border-color: #3b82f6;
          }

          .editor-content {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
            background: white;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
          }

          .content-block {
            border: 2px solid transparent;
            border-radius: 4px;
            transition: all 0.2s ease;
            position: relative;
          }

          .content-block:hover {
            border-color: #e5e7eb;
          }

          .content-block.selected {
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
          }

          .content-block.editable:hover::after {
            content: '✏️';
            position: absolute;
            top: 4px;
            right: 4px;
            background: #3b82f6;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }

          .placeholder-image, .placeholder-video {
            background: #f3f4f6;
            border: 2px dashed #d1d5db;
            border-radius: 6px;
            padding: 40px;
            text-align: center;
            color: #6b7280;
            font-size: 16px;
            cursor: pointer;
          }

          .placeholder-image:hover, .placeholder-video:hover {
            background: #e5e7eb;
            border-color: #9ca3af;
          }

          .video-container {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%; /* 16:9 aspect ratio */
          }

          .video-container iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
          }

          .course-button {
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .course-button.primary {
            background: #3b82f6;
            color: white;
          }

          .course-button.secondary {
            background: #6b7280;
            color: white;
          }

          .course-button.outline {
            background: transparent;
            color: #3b82f6;
            border: 2px solid #3b82f6;
          }

          /* Right Panel - Properties */
          .property-panel {
            background: white;
            border-left: 1px solid #e2e8f0;
            padding: 16px;
            overflow-y: auto;
          }

          .property-panel h4 {
            margin: 0 0 16px 0;
            font-size: 16px;
            font-weight: 600;
            color: #374151;
          }

          .property-group {
            margin-bottom: 16px;
          }

          .property-group label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #374151;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .property-group input,
          .property-group select,
          .property-group textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            font-size: 14px;
          }

          .property-group input[type="color"] {
            height: 36px;
            padding: 4px;
            cursor: pointer;
          }

          .property-actions {
            margin-top: 24px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .property-actions button {
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            background: white;
            color: #374151;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .property-actions button:hover {
            background: #f3f4f6;
            border-color: #9ca3af;
          }

          .property-actions button.danger {
            color: #dc2626;
            border-color: #dc2626;
          }

          .property-actions button.danger:hover {
            background: #fee2e2;
          }

          .empty-editor {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 300px;
            color: #9ca3af;
            text-align: center;
          }

          .empty-editor-icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
        `}
      </style>

      {/* Left Panel - Content Blocks Library */}
      <div className="content-library">
        <div className="library-header">Content Blocks</div>
        {CONTENT_BLOCKS.map(blockType => (
          <div
            key={blockType.type}
            className="content-block-option"
            onClick={() => addContentBlock(blockType.type)}
          >
            <div className="block-icon">{blockType.icon}</div>
            <div className="block-info">
              <h4>{blockType.label}</h4>
              <p>{blockType.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Center Panel - Editor */}
      <div className="editor-panel">
        <div className="editor-toolbar">
          <input
            type="text"
            className="page-title-input"
            value={page.page_title}
            onChange={(e) => onChange({ ...page, page_title: e.target.value })}
            placeholder="Page Title"
          />
          <div className="view-toggle">
            <button
              className={`view-btn ${currentView === 'edit' ? 'active' : ''}`}
              onClick={() => setCurrentView('edit')}
            >
              Edit
            </button>
            <button
              className={`view-btn ${currentView === 'preview' ? 'active' : ''}`}
              onClick={() => setCurrentView('preview')}
            >
              Preview
            </button>
          </div>
        </div>

        <div className="editor-content">
          {contentBlocks.length === 0 ? (
            <div className="empty-editor">
              <div className="empty-editor-icon">📄</div>
              <h3>Start Building Your Course Page</h3>
              <p>Add content blocks from the left panel to create your course page</p>
            </div>
          ) : (
            contentBlocks.map(block => renderBlock(block, currentView === 'edit'))
          )}
        </div>
      </div>

      {/* Right Panel - Properties */}
      <div className="property-panel">
        {selectedBlock ? renderPropertyPanel() : (
          <div>
            <h4>Page Properties</h4>
            <div className="property-group">
              <label>Page Order:</label>
              <input
                type="number"
                value={page.page_order || 1}
                onChange={(e) => onChange({ ...page, page_order: parseInt(e.target.value) || 1 })}
                min="1"
              />
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px' }}>
              Select a content block to edit its properties
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper functions
function getDefaultContent(blockType: string): string {
  switch (blockType) {
    case 'heading': return 'New Heading';
    case 'text': return '<p>Enter your text content here...</p>';
    case 'image': return '';
    case 'video': return '';
    case 'list': return 'First item\nSecond item\nThird item';
    case 'quote': return 'Enter your quote here...';
    case 'button': return 'Click Me';
    case 'info-box': return 'Important information goes here';
    default: return '';
  }
}

function getDefaultStyle(blockType: string): any {
  switch (blockType) {
    case 'heading': return { textAlign: 'left', fontSize: '1.5em', color: '#1f2937' };
    case 'text': return { textAlign: 'left', fontSize: '1em', color: '#374151' };
    case 'quote': return { textAlign: 'left', fontSize: '1.1em', color: '#374151' };
    case 'button': return { textAlign: 'center' };
    default: return { textAlign: 'left', color: '#374151' };
  }
}

function getDefaultSettings(blockType: string): any {
  switch (blockType) {
    case 'heading': return { headingLevel: 2 };
    case 'list': return { listType: 'bullet' };
    case 'button': return { buttonStyle: 'primary' };
    default: return {};
  }
}

function renderBlockAsHTML(block: ContentBlock): string {
  const styleString = Object.entries(block.style || {})
    .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
    .join('; ');

  switch (block.type) {
    case 'heading':
      const level = block.settings?.headingLevel || 2;
      return `<h${level} style="${styleString}">${block.content}</h${level}>`;
    case 'text':
      return `<div style="${styleString}">${block.content}</div>`;
    case 'image':
      return `<img src="${block.content}" alt="${block.settings?.imageAlt || ''}" style="${styleString}; max-width: 100%; height: auto;" />`;
    case 'video':
      return `<div style="${styleString}"><iframe src="${getEmbedUrl(block.content)}" width="100%" height="315" frameborder="0" allowfullscreen></iframe></div>`;
    case 'list':
      const listTag = block.settings?.listType === 'numbered' ? 'ol' : 'ul';
      const items = block.content.split('\n').filter(item => item.trim());
      return `<${listTag} style="${styleString}">${items.map(item => `<li>${item}</li>`).join('')}</${listTag}>`;
    case 'quote':
      return `<blockquote style="${styleString}; border-left: 4px solid #3b82f6; background: #f8fafc; font-style: italic; padding: 16px; margin: 16px 0;">${block.content}</blockquote>`;
    case 'divider':
      return `<hr style="${styleString}; border: none; height: 1px; background: #e2e8f0; margin: 16px 0;" />`;
    case 'button':
      return `<div style="${styleString}"><button style="padding: 12px 24px; border: none; border-radius: 6px; font-weight: 600; background: #3b82f6; color: white;">${block.content}</button></div>`;
    case 'info-box':
      return `<div style="${styleString}; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; color: #1e40af;"><strong>ℹ️ Information:</strong> ${block.content}</div>`;
    default:
      return '';
  }
}

function getEmbedUrl(url: string): string {
  // Convert YouTube URLs to embed format
  if (url.includes('youtube.com/watch')) {
    const videoId = url.split('v=')[1]?.split('&')[0];
    return `https://www.youtube.com/embed/${videoId}`;
  }
  if (url.includes('youtu.be/')) {
    const videoId = url.split('youtu.be/')[1]?.split('?')[0];
    return `https://www.youtube.com/embed/${videoId}`;
  }
  
  // Convert Vimeo URLs to embed format
  if (url.includes('vimeo.com/')) {
    const videoId = url.split('vimeo.com/')[1]?.split('?')[0];
    return `https://player.vimeo.com/video/${videoId}`;
  }
  
  // Return as-is for direct embed URLs
  return url;
}

export default VisualCoursePageEditor; 
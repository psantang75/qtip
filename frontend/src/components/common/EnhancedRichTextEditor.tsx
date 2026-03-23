import React, { useRef, useEffect, useCallback, useState } from 'react';

interface EnhancedRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
  showPreview?: boolean;
  mode?: 'edit' | 'preview' | 'split';
  allowFormElements?: boolean;
}

const EnhancedRichTextEditor: React.FC<EnhancedRichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Start writing...',
  height = '400px',
  readOnly = false,
  showPreview = true,
  mode = 'split',
  allowFormElements = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [currentMode, setCurrentMode] = useState<'edit' | 'preview' | 'split'>(mode);
  const [isActive, setIsActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  });

  // Update content when value prop changes
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
    if (previewRef.current) {
      previewRef.current.innerHTML = value || '';
    }
  }, [value]);

  // Handle content changes with live preview update
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML;
      onChange(content);
      
      // Update preview in real-time
      if (previewRef.current) {
        previewRef.current.innerHTML = content;
      }
    }
  }, [onChange]);

  // Update active states based on cursor position
  const updateActiveStates = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      setIsActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikethrough: document.queryCommandState('strikeThrough'),
      });
    }
  }, []);

  // Execute formatting commands
  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateActiveStates();
    handleInput();
  }, [updateActiveStates, handleInput]);

  // Handle key events
  const handleKeyUp = useCallback(() => {
    updateActiveStates();
    handleInput();
  }, [updateActiveStates, handleInput]);

  const handleMouseUp = useCallback(() => {
    updateActiveStates();
  }, [updateActiveStates]);

  // Prevent default behavior for enter key to maintain formatting
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      execCommand('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  }, [execCommand]);

  // Insert predefined templates
  const insertTemplate = useCallback((template: string) => {
    execCommand('insertHTML', template);
  }, [execCommand]);

  // Form element templates
  const formTemplates = {
    textInput: '<div class="form-element"><label class="form-label">Label:</label><input type="text" class="form-input" placeholder="Enter text..." /></div>',
    textarea: '<div class="form-element"><label class="form-label">Label:</label><textarea class="form-textarea" placeholder="Enter text..." rows="3"></textarea></div>',
    select: '<div class="form-element"><label class="form-label">Label:</label><select class="form-select"><option>Option 1</option><option>Option 2</option></select></div>',
    checkbox: '<div class="form-element"><label class="form-label"><input type="checkbox" class="form-checkbox" /> Checkbox Label</label></div>',
    radio: '<div class="form-element"><label class="form-label"><input type="radio" name="radio-group" class="form-radio" /> Radio Option</label></div>',
    button: '<button type="button" class="form-button">Button Text</button>',
    divider: '<hr class="form-divider" />',
    infoBox: '<div class="info-box"><strong>Information:</strong> Add your informational content here.</div>',
  };

  // Toolbar button component
  const ToolbarButton: React.FC<{
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
    className?: string;
  }> = ({ onClick, active, title, children, className = '' }) => (
    <button
      type="button"
      onClick={onClick}
      className={`toolbar-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );

  // Mode toggle buttons
  const ModeButton: React.FC<{ mode: 'edit' | 'preview' | 'split'; label: string }> = ({ mode: buttonMode, label }) => (
    <button
      type="button"
      onClick={() => setCurrentMode(buttonMode)}
      className={`mode-btn ${currentMode === buttonMode ? 'active' : ''}`}
      title={`Switch to ${label} mode`}
    >
      {label}
    </button>
  );

  // Content containers based on mode
  const renderEditor = () => (
    <div
      ref={editorRef}
      className="editor-content"
      contentEditable={!readOnly}
      onInput={handleInput}
      onKeyUp={handleKeyUp}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      data-placeholder={placeholder}
      suppressContentEditableWarning={true}
      style={{ height: currentMode === 'split' ? `calc(${height} - 60px)` : height }}
    />
  );

  const renderPreview = () => (
    <div
      ref={previewRef}
      className="preview-content"
      style={{ height: currentMode === 'split' ? `calc(${height} - 60px)` : height }}
    />
  );

  return (
    <div className="enhanced-rich-text-editor">
      <style>
        {`
          .enhanced-rich-text-editor {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: white;
          }
          
          .editor-toolbar {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            padding: 12px;
            border-radius: 8px 8px 0 0;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            justify-content: space-between;
          }
          
          .toolbar-main {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
          }
          
          .toolbar-group {
            display: flex;
            gap: 4px;
            align-items: center;
          }
          
          .toolbar-divider {
            width: 1px;
            height: 24px;
            background: #d1d5db;
            margin: 0 4px;
          }
          
          .toolbar-btn {
            padding: 6px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: #374151;
            transition: all 0.15s ease;
            min-width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .toolbar-btn:hover {
            background: #f3f4f6;
            border-color: #9ca3af;
            transform: translateY(-1px);
          }
          
          .toolbar-btn.active {
            background: #3b82f6;
            color: white;
            border-color: #3b82f6;
            box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
          }
          
          .mode-controls {
            display: flex;
            gap: 4px;
            align-items: center;
          }
          
          .mode-btn {
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
          
          .mode-btn:hover {
            background: #f3f4f6;
            border-color: #9ca3af;
          }
          
          .mode-btn.active {
            background: #10b981;
            color: white;
            border-color: #10b981;
          }
          
          .content-container {
            display: flex;
            height: ${height};
          }
          
          .content-container.edit-only .editor-panel {
            width: 100%;
          }
          
          .content-container.preview-only .preview-panel {
            width: 100%;
          }
          
          .content-container.split .editor-panel,
          .content-container.split .preview-panel {
            width: 50%;
          }
          
          .editor-panel {
            border-right: 1px solid #e2e8f0;
          }
          
          .preview-panel {
            background: #f9fafb;
          }
          
          .panel-header {
            background: #f1f5f9;
            padding: 8px 12px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 12px;
            font-weight: 600;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .editor-content {
            padding: 16px;
            line-height: 1.6;
            font-size: 14px;
            color: #374151;
            outline: none;
            overflow-y: auto;
          }
          
          .preview-content {
            padding: 16px;
            line-height: 1.6;
            font-size: 14px;
            color: #374151;
            overflow-y: auto;
            background: white;
            margin: 8px;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          
          .editor-content:empty:before {
            content: attr(data-placeholder);
            color: #9ca3af;
            pointer-events: none;
          }
          
          .enhanced-rich-text-editor:focus-within {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }
          
          /* Form element styles */
          .form-element {
            margin: 12px 0;
            padding: 12px;
            border: 2px dashed #e2e8f0;
            border-radius: 6px;
            background: #f8fafc;
          }
          
          .form-label {
            display: block;
            font-weight: 600;
            color: #374151;
            margin-bottom: 4px;
            font-size: 14px;
          }
          
          .form-input, .form-textarea, .form-select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            font-size: 14px;
          }
          
          .form-button {
            background: #3b82f6;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
          }
          
          .form-divider {
            border: none;
            height: 1px;
            background: #e2e8f0;
            margin: 16px 0;
          }
          
          .info-box {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            padding: 12px;
            margin: 12px 0;
            color: #1e40af;
          }
          
          /* Content styling */
          .editor-content h1, .preview-content h1 { font-size: 2em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h2, .preview-content h2 { font-size: 1.5em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h3, .preview-content h3 { font-size: 1.25em; font-weight: bold; margin: 0.5em 0; }
          .editor-content p, .preview-content p { margin: 0.5em 0; }
          .editor-content ul, .preview-content ul,
          .editor-content ol, .preview-content ol { margin: 0.5em 0; padding-left: 2em; }
          .editor-content li, .preview-content li { margin: 0.25em 0; }
          .editor-content blockquote, .preview-content blockquote { 
            margin: 1em 0; 
            padding: 0.5em 1em; 
            border-left: 4px solid #3b82f6; 
            background: #f8fafc; 
            font-style: italic; 
          }
          .editor-content a, .preview-content a { color: #3b82f6; text-decoration: underline; }
          .editor-content code, .preview-content code { 
            background: #f1f5f9; 
            padding: 2px 4px; 
            border-radius: 3px; 
            font-family: monospace; 
          }
        `}
      </style>

      {!readOnly && (
        <div className="editor-toolbar">
          <div className="toolbar-main">
            {/* Text Formatting */}
            <div className="toolbar-group">
              <ToolbarButton
                onClick={() => execCommand('bold')}
                active={isActive.bold}
                title="Bold (Ctrl+B)"
              >
                <strong>B</strong>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => execCommand('italic')}
                active={isActive.italic}
                title="Italic (Ctrl+I)"
              >
                <em>I</em>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => execCommand('underline')}
                active={isActive.underline}
                title="Underline (Ctrl+U)"
              >
                <u>U</u>
              </ToolbarButton>
            </div>

            <div className="toolbar-divider"></div>

            {/* Headings */}
            <div className="toolbar-group">
              <select
                className="toolbar-select"
                onChange={(e) => execCommand('formatBlock', e.target.value)}
                defaultValue=""
              >
                <option value="">Format</option>
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="blockquote">Quote</option>
              </select>
            </div>

            <div className="toolbar-divider"></div>

            {/* Lists */}
            <div className="toolbar-group">
              <ToolbarButton
                onClick={() => execCommand('insertUnorderedList')}
                title="Bullet List"
              >
                •
              </ToolbarButton>
              <ToolbarButton
                onClick={() => execCommand('insertOrderedList')}
                title="Numbered List"
              >
                1.
              </ToolbarButton>
            </div>

            {allowFormElements && (
              <>
                <div className="toolbar-divider"></div>
                
                {/* Form Elements */}
                <div className="toolbar-group">
                  <ToolbarButton
                    onClick={() => insertTemplate(formTemplates.textInput)}
                    title="Insert Text Input"
                  >
                    📝
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => insertTemplate(formTemplates.select)}
                    title="Insert Dropdown"
                  >
                    📋
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => insertTemplate(formTemplates.checkbox)}
                    title="Insert Checkbox"
                  >
                    ☑️
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => insertTemplate(formTemplates.infoBox)}
                    title="Insert Info Box"
                  >
                    ℹ️
                  </ToolbarButton>
                </div>
              </>
            )}
          </div>

          {/* Mode Controls */}
          {showPreview && (
            <div className="mode-controls">
              <ModeButton mode="edit" label="Edit" />
              <ModeButton mode="split" label="Split" />
              <ModeButton mode="preview" label="Preview" />
            </div>
          )}
        </div>
      )}

      <div className={`content-container ${currentMode === 'edit' ? 'edit-only' : currentMode === 'preview' ? 'preview-only' : 'split'}`}>
        {(currentMode === 'edit' || currentMode === 'split') && (
          <div className="editor-panel">
            {currentMode === 'split' && <div className="panel-header">Editor</div>}
            {renderEditor()}
          </div>
        )}
        
        {(currentMode === 'preview' || currentMode === 'split') && (
          <div className="preview-panel">
            {currentMode === 'split' && <div className="panel-header">Live Preview</div>}
            {renderPreview()}
          </div>
        )}
      </div>
    </div>
  );
};

export default EnhancedRichTextEditor; 
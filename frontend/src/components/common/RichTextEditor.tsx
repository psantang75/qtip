import React, { useRef, useEffect, useCallback, useState } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Start writing...',
  height = '400px',
  readOnly = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
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
  }, [value]);

  // Handle content changes
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML;
      onChange(content);
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

  // Toolbar button component
  const ToolbarButton: React.FC<{
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }> = ({ onClick, active, title, children }) => (
    <button
      type="button"
      onClick={onClick}
      className={`toolbar-btn ${active ? 'active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // Prevent focus loss
    >
      {children}
    </button>
  );

  // Insert link
  const insertLink = useCallback(() => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  }, [execCommand]);

  // Remove link
  const removeLink = useCallback(() => {
    execCommand('unlink');
  }, [execCommand]);

  // Insert list
  const insertList = useCallback((ordered: boolean) => {
    execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
  }, [execCommand]);

  // Change font size
  const changeFontSize = useCallback((size: string) => {
    execCommand('fontSize', size);
  }, [execCommand]);

  // Change text color
  const changeTextColor = useCallback((color: string) => {
    execCommand('foreColor', color);
  }, [execCommand]);

  // Change background color
  const changeBackgroundColor = useCallback((color: string) => {
    execCommand('hiliteColor', color);
  }, [execCommand]);

  return (
    <div className="rich-text-editor-container">
      <style>
        {`
          .rich-text-editor-container {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
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
          
          .toolbar-select {
            padding: 6px 8px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: white;
            font-size: 14px;
            color: #374151;
            cursor: pointer;
          }
          
          .toolbar-select:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }
          
          .color-input {
            width: 36px;
            height: 36px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            cursor: pointer;
            padding: 0;
            background: none;
          }
          
          .editor-content {
            min-height: ${height};
            padding: 16px;
            line-height: 1.6;
            font-size: 14px;
            color: #374151;
            outline: none;
            border-radius: 0 0 8px 8px;
          }
          
          .editor-content:empty:before {
            content: attr(data-placeholder);
            color: #9ca3af;
            pointer-events: none;
          }
          
          .editor-content:focus {
            outline: none;
          }
          
          .rich-text-editor-container:focus-within {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }
          
          /* Content styling */
          .editor-content h1 { font-size: 2em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h2 { font-size: 1.5em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h3 { font-size: 1.25em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h4 { font-size: 1.1em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h5 { font-size: 1em; font-weight: bold; margin: 0.5em 0; }
          .editor-content h6 { font-size: 0.9em; font-weight: bold; margin: 0.5em 0; }
          .editor-content p { margin: 0.5em 0; }
          .editor-content ul, .editor-content ol { margin: 0.5em 0; padding-left: 2em; }
          .editor-content li { margin: 0.25em 0; }
          .editor-content blockquote { 
            margin: 1em 0; 
            padding: 0.5em 1em; 
            border-left: 4px solid #3b82f6; 
            background: #f8fafc; 
            font-style: italic; 
          }
          .editor-content a { color: #3b82f6; text-decoration: underline; }
          .editor-content code { 
            background: #f1f5f9; 
            padding: 2px 4px; 
            border-radius: 3px; 
            font-family: monospace; 
          }
        `}
      </style>

      {!readOnly && (
        <div className="editor-toolbar">
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
            <ToolbarButton
              onClick={() => execCommand('strikeThrough')}
              active={isActive.strikethrough}
              title="Strikethrough"
            >
              <s>S</s>
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
              <option value="p">Normal</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
              <option value="h5">Heading 5</option>
              <option value="h6">Heading 6</option>
              <option value="blockquote">Quote</option>
            </select>

            <select
              className="toolbar-select"
              onChange={(e) => changeFontSize(e.target.value)}
              defaultValue="3"
            >
              <option value="1">10px</option>
              <option value="2">12px</option>
              <option value="3">14px</option>
              <option value="4">16px</option>
              <option value="5">18px</option>
              <option value="6">20px</option>
              <option value="7">24px</option>
            </select>
          </div>

          <div className="toolbar-divider"></div>

          {/* Lists and Alignment */}
          <div className="toolbar-group">
            <ToolbarButton
              onClick={() => insertList(false)}
              title="Bullet List"
            >
              •
            </ToolbarButton>
            <ToolbarButton
              onClick={() => insertList(true)}
              title="Numbered List"
            >
              1.
            </ToolbarButton>
            <ToolbarButton
              onClick={() => execCommand('justifyLeft')}
              title="Align Left"
            >
              ⬅
            </ToolbarButton>
            <ToolbarButton
              onClick={() => execCommand('justifyCenter')}
              title="Align Center"
            >
              ↔
            </ToolbarButton>
            <ToolbarButton
              onClick={() => execCommand('justifyRight')}
              title="Align Right"
            >
              ➡
            </ToolbarButton>
          </div>

          <div className="toolbar-divider"></div>

          {/* Colors and Links */}
          <div className="toolbar-group">
            <input
              type="color"
              className="color-input"
              onChange={(e) => changeTextColor(e.target.value)}
              title="Text Color"
            />
            <input
              type="color"
              className="color-input"
              onChange={(e) => changeBackgroundColor(e.target.value)}
              title="Background Color"
            />
            <ToolbarButton onClick={insertLink} title="Insert Link">
              🔗
            </ToolbarButton>
            <ToolbarButton onClick={removeLink} title="Remove Link">
              🔗✖
            </ToolbarButton>
          </div>

          <div className="toolbar-divider"></div>

          {/* Utility */}
          <div className="toolbar-group">
            <ToolbarButton
              onClick={() => execCommand('undo')}
              title="Undo (Ctrl+Z)"
            >
              ↶
            </ToolbarButton>
            <ToolbarButton
              onClick={() => execCommand('redo')}
              title="Redo (Ctrl+Y)"
            >
              ↷
            </ToolbarButton>
            <ToolbarButton
              onClick={() => execCommand('removeFormat')}
              title="Clear Formatting"
            >
              🧹
            </ToolbarButton>
          </div>
        </div>
      )}

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
      />
    </div>
  );
};

export default RichTextEditor; 
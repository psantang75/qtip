import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { CoursePage } from '../../types/course.types';
import { courseService } from '../../services/courseService';

interface SimpleCourseBuilderProps {
  page: CoursePage;
  onChange: (page: CoursePage) => void;
}

interface Element {
  id: string;
  type: 'text' | 'heading' | 'image' | 'video' | 'button' | 'list' | 'quote' | 'divider' | 'shape' | 'icon';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  style: {
    fontSize?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    borderRadius?: string;
    padding?: string;
    margin?: string;
    border?: string;
    borderColor?: string;
    borderWidth?: string;
    borderStyle?: string;
    borderLeft?: string;
    borderRight?: string;
    borderTop?: string;
    borderBottom?: string;
    boxShadow?: string;
    textShadow?: string;
    opacity?: string;
    transform?: string;
    backgroundImage?: string;
    backgroundSize?: string;
    backgroundPosition?: string;
    lineHeight?: string;
    letterSpacing?: string;
  };
  animation?: {
    type: 'none' | 'fadeIn' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'bounceIn' | 'zoomIn';
    duration: string;
    delay: string;
  };
  listItems?: string[];
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'arrow';
  iconName?: string;
}

interface HistoryState {
  elements: Element[];
  selectedElement: string | null;
}

const SimpleCourseBuilder: React.FC<SimpleCourseBuilderProps> = ({ page, onChange }) => {
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [draggedElement, setDraggedElement] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [clipboard, setClipboard] = useState<Element | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize elements from existing page content
  useEffect(() => {
    if (!isInitialized && page.content_text) {
      try {
        // Try to extract elements data from HTML comment
        const match = page.content_text.match(/<!-- VISUAL_BUILDER_DATA:(.*?) -->/);
        if (match && match[1]) {
          const elementsData = JSON.parse(match[1]);
          setElements(elementsData);
          console.log('Loaded existing elements:', elementsData);
        } else {
          console.log('No visual builder data found in content, starting with empty canvas');
        }
      } catch (error) {
        console.warn('Could not parse existing elements, starting with empty canvas:', error);
      }
      setIsInitialized(true);
    } else if (!isInitialized) {
      setIsInitialized(true);
    }
  }, [page.content_text, isInitialized]);

  // Auto-save function with debouncing
  const autoSave = useCallback(async (updatedPage: CoursePage) => {
    // Only auto-save if we have a course ID and page ID (existing page)
    if (!updatedPage.course_id || !updatedPage.id) {
      return;
    }

    // Clear any existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set a new timeout for auto-saving
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSaving(true);
        
        await courseService.autoSaveCoursePage(
          updatedPage.course_id!,
          updatedPage.id!,
          {
            page_title: updatedPage.page_title,
            content_text: updatedPage.content_text
          }
        );
        
        setLastSaved(new Date());
      } catch (error) {
        console.error('Auto-save failed:', error);
        // Could add a toast notification here
      } finally {
        setIsSaving(false);
      }
    }, 2000); // Wait 2 seconds after user stops typing
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // Enhanced templates with more variety
  const templates = [
    {
      name: 'Hero Section',
      preview: '🎯',
      category: 'Headers',
      elements: [
        {
          id: 'hero-bg',
          type: 'shape' as const,
          content: '',
          x: 0,
          y: 0,
          width: 600,
          height: 300,
          zIndex: 1,
          style: { 
            backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
          },
          shapeType: 'rectangle' as const
        },
        {
          id: 'hero-title',
          type: 'heading' as const,
          content: 'Welcome to Our Course',
          x: 50,
          y: 80,
          width: 500,
          height: 60,
          zIndex: 2,
          style: { 
            fontSize: '42px', 
            fontWeight: 'bold', 
            color: '#ffffff', 
            textAlign: 'center' as const,
            textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
          }
        },
        {
          id: 'hero-subtitle',
          type: 'text' as const,
          content: 'Learn essential skills with our comprehensive training program',
          x: 100,
          y: 160,
          width: 400,
          height: 40,
          zIndex: 2,
          style: { 
            fontSize: '18px', 
            color: '#f0f0f0', 
            textAlign: 'center' as const,
            lineHeight: '1.5'
          }
        },
        {
          id: 'hero-cta',
          type: 'button' as const,
          content: 'Get Started',
          x: 250,
          y: 220,
          width: 100,
          height: 40,
          zIndex: 2,
          style: { 
            fontSize: '16px', 
            fontWeight: 'bold',
            color: '#667eea', 
            backgroundColor: '#ffffff', 
            borderRadius: '25px',
            textAlign: 'center' as const,
            border: '2px solid #ffffff',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
          }
        }
      ]
    },
    {
      name: 'Article Layout',
      preview: '📰',
      category: 'Content',
      elements: [
        {
          id: 'article-title',
          type: 'heading' as const,
          content: 'Chapter Title',
          x: 50,
          y: 30,
          width: 500,
          height: 50,
          zIndex: 1,
          style: { fontSize: '32px', fontWeight: 'bold', color: '#1f2937', borderBottom: '3px solid #3b82f6' }
        },
        {
          id: 'article-content',
          type: 'text' as const,
          content: 'This is where your main content goes. You can write detailed explanations, instructions, or any learning material here.',
          x: 50,
          y: 100,
          width: 350,
          height: 200,
          zIndex: 1,
          style: { fontSize: '16px', color: '#374151', lineHeight: '1.6', padding: '16px' }
        },
        {
          id: 'article-sidebar',
          type: 'text' as const,
          content: 'Key Points:\n• Important concept\n• Remember this\n• Practice exercise',
          x: 420,
          y: 100,
          width: 130,
          height: 200,
          zIndex: 1,
          style: { 
            fontSize: '14px', 
            color: '#059669', 
            backgroundColor: '#f0fdf4',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid #bbf7d0'
          }
        }
      ]
    },
    {
      name: 'Image Gallery',
      preview: '🖼️',
      category: 'Media',
      elements: [
        {
          id: 'gallery-title',
          type: 'heading' as const,
          content: 'Visual Examples',
          x: 50,
          y: 20,
          width: 500,
          height: 40,
          zIndex: 1,
          style: { fontSize: '28px', fontWeight: 'bold', color: '#1f2937', textAlign: 'center' as const }
        },
        {
          id: 'img1',
          type: 'image' as const,
          content: 'https://via.placeholder.com/150x120/3b82f6/ffffff?text=Image+1',
          x: 50,
          y: 80,
          width: 150,
          height: 120,
          zIndex: 1,
          style: { borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
        },
        {
          id: 'img2',
          type: 'image' as const,
          content: 'https://via.placeholder.com/150x120/10b981/ffffff?text=Image+2',
          x: 225,
          y: 80,
          width: 150,
          height: 120,
          zIndex: 1,
          style: { borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
        },
        {
          id: 'img3',
          type: 'image' as const,
          content: 'https://via.placeholder.com/150x120/f59e0b/ffffff?text=Image+3',
          x: 400,
          y: 80,
          width: 150,
          height: 120,
          zIndex: 1,
          style: { borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
        }
      ]
    },
    {
      name: 'Quote Block',
      preview: '💬',
      category: 'Content',
      elements: [
        {
          id: 'quote-bg',
          type: 'shape' as const,
          content: '',
          x: 50,
          y: 50,
          width: 500,
          height: 150,
          zIndex: 1,
          style: { 
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          },
          shapeType: 'rectangle' as const
        },
        {
          id: 'quote-icon',
          type: 'icon' as const,
          content: '"',
          x: 70,
          y: 70,
          width: 40,
          height: 40,
          zIndex: 2,
          style: { fontSize: '36px', color: '#3b82f6', fontWeight: 'bold' },
          iconName: 'quote'
        },
        {
          id: 'quote-text',
          type: 'quote' as const,
          content: 'This is an inspiring quote or important message that stands out from the rest of the content.',
          x: 120,
          y: 80,
          width: 400,
          height: 60,
          zIndex: 2,
          style: { 
            fontSize: '18px', 
            fontStyle: 'italic',
            color: '#1e293b',
            lineHeight: '1.5'
          }
        },
        {
          id: 'quote-author',
          type: 'text' as const,
          content: '— Course Author',
          x: 400,
          y: 150,
          width: 120,
          height: 30,
          zIndex: 2,
          style: { 
            fontSize: '14px', 
            color: '#64748b',
            textAlign: 'right' as const,
            fontWeight: '500'
          }
        }
      ]
    }
  ];

  // Enhanced element types
  const elementTypes = [
    { type: 'heading', icon: '📝', label: 'Heading', category: 'Text' },
    { type: 'text', icon: '📄', label: 'Text Block', category: 'Text' },
    { type: 'list', icon: '📋', label: 'List', category: 'Text' },
    { type: 'quote', icon: '💬', label: 'Quote', category: 'Text' },
    { type: 'image', icon: '🖼️', label: 'Image', category: 'Media' },
    { type: 'video', icon: '🎥', label: 'Video', category: 'Media' },
    { type: 'button', icon: '🔘', label: 'Button', category: 'Interactive' },
    { type: 'divider', icon: '➖', label: 'Divider', category: 'Layout' },
    { type: 'shape', icon: '🔶', label: 'Shape', category: 'Design' },
    { type: 'icon', icon: '⭐', label: 'Icon', category: 'Design' },
  ];

  // Save state to history
  const saveToHistory = useCallback(() => {
    const newState: HistoryState = {
      elements: [...elements],
      selectedElement
    };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [elements, selectedElement, history, historyIndex]);

  // Undo/Redo functionality
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setElements(prevState.elements);
      setSelectedElement(prevState.selectedElement);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setElements(nextState.elements);
      setSelectedElement(nextState.selectedElement);
      setHistoryIndex(historyIndex + 1);
    }
  }, [history, historyIndex]);

  // Grid snapping
  const snapToGridIfEnabled = (value: number) => {
    if (snapToGrid) {
      return Math.round(value / 10) * 10;
    }
    return value;
  };

  const loadTemplate = (template: typeof templates[0]) => {
    const newElements = template.elements.map(el => ({ 
      ...el, 
      id: `${el.type}_${Date.now()}_${Math.random()}`,
      animation: { type: 'none' as const, duration: '0.3s', delay: '0s' }
    }));
    setElements(newElements);
    setSelectedElement(null);
    updatePageContent(newElements);
    saveToHistory();
  };

  const addElement = (type: Element['type']) => {
    const newElement: Element = {
      id: `${type}_${Date.now()}`,
      type,
      content: getDefaultContent(type),
      x: snapToGridIfEnabled(100),
      y: snapToGridIfEnabled(100),
      width: getDefaultWidth(type),
      height: getDefaultHeight(type),
      zIndex: elements.length + 1,
      style: getDefaultStyle(type),
      animation: { type: 'none', duration: '0.3s', delay: '0s' },
      ...(type === 'list' && { listItems: ['Item 1', 'Item 2', 'Item 3'] }),
      ...(type === 'shape' && { shapeType: 'rectangle' }),
      ...(type === 'icon' && { iconName: 'star' })
    };

    const updatedElements = [...elements, newElement];
    setElements(updatedElements);
    setSelectedElement(newElement.id);
    updatePageContent(updatedElements);
    saveToHistory();
  };

  const getDefaultContent = (type: Element['type']) => {
    switch (type) {
      case 'heading': return 'New Heading';
      case 'text': return 'Click to edit this text block. You can add any content here.';
      case 'list': return 'bulleted';
      case 'quote': return 'This is an inspirational quote or important message.';
      case 'image': return 'https://via.placeholder.com/200x150/3b82f6/ffffff?text=Click+to+Edit';
      case 'video': return 'https://www.youtube.com/embed/dQw4w9WgXcQ';
      case 'button': return 'Click Me';
      case 'divider': return '---';
      case 'shape': return '';
      case 'icon': return '⭐';
      default: return '';
    }
  };

  const getDefaultWidth = (type: Element['type']) => {
    switch (type) {
      case 'heading': return 300;
      case 'text': return 250;
      case 'list': return 200;
      case 'quote': return 400;
      case 'image': return 200;
      case 'video': return 400;
      case 'button': return 120;
      case 'divider': return 300;
      case 'shape': return 150;
      case 'icon': return 40;
      default: return 200;
    }
  };

  const getDefaultHeight = (type: Element['type']) => {
    switch (type) {
      case 'heading': return 50;
      case 'text': return 100;
      case 'list': return 120;
      case 'quote': return 80;
      case 'image': return 150;
      case 'video': return 225;
      case 'button': return 40;
      case 'divider': return 4;
      case 'shape': return 100;
      case 'icon': return 40;
      default: return 100;
    }
  };

  const getDefaultStyle = (type: Element['type']): Element['style'] => {
    switch (type) {
      case 'heading':
        return { 
          fontSize: '28px', 
          fontWeight: 'bold', 
          color: '#1f2937',
          fontFamily: 'Inter, system-ui, sans-serif'
        };
      case 'text':
        return { 
          fontSize: '16px', 
          color: '#374151', 
          padding: '12px',
          lineHeight: '1.6',
          fontFamily: 'Inter, system-ui, sans-serif'
        };
      case 'list':
        return { 
          fontSize: '16px', 
          color: '#374151', 
          padding: '12px',
          lineHeight: '1.8'
        };
      case 'quote':
        return { 
          fontSize: '18px', 
          fontStyle: 'italic',
          color: '#1e293b',
          padding: '20px',
          backgroundColor: '#f8fafc',
          borderLeft: '4px solid #3b82f6',
          lineHeight: '1.6'
        };
      case 'button':
        return { 
          fontSize: '16px',
          fontWeight: '600',
          color: 'white', 
          backgroundColor: '#3b82f6', 
          borderRadius: '8px', 
          padding: '12px 24px',
          textAlign: 'center',
          border: 'none',
          boxShadow: '0 2px 4px rgba(59,130,246,0.3)'
        };
      case 'divider':
        return {
          backgroundColor: '#e5e7eb',
          borderRadius: '2px'
        };
      case 'shape':
        return {
          backgroundColor: '#3b82f6',
          borderRadius: '4px'
        };
      case 'icon':
        return {
          fontSize: '24px',
          color: '#3b82f6',
          textAlign: 'center'
        };
      default:
        return {};
    }
  };

  const updatePageContent = (elementList: Element[]) => {
    const htmlContent = generateHTML(elementList);
    const updatedPage = {
      ...page,
      content_text: htmlContent,
    };
    
    // Update local state
    onChange(updatedPage);
    
    // Trigger auto-save
    autoSave(updatedPage);
  };

  const generateHTML = (elementList: Element[]) => {
    if (!canvasRef.current) return '';

    return `<!-- VISUAL_BUILDER_DATA:${JSON.stringify(elementList)} -->
      <div style="position: relative; width: 100%; min-height: 500px; background: white; overflow: hidden;">
        ${elementList
          .sort((a, b) => a.zIndex - b.zIndex)
          .map(el => {
            const left = (el.x / 600) * 100;
            const top = (el.y / 500) * 100;
            const width = (el.width / 600) * 100;
            const height = (el.height / 500) * 100;

            const styles = Object.entries(el.style)
              .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
              .join('; ');

            const animationClass = el.animation?.type !== 'none' 
              ? `animation: ${el.animation?.type} ${el.animation?.duration} ${el.animation?.delay} ease-out;` 
              : '';

            switch (el.type) {
              case 'heading':
                return `<h2 style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; margin: 0; ${styles}; ${animationClass}">${el.content}</h2>`;
              case 'text':
                return `<div style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; ${styles}; ${animationClass}">${el.content}</div>`;
              case 'list':
                const listItems = el.listItems || ['Item 1', 'Item 2', 'Item 3'];
                const listType = el.content === 'numbered' ? 'ol' : 'ul';
                return `<${listType} style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; ${styles}; ${animationClass}">${listItems.map(item => `<li>${item}</li>`).join('')}</${listType}>`;
              case 'quote':
                return `<blockquote style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; ${styles}; ${animationClass}">${el.content}</blockquote>`;
              case 'image':
                return `<img src="${el.content}" style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; object-fit: cover; ${styles}; ${animationClass}" />`;
              case 'video':
                return `<iframe src="${el.content}" style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; border: none; ${styles}; ${animationClass}"></iframe>`;
              case 'button':
                return `<button style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; cursor: pointer; ${styles}; ${animationClass}">${el.content}</button>`;
              case 'divider':
                return `<hr style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; border: none; ${styles}; ${animationClass}" />`;
              case 'shape':
                if (el.shapeType === 'circle') {
                  return `<div style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; border-radius: 50%; ${styles}; ${animationClass}"></div>`;
                }
                return `<div style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; ${styles}; ${animationClass}"></div>`;
              case 'icon':
                return `<div style="position: absolute; left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%; display: flex; align-items: center; justify-content: center; ${styles}; ${animationClass}">${el.content}</div>`;
              default:
                return '';
            }
          }).join('')}
      </div>
    `;
  };

  const handleElementClick = (elementId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedElement(elementId);
    setIsEditing(null);
  };

  const handleElementDoubleClick = (elementId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(elementId);
    setSelectedElement(elementId);
  };

  const handleContentChange = (elementId: string, newContent: string) => {
    const updatedElements = elements.map(el =>
      el.id === elementId ? { ...el, content: newContent } : el
    );
    setElements(updatedElements);
    updatePageContent(updatedElements);
  };

  const handleElementMove = (elementId: string, newX: number, newY: number) => {
    const updatedElements = elements.map(el =>
      el.id === elementId ? { 
        ...el, 
        x: snapToGridIfEnabled(newX), 
        y: snapToGridIfEnabled(newY) 
      } : el
    );
    setElements(updatedElements);
    updatePageContent(updatedElements);
  };

  const deleteSelectedElement = () => {
    if (selectedElement) {
      const updatedElements = elements.filter(el => el.id !== selectedElement);
      setElements(updatedElements);
      setSelectedElement(null);
      updatePageContent(updatedElements);
      saveToHistory();
    }
  };

  const updateElementProperty = (property: string, value: any) => {
    if (!selectedElement) return;
    
    const updatedElements = elements.map(el =>
      el.id === selectedElement 
        ? { ...el, [property]: value }
        : el
    );
    setElements(updatedElements);
    updatePageContent(updatedElements);
  };

  const updateElementStyle = (property: string, value: string) => {
    if (!selectedElement) return;
    
    const updatedElements = elements.map(el =>
      el.id === selectedElement 
        ? { ...el, style: { ...el.style, [property]: value } }
        : el
    );
    setElements(updatedElements);
    updatePageContent(updatedElements);
  };

  const updateElementAnimation = (property: string, value: string) => {
    if (!selectedElement) return;
    
    const updatedElements = elements.map(el =>
      el.id === selectedElement 
        ? { ...el, animation: { ...el.animation!, [property]: value } }
        : el
    );
    setElements(updatedElements);
    updatePageContent(updatedElements);
  };

  const selectedEl = elements.find(el => el.id === selectedElement);

  // Copy/Paste functionality
  const copyElement = () => {
    if (selectedElement) {
      const elementToCopy = elements.find(el => el.id === selectedElement);
      if (elementToCopy) {
        setClipboard({ ...elementToCopy });
      }
    }
  };

  const pasteElement = () => {
    if (clipboard) {
      const newElement = {
        ...clipboard,
        id: `${clipboard.type}_${Date.now()}`,
        x: clipboard.x + 20,
        y: clipboard.y + 20,
        zIndex: elements.length + 1
      };
      const updatedElements = [...elements, newElement];
      setElements(updatedElements);
      setSelectedElement(newElement.id);
      updatePageContent(updatedElements);
      saveToHistory();
    }
  };

  // Layer management
  const bringToFront = () => {
    if (!selectedElement) return;
    const maxZ = Math.max(...elements.map(el => el.zIndex));
    updateElementProperty('zIndex', maxZ + 1);
  };

  const sendToBack = () => {
    if (!selectedElement) return;
    const minZ = Math.min(...elements.map(el => el.zIndex));
    updateElementProperty('zIndex', minZ - 1);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            break;
          case 'c':
            e.preventDefault();
            copyElement();
            break;
          case 'v':
            e.preventDefault();
            pasteElement();
            break;
        }
      }
      
      if (e.key === 'Delete' && selectedElement) {
        deleteSelectedElement();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, undo, redo, copyElement, pasteElement, deleteSelectedElement]);

  const fontFamilies = [
    'Inter, system-ui, sans-serif',
    'Georgia, serif',
    'Times New Roman, serif',
    'Arial, sans-serif',
    'Helvetica, sans-serif',
    'Monaco, monospace',
    'Courier New, monospace'
  ];

  const animations = [
    { value: 'none', label: 'None' },
    { value: 'fadeIn', label: 'Fade In' },
    { value: 'slideUp', label: 'Slide Up' },
    { value: 'slideDown', label: 'Slide Down' },
    { value: 'slideLeft', label: 'Slide Left' },
    { value: 'slideRight', label: 'Slide Right' },
    { value: 'bounceIn', label: 'Bounce In' },
    { value: 'zoomIn', label: 'Zoom In' }
  ];

  if (!isInitialized) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading page content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Top Toolbar */}
      <div className="bg-white border-b border-gray-200 p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-800">Visual Page Builder</h2>
            
            {/* Auto-save Status */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {isSaving ? (
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </div>
              ) : lastSaved ? (
                <div className="flex items-center gap-1">
                  <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Saved {lastSaved.toLocaleTimeString()}</span>
                </div>
              ) : page.id ? (
                <span>Auto-save enabled</span>
              ) : (
                <span>Save course to enable auto-save</span>
              )}
            </div>
            
            {/* Undo/Redo */}
            <div className="flex gap-1">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-1.5 text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                title="Undo (Ctrl+Z)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                title="Redo (Ctrl+Shift+Z)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
                </svg>
              </button>
            </div>

            {/* View Options */}
            <div className="flex items-center gap-3 text-xs border-l border-gray-300 pl-4">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(e) => setSnapToGrid(e.target.checked)}
                  className="rounded"
                />
                Grid Snap
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="rounded"
                />
                Show Grid
              </label>
              <div className="flex items-center gap-1">
                <span>Zoom:</span>
                <select
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="text-xs border border-gray-300 rounded px-1 py-0.5"
                >
                  <option value={50}>50%</option>
                  <option value={75}>75%</option>
                  <option value={100}>100%</option>
                  <option value={125}>125%</option>
                  <option value={150}>150%</option>
                </select>
              </div>
            </div>
          </div>

          {/* Selected Element Actions */}
          {selectedEl && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Selected: {selectedEl.type}</span>
              <button
                onClick={copyElement}
                className="p-1.5 text-gray-500 hover:text-gray-700 rounded"
                title="Copy (Ctrl+C)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={deleteSelectedElement}
                className="p-1.5 text-red-500 hover:text-red-700 rounded"
                title="Delete (Del)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Templates Row */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Templates:</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {templates.map((template, index) => (
              <button
                key={index}
                onClick={() => loadTemplate(template)}
                className="flex-shrink-0 flex flex-col items-center p-2 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-200 border border-gray-200 transition-all duration-200 min-w-[80px]"
                title={template.name}
              >
                <div className="text-xl mb-1">{template.preview}</div>
                <div className="text-xs font-medium text-gray-700 text-center leading-tight">
                  {template.name}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Elements Row */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Add Elements:</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {elementTypes.map((elementType) => (
              <button
                key={elementType.type}
                onClick={() => addElement(elementType.type as Element['type'])}
                className="flex-shrink-0 flex flex-col items-center p-2 bg-gray-50 rounded-lg hover:bg-green-50 hover:border-green-200 border border-gray-200 transition-all duration-200 min-w-[60px] group"
              >
                <span className="text-lg mb-1 group-hover:scale-110 transition-transform">
                  {elementType.icon}
                </span>
                <span className="text-xs font-medium text-gray-700 group-hover:text-green-700 text-center leading-tight">
                  {elementType.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex">
        {/* Canvas Area */}
        <div className={`${selectedEl ? 'flex-1' : 'w-full'} p-4`}>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full relative overflow-auto">
            <div
              ref={canvasRef}
              className="relative w-full bg-white mx-auto"
              style={{ 
                minHeight: '600px',
                maxWidth: '1200px',
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
                backgroundImage: showGrid ? 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)' : 'none',
                backgroundSize: showGrid ? '20px 20px' : 'auto'
              }}
              onClick={() => {
                setSelectedElement(null);
                setIsEditing(null);
              }}
            >
              {elements.map((element) => (
                <div
                  key={element.id}
                  className={`absolute cursor-pointer transition-all duration-200 ${
                    selectedElement === element.id ? 'ring-2 ring-blue-500 ring-opacity-75' : ''
                  } ${draggedElement === element.id ? 'opacity-50' : ''}`}
                  style={{
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    height: element.height,
                    zIndex: element.zIndex,
                    ...element.style,
                  } as React.CSSProperties}
                  onClick={(e) => handleElementClick(element.id, e)}
                  onDoubleClick={(e) => handleElementDoubleClick(element.id, e)}
                  draggable
                  onDragStart={() => setDraggedElement(element.id)}
                  onDragEnd={(e) => {
                    if (draggedElement === element.id && canvasRef.current) {
                      const rect = canvasRef.current.getBoundingClientRect();
                      const scale = zoom / 100;
                      const newX = (e.clientX - rect.left) / scale - element.width / 2;
                      const newY = (e.clientY - rect.top) / scale - element.height / 2;
                      handleElementMove(element.id, Math.max(0, newX), Math.max(0, newY));
                    }
                    setDraggedElement(null);
                  }}
                >
                  {isEditing === element.id ? (
                    element.type === 'image' || element.type === 'video' ? (
                      <input
                        type="url"
                        value={element.content}
                        onChange={(e) => handleContentChange(element.id, e.target.value)}
                        onBlur={() => setIsEditing(null)}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditing(null)}
                        className="w-full h-full border-2 border-blue-300 rounded px-2 text-sm"
                        placeholder="Enter URL"
                        autoFocus
                      />
                    ) : element.type === 'list' ? (
                      <textarea
                        value={element.listItems?.join('\n') || ''}
                        onChange={(e) => {
                          const listItems = e.target.value.split('\n').filter(item => item.trim());
                          const updatedElements = elements.map(el =>
                            el.id === element.id ? { ...el, listItems } : el
                          );
                          setElements(updatedElements);
                          updatePageContent(updatedElements);
                        }}
                        onBlur={() => setIsEditing(null)}
                        className="w-full h-full border-2 border-blue-300 rounded px-2 py-1 text-sm resize-none"
                        placeholder="Enter list items (one per line)"
                        autoFocus
                      />
                    ) : (
                      <textarea
                        value={element.content}
                        onChange={(e) => handleContentChange(element.id, e.target.value)}
                        onBlur={() => setIsEditing(null)}
                        onKeyDown={(e) => e.key === 'Enter' && e.shiftKey === false && setIsEditing(null)}
                        className="w-full h-full border-2 border-blue-300 rounded px-2 py-1 text-sm resize-none"
                        style={{ ...element.style, border: '2px solid #3b82f6' } as React.CSSProperties}
                        autoFocus
                      />
                    )
                  ) : (
                    <>
                      {element.type === 'heading' && (
                        <h2 className="m-0 truncate" style={element.style as React.CSSProperties}>
                          {element.content}
                        </h2>
                      )}
                      {element.type === 'text' && (
                        <div className="whitespace-pre-wrap overflow-hidden" style={element.style as React.CSSProperties}>
                          {element.content}
                        </div>
                      )}
                      {element.type === 'list' && (
                        element.content === 'numbered' ? (
                          <ol className="m-0 pl-5" style={element.style as React.CSSProperties}>
                            {(element.listItems || ['Item 1', 'Item 2', 'Item 3']).map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ol>
                        ) : (
                          <ul className="m-0 pl-5" style={element.style as React.CSSProperties}>
                            {(element.listItems || ['Item 1', 'Item 2', 'Item 3']).map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        )
                      )}
                      {element.type === 'quote' && (
                        <blockquote className="m-0 italic" style={element.style as React.CSSProperties}>
                          {element.content}
                        </blockquote>
                      )}
                      {element.type === 'image' && (
                        <img
                          src={element.content}
                          alt=""
                          className="w-full h-full object-cover"
                          style={element.style as React.CSSProperties}
                          draggable={false}
                        />
                      )}
                      {element.type === 'video' && (
                        <iframe
                          src={element.content}
                          className="w-full h-full border-none"
                          style={element.style as React.CSSProperties}
                          title="Video"
                        />
                      )}
                      {element.type === 'button' && (
                        <button 
                          className="w-full h-full border-none cursor-pointer"
                          style={element.style as React.CSSProperties}
                        >
                          {element.content}
                        </button>
                      )}
                      {element.type === 'divider' && (
                        <hr 
                          className="border-none m-0"
                          style={element.style as React.CSSProperties}
                        />
                      )}
                      {element.type === 'shape' && (
                        <div 
                          className="w-full h-full"
                          style={{
                            ...element.style,
                            borderRadius: element.shapeType === 'circle' ? '50%' : element.style.borderRadius
                          } as React.CSSProperties}
                        />
                      )}
                      {element.type === 'icon' && (
                        <div 
                          className="w-full h-full flex items-center justify-center"
                          style={element.style as React.CSSProperties}
                        >
                          {element.content}
                        </div>
                      )}
                    </>
                  )}

                  {/* Selection handles */}
                  {selectedElement === element.id && !isEditing && (
                    <>
                      <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 rounded-full cursor-nw-resize" />
                      <div className="absolute -top-1 right-1/2 w-2 h-2 bg-blue-500 rounded-full cursor-n-resize" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full cursor-ne-resize" />
                      <div className="absolute top-1/2 -right-1 w-2 h-2 bg-blue-500 rounded-full cursor-e-resize" />
                      <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-500 rounded-full cursor-se-resize" />
                      <div className="absolute -bottom-1 left-1/2 w-2 h-2 bg-blue-500 rounded-full cursor-s-resize" />
                      <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-blue-500 rounded-full cursor-sw-resize" />
                      <div className="absolute top-1/2 -left-1 w-2 h-2 bg-blue-500 rounded-full cursor-w-resize" />
                    </>
                  )}
                </div>
              ))}

              {elements.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <div className="text-8xl mb-6">🎨</div>
                    <p className="text-2xl font-medium mb-2">Start Building Your Page</p>
                    <p className="text-lg">Choose a template from above or add elements</p>
                    <div className="mt-6 space-y-2 text-sm text-gray-500">
                      <p>🎯 <strong>Pro Tips:</strong></p>
                      <p>• Double-click to edit content</p>
                      <p>• Drag to move elements</p>
                      <p>• Use Ctrl+C/V to copy/paste</p>
                      <p>• Press Delete to remove selected element</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Properties Panel - Only show when element is selected */}
        {selectedEl && (
          <div className="w-80 bg-white border-l border-gray-200 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Properties</h3>
                <div className="flex gap-1">
                  <button
                    onClick={bringToFront}
                    className="p-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border"
                    title="Bring to Front"
                  >
                    ↑
                  </button>
                  <button
                    onClick={sendToBack}
                    className="p-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border"
                    title="Send to Back"
                  >
                    ↓
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {/* Quick Position & Size */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Position & Size</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-gray-600 mb-1">X</label>
                      <input
                        type="number"
                        value={selectedEl.x}
                        onChange={(e) => updateElementProperty('x', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">Y</label>
                      <input
                        type="number"
                        value={selectedEl.y}
                        onChange={(e) => updateElementProperty('y', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">W</label>
                      <input
                        type="number"
                        value={selectedEl.width}
                        onChange={(e) => updateElementProperty('width', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">H</label>
                      <input
                        type="number"
                        value={selectedEl.height}
                        onChange={(e) => updateElementProperty('height', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded"
                      />
                    </div>
                  </div>
                </div>

                {/* Typography (for text elements) */}
                {(selectedEl.type === 'text' || selectedEl.type === 'heading' || selectedEl.type === 'button' || selectedEl.type === 'list' || selectedEl.type === 'quote') && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Typography</h4>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Font Size: {selectedEl.style.fontSize || '16px'}</label>
                        <input
                          type="range"
                          min="8"
                          max="72"
                          value={parseInt(selectedEl.style.fontSize || '16')}
                          onChange={(e) => updateElementStyle('fontSize', `${e.target.value}px`)}
                          className="w-full"
                        />
                      </div>

                      <div className="flex gap-1">
                        <button
                          onClick={() => updateElementStyle('fontWeight', selectedEl.style.fontWeight === 'bold' ? 'normal' : 'bold')}
                          className={`px-2 py-1 text-xs rounded border font-bold ${
                            selectedEl.style.fontWeight === 'bold' ? 'bg-blue-100 border-blue-300' : 'bg-gray-50 border-gray-300'
                          }`}
                        >
                          B
                        </button>
                        <button
                          onClick={() => updateElementStyle('fontStyle', selectedEl.style.fontStyle === 'italic' ? 'normal' : 'italic')}
                          className={`px-2 py-1 text-xs rounded border italic ${
                            selectedEl.style.fontStyle === 'italic' ? 'bg-blue-100 border-blue-300' : 'bg-gray-50 border-gray-300'
                          }`}
                        >
                          I
                        </button>
                        <button
                          onClick={() => updateElementStyle('textDecoration', selectedEl.style.textDecoration === 'underline' ? 'none' : 'underline')}
                          className={`px-2 py-1 text-xs rounded border underline ${
                            selectedEl.style.textDecoration === 'underline' ? 'bg-blue-100 border-blue-300' : 'bg-gray-50 border-gray-300'
                          }`}
                        >
                          U
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Text Color</label>
                        <input
                          type="color"
                          value={selectedEl.style.color || '#000000'}
                          onChange={(e) => updateElementStyle('color', e.target.value)}
                          className="w-full h-8 rounded border border-gray-300"
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-1">
                        {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                          <button
                            key={align}
                            onClick={() => updateElementStyle('textAlign', align)}
                            className={`py-1 px-1 text-xs rounded border ${
                              selectedEl.style.textAlign === align ? 'bg-blue-100 border-blue-300' : 'bg-gray-50 border-gray-300'
                            }`}
                          >
                            {align.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Background & Appearance */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Appearance</h4>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Background</label>
                      <input
                        type="color"
                        value={selectedEl.style.backgroundColor || '#ffffff'}
                        onChange={(e) => updateElementStyle('backgroundColor', e.target.value)}
                        className="w-full h-8 rounded border border-gray-300"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Border Radius: {selectedEl.style.borderRadius || '0px'}</label>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        value={parseInt(selectedEl.style.borderRadius || '0')}
                        onChange={(e) => updateElementStyle('borderRadius', `${e.target.value}px`)}
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Opacity: {Math.round((parseFloat(selectedEl.style.opacity || '1') * 100))}%</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={selectedEl.style.opacity || '1'}
                        onChange={(e) => updateElementStyle('opacity', e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleCourseBuilder; 
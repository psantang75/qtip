import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered } from 'lucide-react'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}

export function RichTextEditor({ value, onChange, placeholder, className }: RichTextEditorProps) {
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      code: false,
    }),
    Underline,
    Placeholder.configure({ placeholder: placeholder ?? '' }),
  ], [placeholder])

  const editor = useEditor({
    extensions,
    content: value || '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[60px] px-3 py-2 text-sm text-slate-900 prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML()
      onChange(html === '<p></p>' ? '' : html)
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current && value !== (current === '<p></p>' ? '' : current)) {
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  if (!editor) return null

  return (
    <div className={cn(
      'relative rounded-md border border-input bg-background',
      'focus-within:border-slate-400',
      className,
    )}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null

  const btn = (active: boolean) => cn(
    'p-1.5 rounded hover:bg-slate-100 transition-colors',
    active ? 'bg-slate-200 text-slate-900' : 'text-slate-500',
  )

  return (
    <div className="flex items-center gap-0.5 border-b border-input px-2 py-1">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive('bold'))} title="Bold">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive('italic'))} title="Italic">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={btn(editor.isActive('underline'))} title="Underline">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive('bulletList'))} title="Bullet List">
        <List className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive('orderedList'))} title="Numbered List">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

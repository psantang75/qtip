interface TopicChipsProps {
  topics: string[]
  max?: number
}

export function TopicChips({ topics, max = 2 }: TopicChipsProps) {
  const shown = topics.slice(0, max)
  const extra = topics.length - max
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(t => (
        <span key={t} className="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded-full">{t}</span>
      ))}
      {extra > 0 && (
        <span className="bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full">+{extra}</span>
      )}
    </div>
  )
}

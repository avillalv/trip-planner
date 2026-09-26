import { Loader2, Search } from 'lucide-react'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type ComboboxProps<T> = {
  inputId?: string
  'aria-label'?: string
  placeholder?: string
  query: string
  onQueryChange: (query: string) => void
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  onSelect: (item: T) => void
  loading?: boolean
  error?: string | null
  emptyText?: string
  minChars?: number
}

/** Search-as-you-type field with a keyboard-navigable list of results (ARIA combobox pattern). */
export function Combobox<T>({
  inputId,
  placeholder,
  query,
  onQueryChange,
  items,
  getKey,
  renderItem,
  onSelect,
  loading = false,
  error,
  emptyText = 'No matches',
  minChars = 2,
  ...aria
}: ComboboxProps<T>) {
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const open = focused && query.trim().length >= minChars
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))

  const choose = (item: T) => {
    onSelect(item)
    onQueryChange('')
    setActive(0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (items[activeIndex]) choose(items[activeIndex])
    } else if (event.key === 'Escape') {
      onQueryChange('')
    }
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
      <Input
        id={inputId}
        role="combobox"
        aria-label={aria['aria-label']}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length > 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value)
          setActive(0)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        className="pl-8"
      />
      {loading && open && (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-ink-soft" aria-hidden="true" />
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {error ? (
            <li className="px-3 py-2 text-sm text-destructive">{error}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-soft">{loading ? 'Searching…' : emptyText}</li>
          ) : (
            items.map((item, index) => (
              <li
                key={getKey(item)}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // mousedown keeps focus in the input so the list doesn't close first
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(item)
                }}
                onMouseEnter={() => setActive(index)}
                className={cn('cursor-pointer rounded-md px-3 py-2 text-sm', index === activeIndex && 'bg-accent')}
              >
                {renderItem(item)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme, type Theme } from '@/lib/theme-context'

const OPTIONS: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-md bg-sidebar-accent/60 p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'grid size-7 place-items-center rounded-[5px] text-cover-soft transition-colors outline-offset-1 hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-ring',
            theme === value && 'bg-sidebar text-white shadow-sm',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

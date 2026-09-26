import { Link } from 'react-router'
import { BrandMark } from './brand-mark'

export function Logo({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-sidebar-ring"
    >
      <BrandMark className="size-8" />
      <span className="type-heading text-[1.05rem] leading-none text-white">Trip Planner</span>
    </Link>
  )
}

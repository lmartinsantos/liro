import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function Brand({ className, markOnly }: { className?: string; markOnly?: boolean }) {
  return (
    <Link
      to="/"
      className={cn('flex items-center gap-2.5 font-extrabold tracking-tight', className)}
    >
      <span className="flex size-8 items-center justify-center rounded-2xl bg-primary text-sm font-extrabold text-primary-foreground shadow-card">
        L
      </span>
      {!markOnly && <span className="text-lg leading-none">Liro</span>}
    </Link>
  )
}

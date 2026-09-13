import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      hint={resolved === 'dark' ? 'Light theme' : 'Dark theme'}
      onClick={toggle}
      aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}

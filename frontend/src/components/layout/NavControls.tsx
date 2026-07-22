import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/lib/navigation'

/**
 * Back / Forward, in the same place on every screen.
 *
 * Back is always in the first position after the menu button so a user never has to
 * look for it, and both are 44px targets for gloved hands. Forward appears only when
 * there is somewhere to go forward TO — a permanently greyed-out control would just
 * be spending scarce width on a phone.
 *
 * The destination is named on wider screens ("Back to Requests"), because the whole
 * point of a contextual back is that the user can see where it will take them.
 */
export function NavControls() {
  const { back, goBack, canGoForward, goForward } = useNavigation()

  // Nothing to show on a role's own home screen with no forward history.
  if (!back && !canGoForward) return null

  return (
    <div className="flex shrink-0 items-center">
      {/* min-w-11: with the label hidden on a phone this is just a chevron, and px-2
          alone left a 32px-wide target — under the 44px gloved-hand minimum. */}
      {back && (
        <Button
          variant="ghost"
          size="sm"
          onClick={goBack}
          aria-label={`Back to ${back.label}`}
          className="h-11 min-w-11 gap-1 px-2 text-chip-600 hover:text-chip-900 sm:min-w-0 sm:pr-3"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="hidden max-w-[12rem] truncate sm:inline">{back.label}</span>
        </Button>
      )}
      {canGoForward && (
        <Button
          variant="ghost"
          size="icon"
          onClick={goForward}
          aria-label="Forward"
          className="h-11 w-11 text-chip-600 hover:text-chip-900"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      )}
    </div>
  )
}

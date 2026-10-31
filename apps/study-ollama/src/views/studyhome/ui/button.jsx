import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-st text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-st-primary text-st-primary-foreground hover:bg-st-primary/90",
        ghost: "hover:bg-st-accent hover:text-st-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-st-sm px-3 text-xs",
        icon: "h-9 w-9",
        iconSm: "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, type = "button", ...props }, ref) => (
  <button
    type={type}
    className={cn(buttonVariants({ variant, size, className }))}
    ref={ref}
    {...props}
  />
))
Button.displayName = "Button"

export { Button, buttonVariants }

import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-st-sm border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-st-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-st-primary text-st-primary-foreground",
        secondary: "border-transparent bg-st-secondary text-st-secondary-foreground",
        destructive: "border-transparent bg-st-destructive text-st-destructive-foreground",
        outline: "text-st-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }

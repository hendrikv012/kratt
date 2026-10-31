import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "../../../lib/utils"

const ToggleGroup = React.forwardRef(({ className, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    {children}
  </ToggleGroupPrimitive.Root>
))
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center gap-2 rounded-st px-3 text-sm font-medium transition-colors hover:bg-st-muted hover:text-st-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-st-accent data-[state=on]:text-st-accent-foreground",
      className
    )}
    {...props}
  >
    {children}
  </ToggleGroupPrimitive.Item>
))
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }

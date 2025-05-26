"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"
import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <div className="flex flex-col w-full">
      {/* Etiquetas centradas */}
      <div className="flex justify-center items-center gap-4 mb-1">
        <div className="flex items-center gap-1 font-bold text-xs" style={{ fontFamily: "Arial" }}>
          <div className="bg-[#6366f1] text-white rounded-full w-5 h-5 flex items-center justify-center">
            S
          </div>
          <span className="text-muted-foreground">Stall</span>
        </div>
        <div className="flex items-center gap-1 font-bold text-xs" style={{ fontFamily: "Arial" }}>
          <div className="bg-[#f49e09] text-white rounded-full w-5 h-5 flex items-center justify-center">
            F
          </div>
          <span className="text-muted-foreground">Forward</span>
        </div>
      </div>

      {/* Separador */}
      <SeparatorPrimitive.Root
        ref={ref}
        decorative={decorative}
        orientation={orientation}
        className={cn(
          "shrink-0 bg-border w-full",
          orientation === "horizontal" ? "h-[1px]" : "h-full w-[1px]",
          className
        )}
        {...props}
      />
    </div>
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }

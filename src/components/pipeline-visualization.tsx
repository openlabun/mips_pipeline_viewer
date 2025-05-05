// src/components/pipeline-visualization.tsx
"use client";

import type * as React from 'react';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Code2, Cpu, MemoryStick, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext'; // Import context hook

// Removed props interface as state comes from context now

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

export function PipelineVisualization() {
  // Get state from context
  const { instructions, currentCycle: cycle, maxCycles, isRunning, stageCount } = useSimulationState();
  const STAGE_COUNT = stageCount;

   // Calculate the cycle number when the simulation should be considered complete
   // This happens when the current cycle exceeds the cycle where the last instruction finishes WB
  const completionCycle = instructions.length > 0 ? instructions.length + STAGE_COUNT - 1 : 0;
  // Simulation is completed if it's not running AND the current cycle is at or beyond the completion cycle
  // Ensure completionCycle > 0 to avoid triggering completed state initially when cycle is 0
  const simulationCompleted = !isRunning && cycle >= completionCycle && completionCycle > 0;


  // Rendering is handled in page.tsx based on instructions.length
  // if (instructions.length === 0) return null;

  // Use completionCycle for the number of columns if it's calculated, otherwise fallback to maxCycles (or 0 if not started)
  const totalCyclesToDisplay = completionCycle > 0 ? completionCycle : maxCycles;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);


  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization without hazard handling.</TableCaption>
            <TableHeader>
              <TableRow>
                 {/* Use bg-card for sticky header cell background */}
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">Instruction</TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`}>
                   {/* Use bg-card for sticky instruction cell background */}
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const stageIndex = c - 1 - instIndex;
                    const isInPipeline = stageIndex >= 0 && stageIndex < STAGE_COUNT;
                    const currentStage = isInPipeline ? STAGES[stageIndex] : null;
                    const isCurrentCycleStage = isInPipeline && c === cycle;

                    // Only animate if the simulation is running AND not yet completed
                    const shouldAnimate = isCurrentCycleStage && isRunning && !simulationCompleted;
                    // Highlight statically if it's the current stage but paused/stopped (and not completed)
                    const shouldHighlightStatically = isCurrentCycleStage && !isRunning && !simulationCompleted;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          // 1. If simulation is completed, reset all cells to default background
                           simulationCompleted ? 'bg-background' :
                          // 2. If it's the current stage and running, animate
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          // 3. If it's the current stage but paused/stopped, highlight statically
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          // 4. If it's a past stage in the pipeline (but not current), use secondary
                          isInPipeline ? 'bg-secondary text-secondary-foreground' :
                          // 5. Otherwise (future stage or empty cell), use default background
                          'bg-background'
                        )}
                      >
                        {/* Only show icon/name if the stage is active in the pipeline AND simulation is not completed */}
                        {currentStage && !simulationCompleted && (
                           <div className="flex flex-col items-center justify-center">
                             <currentStage.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                             <span className="text-xs">{currentStage.name}</span>
                           </div>
                         )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
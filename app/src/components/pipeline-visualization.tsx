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

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

export function PipelineVisualization() {
  // Get state from context
  const {
    instructions,
    currentCycle: cycle,
    maxCycles, // Max cycles determines the number of columns
    isRunning,
    instructionStages, // Use the pre-calculated stages
    isFinished, // Use the finished flag from context
    stageHistory,
  } = useSimulationState();

  // Calculate the last cycle based on stage history or fallback to maxCycles
  const lastCycle = Math.max(
    ...Object.keys(stageHistory || {}).map(Number),
    maxCycles // fallback
  );
  const totalCyclesToDisplay = lastCycle > 0 ? lastCycle : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // if (instructions.length === 0) return null; // Handled in page.tsx

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
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
                    // Determine the stage for this instruction *at this cycle column 'c'*
                    // Instruction 'instIndex' entered stage 's' at cycle 'instIndex + s + 1'
                    // So, at cycle 'c', the stage index is 'c - instIndex - 1'
                    
                    const stageIndex = stageHistory?.[c]?.[instIndex];
                    const stageData = stageIndex !== null && stageIndex !== undefined ? STAGES[stageIndex] : null;

                    // Detecta si la instrucción está en la misma etapa que el ciclo anterior (stall visual)
                    const prevStageIndex = stageHistory?.[c - 1]?.[instIndex];
                    const isStall = stageIndex !== null && stageIndex === prevStageIndex && stageIndex !== undefined;

                    // ¿Es la etapa actual en el ciclo actual?
                    const isActualCurrentStage = stageIndex !== null && c === cycle;

                    // Animar solo la celda actual
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;

                    // Mark past stages
                   // const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          // 1. If simulation is completed, reset all cells to default background
                          isFinished ? 'bg-background' :
                          // 2. If it's the current stage and running, animate
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          // 3. If it's the current stage but paused/stopped, highlight statically
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          // 4. Si hay un stall, usar color especial
                          isStall ? 'bg-yellow-200' :
                          // 5. Si hay datos de etapa, usar fondo secundario
                          stageData ? 'bg-secondary text-secondary-foreground' :
                          // 6. De lo contrario (etapa futura o celda vacía), usar fondo por defecto
                          'bg-background'
                        )}
                      >
                        {/* Show icon/name if the stage should be active in this cycle column AND simulation is not completed */}
                        {stageData && !isFinished && (
                           <div className="flex flex-col items-center justify-center">
                             <stageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                             <span className="text-xs">{stageData.name}</span>
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
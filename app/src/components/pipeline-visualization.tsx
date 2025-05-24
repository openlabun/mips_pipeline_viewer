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
import { Download, Code2, Cpu, MemoryStick, CheckSquare, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext'; // Import context hook

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare }
] as const;

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
    pipelineHistory,
    forwardingCycles
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

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
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const expectedStageIndex = c - instIndex - 1;
                    const currentStageIndex = instructionStages[instIndex];
                    const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                    const currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;
                    const isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && c === cycle;
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    // Obtener forwarding info
                    const forwardingInfo = forwardingCycles?.[c - 1]; // ciclo 1 es index 0
                    const isEX = currentStageData?.name === 'EX';
                    const isMEM = currentStageData?.name === 'MEM';
                    const isWB = currentStageData?.name === 'WB';

                    const isEXForwarding = forwardingInfo?.hasEXForwarding && (isEX || isMEM);
                    const isMEMForwarding = forwardingInfo?.hasMEMForwarding && (isEX || isWB);

                    const forwardingClass = (isEXForwarding || isMEMForwarding)
                      ? 'bg-yellow-300 text-black'
                      : '';

                    let cellContent = null;
                    if (inst === "STALL" && currentStageData) {
                      cellContent = (
                        <div className="flex flex-col items-center justify-center">
                          {currentStageData.name === "IF" ? (
                            <>
                              <Download className="w-4 h-4 mb-1" aria-hidden="true" />
                              <span className="text-xs">{currentStageData.name}</span>
                            </>
                          ) : (
                            <>
                              <Cloud className="w-4 h-4 mb-1" aria-hidden="true" />
                              <span className="text-xs">STALL</span>
                            </>
                          )}
                        </div>
                      );
                    } else if (currentStageData) {
                      cellContent = (
                        <div className="flex flex-col items-center justify-center">
                          <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                          <span className="text-xs">{currentStageData.name}</span>
                        </div>
                      );
                    }

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          isFinished ? 'bg-background' :
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          isPastStage ? 'bg-secondary text-secondary-foreground' :
                          'bg-background',
                          forwardingClass
                        )}
                      >
                        {cellContent}
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

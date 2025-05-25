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
import { useSimulationState, getStageInfo } from '@/context/SimulationContext'; // Importar getStageInfo

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
    forwarding, // 👈 importar forwarding
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
                  <TableHead key={`cycle-${c}`} className="text-center w-16">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`}>
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">{inst}</TableCell>
                  {cycleNumbers.map((c) => {
                    const expectedStageIndex = c - instIndex - 1;
                    const currentStageIndex = instructionStages[instIndex];
                    const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                    const currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;
                    const isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && c === cycle;
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    const baseTooltip = getStageInfo(
                      isInPipelineAtThisCycle ? expectedStageIndex : null,
                      inst
                    );

                    // 🟢 Obtener estado de forwarding
                    const isForwarded = forwarding[instIndex]?.[expectedStageIndex] ?? false;
                    const tooltipText = isInPipelineAtThisCycle
                      ? `${baseTooltip} | ${isForwarded ? 'Forwarded from previus instruction' : ''}`
                      : baseTooltip;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          isFinished ? 'bg-background' :
                          isForwarded ? 'bg-red-500 text-white' : // 🔴 Forwarding detectado
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          isPastStage ? 'bg-secondary text-secondary-foreground' :
                          'bg-background'
                        )}
                        title={tooltipText}
                      >

                        {currentStageData && !isFinished && (
                          inst === '00000000' && currentStageData.name !== 'IF' ? (
                            <div className="flex items-center justify-center text-xs font-semibold text-blue-600">
                              BUBBLE
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center">
                              <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                              <span className="text-xs">{currentStageData.name}</span>
                            </div>
                          )
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

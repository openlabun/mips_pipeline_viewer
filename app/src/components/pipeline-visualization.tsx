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
import { Download, Code2, Cpu, MemoryStick, CheckSquare, Pause, FastForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState, useStallInformation } from '@/context/SimulationContext';

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

const STALL_STAGE = { name: 'STALL', icon: Pause };
const FORWARD_STAGE = { name: 'FORWARD', icon: FastForward };

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    isFinished,
  } = useSimulationState();

  const { 
    isStallEnabled, 
    isForwardEnabled,
    pipelineMatrix,
    forwardedInstructions 
  } = useStallInformation();
  
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
                    let stageValue: string = "";
                    let isStall = false;
                    let isForward = false;
                    
                    if ((isStallEnabled || isForwardEnabled) && pipelineMatrix.length > 0) {
                      stageValue = pipelineMatrix[instIndex]?.[c - 1] || "";
                      isStall = stageValue === "STALL";
                      isForward = stageValue === "FORWARD";
                    } else {
                      const expectedStageIndex = c - instIndex - 1;
                      if (expectedStageIndex >= 0 && expectedStageIndex < STAGES.length) {
                        stageValue = STAGES[expectedStageIndex].name;
                      }
                    }

                    const currentStageData = isStall 
                      ? STALL_STAGE 
                      : isForward
                        ? FORWARD_STAGE
                        : STAGES.find(stage => stage.name === stageValue);

                    const isCurrentCycle = c === cycle;
                    const isActiveStage = isCurrentCycle && currentStageData && !isFinished;
                    const isPastStage = c < cycle && currentStageData;
                    
                    const shouldAnimate = isActiveStage && isRunning;
                    const shouldHighlight = isActiveStage && !isRunning;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          isFinished ? 'bg-background' :
                          isStall ? (
                            shouldAnimate ? 'bg-yellow-300 text-yellow-900 animate-pulse-bg' :
                            shouldHighlight ? 'bg-yellow-300 text-yellow-900' :
                            isPastStage ? 'bg-yellow-200 text-yellow-800' :
                            'bg-yellow-100 text-yellow-700'
                          ) :
                          isForward ? (
                            shouldAnimate ? 'bg-purple-300 text-purple-900 animate-pulse-bg' :
                            shouldHighlight ? 'bg-purple-300 text-purple-900' :
                            isPastStage ? 'bg-purple-200 text-purple-800' :
                            'bg-purple-100 text-purple-700'
                          ) :
                          shouldAnimate ? 'bg-primary text-primary-foreground animate-pulse-bg' :
                          shouldHighlight ? 'bg-primary text-primary-foreground' :
                          isPastStage ? 'bg-secondary text-secondary-foreground' :
                          'bg-background'
                        )}
                      >
                        {currentStageData && !isFinished && (
                          <div className="flex flex-col items-center justify-center">
                            <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                            <span className="text-xs">{currentStageData.name}</span>
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
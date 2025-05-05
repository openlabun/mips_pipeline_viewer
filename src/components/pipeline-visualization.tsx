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

interface PipelineVisualizationProps {
  instructions: string[];
  cycle: number;
  maxCycles: number;
}

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

const STAGE_COUNT = STAGES.length;

export function PipelineVisualization({ instructions, cycle, maxCycles }: PipelineVisualizationProps) {
  if (instructions.length === 0 || maxCycles === 0) {
    return null; // Don't render if no instructions or cycles
  }

  const cycleNumbers = Array.from({ length: maxCycles }, (_, i) => i + 1);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress (Cycle: {cycle}/{maxCycles})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization without hazard handling.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px] sticky left-0 bg-background z-10 border-r">Instruction</TableHead>
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
                  <TableCell className="font-mono sticky left-0 bg-background z-10 border-r">
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const stageIndex = c - 1 - instIndex;
                    const isInPipeline = stageIndex >= 0 && stageIndex < STAGE_COUNT;
                    const currentStage = isInPipeline ? STAGES[stageIndex] : null;
                    const isCurrentCycleStage = isInPipeline && c === cycle && stageIndex < STAGE_COUNT;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300', // Added transition
                          isCurrentCycleStage ? 'bg-accent text-accent-foreground animate-pulse-bg' : // Highlight + Animation
                          isInPipeline ? 'bg-secondary text-secondary-foreground' : 'bg-background' // Normal stages
                        )}
                      >
                        {currentStage && (
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

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    instructionStages,
    isFinished,
    stallHandling, // Get the mode directly from context
  } = useSimulationState();

  const { 
    pipelineMatrix,
  } = useStallInformation();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // Use the mode from context directly
  const effectiveMode = stallHandling;

  const renderStageCell = (instIndex: number, cycleNum: number) => {
    let currentStageData = null;
    let isActualCurrentStage = false;
    let isPastStage = false;
    let isForward = false;

    if (effectiveMode !== 'default' && pipelineMatrix.length > 0) {
      // Use pipeline matrix for stall/forward modes
      const stageValue = pipelineMatrix[instIndex]?.[cycleNum - 1]; // cycleNum is 1-based, array is 0-based
      
      if (effectiveMode === 'stall') {
        // In stall mode, show STALL or regular stages, but no FORWARD
        if (stageValue === "STALL") {
          currentStageData = STALL_STAGE;
        } else if (stageValue && stageValue !== "" && stageValue !== "FORWARD") {
          const stageIndex = STAGES.findIndex(stage => stage.name === stageValue);
          currentStageData = stageIndex >= 0 ? STAGES[stageIndex] : null;
        }
      } else if (effectiveMode === 'forward') {
        // In forward mode, show FORWARD or regular stages, but no STALL
        if (stageValue === "FORWARD") {
          currentStageData = FORWARD_STAGE;
          isForward = true;
        } else if (stageValue && stageValue !== "" && stageValue !== "STALL") {
          const stageIndex = STAGES.findIndex(stage => stage.name === stageValue);
          currentStageData = stageIndex >= 0 ? STAGES[stageIndex] : null;
        }
      }
      
      // Check if this is the current stage
      isActualCurrentStage = cycleNum === cycle && instructionStages[instIndex] !== null && currentStageData !== null;
      isPastStage = (currentStageData && cycleNum < cycle) ?? false;
    } else {
      // Default mode logic
      const expectedStageIndex = cycleNum - instIndex - 1;
      const currentStageIndex = instructionStages[instIndex];

      const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
      currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;

      isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && cycleNum === cycle;
      isPastStage = isInPipelineAtThisCycle && cycleNum < cycle;
    }

    // Animation and highlighting logic
    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;

    // Cell styling based on stage type
    const getCellStyles = () => {
      if (isFinished) return 'bg-background';
      
      if (currentStageData?.name === 'STALL') {
        if (shouldAnimate) return 'bg-yellow-300 text-yellow-900 animate-pulse-bg';
        if (shouldHighlightStatically) return 'bg-yellow-300 text-yellow-900';
        if (isPastStage) return 'bg-yellow-200 text-yellow-800';
        return 'bg-yellow-100 text-yellow-700';
      }
      
      if (isForward) {
        if (shouldAnimate) return 'bg-purple-300 text-purple-900 animate-pulse-bg';
        if (shouldHighlightStatically) return 'bg-purple-300 text-purple-900';
        if (isPastStage) return 'bg-purple-200 text-purple-800';
        return 'bg-purple-100 text-purple-700';
      }
      
      // Default stage styling
      if (shouldAnimate) return 'bg-primary text-primary-foreground animate-pulse-bg';
      if (shouldHighlightStatically) return 'bg-primary text-primary-foreground';
      if (isPastStage) return 'bg-secondary text-secondary-foreground';
      return 'bg-background';
    };

    return (
      <TableCell
        key={`inst-${instIndex}-cycle-${cycleNum}`}
        className={cn(
          'text-center w-16 h-14 transition-colors duration-300 min-w-[4rem] max-w-[4rem]', // Fixed width to ensure uniformity
          getCellStyles()
        )}
      >
        {currentStageData && !isFinished && (
          <div className="flex flex-col items-center justify-center">
            <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
            <span className="text-xs font-medium truncate w-full">{currentStageData.name}</span>
          </div>
        )}
      </TableCell>
    );
  };

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
        <div className="text-sm text-muted-foreground">
          Mode: <span className="font-medium capitalize">{effectiveMode}</span>
          {effectiveMode === 'default' && ' - Standard 5-stage pipeline'}
          {effectiveMode === 'stall' && ' - Pipeline with stall handling'}
          {effectiveMode === 'forward' && ' - Pipeline with data forwarding'}
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              MIPS instruction pipeline visualization
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">
                  Instruction
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead 
                    key={`cycle-${c}`} 
                    className="text-center w-16 min-w-[4rem] max-w-[4rem]" // Fixed width for uniformity
                  >
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
                  {cycleNumbers.map((c) => renderStageCell(instIndex, c))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {/* Legend */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-primary rounded"></div>
              <span>Current Stage</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-secondary rounded"></div>
              <span>Completed Stage</span>
            </div>
            {effectiveMode === 'stall' && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-300 rounded"></div>
                <span>Stall</span>
              </div>
            )}
            {effectiveMode === 'forward' && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-300 rounded"></div>
                <span>Forward</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
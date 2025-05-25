// src/components/pipeline-visualization.tsx
'use client';

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
  Download,
  Code2,
  Cpu,
  MemoryStick,
  CheckSquare,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';

const PROCESSOR_STAGES = [
  { label: 'IF', component: Download },
  { label: 'ID', component: Code2 },
  { label: 'EX', component: Cpu },
  { label: 'MEM', component: MemoryStick },
  { label: 'WB', component: CheckSquare },
] as const;

interface CellState {
  cellType: 'empty' | 'standard' | 'bubble' | 'forwarding';
  stageInfo: (typeof PROCESSOR_STAGES)[number] | null;
  isActive: boolean;
  forwardingDetails?: any;
}

export function PipelineVisualization() {
  const {
    programInstructions,
    clockCycle: currentClock,
    totalCycles,
    executionActive,
    phaseMap,
    executionComplete,
    conflictAnalysis,
    dataForwarding,
    pipelineBubbles,
    instructionFormats,
    activeBubbles,
  } = useSimulationState();

  const clockSequence =
    totalCycles > 0 ? Array.from({ length: totalCycles }, (_, i) => i + 1) : [];

  // Calculate statistics
  const forwardCount = Object.values(dataForwarding).filter(
    (f: any) => f.length > 0
  ).length;
  const bubbleSum = Object.values(pipelineBubbles).reduce(
    (sum: number, bubbles: number) => sum + bubbles,
    0
  );

  // Helper: calculate bubbles before instruction
  const getBubblesBeforeInstruction = (instructionIdx: number): number => {
    let bubbleSum = 0;
    for (let i = 0; i < instructionIdx; i++) {
      bubbleSum += pipelineBubbles[i] || 0;
    }
    return bubbleSum;
  };

  // Helper: check if cell represents a bubble
  const isBubbleCell = (instructionIdx: number, clockNum: number): boolean => {
    if (pipelineBubbles[instructionIdx] <= 0) return false;

    const baseExecutionStart = instructionIdx + 2;
    const precedingBubbles = getBubblesBeforeInstruction(instructionIdx);

    return (
      clockNum > baseExecutionStart + precedingBubbles &&
      clockNum <=
        baseExecutionStart + precedingBubbles + pipelineBubbles[instructionIdx]
    );
  };

  // Helper: get forwarding details for cell
  const getForwardingDetails = (instructionIdx: number, clockNum: number) => {
    if (
      !dataForwarding[instructionIdx] ||
      dataForwarding[instructionIdx].length === 0
    ) {
      return { hasForwarding: false };
    }

    const precedingBubbles = getBubblesBeforeInstruction(instructionIdx);
    const expectedPhase = clockNum - instructionIdx - 1 - precedingBubbles;

    if (expectedPhase === 2) {
      return {
        hasForwarding: true,
        forwardingDetails: dataForwarding[instructionIdx],
      };
    }

    return { hasForwarding: false };
  };

  // Main cell state calculator
  const determineCellState = (
    instructionIdx: number,
    clockNum: number
  ): CellState => {
    // Si la ejecución está completa, todas las celdas deben estar vacías
    if (executionComplete) {
      return {
        cellType: 'empty',
        stageInfo: null,
        isActive: false,
      };
    }

    const precedingBubbles = getBubblesBeforeInstruction(instructionIdx);

    if (isBubbleCell(instructionIdx, clockNum)) {
      return {
        cellType: 'bubble',
        stageInfo: null,
        isActive: false,
      };
    }

    const expectedPhaseIdx = clockNum - instructionIdx - 1 - precedingBubbles;
    const actualPhaseIdx = phaseMap[instructionIdx];

    const isValidPhase =
      expectedPhaseIdx >= 0 && expectedPhaseIdx < PROCESSOR_STAGES.length;
    const stageInfo = isValidPhase ? PROCESSOR_STAGES[expectedPhaseIdx] : null;

    const { hasForwarding, forwardingDetails } = getForwardingDetails(
      instructionIdx,
      clockNum
    );

    const isActive =
      actualPhaseIdx !== null &&
      expectedPhaseIdx === actualPhaseIdx &&
      clockNum === currentClock;

    if (hasForwarding) {
      return {
        cellType: 'forwarding',
        stageInfo,
        isActive,
        forwardingDetails,
      };
    }

    return {
      cellType: isValidPhase ? 'standard' : 'empty',
      stageInfo,
      isActive,
    };
  };

  return (
    <Card className='w-full overflow-hidden'>
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>

        {/* Statistics moved to top */}
        {programInstructions.length > 0 &&
          (forwardCount > 0 || bubbleSum > 0) && (
            <div className='flex flex-wrap gap-4 text-sm bg-muted rounded p-3'>
              {forwardCount > 0 && (
                <div className='flex items-center'>
                  <div className='w-3 h-3 bg-emerald-500 rounded-full mr-2'></div>
                  <span>{forwardCount} forwards</span>
                </div>
              )}
              {bubbleSum > 0 && (
                <div className='flex items-center'>
                  <div className='w-3 h-3 bg-red-500 rounded-full mr-2'></div>
                  <span>{bubbleSum} stalls</span>
                </div>
              )}
              <div className='flex items-center'>
                <div className='w-3 h-3 bg-green-500 rounded-full mr-2'></div>
                <span>Data forward active</span>
              </div>
            </div>
          )}
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto'>
          <Table className='min-w-max'>
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[190px] sticky left-0 bg-card z-10 border-r'>
                  Instruction
                </TableHead>
                {clockSequence.map((clock: number) => (
                  <TableHead
                    key={`clock-${clock}`}
                    className='text-center w-16'
                  >
                    {clock}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {programInstructions.map((instruction: string, idx: number) => (
                <TableRow key={`instruction-${idx}`}>
                  <TableCell className='font-mono sticky left-0 bg-card z-10 border-r'>
                    <div className='flex items-center gap-2'>
                      <div>{instruction}</div>
                      {/* Show forward or stall tags inline - solo si no está completo */}
                      {!executionComplete &&
                        dataForwarding[idx]?.length > 0 && (
                          <div className='text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 flex-shrink-0'>
                            FORWARD
                          </div>
                        )}
                      {!executionComplete && pipelineBubbles[idx] > 0 && (
                        <div className='text-xs px-2 py-1 rounded bg-red-100 text-red-700 flex-shrink-0'>
                          {pipelineBubbles[idx]} STALL
                        </div>
                      )}
                    </div>
                  </TableCell>

                  {clockSequence.map((clock: number) => {
                    const cellState = determineCellState(idx, clock);

                    const isCurrentColumn = clock === currentClock;
                    const hasContent = cellState.cellType !== 'empty';

                    // Todas las celdas con contenido empiezan en gris
                    const baseStyling = hasContent
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-background';

                    // Solo cuando llegan a la columna activa cambian de color y se animan
                    const highlightStyling =
                      isCurrentColumn && hasContent && cellState.isActive
                        ? executionActive && !executionComplete
                          ? cellState.cellType === 'bubble'
                            ? 'bg-red-500 text-white animate-pulse-bg-stall'
                            : cellState.cellType === 'forwarding'
                            ? 'bg-green-500 text-white animate-pulse-bg-forward'
                            : 'bg-accent text-accent-foreground animate-pulse-bg'
                          : cellState.cellType === 'bubble'
                          ? 'bg-red-500 text-white'
                          : cellState.cellType === 'forwarding'
                          ? 'bg-green-500 text-white'
                          : 'bg-accent text-accent-foreground'
                        : '';

                    return (
                      <TableCell
                        key={`instruction-${idx}-clock-${clock}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          baseStyling,
                          highlightStyling
                        )}
                      >
                        {cellState.cellType === 'bubble' && (
                          <div className='flex flex-col items-center justify-center'>
                            <Circle className='w-4 h-4 mb-1 fill-current' />
                            <span className='text-xs font-semibold'>STALL</span>
                          </div>
                        )}

                        {cellState.cellType === 'standard' &&
                          cellState.stageInfo && (
                            <div className='flex flex-col items-center justify-center'>
                              <cellState.stageInfo.component className='w-4 h-4 mb-1' />
                              <span className='text-xs'>
                                {cellState.stageInfo.label}
                              </span>
                            </div>
                          )}

                        {cellState.cellType === 'forwarding' &&
                          cellState.stageInfo && (
                            <div className='flex flex-col items-center justify-center'>
                              <cellState.stageInfo.component className='w-4 h-4 mb-1' />
                              <span className='text-xs'>
                                {cellState.stageInfo.label}
                              </span>
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

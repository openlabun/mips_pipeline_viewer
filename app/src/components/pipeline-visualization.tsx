// src/components/pipeline-visualization.tsx
"use client";

import * as React from 'react';
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
import { Download, Code2, Cpu, MemoryStick, CheckSquare, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';

const STAGES_DEFINITION = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

// Ya no necesitamos STALL_STAGE_DISPLAY_DATA si construimos el texto dinámicamente
// const STALL_STAGE_DISPLAY_DATA = { name: 'STALL', icon: MinusCircle }; 

const PIPELINE_STAGE_INDICES = {
  IF: 0,
  ID: 1,
  EX: 2,
  MEM: 3,
  WB: 4,
  OUT: 5,
} as const;

export function PipelineVisualization() {
  const {
    instructions: contextInstructions,
    currentCycle: cycle,
    maxCycles: contextMaxCycles,
    isRunning,
    instructionStages,
    pipelineEventHistory,
    isFinished,
  } = useSimulationState();

  const instructions = contextInstructions || [];
  const maxCyclesFromContext = contextMaxCycles || 0;

  const calculatedMaxCycles = React.useMemo(() => {
    if (maxCyclesFromContext > 0) return maxCyclesFromContext;
    if (instructions.length > 0) {
      return instructions.length + STAGES_DEFINITION.length + 10;
    }
    return 15;
  }, [maxCyclesFromContext, instructions.length]);

  const cycleNumbers = React.useMemo(() => {
    const length = Math.max(0, Number(calculatedMaxCycles) || 0);
    if (isNaN(length)) {
      console.error('[PipelineVis] CRITICAL ERROR IN CYCLE NUMBERS: length for cycleNumbers is NaN. calculatedMaxCycles was:', calculatedMaxCycles);
      return Array.from({ length: 15 }, (_, i) => i + 1);
    }
    return Array.from({ length }, (_, i) => i + 1);
  }, [calculatedMaxCycles]);

  if (!Array.isArray(cycleNumbers)) {
    console.error('[PipelineVis] CRITICAL ERROR: cycleNumbers is NOT an array before map. Value:', cycleNumbers);
  }

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
                {(cycleNumbers || []).map((cNum) => (
                  <TableHead key={`cycle-header-${cNum}`} className="text-center w-16">
                    {cNum}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(instructions.length > 0) ? instructions.map((inst, instIndex) => (
                <TableRow key={`inst-row-${instIndex}`}>
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>
                  {(cycleNumbers || []).map((cCol) => {
                    const stageInfo = instructionStages?.[instIndex];
                    const eventKey = `cycle-${cCol}-inst-${instIndex}`;
                    const historicalEvent = pipelineEventHistory?.[eventKey];

                    let cellContentConfig = null;
                    let cellBgClass = 'bg-background';
                    let cellTextClass = 'text-foreground';

                    if (cCol === cycle && !isFinished) { 
                      if (stageInfo && stageInfo.stage !== null && stageInfo.stage < PIPELINE_STAGE_INDICES.OUT) {
                        const currentStageIdx = stageInfo.stage;
                        const isStalled = !!stageInfo.isStalled;
                        const isForwarding = !!stageInfo.forwardingSourceStage && currentStageIdx === PIPELINE_STAGE_INDICES.EX;

                        if (isStalled) {
                          if (currentStageIdx < STAGES_DEFINITION.length) {
                            const stageData = STAGES_DEFINITION[currentStageIdx];
                            cellContentConfig = {
                                icon: MinusCircle, 
                                name: `${stageData.name} (Stall)` 
                            };
                          } else { // Fallback
                             cellContentConfig = {name: 'STALL', icon: MinusCircle};
                          }
                          cellBgClass = 'bg-stall'; cellTextClass = 'text-stall-foreground';
                        } else if (isForwarding) {
                          const stageData = STAGES_DEFINITION[currentStageIdx];
                          cellContentConfig = { 
                            icon: stageData.icon,
                            name: `${stageData.name} (FWD ${stageInfo.forwardingSourceStage})` 
                          };
                          cellBgClass = 'bg-forwarding'; cellTextClass = 'text-forwarding-foreground';
                        } else if (currentStageIdx < STAGES_DEFINITION.length) {
                          cellContentConfig = STAGES_DEFINITION[currentStageIdx];
                          if (isRunning) {
                            cellBgClass = 'bg-accent animate-pulse-bg'; cellTextClass = 'text-accent-foreground';
                          } else {
                            cellBgClass = 'bg-accent'; cellTextClass = 'text-accent-foreground';
                          }
                        }
                      }
                    } else if (cCol < cycle || (isFinished && cCol <= cycle)) { 
                      if (historicalEvent) {
                        const eventStageIdx = historicalEvent.stage;
                        if (historicalEvent.type === 'stall' && eventStageIdx < STAGES_DEFINITION.length) {
                          const stageData = STAGES_DEFINITION[eventStageIdx];
                          cellContentConfig = {
                              icon: MinusCircle,
                              name: `${stageData.name} (Stall)`
                          };
                          cellBgClass = 'bg-stall'; cellTextClass = 'text-stall-foreground';
                        } else if (historicalEvent.type === 'forwarding' && eventStageIdx === PIPELINE_STAGE_INDICES.EX) {
                          const stageData = STAGES_DEFINITION[PIPELINE_STAGE_INDICES.EX];
                           cellContentConfig = { 
                            icon: stageData.icon,
                            name: `${stageData.name} (FWD ${historicalEvent.forwardingSource})`
                          };
                          cellBgClass = 'bg-forwarding'; cellTextClass = 'text-forwarding-foreground';
                        } else if (historicalEvent.type === 'active' && eventStageIdx < STAGES_DEFINITION.length) {
                          cellContentConfig = STAGES_DEFINITION[eventStageIdx];
                          cellBgClass = 'bg-secondary'; cellTextClass = 'text-secondary-foreground';
                        } else { 
                           cellBgClass = 'bg-background'; 
                        }
                      } else if (isFinished) { 
                          const idealStageInPast = cCol - (instIndex + 1);
                          if (idealStageInPast >=0 && idealStageInPast < STAGES_DEFINITION.length) {
                              const finalActualStage = stageInfo?.stage; 
                              if (finalActualStage === PIPELINE_STAGE_INDICES.OUT || (finalActualStage !== null && finalActualStage >= idealStageInPast) ) {
                                  cellContentConfig = STAGES_DEFINITION[idealStageInPast];
                                  cellBgClass = 'bg-secondary';
                                  cellTextClass = 'text-secondary-foreground';
                              }
                          }
                      }
                    }

                    return (
                      <TableCell
                        key={`cell-${instIndex}-${cCol}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          cellBgClass,
                          cellTextClass
                        )}
                      >
                        {cellContentConfig && (
                           <div className="flex flex-col items-center justify-center">
                             {cellContentConfig.icon && <cellContentConfig.icon className="w-4 h-4 mb-1" aria-hidden="true" />}
                             {cellContentConfig.name && <span className="text-xs">{cellContentConfig.name}</span>}
                           </div>
                         )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              )) : (
                <TableRow>
                    <TableCell colSpan={(cycleNumbers?.length || 0) + 1} className="text-center h-24">
                        No instructions loaded.
                    </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
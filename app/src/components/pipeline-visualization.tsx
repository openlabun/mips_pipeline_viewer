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

const STALL_STAGE_DISPLAY_DATA = { name: 'STALL', icon: MinusCircle };

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
    isFinished,
  } = useSimulationState();

  // Log inicial de los props del contexto
  // console.log('[PipelineVis] Render Start. Context values:', { contextInstructions, contextMaxCycles, cycle, isRunning, isFinished });

  const instructions = contextInstructions || [];
  const maxCyclesFromContext = contextMaxCycles || 0;

  // console.log('[PipelineVis] Safe values:', { instructionsLength: instructions.length, maxCyclesFromContext });

  const calculatedMaxCycles = React.useMemo(() => {
    // console.log('[PipelineVis] Entering useMemo for calculatedMaxCycles. Deps:', { maxCyclesFromContext, instructionsLength: instructions.length });
    let result;
    if (maxCyclesFromContext > 0) {
      result = maxCyclesFromContext;
    } else if (instructions.length > 0) {
      result = instructions.length + STAGES_DEFINITION.length + 10;
    } else {
      result = 15; // Default
    }
    // console.log('[PipelineVis] calculatedMaxCycles result:', result);
    return result;
  }, [maxCyclesFromContext, instructions.length]);

  // console.log('[PipelineVis] After useMemo for calculatedMaxCycles. Value:', calculatedMaxCycles);

  const cycleNumbers = React.useMemo(() => {
    // console.log('[PipelineVis] Entering useMemo for cycleNumbers. Dependency calculatedMaxCycles:', calculatedMaxCycles);
    const length = Math.max(0, Number(calculatedMaxCycles) || 0);
    if (isNaN(length)) {
        console.error('[PipelineVis] CRITICAL ERROR: length for cycleNumbers is NaN. calculatedMaxCycles was:', calculatedMaxCycles);
        return [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]; // Fallback
    }
    const result = Array.from({ length }, (_, i) => i + 1);
    // console.log('[PipelineVis] cycleNumbers result (length):', result.length);
    return result;
  }, [calculatedMaxCycles]);

  // console.log('[PipelineVis] After useMemo for cycleNumbers. Value:', cycleNumbers);

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

                    let cellContentConfig = null;
                    let cellBgClass = 'bg-background';
                    let cellTextClass = 'text-foreground';
                    let isStalledForCell = false;
                    let isForwardingForCell = false;

                    if (cCol === cycle) { 
                      if (stageInfo && stageInfo.stage !== null && stageInfo.stage < PIPELINE_STAGE_INDICES.OUT) {
                        const currentStageIdx = stageInfo.stage;
                        isStalledForCell = !!stageInfo.isStalled;
                        isForwardingForCell = !!stageInfo.forwardingSourceStage && currentStageIdx === PIPELINE_STAGE_INDICES.EX;

                        // --- CONSOLE LOG PARA LA CELDA DEL CICLO ACTUAL ---
                        // Loguear para la instrucción relevante (ej. Inst 1) o para todas si es necesario
                        if (instIndex === 1 && cCol === cycle) { 
                            console.log(`[PipelineVis] Cycle ${cycle}: Inst ${instIndex} ('${inst}') stageInfo:`, JSON.stringify(stageInfo) , `isStalledForCell: ${isStalledForCell}, isForwardingForCell: ${isForwardingForCell}`);
                        }
                        if(isStalledForCell && cCol === cycle){ // Este log ya existía y es bueno
                             console.log(`[PipelineVis] STALL VISUAL: Cycle ${cycle}, Inst ${instIndex} ('${inst}') IS STALLED. StageInfo:`, JSON.stringify(stageInfo));
                        }
                        if(isForwardingForCell && cCol === cycle && currentStageIdx === PIPELINE_STAGE_INDICES.EX){ // Este log ya existía y es bueno
                             console.log(`[PipelineVis] FORWARDING VISUAL: Cycle ${cycle}, Inst ${instIndex} ('${inst}') IS FORWARDING to EX from ${stageInfo.forwardingSourceStage}. StageInfo:`, JSON.stringify(stageInfo));
                        }
                        // --- FIN CONSOLE LOG ---

                        if (isFinished) {
                           if (isStalledForCell) {
                                cellContentConfig = STALL_STAGE_DISPLAY_DATA;
                                cellBgClass = 'bg-stall'; cellTextClass = 'text-stall-foreground';
                           } else if (isForwardingForCell) {
                                cellContentConfig = STAGES_DEFINITION[currentStageIdx];
                                cellBgClass = 'bg-forwarding'; cellTextClass = 'text-forwarding-foreground';
                           } else if (currentStageIdx < STAGES_DEFINITION.length) {
                                cellContentConfig = STAGES_DEFINITION[currentStageIdx];
                                cellBgClass = 'bg-secondary'; cellTextClass = 'text-secondary-foreground';
                           }
                        } else { 
                            if (isStalledForCell) {
                                cellContentConfig = STALL_STAGE_DISPLAY_DATA;
                                cellBgClass = 'bg-stall'; cellTextClass = 'text-stall-foreground';
                            } else if (isForwardingForCell) {
                                cellContentConfig = STAGES_DEFINITION[currentStageIdx];
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
                      } else if (isFinished && stageInfo && stageInfo.stage === PIPELINE_STAGE_INDICES.OUT) {
                        cellContentConfig = null;
                        cellBgClass = 'bg-background';
                      }
                    } else if (cCol < cycle) { 
                        const idealStageInPast = cCol - (instIndex + 1);
                        if (idealStageInPast >= 0 && idealStageInPast < STAGES_DEFINITION.length) {
                            const actualCurrentStageForInst = stageInfo?.stage;
                            if (actualCurrentStageForInst !== null && typeof actualCurrentStageForInst !== 'undefined') {
                                if (isFinished || actualCurrentStageForInst > idealStageInPast || actualCurrentStageForInst === PIPELINE_STAGE_INDICES.OUT) {
                                    cellContentConfig = STAGES_DEFINITION[idealStageInPast];
                                    cellBgClass = 'bg-secondary';
                                    cellTextClass = 'text-secondary-foreground';
                                }
                            }
                        }
                    }
                    
                    if (isFinished && cCol <= cycle ) { 
                        const idealStageInPast = cCol - (instIndex + 1);
                        if (idealStageInPast >=0 && idealStageInPast < STAGES_DEFINITION.length) {
                            if (cCol !== cycle) { 
                                if (!cellContentConfig) {
                                    cellContentConfig = STAGES_DEFINITION[idealStageInPast];
                                    cellBgClass = 'bg-secondary';
                                    cellTextClass = 'text-secondary-foreground';
                                }
                            } else if (!cellContentConfig && stageInfo?.stage !== PIPELINE_STAGE_INDICES.OUT) {
                                if (stageInfo?.stage !== null && typeof stageInfo?.stage !== 'undefined' && stageInfo.stage < STAGES_DEFINITION.length) {
                                    cellContentConfig = STAGES_DEFINITION[stageInfo.stage];
                                    cellBgClass = 'bg-secondary';
                                    cellTextClass = 'text-secondary-foreground';
                                }
                            }
                        } else if (idealStageInPast >= STAGES_DEFINITION.length && cCol !== cycle && !cellContentConfig) { 
                             cellContentConfig = null;
                             cellBgClass = 'bg-background';
                        }
                    } else if (isFinished && cCol > cycle && !cellContentConfig) { 
                        cellContentConfig = null;
                        cellBgClass = 'bg-background';
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
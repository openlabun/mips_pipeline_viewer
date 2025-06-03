'use client';


import { alarma } from '@/context/SimulationContext';
import { saltables } from './instruction-input'; 
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
  AlertTriangle,
  Zap,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';
import { Badge } from '@/components/ui/badge';
import { misses } from '@/context/SimulationContext';
import { botonn } from '@/context/SimulationContext';


const PIPELINE_STAGE_CONFIG = [
  { id: 'IF', icon: Download, label: 'IF' },
  { id: 'ID', icon: Code2, label: 'ID' },
  { id: 'EX', icon: Cpu, label: 'EX' },
  { id: 'MEM', icon: MemoryStick, label: 'MEM' },
  { id: 'WB', icon: CheckSquare, label: 'WB' },
] as const;

type PipelineStageId = typeof PIPELINE_STAGE_CONFIG[number]['id'];

interface CellDisplayInfo {
  type: 'stall' | 'forwarding' | 'normal' | 'empty';
  stage: typeof PIPELINE_STAGE_CONFIG[number] | null;
  isCurrentlyActiveCycleCell: boolean;
  forwardingDetails?: any; 
}


export function PipelineVisualization() {

  const {
    instructions: instructionList, 
    currentCycle: activeSimCycle,  
    maxCycles: totalSimulationCycles, 
    isRunning: simulationIsRunning, 
    instructionStages: instructionStageTracker, 
    isFinished: simulationIsConcluded,
    hazards: hazardDetails, 
    forwardings: forwardingDetailsFromContext, 
    stalls: stallDataFromContext, 
    registerUsage: instructionRegisterInfo, 
  
    stallsEnabled: stallLogicIsEnabled, 
    forwardingEnabled: forwardingLogicIsEnabled, 
  } = useSimulationState();

  const displayedCycleCount = totalSimulationCycles > 0 ? totalSimulationCycles : 0;
  const cycleIterationNumbers = Array.from(
    { length: displayedCycleCount },
    (_, i) => i + 1
  );

  
  const sumStallsBeforeInstruction = (instrIdx: number): number => {
    if (!stallLogicIsEnabled) return 0;
    let cumulativeStalls = 0;
    for (let i = 0; i < instrIdx; i++) {
      cumulativeStalls += stallDataFromContext[i] || 0;
    }
    return cumulativeStalls;
  };

  const isCellIndicatingStall = (instrIdx: number, cycleValue: number): boolean => {
    if (!stallLogicIsEnabled || !stallDataFromContext[instrIdx] || stallDataFromContext[instrIdx] <= 0) return false;
    
    
    const expectedCycleForIDWithoutStalls = instrIdx + 2; 
    const precedingStalls = sumStallsBeforeInstruction(instrIdx);
    const currentInstructionStalls = stallDataFromContext[instrIdx];

    return (
      cycleValue > expectedCycleForIDWithoutStalls + precedingStalls &&
      cycleValue <= expectedCycleForIDWithoutStalls + precedingStalls + currentInstructionStalls
    );
  };

  const getForwardingDetailsForCell = (instrIdx: number, cycleValue: number) => {
    if (
      !stallLogicIsEnabled ||
      !forwardingLogicIsEnabled ||
      !forwardingDetailsFromContext[instrIdx] ||
      forwardingDetailsFromContext[instrIdx].length === 0
    ) {
      return { hasForwarding: false, details: undefined };
    }

    const precedingStalls = sumStallsBeforeInstruction(instrIdx);
    
    const effectiveStageIndex = cycleValue - instrIdx - 1 - precedingStalls;

   
    if (effectiveStageIndex === 2) {
      return {
        hasForwarding: true,
        details: forwardingDetailsFromContext[instrIdx],
      };
    }
    return { hasForwarding: false, details: undefined };
  };

  const isCycleColumnActive = (cycleValue: number): boolean => {
    return cycleValue === activeSimCycle;
  };
  
  const determineCellState = (instrIdx: number, cycleValue: number): CellDisplayInfo => {
    const precedingStalls = sumStallsBeforeInstruction(instrIdx);

    if (stallLogicIsEnabled && isCellIndicatingStall(instrIdx, cycleValue)) {
      return {
        type: 'stall',
        stage: null,
        isCurrentlyActiveCycleCell: isCycleColumnActive(cycleValue),
      };
    }

    
    const stageIndexInPipeline = cycleValue - instrIdx - 1 - precedingStalls;
    const currentActualStageIndexForInstruction = instructionStageTracker[instrIdx];

    const isStageValid = stageIndexInPipeline >= 0 && stageIndexInPipeline < PIPELINE_STAGE_CONFIG.length;
    const stageConfigForCell = isStageValid ? PIPELINE_STAGE_CONFIG[stageIndexInPipeline] : null;

    const { hasForwarding, details: forwardingData } = getForwardingDetailsForCell(instrIdx, cycleValue);

    
    const isCellRepresentingCurrentProgress =
      currentActualStageIndexForInstruction !== null &&
      stageIndexInPipeline === currentActualStageIndexForInstruction &&
      cycleValue === activeSimCycle;

    const isBranchRowActive =
                    alarma === true &&
                    saltables[instrIdx] &&
                    botonn === true;

    if (hasForwarding) {
      return {
        type: 'forwarding',
        stage: stageConfigForCell,
        isCurrentlyActiveCycleCell: isCellRepresentingCurrentProgress || isCycleColumnActive(cycleValue),
        forwardingDetails: forwardingData,
      };
    }

    return {
      type: isStageValid ? 'normal' : 'empty',
      stage: stageConfigForCell,
      isCurrentlyActiveCycleCell: isCellRepresentingCurrentProgress || isCycleColumnActive(cycleValue),
    };
  };


  return (
    <Card className='w-full overflow-hidden'>
      <CardHeader>
        <CardTitle>
          Pipeline Progress
          {!stallLogicIsEnabled && (
            <span className='ml-2 text-sm font-normal text-muted-foreground'>
              (Ideal Pipeline - No Hazard Detection)
            </span>
          )}
          
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto'>
          <Table className='min-w-max'>
            <TableCaption>
              MIPS instruction pipeline visualization
              {!stallLogicIsEnabled && ' - ideal 5-stage pipeline'}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[120px] sticky left-0 bg-card z-10 border-r'>
                  Instruction
                </TableHead>
                <TableHead className='w-[240px] sticky left-[120px] bg-card z-10 border-r'>
                  {stallLogicIsEnabled ? 'Hazard & Forwarding Info' : 'Instruction Type'}
                </TableHead>
                {cycleIterationNumbers.map((cycleNum) => (
                  <TableHead key={`cycle-header-${cycleNum}`} className='text-center w-16'>
                    {cycleNum}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              
              {instructionList.map((instructionHex, instrIdx) => {
                const currentInstructionHazards = hazardDetails[instrIdx];
                const currentInstructionStalls = stallDataFromContext[instrIdx];
                const currentForwardingInfo = forwardingDetailsFromContext[instrIdx];
                const registerUsageInfo = instructionRegisterInfo[instrIdx];

                return (
                  <TableRow key={`instr-row-${instrIdx}`} className='h-24'>
                    <TableCell className='font-mono sticky left-0 bg-card z-10 border-r'>
                      {instructionHex}
                      {registerUsageInfo && (
                        <div className='text-xs text-muted-foreground mt-1'>
                          {registerUsageInfo.type}-type
                          {registerUsageInfo.isLoad && ' (Load)'}: rs=${registerUsageInfo.rs}, rt=${registerUsageInfo.rt}
                          {registerUsageInfo.rd !== 0 && `, rd=$${registerUsageInfo.rd}`}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className='sticky left-[120px] bg-card z-10 border-r'>
                      {stallLogicIsEnabled ? (
                        currentInstructionHazards?.type !== 'NONE' && (
                          <div className='flex flex-col gap-1 items-start'>
                            <div className='flex items-start gap-1'>
                              <Badge
                                className={cn(
                                  currentInstructionHazards.type === 'RAW'
                                    ? 'border-red-500 bg-red-100 text-red-500'
                                    : 'border-yellow-500 bg-yellow-100 text-yellow-500',
                                  'px-2 border-[1px] rounded-lg'
                                )}
                              >
                                {currentInstructionHazards.type}
                              </Badge>
                              {currentInstructionHazards.canForward && currentForwardingInfo?.length > 0 && (
                                <Badge className='border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg'>
                                  FORWARDING
                                </Badge>
                              )}
                              {currentInstructionStalls > 0 && (
                                <Badge className='border px-2 bg-red-100 text-red-500 border-red-500 rounded-lg'>
                                  STALL ({currentInstructionStalls})
                                </Badge>
                              )}
                            </div>
                            {currentInstructionHazards.canForward && currentForwardingInfo?.length > 0 && (
                              <div className='flex items-center gap-1 flex-wrap'> 
                                {currentForwardingInfo.map((fwDetail, fwIdx) => (
                                  <span
                                    key={`fw-${instrIdx}-${fwIdx}`}
                                    className='text-xs border px-2 bg-black/1 text-black border-black/50 rounded-lg'
                                  >
                                    {fwDetail.fromStage} {fwDetail.register} → {fwDetail.toStage}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ) : (
                        registerUsageInfo && (
                          <div className='flex flex-col gap-1'>
                            <Badge className='w-fit px-2 border-[1px] bg-blue-100 text-blue-500 border-blue-500 rounded-lg'>
                              {registerUsageInfo.type}-TYPE
                            </Badge>
                            {registerUsageInfo.isLoad && (
                              <Badge className='w-fit px-2 border-[1px] bg-purple-100 text-purple-500 border-purple-500 rounded-lg'>
                                LOAD
                              </Badge>
                            )}
                          </div>
                        )
                      )}
                    </TableCell>

                    {cycleIterationNumbers.map((cycleVal) => {
                      const cellDisplay = determineCellState(instrIdx, cycleVal);
                      const isColActive = cycleVal === activeSimCycle;
                      const cellHasPipelineContent = cellDisplay.type !== 'empty';

                      const baseCellStyle =
                        cellDisplay.type === 'stall'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                          : cellDisplay.type === 'forwarding'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          : cellDisplay.type === 'normal'
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-background'; 

                      const activeColumnHighlightStyle =
                        isColActive && cellHasPipelineContent
                          ? cellDisplay.type === 'stall'
                            ? 'bg-red-200 dark:bg-red-800/50' 
                            : cellDisplay.type === 'forwarding'
                            ? 'bg-green-200 dark:bg-green-800/50' 
                            : 'bg-accent text-accent-foreground'
                          : '';
                      
                      const animationStyle =
                        isColActive && cellHasPipelineContent && simulationIsRunning && !simulationIsConcluded
                          ? cellDisplay.type === 'stall'
                            ? 'animate-pulse-bg-red'
                            : cellDisplay.type === 'forwarding'
                            ? 'animate-pulse-bg-green'
                            : 'animate-pulse-bg'
                          : '';

                      
                      const branchSkipStyleOverride =
                        alarma === true &&
                        saltables[instrIdx] && 
                        cellDisplay.stage &&
                        (PIPELINE_STAGE_CONFIG as ReadonlyArray<{label: string}>).map(s => s.label).includes(cellDisplay.stage.label as PipelineStageId) && // Ensure type compatibility
                        botonn === true && 
                        'bg-purple-300 text-black border border-purple-500';

                      return (
                        <TableCell
                          key={`instr-${instrIdx}-cycle-${cycleVal}`}
                          className={cn(
                            'text-center w-16 h-14 p-0 transition-colors duration-300',
                            baseCellStyle, 
                            activeColumnHighlightStyle, 
                            animationStyle, 
                            branchSkipStyleOverride 
                          )}
                        >
                          {cellDisplay.type === 'stall' && (
                            <div className='flex flex-col items-center justify-center'>
                              <AlertTriangle className='w-4 h-4 mb-1 text-red-500' />
                              <span className='text-xs font-semibold'>STALL</span>
                            </div>
                          )}
                          {cellDisplay.type === 'normal' && cellDisplay.stage && (
                            <div className='flex flex-col items-center justify-center'>
                              {branchSkipStyleOverride ? (
                                <X className='w-4 h-4 mb-1 text-red-500' /> 
                              ) : (
                                <cellDisplay.stage.icon className='w-4 h-4 mb-1' /> 
                              )}
                              <span className='text-xs'>{cellDisplay.stage.label}</span>
                            </div>
                          )}
                          
                          {cellDisplay.type === 'forwarding' && cellDisplay.stage && (
                            <div className='flex flex-col items-center justify-center'>
                              <div className='flex items-center justify-center mb-1 gap-1'>
                                {branchSkipStyleOverride ? (
                                  <X className='w-4 h-4 text-red-500' /> 
                                ) : (
                                  <cellDisplay.stage.icon className='w-4 h-4' />
                                )}
                                
                                <Zap className='w-3 h-3 text-green-500' /> 
                              </div>
                              <span className='text-xs'>{cellDisplay.stage.label}</span>
                            </div>
                          )}
                          
                          {branchSkipStyleOverride && ( 
                           <div>
                              <span className="text-[10px] font-semibold leading-tight"></span>
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        
        <span className="ml-6 text-sm font-Arial text-purple-600">
              Number of Branch misses: {misses}
        </span>
        <div className='flex flex-wrap gap-4 mt-4 text-sm'>
          <div className='flex items-center'>
            <div className='w-4 h-4 bg-accent mr-2 rounded-sm'></div>
            <span>Current Stage</span>
          </div>
          <div className='flex items-center'>
            <div className='w-4 h-4 bg-secondary mr-2 rounded-sm'></div>
            <span>Completed Stage</span>
          </div>
          {stallLogicIsEnabled && (
            <>
              <div className='flex items-center'>
                <div className='w-4 h-4 bg-red-100 dark:bg-red-900/30 mr-2 rounded-sm'></div>
                <span>Stall</span>
              </div>
              <div className='flex items-center'>
                <div className='w-4 h-4 bg-green-100 dark:bg-green-900/30 mr-2 rounded-sm'></div>
                <span>Forwarding</span>
              </div>
            </>
          )}
          <div className='flex items-center'>
            <div className='w-4 h-4 bg-purple-100 dark:bg-purple-900/30 mr-2 rounded-sm'></div>
            <span>Branch</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
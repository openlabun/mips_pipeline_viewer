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
  AlertTriangle,
  Zap,
  GitBranch,
  X,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';
import { Badge } from '@/components/ui/badge';

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
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
    hazards,
    forwardings,
    stalls,
    registerUsage,
    branches,
    currentStallCycles,
    currentFlushCycles,
    stallsEnabled,
    forwardingEnabled,
    branchPredictionEnabled,
    branchPredictionType,
    registerFile,
    totalBranches,
    totalMisses,
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

  // Calculate stalls before an instruction
  const calculatePrecedingStalls = (index: number): number => {
    if (!stallsEnabled) return 0;
    let totalStalls = 0;
    for (let i = 0; i < index; i++) {
      totalStalls += stalls[i] || 0;
    }
    return totalStalls;
  };

  // Determine if a cell represents a stall
  const isStallCell = (instIndex: number, cycleNum: number): boolean => {
    if (!stallsEnabled || stalls[instIndex] <= 0) return false;
    const expectedCycleWithoutStalls = instIndex + 2;
    const precedingStalls = calculatePrecedingStalls(instIndex);

    return (
      cycleNum > expectedCycleWithoutStalls + precedingStalls &&
      cycleNum <=
        expectedCycleWithoutStalls + precedingStalls + stalls[instIndex]
    );
  };

  // Determine if a cell represents a flush (for branch misprediction)
  const isFlushCell = (instIndex: number, cycleNum: number): boolean => {
    if (!stallsEnabled || !branchPredictionEnabled) return false;

    // Check if this instruction would be flushed due to branch misprediction
    for (let i = 0; i < instIndex; i++) {
      const branchInfo = branches[i];
      if (branchInfo?.isMispredicted) {
        const branchCycle = i + 2; // Branch resolved in ID stage (cycle i+2)
        const precedingStalls = calculatePrecedingStalls(i);
        const actualBranchCycle = branchCycle + precedingStalls;

        // Instructions in pipeline after branch misprediction are flushed
        if (
          cycleNum >= actualBranchCycle &&
          cycleNum < actualBranchCycle + branchInfo.flushCycles
        ) {
          const instStartCycle =
            instIndex + 1 + calculatePrecedingStalls(instIndex);
          if (
            cycleNum >= instStartCycle &&
            cycleNum < actualBranchCycle + branchInfo.flushCycles
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Determine if this cell shows forwarding
  const getForwardingInfo = (instIndex: number, cycleNum: number) => {
    if (
      !stallsEnabled ||
      !forwardingEnabled ||
      !forwardings[instIndex] ||
      forwardings[instIndex].length === 0
    ) {
      return { isForwarding: false };
    }

    const precedingStalls = calculatePrecedingStalls(instIndex);
    const expectedStage = cycleNum - instIndex - 1 - precedingStalls;

    // Show forwarding in the EX stage (stage 2)
    if (expectedStage === 2) {
      return {
        isForwarding: true,
        forwardingInfo: forwardings[instIndex],
      };
    }

    return { isForwarding: false };
  };

  // Check if a cell is in the current active column
  const isInCurrentColumn = (cycleNum: number): boolean => {
    return cycleNum === cycle;
  };

  // Determine current stage and cell state
  const getCellState = (instIndex: number, cycleNum: number) => {
    const precedingStalls = calculatePrecedingStalls(instIndex);

    // Check for flush first
    if (
      stallsEnabled &&
      branchPredictionEnabled &&
      isFlushCell(instIndex, cycleNum)
    ) {
      return {
        type: 'flush',
        stage: null,
        isCurrentCell: isInCurrentColumn(cycleNum),
      };
    }

    // Check for stalls
    if (stallsEnabled && isStallCell(instIndex, cycleNum)) {
      return {
        type: 'stall',
        stage: null,
        isCurrentCell: isInCurrentColumn(cycleNum),
      };
    }

    const expectedStageIndex = cycleNum - instIndex - 1 - precedingStalls;
    const currentStageIndex = instructionStages[instIndex];

    const isInPipeline =
      expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
    const stageData = isInPipeline ? STAGES[expectedStageIndex] : null;

    const { isForwarding, forwardingInfo } = getForwardingInfo(
      instIndex,
      cycleNum
    );

    const isCurrentCell =
      currentStageIndex !== null &&
      expectedStageIndex === currentStageIndex &&
      cycleNum === cycle;

    // Special handling for branch instructions in ID stage (only when branch prediction is enabled)
    if (
      isInPipeline &&
      expectedStageIndex === 1 &&
      registerUsage[instIndex]?.isBranch &&
      branchPredictionEnabled
    ) {
      const branchInfo = branches[instIndex];
      return {
        type: branchInfo?.isMispredicted
          ? 'branch_mispredicted'
          : 'branch_predicted',
        stage: stageData,
        isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
        branchInfo,
      };
    }

    if (isForwarding) {
      return {
        type: 'forwarding',
        stage: stageData,
        isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
        forwardingInfo,
      };
    }

    return {
      type: isInPipeline ? 'normal' : 'empty',
      stage: stageData,
      isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
    };
  };

  return (
    <Card className='w-full overflow-hidden'>
      <CardHeader>
        <CardTitle>
          Pipeline Progress
          {!stallsEnabled && (
            <span className='ml-2 text-sm font-normal text-muted-foreground'>
              (Ideal Pipeline - No Hazard Detection)
            </span>
          )}
          {currentFlushCycles > 0 && (
            <span className='ml-2 text-sm font-normal text-orange-600'>
              (Flushing Pipeline - {currentFlushCycles} cycles remaining)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto'>
          <Table className='min-w-max'>
            <TableCaption>
              MIPS instruction pipeline visualization
              {!stallsEnabled && ' - ideal 5-stage pipeline'}
              {stallsEnabled &&
                branchPredictionEnabled &&
                ' - with branch prediction and control hazards'}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[120px] sticky bg-card z-10 border-r'>
                  Instruction
                </TableHead>
                <TableHead className='w-[280px] sticky bg-card z-10 border-r'>
                  {stallsEnabled ? 'Hazards & Branch Info' : 'Instruction Type'}
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className='text-center w-16'>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`} className='h-24'>
                  <TableCell className='font-mono sticky left-0 bg-card z-10 border-r'>
                    {inst}
                    {registerUsage[instIndex] && (
                      <div className='text-xs text-muted-foreground mt-1'>
                        {registerUsage[instIndex].type}-type
                        {registerUsage[instIndex].isLoad && ' (Load)'}
                        {registerUsage[instIndex].isBranch &&
                          ` (${registerUsage[
                            instIndex
                          ].branchType?.toUpperCase()})`}
                        <br />
                        rs=${registerUsage[instIndex].rs}, rt=$
                        {registerUsage[instIndex].rt}
                        {registerUsage[instIndex].rd !== 0 &&
                          `, rd=$${registerUsage[instIndex].rd}`}
                      </div>
                    )}
                  </TableCell>

                  {/* Hazard information or instruction type */}
                  <TableCell className='sticky left-[120px] bg-card z-10 border-r'>
                    {stallsEnabled
                      ? // Show hazard info when stalls are enabled
                        (hazards[instIndex]?.type !== 'NONE' ||
                          registerUsage[instIndex]?.isBranch) && (
                          <div className='flex flex-col gap-1 items-start'>
                            <div className='flex items-start gap-1 flex-wrap'>
                              {/* Hazard type badge */}
                              {hazards[instIndex]?.type !== 'NONE' && (
                                <Badge
                                  className={cn(
                                    hazards[instIndex].type === 'RAW'
                                      ? 'border-red-500 bg-red-100 text-red-500'
                                      : hazards[instIndex].type === 'WAW'
                                      ? 'border-yellow-500 bg-yellow-100 text-yellow-500'
                                      : hazards[instIndex].type === 'CONTROL'
                                      ? 'border-orange-500 bg-orange-100 text-orange-500'
                                      : 'border-gray-500 bg-gray-100 text-gray-500',
                                    'px-2 border-[1px] rounded-lg'
                                  )}
                                >
                                  {hazards[instIndex].type}
                                </Badge>
                              )}

                              {/* Branch info badges */}
                              {registerUsage[instIndex]?.isBranch &&
                                branchPredictionEnabled && (
                                  <>
                                    <Badge className='border px-2 bg-blue-100 text-blue-500 border-blue-500 rounded-lg'>
                                      BRANCH
                                    </Badge>
                                    {branches[instIndex]?.isMispredicted ? (
                                      <Badge className='border px-2 bg-red-100 text-red-500 border-red-500 rounded-lg'>
                                        MISPREDICTED
                                      </Badge>
                                    ) : (
                                      branches[instIndex] && (
                                        <Badge className='border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg'>
                                          PREDICTED
                                        </Badge>
                                      )
                                    )}
                                  </>
                                )}

                              {/* Forwarding badge */}
                              {hazards[instIndex]?.canForward &&
                                forwardings[instIndex]?.length > 0 && (
                                  <Badge className='border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg'>
                                    FORWARDING
                                  </Badge>
                                )}

                              {/* Stall badge */}
                              {stalls[instIndex] > 0 && (
                                <Badge className='border px-2 bg-red-100 text-red-500 border-red-500 rounded-lg'>
                                  STALL ({stalls[instIndex]})
                                </Badge>
                              )}
                            </div>

                            {/* Forwarding details */}
                            {hazards[instIndex]?.canForward &&
                              forwardings[instIndex]?.length > 0 && (
                                <div className='flex items-center gap-1 flex-wrap'>
                                  {forwardings[instIndex].map((fw, idx) => (
                                    <span
                                      key={idx}
                                      className='text-xs border px-2 bg-black/1 text-black border-black/50 rounded-lg'
                                    >
                                      {fw.fromStage} {fw.register} →{' '}
                                      {fw.toStage}
                                    </span>
                                  ))}
                                </div>
                              )}

                            {/* Branch details */}
                            {registerUsage[instIndex]?.isBranch &&
                              branches[instIndex] &&
                              branchPredictionEnabled && (
                                <div className='text-xs text-muted-foreground mt-1'>
                                  <div>
                                    Condition:{' '}
                                    {registerUsage[
                                      instIndex
                                    ].branchType?.toUpperCase()}{' '}
                                    $rs=$
                                    {registerFile?.[
                                      registerUsage[instIndex].rs
                                    ] || '?'}{' '}
                                    {'<->'} $rt=$
                                    {registerFile?.[
                                      registerUsage[instIndex].rt
                                    ] || '?'}
                                  </div>
                                  <div>
                                    Result:{' '}
                                    {branches[instIndex].conditionResult
                                      ? 'TRUE (taken)'
                                      : 'FALSE (not taken)'}{' '}
                                    | Predicted:{' '}
                                    {branches[instIndex].isPredicted
                                      ? 'TAKEN'
                                      : 'NOT TAKEN'}
                                  </div>
                                  <div>
                                    Strategy:{' '}
                                    {branchPredictionType.replace('_', ' ')}
                                  </div>
                                  {branches[instIndex].target && (
                                    <div>
                                      Target: PC+
                                      {((branches[instIndex].target || 0) -
                                        instIndex -
                                        1) *
                                        4}
                                    </div>
                                  )}
                                </div>
                              )}
                          </div>
                        )
                      : // Show instruction type when stalls are disabled
                        registerUsage[instIndex] && (
                          <div className='flex flex-col gap-1'>
                            <Badge className='w-fit px-2 border-[1px] bg-blue-100 text-blue-500 border-blue-500 rounded-lg'>
                              {registerUsage[instIndex].type}-TYPE
                            </Badge>
                            {registerUsage[instIndex].isLoad && (
                              <Badge className='w-fit px-2 border-[1px] bg-purple-100 text-purple-500 border-purple-500 rounded-lg'>
                                LOAD
                              </Badge>
                            )}
                            {registerUsage[instIndex].isBranch && (
                              <Badge className='w-fit px-2 border-[1px] bg-orange-100 text-orange-500 border-orange-500 rounded-lg'>
                                BRANCH (
                                {registerUsage[
                                  instIndex
                                ].branchType?.toUpperCase()}
                                )
                              </Badge>
                            )}
                          </div>
                        )}
                  </TableCell>

                  {cycleNumbers.map((c) => {
                    const cellState = getCellState(instIndex, c);

                    const isActiveColumn = c === cycle;
                    const hasContent = cellState.type !== 'empty';

                    const cellStyle =
                      cellState.type === 'stall'
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                        : cellState.type === 'flush'
                        ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                        : cellState.type === 'forwarding'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : cellState.type === 'branch_mispredicted'
                        ? 'bg-red-200 dark:bg-red-800/50 text-red-700 dark:text-red-300'
                        : cellState.type === 'branch_predicted'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : cellState.type === 'normal'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-background';

                    const animationClass =
                      isActiveColumn && hasContent && isRunning && !isFinished
                        ? cellState.type === 'stall'
                          ? 'animate-pulse-bg-red'
                          : cellState.type === 'flush'
                          ? 'animate-pulse-bg-orange'
                          : cellState.type === 'forwarding'
                          ? 'animate-pulse-bg-green'
                          : cellState.type === 'branch_mispredicted'
                          ? 'animate-pulse-bg-red'
                          : cellState.type === 'branch_predicted'
                          ? 'animate-pulse-bg-blue'
                          : 'animate-pulse-bg'
                        : '';

                    const highlightClass =
                      isActiveColumn && hasContent
                        ? cellState.type === 'stall'
                          ? 'bg-red-200 dark:bg-red-800/50'
                          : cellState.type === 'flush'
                          ? 'bg-orange-200 dark:bg-orange-800/50'
                          : cellState.type === 'forwarding'
                          ? 'bg-green-200 dark:bg-green-800/50'
                          : cellState.type === 'branch_mispredicted'
                          ? 'bg-red-300 dark:bg-red-700/50'
                          : cellState.type === 'branch_predicted'
                          ? 'bg-blue-200 dark:bg-blue-800/50'
                          : 'bg-accent text-accent-foreground'
                        : '';

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          cellStyle,
                          isActiveColumn ? highlightClass : '',
                          animationClass
                        )}
                      >
                        {/* Flush indicator */}
                        {cellState.type === 'flush' && (
                          <div className='flex flex-col items-center justify-center'>
                            <X className='w-4 h-4 mb-1 text-orange-500' />
                            <span className='text-xs font-semibold'>FLUSH</span>
                          </div>
                        )}

                        {/* Stall indicator */}
                        {cellState.type === 'stall' && (
                          <div className='flex flex-col items-center justify-center'>
                            <AlertTriangle className='w-4 h-4 mb-1 text-red-500' />
                            <span className='text-xs font-semibold'>STALL</span>
                          </div>
                        )}

                        {/* Branch mispredicted indicator */}
                        {cellState.type === 'branch_mispredicted' &&
                          cellState.stage && (
                            <div className='flex flex-col items-center justify-center'>
                              <div className='flex items-center justify-center mb-1 gap-1'>
                                <cellState.stage.icon className='w-4 h-4' />
                                <GitBranch className='w-3 h-3 text-red-500' />
                              </div>
                              <span className='text-xs'>
                                {cellState.stage.name}
                              </span>
                            </div>
                          )}

                        {/* Branch predicted indicator */}
                        {cellState.type === 'branch_predicted' &&
                          cellState.stage && (
                            <div className='flex flex-col items-center justify-center'>
                              <div className='flex items-center justify-center mb-1 gap-1'>
                                <cellState.stage.icon className='w-4 h-4' />
                                <Target className='w-3 h-3 text-blue-500' />
                              </div>
                              <span className='text-xs'>
                                {cellState.stage.name}
                              </span>
                            </div>
                          )}

                        {/* Normal stage indicator */}
                        {cellState.type === 'normal' && cellState.stage && (
                          <div className='flex flex-col items-center justify-center'>
                            <cellState.stage.icon className='w-4 h-4 mb-1' />
                            <span className='text-xs'>
                              {cellState.stage.name}
                            </span>
                          </div>
                        )}

                        {/* Forwarding indicator */}
                        {cellState.type === 'forwarding' && cellState.stage && (
                          <div className='flex flex-col items-center justify-center'>
                            <div className='flex items-center justify-center mb-1 gap-1'>
                              <cellState.stage.icon className='w-4 h-4' />
                              <Zap className='w-3 h-3 text-green-500' />
                            </div>
                            <span className='text-xs'>
                              {cellState.stage.name}
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

        {/* Legend */}
        <div className='flex flex-wrap gap-4 mt-4 text-sm'>
          <div className='flex items-center'>
            <div className='w-4 h-4 bg-accent mr-2 rounded-sm'></div>
            <span>Current Stage</span>
          </div>
          <div className='flex items-center'>
            <div className='w-4 h-4 bg-secondary mr-2 rounded-sm'></div>
            <span>Completed Stage</span>
          </div>
          {stallsEnabled && (
            <>
              <div className='flex items-center'>
                <div className='w-4 h-4 bg-red-100 dark:bg-red-900/30 mr-2 rounded-sm'></div>
                <span>Stall</span>
              </div>
              <div className='flex items-center'>
                <div className='w-4 h-4 bg-green-100 dark:bg-green-900/30 mr-2 rounded-sm'></div>
                <span>Forwarding</span>
              </div>
              {branchPredictionEnabled && (
                <>
                  <div className='flex items-center'>
                    <div className='w-4 h-4 bg-blue-100 dark:bg-blue-900/30 mr-2 rounded-sm'></div>
                    <span>Branch Predicted</span>
                  </div>
                  <div className='flex items-center'>
                    <div className='w-4 h-4 bg-orange-100 dark:bg-orange-900/30 mr-2 rounded-sm'></div>
                    <span>Pipeline Flush</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

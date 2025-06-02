"use client";

import type * as React from "react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Code2,
  Cpu,
  MemoryStick,
  CheckSquare,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulationState } from "@/context/SimulationContext";
import { Badge } from "@/components/ui/badge";
import { branchHistory, totalMisses } from "@/context/SimulationContext";
import type {
  PredictionMode,
  StateMachineConfig,
} from "@/context/SimulationContext";
import { XCircle, CheckCircle } from "lucide-react";

const STAGES = [
  { name: "IF", icon: Download },
  { name: "ID", icon: Code2 },
  { name: "EX", icon: Cpu },
  { name: "MEM", icon: MemoryStick },
  { name: "WB", icon: CheckSquare },
] as const;

function getCurrentPredictionDisplay(
  predictionMode: PredictionMode,
  stateMachineConfig: StateMachineConfig
): string {
  if (predictionMode === "TAKEN") return "Always Taken";
  if (predictionMode === "NOT_TAKEN") return "Always Not Taken";
  if (predictionMode === "STATE_MACHINE") {
    const prediction =
      branchHistory["global"]?.taken ??
      stateMachineConfig.initialPrediction === "TAKEN";
    return `State Machine → ${prediction ? "Taken" : "Not Taken"}`;
  }
  return "Unknown";
}

export function PipelineVisualization() {
  // Get state from context
  const {
    instructions,
    currentCycle: cycle,
    maxCycles, // Max cycles determines the number of columns
    isRunning,
    instructionStages, // Use the pre-calculated stages
    isFinished, // Use the finished flag from context
    hazards,
    forwardings,
    stalls,
    registerUsage,
    currentStallCycles,
    stallsEnabled,
    forwardingEnabled,
    predictionMode,
    stateMachineConfig,
    branchMisses,
  } = useSimulationState();

  const predictionDisplay = getCurrentPredictionDisplay(
    predictionMode,
    stateMachineConfig
  );
  // Use maxCycles for the number of columns if it's calculated, otherwise 0
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

    if (stallsEnabled && isStallCell(instIndex, cycleNum)) {
      return {
        type: "stall",
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

    if (isForwarding) {
      return {
        type: "forwarding",
        stage: stageData,
        isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
        forwardingInfo,
      };
    }

    return {
      type: isInPipeline ? "normal" : "empty",
      stage: stageData,
      isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
    };
  };

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>
          <CardHeader>
            <CardTitle className="flex justify-between items-start">
              <span>
                Pipeline Progress
                {!stallsEnabled && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    (Ideal Pipeline - No Hazard Detection)
                  </span>
                )}
              </span>
              <div className="flex flex-col text-base font-semibold items-end text-right">
                <div>
                  <span className="font-semibold">Predicción:</span>{" "}
                  {predictionDisplay}
                </div>
                <div>
                  <span className="font-semibold">Misses:</span> {totalMisses}
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          {!stallsEnabled && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (Ideal Pipeline - No Hazard Detection)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              MIPS instruction pipeline visualization
              {!stallsEnabled && " - ideal 5-stage pipeline"}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px] sticky bg-card z-10 border-r">
                  Instruction
                </TableHead>
                <TableHead className="w-[240px] sticky bg-card z-10 border-r">
                  {stallsEnabled ? "Hazard & Forwarding" : "Instruction Type"}
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`} className="h-24">
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                    {registerUsage[instIndex] && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {registerUsage[instIndex].type}-type
                        {registerUsage[instIndex].isLoad && " (Load)"}: rs=$
                        {registerUsage[instIndex].rs}, rt=$
                        {registerUsage[instIndex].rt}
                        {registerUsage[instIndex].rd !== 0 &&
                          `, rd=$${registerUsage[instIndex].rd}`}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="sticky left-[120px] bg-card z-10 border-r">
                    {stallsEnabled
                      ? hazards[instIndex]?.type !== "NONE" && (
                          <div className="flex flex-col gap-1 items-start">
                            <div className="flex items-start gap-1">
                              <Badge
                                className={cn(
                                  hazards[instIndex].type === "RAW"
                                    ? "border-red-500 bg-red-100 text-red-500"
                                    : "border-yellow-500 bg-yellow-100 text-yellow-500",
                                  "px-2 border-[1px] rounded-lg"
                                )}
                              >
                                {hazards[instIndex].type}
                              </Badge>
                              {hazards[instIndex].canForward &&
                                forwardings[instIndex]?.length > 0 && (
                                  <Badge className="border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg">
                                    FORWARDING
                                  </Badge>
                                )}
                              {stalls[instIndex] > 0 && (
                                <Badge className="border px-2 bg-red-100 text-red-500 border-red-500 rounded-lg">
                                  STALL ({stalls[instIndex]})
                                </Badge>
                              )}
                            </div>

                            {hazards[instIndex].canForward &&
                              forwardings[instIndex]?.length > 0 && (
                                <div className="flex items-center gap-1">
                                  {forwardings[instIndex].map((fw, idx) => (
                                    <span
                                      key={idx}
                                      className="text-xs border px-2 bg-black/1 text-black border-black/50 rounded-lg"
                                    >
                                      {fw.fromStage} {fw.register} →{" "}
                                      {fw.toStage}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                        )
                      : registerUsage[instIndex] && (
                          <div className="flex flex-col gap-1">
                            <Badge className="w-fit px-2 border-[1px] bg-blue-100 text-blue-500 border-blue-500 rounded-lg">
                              {registerUsage[instIndex].type}-TYPE
                            </Badge>
                            {registerUsage[instIndex].isLoad && (
                              <Badge className="w-fit px-2 border-[1px] bg-purple-100 text-purple-500 border-purple-500 rounded-lg">
                                LOAD
                              </Badge>
                            )}
                          </div>
                        )}
                  </TableCell>

                  {cycleNumbers.map((c) => {
                    const cellState = getCellState(instIndex, c);
                    console.log(branchMisses);
                    const isActiveColumn = c === cycle;
                    const hasContent = cellState.type !== "empty";

                    const cellStyle =
                      cellState.type === "stall"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                        : cellState.type === "forwarding"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                        : cellState.type === "normal"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-background";

                    const showBranchMiss =
                      isActiveColumn &&
                      cellState.stage?.name === "ID" &&
                      registerUsage[instIndex]?.isBranch &&
                      branchMisses[instIndex] === true;

                    const showBranchCorrect =
                      isActiveColumn &&
                      cellState.stage?.name === "ID" &&
                      registerUsage[instIndex]?.isBranch &&
                      branchMisses[instIndex] === undefined;

                    const animationClass =
                      isActiveColumn && hasContent && isRunning && !isFinished
                        ? cellState.type === "stall"
                          ? "animate-pulse-bg-red"
                          : cellState.type === "forwarding"
                          ? "animate-pulse-bg-green"
                          : "animate-pulse-bg"
                        : "";

                    const highlightClass =
                      isActiveColumn && hasContent
                        ? cellState.type === "stall"
                          ? "bg-red-200 dark:bg-red-800/50"
                          : cellState.type === "forwarding"
                          ? "bg-green-200 dark:bg-green-800/50"
                          : "bg-accent text-accent-foreground"
                        : "";

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300",
                          cellStyle,
                          isActiveColumn ? highlightClass : "",
                          animationClass
                        )}
                      >
                        {cellState.type === "stall" && (
                          <div className="flex flex-col items-center justify-center">
                            <AlertTriangle className="w-4 h-4 mb-1 text-red-500" />
                            <span className="text-xs font-semibold">STALL</span>
                          </div>
                        )}

                        {cellState.type === "normal" && cellState.stage && (
                          <div className="flex flex-col items-center justify-center">
                            <cellState.stage.icon className="w-4 h-4 mb-1" />
                            <span className="text-xs">
                              {cellState.stage.name}
                            </span>
                            {showBranchMiss && (
                              <XCircle className="w-8 h-8 text-red-500 animate-pulse mt-1" />
                            )}
                            {showBranchCorrect && (
                              <CheckCircle className="w-8 h-8 text-yellow-500 animate-pulse mt-1" />
                            )}
                          </div>
                        )}

                        {cellState.type === "forwarding" && cellState.stage && (
                          <div className="flex flex-col items-center justify-center">
                            <div className="flex items-center justify-center mb-1 gap-1">
                              <cellState.stage.icon className="w-4 h-4" />
                              <Zap className="w-3 h-3 text-green-500" />
                            </div>
                            <span className="text-xs">
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
        <div className="flex flex-wrap gap-4 mt-4 text-sm">
          <div className="flex items-center">
            <div className="w-4 h-4 bg-accent mr-2 rounded-sm"></div>
            <span>Current Stage</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-secondary mr-2 rounded-sm"></div>
            <span>Completed Stage</span>
          </div>
          {stallsEnabled && (
            <>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-red-100 dark:bg-red-900/30 mr-2 rounded-sm"></div>
                <span>Stall</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-green-100 dark:bg-green-900/30 mr-2 rounded-sm"></div>
                <span>Forwarding</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import type * as React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableCaption } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Code2, Cpu, MemoryStick, CheckSquare, AlertTriangle, Zap, XCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulationState } from "@/context/SimulationContext";
import { Badge } from "@/components/ui/badge";

const STAGES = [
  { name: "IF", icon: Download },
  { name: "ID", icon: Code2 },
  { name: "EX", icon: Cpu },
  { name: "MEM", icon: MemoryStick },
  { name: "WB", icon: CheckSquare },
] as const;

export function PipelineVisualization() {
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
    branchMisses,
    missCount,
    stallsEnabled,
    forwardingEnabled,
    branchConfig,
    branchStateIndex,
    branchTakenTargets,
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

  const calculatePrecedingStalls = (index: number): number => {
    if (!stallsEnabled) return 0;
    let total = 0;
    for (let i = 0; i < index; i++) {
      total += stalls[i] || 0;
    }
    return total;
  };

  const hasSquashFromBranch = (instIndex: number): boolean => {
    if (branchTakenTargets[instIndex]) {
      return false;
    }

    return Object.entries(branchMisses).some(([jStr, wasMiss]) => {
      if (!wasMiss) return false;
      const j = Number(jStr);
      if (j >= instIndex) return false;

      const stallsBeforeJ = calculatePrecedingStalls(j);
      const resolveCycleJ = j + 2 + stallsBeforeJ;

      const stallsBeforeI = calculatePrecedingStalls(instIndex);
      const ifCycleI = instIndex + 1 + stallsBeforeI;

      return ifCycleI <= resolveCycleJ;
    });
  };

  const shouldSquashDueToTakenBranch = (instIndex: number): boolean => {
    if (branchTakenTargets[instIndex]) {
      return false;
    }

    for (let j = 0; j < instIndex; j++) {
      if (!branchMisses[j] && registerUsage[j]?.isBranch) {
        const stallsBeforeJ = calculatePrecedingStalls(j);
        const resolveCycleJ = j + 2 + stallsBeforeJ;

        const stallsBeforeI = calculatePrecedingStalls(instIndex);
        const ifCycleI = instIndex + 1 + stallsBeforeI;

        if (ifCycleI <= resolveCycleJ) {
          return true;
        }
      }
    }
    return false;
  };

  const isStallCell = (instIndex: number, cycleNum: number): boolean => {
    if (!stallsEnabled || (stalls[instIndex] || 0) <= 0) return false;
    const expectedCycleWithoutStalls = instIndex + 2;
    const precedingStalls = calculatePrecedingStalls(instIndex);

    return (
      cycleNum > expectedCycleWithoutStalls + precedingStalls &&
      cycleNum <=
        expectedCycleWithoutStalls + precedingStalls + (stalls[instIndex] || 0)
    );
  };

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
    if (expectedStage === 2) {
      return {
        isForwarding: true,
        forwardingInfo: forwardings[instIndex],
      };
    }
    return { isForwarding: false };
  };

  const isInCurrentColumn = (cycleNum: number): boolean => cycleNum === cycle;

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

    if (isInPipeline && expectedStageIndex >= 1 && hasSquashFromBranch(instIndex)) {
      return {
        type: "squash",
        stage: stageData,
        isCurrentCell: false,
      };
    }

    if (
      isInPipeline &&
      expectedStageIndex >= 1 &&
      shouldSquashDueToTakenBranch(instIndex)
    ) {
      return {
        type: "squash",
        stage: stageData,
        isCurrentCell: false,
      };
    }

    if (isForwarding && isInPipeline) {
      return {
        type: "forwarding",
        stage: stageData,
        isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
        forwardingInfo,
      };
    }

    if (isInPipeline) {
      return {
        type: "normal",
        stage: stageData,
        isCurrentCell: isCurrentCell || isInCurrentColumn(cycleNum),
      };
    }

    return {
      type: "empty",
      stage: null,
      isCurrentCell: false,
    };
  };

  return (
    <Card className="w-full overflow-hidden dark:bg-gray-700">
      <CardHeader>
        <CardTitle>
          Pipeline View
          {!stallsEnabled && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              Ideal Pipeline – No Hazard Detection
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              MIPS instruction pipeline visualization
              {!stallsEnabled && " – ideal 5-stage pipeline"}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px] sticky bg-card z-10 border-r dark:bg-gray-700">
                  Instruction
                </TableHead>
                <TableHead className="w-[240px] sticky bg-card z-10 border-r dark:bg-gray-700">
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
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r dark:bg-gray-700">
                    {inst}
                    {registerUsage[instIndex] && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {registerUsage[instIndex].type}-type
                        {registerUsage[instIndex].isLoad && " (Load)"}: rs=
                        {registerUsage[instIndex].rs}, rt=
                        {registerUsage[instIndex].rt}
                        {registerUsage[instIndex].rd !== 0 &&
                          `, rd=${registerUsage[instIndex].rd}`}
                      </div>
                    )}

                    {registerUsage[instIndex].isBranch && (
                      <div className="mt-2">
                        {!branchStateIndex[instIndex] ? (
                          <Badge className="bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            {branchConfig.initialPrediction
                              ? "P: Taken"
                              : "P: Not Taken"}
                          </Badge>
                        ) : branchMisses[instIndex] ? (
                          branchConfig.mode === "machine" ? (
                            (() => {
                              const prev = branchStateIndex[instIndex];
                              const M = branchConfig.missThreshold;
                              const maxS = 2 * M;
                              const next = Math.min(prev + 1, maxS);
                              return (
                                <Badge className="border px-2 bg-rose-100 text-rose-500 border-rose-500 rounded-lg flex items-center">
                                  <XCircle className="w-4 h-4 mr-1" />
                                  {`MISS S${prev} → S${next}`}
                                </Badge>
                              );
                            })()
                          ) : (
                            <Badge className="border px-2 bg-rose-100 text-rose-500 border-rose-500 rounded-lg flex items-center">
                              <XCircle className="w-4 h-4 mr-1" />
                              MISS
                            </Badge>
                          )
                        ) : branchConfig.mode === "machine" ? (
                          (() => {
                            const prev = branchStateIndex[instIndex];
                            const next = Math.max(prev - 1, 1);
                            return (
                              <Badge className="border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg flex items-center">
                                <CheckCircle className="w-4 h-4 mr-1" />
                                {`OK S${prev} → S${next}`}
                              </Badge>
                            );
                          })()
                        ) : (
                          <Badge className="border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg flex items-center">
                            <CheckCircle className="w-4 h-4 mr-1" />
                            OK
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="sticky left-[120px] bg-card z-10 border-r dark:bg-gray-700">
                    {stallsEnabled ? (
                      <div className="flex flex-col gap-1 items-start">
                        {/* If RAW or WAW */}
                        {hazards[instIndex]?.type !== "NONE" && (
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
                          </div>
                        )}

                        {/* If forwarding */}
                        {hazards[instIndex]?.canForward &&
                          forwardings[instIndex]?.length > 0 && (
                            <Badge className="border px-2 bg-green-100 text-green-500 border-green-500 rounded-lg">
                              FORWARDING
                            </Badge>
                          )}

                        {/* If stall */}
                        {stalls[instIndex] > 0 && (
                          <Badge className="border px-2 bg-red-100 text-red-500 border-red-500 rounded-lg">
                            STALL ({stalls[instIndex]})
                          </Badge>
                        )}
                      </div>
                    ) : (
                      registerUsage[instIndex] && (
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
                      )
                    )}
                  </TableCell>

                  {/* Celdas de pipeline para cada ciclo */}
                  {cycleNumbers.map((c) => {
                    const cellState = getCellState(instIndex, c);
                    const { type, stage, isCurrentCell } = cellState;
                    const hasContent = type !== "empty";

                    const cellStyle =
                      type === "stall"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                        : type === "forwarding"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                        : type === "normal"
                        ? "bg-secondary text-secondary-foreground"
                        : type === "squash"
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500 line-through"
                        : "bg-background dark:bg-gray-700";

                    // Highlight
                    const animationClass =
                      isCurrentCell && hasContent && isRunning && !isFinished
                        ? type === "stall"
                          ? "animate-pulse-bg-red"
                          : type === "forwarding"
                          ? "animate-pulse-bg-green"
                          : "animate-pulse-bg"
                        : "";

                    const highlightClass =
                      isCurrentCell && hasContent
                        ? type === "stall"
                          ? "bg-red-200 dark:bg-red-800/50"
                          : type === "forwarding"
                          ? "bg-green-200 dark:bg-green-800/50"
                          : "bg-accent text-accent-foreground dark:bg-accent-dark dark:text-accent-foreground-dark"
                        : "";

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300 dark:bg-gray-600",
                          cellStyle,
                          isCurrentCell ? highlightClass : "",
                          animationClass
                        )}
                      >
                        {/*  Stall  */}
                        {type === "stall" && (
                          <div className="flex flex-col items-center justify-center">
                            <AlertTriangle className="w-4 h-4 mb-1 text-red-500" />
                            <span className="text-xs font-semibold">
                              STALL
                            </span>
                          </div>
                        )}

                        {/* Forwarding */}
                        {type === "forwarding" && stage && (
                          <div className="flex flex-col items-center justify-center">
                            <div className="flex items-center justify-center mb-1 gap-1">
                              <stage.icon className="w-4 h-4" />
                              <Zap className="w-3 h-3 text-green-500" />
                            </div>
                            <span className="text-xs">{stage.name}</span>
                          </div>
                        )}

                        {/* Normal */}
                        {type === "normal" && stage && (
                          <div className="flex flex-col items-center justify-center">
                            <stage.icon className="w-4 h-4 mb-1" />
                            <span className="text-xs">{stage.name}</span>
                          </div>
                        )}

                        {/* Squash */}
                        {type === "squash" && stage && (
                          <div className="flex flex-col items-center justify-center">
                            <stage.icon className="w-4 h-4 mb-1 opacity-50" />
                            <span className="text-xs opacity-50">
                              {stage.name}
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

        <div className="flex flex-wrap gap-4 mt-4 text-sm">
          <div className="flex items-center">
            <div className="w-4 h-4 bg-accent mr-2 rounded-full"></div>
            <span>Current Stage</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-secondary mr-2 rounded-full"></div>
            <span>Completed Stage</span>
          </div>
          {stallsEnabled && (
            <>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-red-100 dark:bg-red-900/30 mr-2 rounded-full"></div>
                <span>Stall</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-green-100 dark:bg-green-900/30 mr-2 rounded-full"></div>
                <span>Forwarding</span>
              </div>
            </>
          )}
          <div className="flex items-center">
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
            <span>Branch Pred OK</span>
          </div>
          <div className="flex items-center">
            <XCircle className="w-4 h-4 text-rose-500 mr-2" />
            <span>Misprediction</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-gray-200 dark:bg-[#1E2836] mr-2 rounded-full line-through"></div>
            <span>Squashed Stage</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

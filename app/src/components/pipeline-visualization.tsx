// src/components/pipeline-visualization.tsx
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
import { Download, Code2, Cpu, MemoryStick, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulationState } from "@/context/SimulationContext"; // Import context hook

const STAGES = [
  { name: "IF", icon: Download },
  { name: "ID", icon: Code2 },
  { name: "EX", icon: Cpu },
  { name: "MEM", icon: MemoryStick },
  { name: "WB", icon: CheckSquare },
] as const;

export function PipelineVisualization() {
  // Get state from context
  const {
    instructions,
    currentCycle: cycle,
    maxCycles, // Max cycles determines the number of columns
    isRunning,
    instructionStages, // Use the pre-calculated stages
    isFinished, // Use the finished flag from context
    forwardingPaths = [],
  } = useSimulationState();

  // Use maxCycles for the number of columns if it's calculated, otherwise 0
  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

  const isForwardingCell = (
    instIndex: number,
    stageName: string,
    cycle: number
  ): boolean => {
    return forwardingPaths.some(
      (f) =>
        (f.toIndex === instIndex && f.stage === stageName) ||
        (f.fromIndex === instIndex && f.stage === stageName)
    );
  };

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
                {/* Use bg-card for sticky header cell background */}
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">
                  Instruction
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
                <TableRow key={`inst-${instIndex}`}>
                  <TableCell
                    className={cn(
                      "font-mono sticky left-0 z-10 border-r",
                      inst === "STALL"
                        ? "bg-red-200 text-red-800 font-bold"
                        : "bg-card"
                    )}
                  >
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const expectedStageIndex = c - instIndex - 1;
                    const currentStageIndex = instructionStages[instIndex];

                    const isInPipelineAtThisCycle =
                      expectedStageIndex >= 0 &&
                      expectedStageIndex < STAGES.length;
                    const currentStageData = isInPipelineAtThisCycle
                      ? STAGES[expectedStageIndex]
                      : null;

                    const isActualCurrentStage =
                      currentStageIndex !== null &&
                      expectedStageIndex === currentStageIndex &&
                      c === cycle;

                    const shouldAnimate =
                      isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically =
                      isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    const isForward =
                      currentStageData &&
                      isForwardingCell(instIndex, currentStageData.name, c);

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300",
                          inst === "STALL"
                            ? isInPipelineAtThisCycle
                              ? isFinished
                                ? "bg-background"
                                : isActualCurrentStage
                                ? "bg-red-300 text-red-900 animate-pulse-bg"
                                : isPastStage
                                ? "bg-red-200 text-red-800"
                                : "bg-background"
                              : "bg-background"
                            : isFinished
                            ? "bg-background"
                            : isForward
                            ? "bg-yellow-300 text-yellow-900"
                            : shouldAnimate
                            ? "bg-accent text-accent-foreground animate-pulse-bg"
                            : shouldHighlightStatically
                            ? "bg-accent text-accent-foreground"
                            : isPastStage
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-background"
                        )}
                      >
                        {currentStageData && !isFinished && (
                          <div className="flex flex-col items-center justify-center">
                            <currentStageData.icon
                              className="w-4 h-4 mb-1"
                              aria-hidden="true"
                            />
                            <span className="text-xs">
                              {currentStageData.name}
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

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
import { useState, useEffect } from "react";

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
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

  // Detect if there's a stall in the current cycle
  const stalls = instructions.map((_, instIndex) => {
    const currentStageIndex = instructionStages[instIndex];
    const prevStageIndex = instructionStages[instIndex - 1];

    // Check for stall condition: current instruction is in ID (1), previous is in EX (2)
    const isStalled =
      currentStageIndex === 1 &&
      prevStageIndex === 2 &&
      !isFinished &&
      isRunning;

    return isStalled ? instIndex : null;
  });

  const isStallDetected = stalls.some((stall) => stall !== null);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {/* Show stall message if detected */}
          {isStallDetected && (
            <div className="mb-4 p-4 bg-yellow-200 text-yellow-900 font-bold rounded">
              Stall detected in cycle {cycle}! Pipeline execution delayed.
            </div>
          )}
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
            <TableHeader>
              <TableRow>
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
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
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

                    const isStalled =
                      stalls.includes(instIndex) &&
                      currentStageIndex === 1 &&
                      c >= cycle;

                    const shouldAnimate =
                      isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically =
                      isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300",
                          isFinished
                            ? "bg-background"
                            : isStalled
                            ? "bg-yellow-200 text-yellow-900 font-bold"
                            : shouldAnimate
                            ? "bg-blue-500 text-white animate-pulse"
                            : shouldHighlightStatically
                            ? "bg-blue-500 text-white"
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
                        {isStalled && <span className="text-xs">STALL</span>}
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

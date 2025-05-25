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
import { useSimulationState } from "@/context/SimulationContext";

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
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

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
              {instructions.map((inst, instIndex) => {
                const stageInfo = instructionStages[instIndex];
                return (
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
                      const currentStageData =
                        expectedStageIndex >= 0 &&
                        expectedStageIndex < STAGES.length
                          ? STAGES[expectedStageIndex]
                          : null;

                      const isActualCurrentStage =
                        stageInfo?.stageIndex !== null &&
                        expectedStageIndex === stageInfo?.stageIndex &&
                        c === cycle;

                      const shouldAnimate =
                        isActualCurrentStage && isRunning && !isFinished;

                      const shouldHighlightStatically =
                        isActualCurrentStage && !isRunning && !isFinished;

                      const isPastStage =
                        expectedStageIndex >= 0 &&
                        expectedStageIndex < STAGES.length &&
                        c < cycle;

                      const isForward =
                        stageInfo?.isForwarding &&
                        expectedStageIndex === stageInfo?.stageIndex;

                      return (
                        <TableCell
                          key={`inst-${instIndex}-cycle-${c}`}
                          className={cn(
                            "text-center w-16 h-14 transition-colors duration-300",
                            inst === "STALL"
                              ? expectedStageIndex >= 0 &&
                                expectedStageIndex < STAGES.length
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
                              <currentStageData.icon className="w-4 h-4 mb-1" />
                              <span className="text-xs">
                                {currentStageData.name}
                              </span>
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
      </CardContent>
    </Card>
  );
}

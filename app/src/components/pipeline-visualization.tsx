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
import { useSimulationState } from "@/context/SimulationContext";

/* ---------- Utilidad para detectar RAW hazard ---------- */
function hasDataHazard(prevHex: string, currHex: string): boolean {
  const decode = (hex: string) => {
    const instr = parseInt(hex, 16);
    const op = (instr >>> 26) & 0x3f;

    if (op === 0x00) {
      return {
        type: "R" as const,
        rs: (instr >>> 21) & 0x1f,
        rt: (instr >>> 16) & 0x1f,
        rd: (instr >>> 11) & 0x1f,
      };
    }
    return {
      type: "I" as const,
      op,
      rs: (instr >>> 21) & 0x1f,
      rt: (instr >>> 16) & 0x1f,
    };
  };

  const p = decode(prevHex);
  const c = decode(currHex);

  let prevDst: number | null = null;
  if (p.type === "R") prevDst = p.rd;
  else if (p.op === 0x23) prevDst = p.rt; // lw
  else if (p.op !== 0x2b) prevDst = p.rt; // I-tipo salvo sw

  const currSrc: number[] = [];
  if (c.type === "R") currSrc.push(c.rs, c.rt);
  else if (c.op === 0x23) currSrc.push(c.rs); // lw
  else if (c.op === 0x2b) currSrc.push(c.rs, c.rt); // sw
  else currSrc.push(c.rs);

  return prevDst !== null && currSrc.includes(prevDst);
}
/* ---------------------------------------------------------------- */

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
    mode,
  } = useSimulationState();

  const totalCycles = Math.max(maxCycles, 0);
  const cycleNums = Array.from({ length: totalCycles }, (_, i) => i + 1);

  /* ------------ detectar stalls reales ------------- */
  const stalls = instructions.map((_, i) => {
    if (
      mode !== "stall" ||
      i === 0 ||
      !isRunning ||
      isFinished ||
      instructionStages[i] !== 1 || // curr en ID
      instructionStages[i - 1] !== 2 // prev en EX
    )
      return null;

    return hasDataHazard(instructions[i - 1], instructions[i]) ? i : null;
  });
  const stallDetected = stalls.some((s) => s !== null);
  /* -------------------------------------------------- */

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {stallDetected && (
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
                {cycleNums.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {instructions.map((inst, i) => (
                <TableRow key={`inst-${i}`}>
                  {/* instrucción */}
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>

                  {cycleNums.map((c) => {
                    const expected = c - i - 1;
                    const currStage = instructionStages[i];

                    const inPipe = expected >= 0 && expected < STAGES.length;
                    const stageData = inPipe ? STAGES[expected] : null;

                    const isCurr =
                      currStage !== null &&
                      expected === currStage &&
                      c === cycle;

                    const stalled =
                      stalls.includes(i) && currStage === 1 && c >= cycle;

                    const animate = isCurr && isRunning && !isFinished;
                    const highlight = isCurr && !isRunning && !isFinished;
                    const past = inPipe && c < cycle;

                    return (
                      <TableCell
                        key={`cell-${i}-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300",
                          isFinished
                            ? "bg-background"
                            : stalled
                            ? "bg-yellow-200 text-yellow-900 font-bold"
                            : animate
                            ? "bg-blue-500 text-white animate-pulse"
                            : highlight
                            ? "bg-blue-500 text-white"
                            : past
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-background"
                        )}
                      >
                        {stageData && !isFinished && (
                          <div className="flex flex-col items-center">
                            <stageData.icon className="w-4 h-4 mb-1" />
                            <span className="text-xs">{stageData.name}</span>
                          </div>
                        )}
                        {stalled && <span className="text-xs">STALL</span>}
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

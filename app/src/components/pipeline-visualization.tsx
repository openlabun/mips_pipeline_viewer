// src/components/pipeline-visualization.tsx
"use client";

import React from "react";
import { useSimulationState } from "@/context/SimulationContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PipelineCell } from "@/context/SimulationContext";

function getCellClass(type: string | null) {
  switch (type) {
    case "stall":
      return "bg-yellow-200 text-yellow-900 border-yellow-500 border-2";
    case "load-use":
      return "bg-red-200 text-red-900 border-red-500 border-2";
    case "forwardA":
    case "forwardB":
      return "bg-green-200 text-green-900 border-green-500 border-2";
    case "normal":
      return "bg-blue-100";
    default:
      return "";
  }
}

export function PipelineVisualization() {
  const {
    parsedInstructions,
    currentCycle,
    maxCycles,
    isFinished,
    mode,
    pipelineMatrix,
  } = useSimulationState();

  // Si no hay instrucciones, no renderizar nada
  if (!pipelineMatrix || pipelineMatrix.length === 0) {
    return null;
  }

  return (
    <Card className="w-full overflow-x-auto">
      <CardHeader>
        <CardTitle>Pipeline Visualization</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="min-w-full border-collapse text-center">
          <thead>
            <tr>
              <th className="border p-2">#</th>
              <th className="border p-2">Instruction</th>
              <th className="border p-2">Mnemonic</th>
              {Array.from({ length: maxCycles }, (_, idx) => (
                <th key={idx} className="border p-2">
                  {idx + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pipelineMatrix.map((row: PipelineCell[], idx: number) => (
              <tr key={idx}>
                <td className="border p-2">{idx + 1}</td>
                <td className="border p-2 font-mono">
                  {parsedInstructions[idx]?.hex}
                </td>
                <td className="border p-2 font-mono">
                  {parsedInstructions[idx]?.mnemonic}
                </td>
                {Array.from({ length: maxCycles }, (_, cidx) => {
                  // Busca la celda para este ciclo
                  const cell = row.find((cell) => cell.cycle === cidx + 1);
                  
                  // Si no hay celda o estamos más allá del ciclo actual
                  if (!cell || !cell.stage || cidx + 1 > currentCycle) {
                    return <td key={cidx} className="border p-2"></td>;
                  }
                  
                  return (
                    <td
                      key={cidx}
                      className={`border p-2 ${getCellClass(cell.type)}`}
                    >
                      {cell.stage}
                      {cell.type && cell.type !== "normal" && cell.info && (
                        <div className="text-xs font-semibold mt-1">{cell.info}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary">
            Modo: {mode === "stall" ? "Stall (sin forwarding)" : "Forwarding"}
          </Badge>
          <Badge variant="outline">
            Ciclo actual: {currentCycle} / {maxCycles}
          </Badge>
          {isFinished && (
            <Badge variant="destructive">Simulación finalizada</Badge>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge className="bg-yellow-200 text-yellow-900">Stall (RAW Hazard)</Badge>
          <Badge className="bg-red-200 text-red-900">Load-Use Hazard</Badge>
          <Badge className="bg-green-200 text-green-900">Forwarding</Badge>
          <Badge className="bg-blue-100 text-blue-900">Normal</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
"use client";

import type * as React from "react";
import { InstructionInput } from "@/components/instruction-input";
import { PipelineVisualization } from "@/components/pipeline-visualization";
import { Separator } from "@/components/ui/separator";
import {
  useSimulationState,
  useSimulationActions,
} from "@/context/SimulationContext";

export default function Home() {
  const {
    programInstructions,
    executionActive,
    clockCycle,
    totalCycles,
    executionComplete,
    forwardingEnabled,
    stallsEnabled,
  } = useSimulationState();
  const { initializeExecution, resetProcessor } = useSimulationActions();

  const hasStarted = clockCycle > 0;

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-primary">
          MIPS Pipeline Viewer
        </h1>
        <p className="text-muted-foreground">
          Visualize the flow of MIPS instructions through a 5-stage pipeline.
        </p>
      </header>

      <InstructionInput
        onInstructionsSubmit={initializeExecution}
        onReset={resetProcessor}
        isRunning={executionActive}
      />

      <Separator className="my-4" />

      {programInstructions.length > 0 && (
        <>
          <PipelineVisualization />
          {totalCycles > 0 && (
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                Cycle: {clockCycle} / {totalCycles}{" "}
                {executionComplete
                  ? "(Finished)"
                  : executionActive
                  ? "(Running)"
                  : "(Paused)"}
              </p>
              <p className="text-sm text-muted-foreground">
                Configuration:{" "}
                {forwardingEnabled ? "Forwarding" : "No Forwarding"} +{" "}
                {stallsEnabled ? "Stalls" : "No Stalls"}
              </p>
            </div>
          )}
        </>
      )}

      {!hasStarted && programInstructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Enter instructions and press Begin Execution.
        </p>
      )}

      {hasStarted && programInstructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Simulation reset. Enter new instructions to start again.
        </p>
      )}
    </div>
  );
}

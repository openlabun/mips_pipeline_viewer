// src/app/page.tsx

"use client";

import type * as React from "react";
import { InstructionInput } from "@/components/instruction-input";
import { PipelineVisualization } from "@/components/pipeline-visualization";
import { Separator } from "@/components/ui/separator";
import {
  useSimulationState,
  useSimulationActions,
} from "@/context/SimulationContext"; // Import context hooks

export default function Home() {
  const { mode } = useSimulationState(); // Get mode from context
  const { setMode } = useSimulationActions(); // Get setMode from context
  // Get state and actions from context
  const { instructions, isRunning, currentCycle, maxCycles, isFinished } =
    useSimulationState();
  const { startSimulation, resetSimulation } = useSimulationActions();

  // Simulation has started if cycle > 0
  const hasStarted = currentCycle > 0;

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

      <div className="flex flex-col md:flex-row items-center gap-4 mt-4">
        <button
          onClick={() => setMode(mode === "stall" ? "normal" : "stall")}
          className={`px-4 py-2 rounded-md border ${
            mode === "stall" ? "bg-blue-600 text-white" : "bg-gray-200"
          }`}
        >
          Activar Stall
        </button>

        <button
          onClick={() =>
            setMode(mode === "forwarding" ? "normal" : "forwarding")
          }
          className={`px-4 py-2 rounded-md border ${
            mode === "forwarding" ? "bg-blue-600 text-white" : "bg-gray-200"
          }`}
        >
          Activar Forwarding
        </button>
      </div>

      {/* Pass context actions/state down */}
      <InstructionInput
        onInstructionsSubmit={startSimulation}
        onReset={resetSimulation}
        isRunning={isRunning} // isRunning is needed for button state/icons
      />

      <Separator className="my-4" />

      {/* Conditionally render visualization and cycle info only if instructions exist */}
      {instructions.length > 0 && (
        <>
          <PipelineVisualization />
          {/* Display cycle info below the visualization */}
          {/* Ensure maxCycles is valid before displaying */}
          {maxCycles > 0 && (
            <p className="text-center text-muted-foreground mt-4">
              Cycle: {currentCycle} / {maxCycles}{" "}
              {isFinished ? "(Finished)" : isRunning ? "(Running)" : "(Paused)"}
            </p>
          )}
        </>
      )}
      {/* Show message if reset/never run and no instructions */}
      {!hasStarted && instructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Enter instructions and press Start Simulation.
        </p>
      )}
      {/* Show different message if reset after a run */}
      {hasStarted && instructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Simulation reset. Enter new instructions to start again.
        </p>
      )}
    </div>
  );
}

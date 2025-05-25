// app/src/app/page.tsx
"use client";

import type * as React from 'react';
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { Separator } from '@/components/ui/separator';
import { useSimulationState, useSimulationActions } from '@/context/SimulationContext';
import { OptionsControls } from '@/components/options-controls';

export default function Home() {
  const { instructions, isRunning, currentCycle, maxCycles, isFinished } = useSimulationState();
  const { startSimulation, resetSimulation } = useSimulationActions();

  const hasStarted = currentCycle > 0;

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-primary">MIPS Pipeline Viewer</h1>
        <p className="text-muted-foreground">
          Visualize the flow of MIPS instructions through a 5-stage pipeline.
        </p>
      </header>

      <InstructionInput
        onInstructionsSubmit={startSimulation}
        onReset={resetSimulation}
        isRunning={isRunning}
      />

      <OptionsControls />

      <Separator className="my-4" />

      {instructions.length > 0 && (
        <>
          <PipelineVisualization />
          {maxCycles > 0 && (
            <p className="text-center text-muted-foreground mt-4">
              Cycle: {currentCycle} / {maxCycles} {isFinished ? '(Finished)' : isRunning ? '(Running)' : '(Paused)'}
            </p>
          )}
        </>
      )}
      {!hasStarted && instructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Enter instructions and press Start Simulation.
        </p>
      )}
      {hasStarted && instructions.length === 0 && (
        <p className="text-center text-muted-foreground mt-4">
          Simulation reset. Enter new instructions to start again.
        </p>
      )}
    </div>
  );
}
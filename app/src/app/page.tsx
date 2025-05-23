// src/app/page.tsx

"use client";

import type * as React from 'react';
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { HazardDetails } from '@/components/hazard-details';
import { Separator } from '@/components/ui/separator';
import { useSimulationState, useSimulationActions } from '@/context/SimulationContext';

export default function Home() {
  // Get state and actions from context
  const { instructions, isRunning, currentCycle, maxCycles, isFinished, stallsEnabled } = useSimulationState();
  const { startSimulation, resetSimulation } = useSimulationActions();

  // Simulation has started if cycle > 0
  const hasStarted = currentCycle > 0;
  const showHazardDetails = hasStarted && stallsEnabled;

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-primary">MIPS Pipeline Viewer</h1>
        <p className="text-muted-foreground">
          Visualize the flow of MIPS instructions through a 5-stage pipeline with hazard detection.
        </p>
      </header>

      <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <InstructionInput
            onInstructionsSubmit={startSimulation}
            onReset={resetSimulation}
            isRunning={isRunning}
          />
        </div>
        
        <div className="md:col-span-2 space-y-6">
          {instructions.length > 0 ? (
            <>
              <PipelineVisualization />
              
              {/* Mostrar detalles de hazards si está habilitado */}
              {showHazardDetails && <HazardDetails />}
              
              {maxCycles > 0 && (
                <p className="text-center text-muted-foreground">
                  Cycle: {currentCycle} / {maxCycles} {isFinished ? '(Finished)' : isRunning ? '(Running)' : '(Paused)'}
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8 border border-dashed rounded-lg bg-muted/50">
                <h3 className="text-xl font-medium mb-2">
                  {hasStarted ? 'Simulación reiniciada' : 'Bienvenido al visualizador de pipeline'}
                </h3>
                <p className="text-muted-foreground">
                  {hasStarted 
                    ? 'Ingresa nuevas instrucciones para comenzar de nuevo.' 
                    : 'Ingresa instrucciones MIPS en formato hexadecimal para visualizar el pipeline en acción.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

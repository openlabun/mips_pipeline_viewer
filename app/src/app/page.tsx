"use client";
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { Separator } from '@/components/ui/separator';
import { useSimulationState, useSimulationActions, SimulationMode } from '@/context/SimulationContext';
import { useState } from 'react';

export default function Home() {
  const { instructions, isRunning, currentCycle, maxCycles, isFinished, mode } = useSimulationState();
  const { startSimulation, resetSimulation, pauseSimulation, resumeSimulation } = useSimulationActions();
  const [localMode, setLocalMode] = useState<SimulationMode>(mode);

  const handleSubmit = (submittedInstructions: string[]) => {
    startSimulation(submittedInstructions, localMode);
  };

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-primary">MIPS Pipeline Viewer</h1>
        <p className="text-muted-foreground">
          Visualiza el flujo de instrucciones MIPS en un pipeline de 5 etapas
        </p>
      </header>

      <div className="flex flex-col items-center space-y-4 w-full max-w-md">
        <div className="flex items-center gap-4 w-full">
          <label className="font-medium">Modo:</label>
          <select
            value={localMode}
            onChange={(e) => setLocalMode(e.target.value as SimulationMode)}
            className="border rounded px-3 py-2 flex-1"
            disabled={isRunning}
          >
            <option value="default">Por defecto</option>
            <option value="stall">Stall</option>
            <option value="forward">Forwarding</option>
          </select>
        </div>

        {localMode !== 'default' && (
          <div className="text-sm text-muted-foreground text-center px-4">
            {localMode === 'stall' 
              ? 'Modo Stall: Inserta burbujas cuando detecta dependencias RAW'
              : 'Modo Forwarding: Minimiza stalls usando adelantamiento de datos'}
          </div>
        )}
      </div>

      <InstructionInput
        onInstructionsSubmit={handleSubmit}
        onReset={resetSimulation}
        isRunning={isRunning}
      />

      <Separator className="my-4" />

      {instructions.length > 0 && (
        <>
          <PipelineVisualization />
          
          <div className="flex flex-col items-center mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">Ciclo:</span>
              <span className="px-2 py-1 bg-accent rounded-md">
                {isFinished ? maxCycles : currentCycle} / {maxCycles}
              </span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                isFinished ? 'bg-green-100 text-green-800' :
                isRunning ? 'bg-blue-100 text-blue-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {isFinished ? 'Completado' : isRunning ? 'En ejecución' : 'Pausado'}
              </span>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {mode !== 'default' && (
                <p>Nota: Ciclos reales pueden variar por dependencias</p>
              )}
            </div>
          </div>
        </>
      )}

      {!instructions.length && (
        <p className="text-muted-foreground">
          {currentCycle > 0 ? 'Simulación reiniciada. Ingresa nuevas instrucciones.' : 'Ingresa instrucciones para comenzar.'}
        </p>
      )}
    </div>
  );
}
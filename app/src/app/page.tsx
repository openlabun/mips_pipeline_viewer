'use client';

import type * as React from 'react';
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { Separator } from '@/components/ui/separator';
import {
  useSimulationState,
  useSimulationActions,
} from '@/context/SimulationContext';

export default function Home() {
  const { instructions, isRunning, currentCycle, maxCycles, isFinished } =
    useSimulationState();
  const { startSimulation, resetSimulation } = useSimulationActions();

  const hasStarted = currentCycle > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/60 via-white to-blue-100/40">
      <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col items-center gap-10">
        <header className="text-center space-y-6 pt-10">
          <h1 className="text-3xl md:text-5xl font-extrabold text-transparent bg-gradient-to-r from-indigo-700 to-blue-700 bg-clip-text font-sans">
            Visualizador de Pipeline MIPS
          </h1>
          <p className="text-base md:text-lg text-gray-700 font-sans font-medium max-w-3xl mx-auto leading-loose">
            Visualize the flow of MIPS instructions through a 5-stage pipeline with advanced hazard detection and forwarding mechanisms.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500 font-sans">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-600 rounded-full"></span>
              <span>Real-time Simulation</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-600 rounded-full"></span>
              <span>Data Forwarding</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-600 rounded-full"></span>
              <span>Hazard Detection</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-purple-600 rounded-full"></span>
              <span>Branch jump </span>
            </div>
          </div>
        </header>

        <div className='w-full max-w-md'>
          <InstructionInput
            onInstructionsSubmit={startSimulation}
            onReset={resetSimulation}
            isRunning={isRunning}
          />
        </div>

        <Separator className='my-8 w-full max-w-4xl bg-gradient-to-r from-transparent via-gray-300 to-transparent h-px' />

        {instructions.length > 0 && (
          <div className='w-full space-y-6'>
            <PipelineVisualization />
            {maxCycles > 0 && (
              <div className='text-center'>
                <div className='inline-flex items-center space-x-4 bg-white/80 backdrop-blur-sm rounded-full px-6 py-3 shadow-lg border border-gray-200'>
                  <span className='font-montserrat font-semibold text-gray-700'>
                    Cycle: {currentCycle} / {maxCycles}
                  </span>
                  <div
                    className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium font-montserrat ${
                      isFinished
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : isRunning
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isFinished
                          ? 'bg-green-500'
                          : isRunning
                          ? 'bg-blue-500 animate-pulse'
                          : 'bg-yellow-500'
                      }`}
                    ></div>
                    <span>
                      {isFinished
                        ? 'Finished'
                        : isRunning
                        ? 'Running'
                        : 'Paused'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!hasStarted && instructions.length === 0 && (
          <div className='text-center space-y-4 py-12'>
            <div className='text-6xl'>🚀</div>
            <h2 className='text-2xl font-montserrat font-semibold text-gray-700'>
              Ready to Start
            </h2>
            <p className='text-gray-600 font-montserrat max-w-md mx-auto'>
              Enter your MIPS instructions above and press "Start Simulation" to
              begin visualizing the pipeline execution.
            </p>
          </div>
        )}

        {hasStarted && instructions.length === 0 && (
          <div className='text-center space-y-4 py-12'>
            <div className='text-6xl'>🔄</div>
            <h2 className='text-2xl font-montserrat font-semibold text-gray-700'>
              Simulation Reset
            </h2>
            <p className='text-gray-600 font-montserrat max-w-md mx-auto'>
              The simulation has been reset. Enter new instructions to start a
              fresh pipeline analysis.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
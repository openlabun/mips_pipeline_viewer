// src/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import type * as ReactTypes from 'react';
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { Separator } from '@/components/ui/separator';
import { useSimulationState, useSimulationActions } from '@/context/SimulationContext';
import { IconRocket, IconHelpCircle, IconMoon, IconSun, IconX } from '@tabler/icons-react';

export default function Home() {
  const {
    instructions,
    isRunning,
    currentCycle,
    maxCycles,
    isFinished,
    missCount,
    branchConfig,
  } = useSimulationState();
  const { startSimulation, resetSimulation } = useSimulationActions();
  const hasStarted = currentCycle > 0;

  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else if (stored === 'light') {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(prefersDark);
      if (prefersDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  return (
    <div className="relative min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-300">
      <div className="absolute top-4 right-4 z-50 flex items-center space-x-2">
        <button
          onClick={() => setShowHelpModal(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-300 text-gray-800 dark:bg-gray-700 dark:text-gray-200 focus:outline-none"
          aria-label="Mostrar instrucciones"
        >
          <IconHelpCircle size={20} />
        </button>

        <button
          onClick={toggleDarkMode}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-300 text-gray-800 dark:bg-gray-700 dark:text-gray-200 focus:outline-none transition-colors duration-200"
          aria-label="Alternar modo oscuro"
        >
          {isDarkMode ? <IconSun size={20} /> : <IconMoon size={20} />}
        </button>
      </div>

      {showHelpModal && (
        <div
          onClick={() => setShowHelpModal(false)}
          className="fixed inset-0 z-40 bg-black/50"
          aria-hidden="true"
        >
          <div onClick={(e) => e.stopPropagation()} className="absolute top-1/2 left-1/2 w-11/12 max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
            <div className="flex justify-between items-center border-b pb-2 mb-4 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                Guide
              </h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-black dark:text-gray-400 focus:outline-none"
                aria-label="Cerrar modal"
              >
                <IconX stroke={2} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              <ul className="list-decimal list-inside space-y-1">
                <li>
                  <strong>Insert Hex instructions</strong> <br />
                  Write the instructions in the textarea input with the valid format. 8 characters for every instruction, one instruction per line.
                  <div className="text-xs flex justify-start items-start gap-2">
                    <strong>Example</strong>
                    <p>
                      8C220000 <br />
                      00432820 <br />
                      00A53022
                    </p>
                  </div>
                </li>

                <li>
                  <strong>Pipeline configuration setup</strong> <br />
                  Toggle “Enable Hazard Detection & Stalls” to insert stalls on RAW/WAW hazards, and enable “Data Forwarding” (when stalls are on) to forward ALU results and reduce bubbles.
                </li>

                <li>
                  <strong>Branch support options</strong> <br />
                  Turn off “State Machine” for a static prediction (“Always Taken” or “Always Not Taken”). Turn it on for a 2-bit predictor: set “Misses until change” (1–4) and choose the starting state (“Taken” or “Not Taken”).
                </li>

                <li>
                  <strong>Start Simulation and Pipeline visualization</strong> <br />
                  Click “Start Simulation” to run one cycle per second; you can Pause/Resume or Reset. As each instruction moves through IF/ID/EX/MEM/WB, you’ll see gray cells for completed stages, a blue highlight for the current stage, red “STALL” cells for hazards (if enabled), green cells for forwarding, and badges for branch OK/MISS. On a mispredicted branch, ID–WB of the wrong‐path instructions are squashed (line-through), and the correct target appears after resolution.
                </li>
              </ul>
            </div>


          </div>
        </div>
      )}

      <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
        <header className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-gradient-to-r from-indigo-300 to-indigo-700 bg-clip-text font-montserrat dark:from-indigo-200 dark:to-indigo-500">
            MIPS Pipeline Viewer
          </h1>
          <p className="text-lg text-gray-600 font-montserrat font-medium max-w-3xl mx-auto leading-relaxed dark:text-gray-300">
            Visualize MIPS Instructions flow through a 5-stage pipeline with Hazard detection, Forwarding and Branch predictions.
          </p>
        </header>

        <div className="w-full max-w-5xl">
          <InstructionInput
            onInstructionsSubmit={(insts, branchCfg) => startSimulation(insts, branchCfg)}
            onReset={resetSimulation}
            isRunning={isRunning}
          />
        </div>

        <Separator className="my-8 w-full max-w-4xl bg-gradient-to-r from-transparent via-gray-300 to-transparent h-px dark:from-transparent dark:via-gray-700 dark:to-transparent" />

        {instructions.length > 0 && (
          <div className="w-full space-y-6">
            <PipelineVisualization />

            {maxCycles > 0 && (
              <div className="text-center flex justify-center items-center gap-4">
                <div className="inline-flex items-center space-x-4 bg-white/80 backdrop-blur-sm rounded-full px-4 py-3 shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                  <span className="font-montserrat font-semibold text-gray-500 dark:text-gray-300">
                    Cycle {currentCycle} / {maxCycles}
                  </span>
                  <div
                    className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium font-montserrat ${isFinished
                      ? 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700'
                      : isRunning
                        ? 'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700'
                        : 'bg-yellow-100 text-yellow-700 border border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-200 dark:border-yellow-700'
                      }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${isFinished
                        ? 'bg-green-500 dark:bg-green-300'
                        : isRunning
                          ? 'bg-blue-500 dark:bg-blue-300 animate-pulse'
                          : 'bg-yellow-500 dark:bg-yellow-300'
                        }`}
                    ></div>
                    <span>
                      {isFinished ? 'Finished' : isRunning ? 'Running' : 'Paused'}
                    </span>
                  </div>
                </div>

                <div className="inline-flex items-center space-x-4 bg-white/80 backdrop-blur-sm rounded-full px-4 py-3 shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                  <span className="font-montserrat font-semibold text-gray-500 dark:text-gray-300">
                    Prediction misses
                  </span>
                  <span className="font-montserrat font-semibold bg-rose-100 text-rose-500 border border-rose-200 px-4 py-1 rounded-full dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700">
                    {missCount}
                  </span>
                </div>

                {branchConfig.mode === 'machine' && (
                  <div className="inline-flex items-center bg-white/80 backdrop-blur-sm rounded-full px-4 py-3 shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                    {/* Taken tag */}
                    <span className="text-xs text-gray-600 dark:text-gray-300 mr-2">Taken</span>

                    {Array.from({ length: branchConfig.missThreshold }).map((_, i) => (
                      <React.Fragment key={`taken-${i}`}>
                        <span className="bg-blue-200 px-3 py-1 rounded-full border border-blue-300 text-blue-700 dark:bg-blue-800 dark:border-blue-600 dark:text-blue-200">
                          {`S${i + 1}`}
                        </span>
                        {i < branchConfig.missThreshold - 1 && (
                          <div className="bg-gray-400 w-4 h-1 dark:bg-gray-600" />
                        )}
                      </React.Fragment>
                    ))}

                    <div className="bg-gray-400 w-10 h-1 dark:bg-gray-600" />

                    {Array.from({ length: branchConfig.missThreshold }).map((_, i) => (
                      <React.Fragment key={`not-${i}`}>
                        <span className="bg-gray-200 px-3 py-1 rounded-full border border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300">
                          {`S${branchConfig.missThreshold + i + 1}`}
                        </span>
                        {i < branchConfig.missThreshold - 1 && (
                          <div className="bg-gray-400 w-4 h-1 dark:bg-gray-600" />
                        )}
                      </React.Fragment>
                    ))}

                    {/* Not taken tag */}
                    <span className="text-xs text-gray-600 dark:text-gray-300 ml-2">Not taken</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

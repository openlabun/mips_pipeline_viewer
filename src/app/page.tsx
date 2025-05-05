// src/app/page.tsx
"use client";

import type * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { InstructionInput } from '@/components/instruction-input';
import { PipelineVisualization } from '@/components/pipeline-visualization';
import { Separator } from '@/components/ui/separator';

const STAGE_COUNT = 5; // IF, ID, EX, MEM, WB

export default function Home() {
  const [instructions, setInstructions] = useState<string[]>([]);
  const [currentCycle, setCurrentCycle] = useState<number>(0);
  const [maxCycles, setMaxCycles] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleInstructionsSubmit = (submittedInstructions: string[]) => {
    resetSimulation(); // Reset before starting a new one
    setInstructions(submittedInstructions);
    const calculatedMaxCycles = submittedInstructions.length + STAGE_COUNT - 1;
    setMaxCycles(calculatedMaxCycles);
    setCurrentCycle(1); // Start from cycle 1
    setIsRunning(true);
  };

  const handleReset = () => {
    resetSimulation();
  };

  const resetSimulation = () => {
     if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setInstructions([]);
    setCurrentCycle(0);
    setMaxCycles(0);
    setIsRunning(false);
  }

  useEffect(() => {
    if (isRunning && currentCycle < maxCycles) { // Check currentCycle < maxCycles to stop interval before last cycle visualization update
      intervalRef.current = setInterval(() => {
        setCurrentCycle((prevCycle) => {
          const nextCycle = prevCycle + 1;
          if (nextCycle >= maxCycles) { // Use >= to handle the last cycle correctly
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            setIsRunning(false); // Stop running when max cycles reached
             // Set cycle to maxCycles explicitly to ensure the last stage is highlighted
             return maxCycles;
          }
          return nextCycle;
        });
      }, 1000); // Advance cycle every 1 second
    } else if (!isRunning && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
    } else if (currentCycle === maxCycles && isRunning) { // Explicitly set isRunning to false when the last cycle is reached
        setIsRunning(false);
    }


    // Cleanup interval on component unmount or when isRunning changes to false
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, currentCycle, maxCycles]);


  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-primary">MIPS Pipeline Viewer</h1>
        <p className="text-muted-foreground">
          Visualize the flow of MIPS instructions through a 5-stage pipeline.
        </p>
      </header>

      <InstructionInput
        onInstructionsSubmit={handleInstructionsSubmit}
        onReset={handleReset}
        isRunning={isRunning}
      />

      <Separator className="my-4" />

      {instructions.length > 0 && (
        <PipelineVisualization
          instructions={instructions}
          cycle={currentCycle}
          maxCycles={maxCycles}
          isRunning={isRunning} // Pass isRunning state
        />
      )}
    </div>
  );
}

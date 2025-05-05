// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext'; // Import context hooks
import { Play, Pause, RotateCcw } from 'lucide-react';

interface InstructionInputProps {
  // Props are now simplified as actions come from context
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean; // Keep isRunning prop for button state logic
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { pauseSimulation, resumeSimulation } = useSimulationActions();
  const { currentCycle, maxCycles, stageCount, instructions } = useSimulationState(); // Get cycle info from state

  // Calculate the cycle number when the simulation should be considered complete
  const completionCycle = instructions.length > 0 ? instructions.length + stageCount - 1 : 0;

  const hasStarted = currentCycle > 0;
  // Consider finished if the current cycle is greater than or equal to the calculated completion cycle
  const hasFinished = hasStarted && currentCycle >= completionCycle;
  const canPauseResume = hasStarted && !hasFinished; // Can only pause/resume if started and not finished


  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (currentInstructions.length === 0) {
      setError('Please enter at least one MIPS instruction in hexadecimal format.');
      return;
    }

    const invalidInstructions = currentInstructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Invalid instruction format found: ${invalidInstructions.join(', ')}. Each instruction must be 8 hexadecimal characters.`);
      return;
    }

    onInstructionsSubmit(currentInstructions);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };


  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">Enter Hex Instructions (one per line)</Label>
          <Textarea
            id="instructions"
            placeholder="e.g., 00a63820..." // Removed 0x prefix for consistency with regex
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            // Disable input field if simulation has started and not yet finished
            disabled={hasStarted && !hasFinished}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-between items-center gap-2">
           {/* Start Button: Disabled if started and not finished */}
          <Button onClick={handleSubmit} disabled={hasStarted && !hasFinished} className="flex-1">
            {hasStarted && !hasFinished ? 'Running...' : hasFinished ? 'Finished' : 'Start Simulation'}
          </Button>

          {/* Conditional Play/Pause Button: Show only when pause/resume is possible */}
          {canPauseResume && (
             <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}>
              {isRunning ? <Pause /> : <Play />}
             </Button>
          )}

          {/* Reset Button: Show only if the simulation has started */}
           {hasStarted && (
              <Button variant="destructive" onClick={onReset} size="icon" aria-label="Reset Simulation">
                <RotateCcw />
              </Button>
           )}
        </div>
      </CardContent>
    </Card>
  );
}
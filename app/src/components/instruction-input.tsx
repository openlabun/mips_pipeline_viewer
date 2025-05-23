// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean; // Keep isRunning prop for button state logic
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { pauseSimulation, resumeSimulation, toggleForwarding, toggleStalling } = useSimulationActions();
  const { currentCycle, isFinished, instructions, forwardingEnabled, stallingEnabled } = useSimulationState(); // Get state from context

  // Reset input text when instructions are cleared (e.g., on reset)
  useEffect(() => {
    if (instructions.length === 0) {
      setInputText('');
      setError(null); // Clear errors on reset as well
    }
  }, [instructions]);


  const hasStarted = currentCycle > 0;
  // Can only pause/resume if started and not finished
  const canPauseResume = hasStarted && !isFinished;
  // Input/Start button should be disabled if simulation has started and isn't finished
  const disableInputAndStart = hasStarted && !isFinished;


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
            placeholder="e.g., 00a63820..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        
        {/* Add hazard resolution toggles */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center space-x-2">
            <Switch 
              id="forwarding-mode"
              checked={forwardingEnabled}
              onCheckedChange={() => toggleForwarding()}
              disabled={disableInputAndStart}
            />
            <Label htmlFor="forwarding-mode">Forwarding</Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch 
              id="stalling-mode"
              checked={stallingEnabled}
              onCheckedChange={() => toggleStalling()}
              disabled={disableInputAndStart}
            />
            <Label htmlFor="stalling-mode">Stalling</Label>
          </div>
        </div>
        
        <div className="flex justify-between items-center gap-2">
           {/* Start Button: Disabled if started and not finished */}
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
             {isFinished ? 'Finished' : hasStarted ? 'Running...' : 'Start Simulation'}
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

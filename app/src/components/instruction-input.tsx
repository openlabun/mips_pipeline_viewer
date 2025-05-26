// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

// Pipeline modes matching the context
const PIPELINE_MODES = [
  { value: 'default', label: 'Default Pipeline' },
  { value: 'stall', label: 'Stall Handling' },
  { value: 'forward', label: 'Forwarding' },
] as const;

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const { pauseSimulation, resumeSimulation, setStallHandling } = useSimulationActions();
  const { currentCycle, isFinished, instructions, stallHandling } = useSimulationState();

  // Reset input text when instructions are cleared
  useEffect(() => {
    if (instructions.length === 0) {
      setInputText('');
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
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

  const handleModeChange = (value: 'default' | 'stall' | 'forward') => {
    if (!hasStarted) { // Only allow mode changes before simulation starts
      setStallHandling(value);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pipeline Mode Selector */}
        <div className="grid w-full gap-1.5">
          <Label htmlFor="pipeline-mode">Pipeline Mode</Label>
          <Select
            value={stallHandling}
            onValueChange={handleModeChange}
            disabled={hasStarted} // Disable mode changes during simulation
          >
            <SelectTrigger id="pipeline-mode">
              <SelectValue placeholder="Select pipeline mode" />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasStarted && (
            <p className="text-xs text-muted-foreground">
              Mode cannot be changed during simulation
            </p>
          )}
        </div>

        {/* Instructions Input */}
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

        {/* Control Buttons */}
        <div className="flex justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? 'Finished' : hasStarted ? 'Running...' : 'Start Simulation'}
          </Button>

          {canPauseResume && (
            <Button 
              variant="outline" 
              onClick={handlePauseResume} 
              size="icon" 
              aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}
            >
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {hasStarted && (
            <Button 
              variant="destructive" 
              onClick={onReset} 
              size="icon" 
              aria-label="Reset Simulation"
            >
              <RotateCcw />
            </Button>
          )}
        </div>

        {/* Mode Description */}
        <div className="text-xs text-muted-foreground border-t pt-2">
          <strong>Current Mode:</strong>{' '}
          {PIPELINE_MODES.find(mode => mode.value === stallHandling)?.label}
          <br />
          {stallHandling === 'default' && 'Standard 5-stage pipeline without hazard handling'}
          {stallHandling === 'stall' && 'Pipeline with stall insertion for data hazards'}
          {stallHandling === 'forward' && 'Pipeline with data forwarding to minimize stalls'}
        </div>
      </CardContent>
    </Card>
  );
}
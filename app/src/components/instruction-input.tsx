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

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

export function InstructionInput() {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [useStalls, setUseStalls] = useState(false);
  const [useForwarding, setUseForwarding] = useState(false); 


  const {
    pauseSimulation,
    resumeSimulation,
    resetSimulation,
    startSimulation,
    startSimulationWithStalls,
    startSimulationWithForwarding,
  } = useSimulationActions();

  const { currentCycle, isFinished, instructions, isRunning } = useSimulationState();

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

    if (useForwarding) {
      startSimulationWithForwarding(currentInstructions);
    } else if (useStalls) {
      startSimulationWithStalls(currentInstructions);
    } else {
      startSimulation(currentInstructions);
    }

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

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="useStalls"
            checked={useStalls}
            onChange={(e) => {
              setUseStalls(e.target.checked);
              if (e.target.checked) setUseForwarding(false);
              }}
            disabled={disableInputAndStart}
          />
          <Label htmlFor="useStalls" className="text-sm">
            Activar detección de hazards (agregar stalls)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="useForwarding"
              checked={useForwarding}
              onChange={(e) => {
                setUseForwarding(e.target.checked);
                if (e.target.checked) setUseStalls(false);
              }}
              disabled={disableInputAndStart}
            />
            <Label htmlFor="useForwarding" className="text-sm">
              Activar Forwarding (con stalls en instrucciones Load)
            </Label>
          </div>
        </div>


        <div className="flex justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? 'Finished' : hasStarted ? 'Running...' : 'Start Simulation'}
          </Button>

          {canPauseResume && (
            <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}>
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {hasStarted && (
            <Button variant="destructive" onClick={resetSimulation} size="icon" aria-label="Reset Simulation">
              <RotateCcw />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

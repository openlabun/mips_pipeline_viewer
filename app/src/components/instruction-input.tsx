"use client";

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { styled } from '@mui/material/styles';
import Switch from '@mui/material/Switch';


const MaterialUISwitch = styled(Switch)(({ theme }) => ({
  width: 62,
  height: 34,
  padding: 7,
  '& .MuiSwitch-switchBase': {
    margin: 1,
    padding: 0,
    transform: 'translateX(6px)',
    '&.Mui-checked': {
      color: '#f49e09',
      transform: 'translateX(22px)',
      '& .MuiSwitch-thumb:before': {
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-weight="bold" font-size="12" font-family="Arial">F</text></svg>`
        )}")`,
      },
      '& + .MuiSwitch-track': {
        backgroundColor: '#F5C86B',
        opacity: 1,
      },
    },
    // Estilos para estado deshabilitado
    '&.Mui-disabled': {
      '& + .MuiSwitch-track': {
        backgroundColor: '#e0e0e0 !important',
      },
      '& .MuiSwitch-thumb': {
        backgroundColor: '#b0b0b0 !important',
      }
    }
  },
  '& .MuiSwitch-thumb': {
    width: 32,
    height: 32,
    backgroundColor: '#6366f1',
    '&::before': {
      content: "''",
      position: 'absolute',
      width: '100%',
      height: '100%',
      left: 0,
      top: 0,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-weight="bold" font-size="12" font-family="Arial">S</text></svg>`
      )}")`,
    },
  },
  '& .Mui-checked .MuiSwitch-thumb': {
    backgroundColor: '#f49e09',
  },
  '& .MuiSwitch-track': {
    borderRadius: 20 / 2,
    backgroundColor: '#C9B7F0',
    opacity: 1,
  },
}));


interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;


export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { pauseSimulation,
          resumeSimulation, 
          toggleStall 
      } = useSimulationActions();
  const { isStall, currentCycle, isFinished, instructions} = useSimulationState();

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
    const currentInstructions = lines.map(line => line.trim()).filter(line => line.length > 0);

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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="mr-4">MIPS Instructions</CardTitle>
        <MaterialUISwitch checked={!isStall} 
          onChange={(e) => toggleStall(!e.target.checked)}
          disabled={isRunning && !isFinished}
        />
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
        <div className="flex justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? 'Restart Simulation' : hasStarted ? 'Running...' : 'Start Simulation'}
          </Button>

          {canPauseResume && (
            <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}>
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

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

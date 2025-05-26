// src/components/instruction-input.tsx
"use client";

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

interface InstructionInputProps {
  onInstructionsSubmit: (lines: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    pauseSimulation,
    resumeSimulation,
    setMode,
  } = useSimulationActions();

  const { currentCycle, isFinished, mode } = useSimulationState();

  useEffect(() => {
    if (!inputText && isFinished === false && currentCycle === 0) {
      setError(null);
    }
  }, [inputText, isFinished, currentCycle]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
      setError('Por favor, ingresa al menos una instrucción MIPS en formato hexadecimal.');
      return;
    }

    const invalidInstructions = lines.filter(line => !HEX_REGEX.test(line));
    if (invalidInstructions.length > 0) {
      setError(`Formato de instrucción inválido: ${invalidInstructions.join(', ')}. Cada instrucción debe tener 8 caracteres hexadecimales.`);
      return;
    }
    if (onInstructionsSubmit) {
      onInstructionsSubmit(lines);
    }
  };

  const handlePauseResume = () => {
    if (isRunning) pauseSimulation();
    else resumeSimulation();
  };

  const handleReset = () => {
    setInputText('');
    setError(null);
    if (onReset) onReset();
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Instrucciones MIPS</CardTitle>
        <CardDescription>Ingresa instrucciones MIPS en formato hexadecimal (8 caracteres cada una)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">Instrucciones Hexadecimales (una por línea)</Label>
          <Textarea
            id="instructions"
            placeholder="Ejemplo:\n8C080000\n01084020"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={disableInputAndStart}
            aria-label="Entrada de Instrucciones MIPS Hexadecimales"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="space-y-2">
          <Label>Modo de Manejo de Hazards:</Label>
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'stall' | 'forward')} disabled={disableInputAndStart} className="flex space-x-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="stall" id="stall" />
              <Label htmlFor="stall" className="cursor-pointer">Stall</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="forward" id="forward" />
              <Label htmlFor="forward" className="cursor-pointer">Forward</Label>
            </div>
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{mode === 'stall' ? 'Modo stall: El pipeline se detiene en todos los hazards de datos' : 'Modo forward: Usa forwarding para la mayoría de hazards, solo hace stall en hazards load-use'}</p>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isRunning ? 'Ejecutando...' : hasStarted ? 'Ejecutando...' : 'Iniciar Simulación'}
          </Button>

          {canPauseResume && (
            <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pausar Simulación' : 'Reanudar Simulación'}>
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {hasStarted && (
            <Button variant="destructive" onClick={handleReset} size="icon" aria-label="Reiniciar Simulación">
              <RotateCcw />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
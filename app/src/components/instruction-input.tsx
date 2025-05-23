// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

// Instrucciones de ejemplo con descripción
const EXAMPLE_INSTRUCTIONS = [
  { hex: "8c010000", description: "lw $1, 0($0)   - Cargar desde memoria" },
  { hex: "8c020004", description: "lw $2, 4($0)   - Cargar otro valor" },
  { hex: "00221820", description: "add $3, $1, $2 - Sumar registros (causa hazard)" },
  { hex: "ac030008", description: "sw $3, 8($0)   - Guardar resultado" },
];

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState<boolean>(false);
  const { pauseSimulation, resumeSimulation } = useSimulationActions();
  const { currentCycle, isFinished, instructions } = useSimulationState();

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
      setError('Por favor ingresa al menos una instrucción MIPS en formato hexadecimal.');
      return;
    }

    const invalidInstructions = currentInstructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Formato inválido: ${invalidInstructions.join(', ')}. Cada instrucción debe tener 8 caracteres hexadecimales.`);
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

  const loadExampleInstructions = () => {
    setInputText(EXAMPLE_INSTRUCTIONS.map(i => i.hex).join('\n'));
    setShowExamples(false);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Instrucciones MIPS</CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowExamples(!showExamples)}
                >
                  <HelpCircle className="h-4 w-4 mr-1" /> Ayuda
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-sm p-0">
                <Card>
                  <CardHeader className="p-2">
                    <CardTitle className="text-sm">Formato de instrucciones</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2 text-xs">
                    <p>Cada instrucción debe ser un número hexadecimal de 8 dígitos.</p>
                    <p className="mt-1">Ejemplo: 00221820 representa add $3, $1, $2</p>
                  </CardContent>
                </Card>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <CardDescription>
          Ingresa instrucciones en formato hexadecimal, una por línea
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showExamples && (
          <div className="mb-4 p-3 bg-muted rounded-md">
            <h4 className="font-medium mb-2">Instrucciones de ejemplo:</h4>
            <ul className="space-y-1 text-sm">
              {EXAMPLE_INSTRUCTIONS.map((instr, i) => (
                <li key={i} className="flex flex-col">
                  <code className="font-mono">{instr.hex}</code>
                  <span className="text-xs text-muted-foreground">{instr.description}</span>
                </li>
              ))}
            </ul>
            <Button 
              size="sm" 
              variant="secondary" 
              className="mt-2"
              onClick={loadExampleInstructions}
            >
              Cargar ejemplos
            </Button>
          </div>
        )}

        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">Instrucciones hexadecimales</Label>
          <Textarea
            id="instructions"
            placeholder="e.g., 00a63820"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && (
            <div className="bg-destructive/10 text-destructive p-2 rounded text-sm mt-1">
              {error}
            </div>
          )}
        </div>
        
        <div className="flex justify-between items-center gap-2">
          <Button 
            onClick={handleSubmit} 
            disabled={disableInputAndStart} 
            className="flex-1"
            variant={hasStarted ? "secondary" : "default"}
          >
            {isFinished ? 'Simulación completada' : hasStarted ? 'Simulación en progreso' : 'Iniciar simulación'}
          </Button>

          {canPauseResume && (
            <Button 
              variant="outline" 
              onClick={handlePauseResume} 
              size="icon" 
              aria-label={isRunning ? 'Pausar simulación' : 'Reanudar simulación'}
            >
              {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}

          {hasStarted && (
            <Button 
              variant="destructive" 
              onClick={onReset} 
              size="icon" 
              aria-label="Reiniciar simulación"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
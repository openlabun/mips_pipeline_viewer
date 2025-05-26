// src/components/pipeline-visualization.tsx
"use client";

import type * as React from 'react';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Code2, Cpu, MemoryStick, CheckSquare, Pause, ArrowRightCircle, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext'; // Import context hook

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

// Definir iconos para hazards y bubbles
const HAZARD_ICONS = {
  stall: Pause,
  forward: ArrowRightCircle,
  bubble: CircleDashed
} as const;

export function PipelineVisualization() {
  // Get state from context, añadiendo historicalHazards
  const {
    instructions,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
    hazards,
    bubbles,
    historicalHazards,
    historicalBubbles, // Añadir esto
  } = useSimulationState();

  // Use maxCycles for the number of columns if it's calculated, otherwise 0
  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // if (instructions.length === 0) return null; // Handled in page.tsx

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
            <TableHeader>
              <TableRow>
                {/* Use bg-card for sticky header cell background */}
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">Instruction</TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`}>
                  {/* Use bg-card for sticky instruction cell background */}
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const expectedStageIndex = c - instIndex - 1;
                    const currentStageIndex = instructionStages[instIndex];
                    const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                    const currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;
                    const isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && c === cycle;
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;
                    
                    // Check if this cell has a current hazard
                    const hazardKey = `${instIndex}-${c}`;
                    const hasHazard = hazards && hazards[hazardKey];
                    const hazardType = hasHazard ? hazards[hazardKey].type : null;
                    
                    // Check if this cell has a historical hazard - usar expectedStageIndex para encontrar hazards históricos
                    const historicalHazardKey = `${instIndex}-${expectedStageIndex}`;
                    const hasHistoricalHazard = historicalHazards && 
                      Object.keys(historicalHazards).some(key => {
                        const [histInstIndex, _, histStageIndex] = key.split('-');
                        return Number(histInstIndex) === instIndex && 
                               Number(histStageIndex) === expectedStageIndex;
                      });
                    const historicalHazardType = hasHistoricalHazard ? 
                      (Object.entries(historicalHazards).find(([key, _value]) => {
                        const [histInstIndex, _unused, histStageIndex] = key.split('-');
                        return Number(histInstIndex) === instIndex && 
                               Number(histStageIndex) === expectedStageIndex;
                      }) || [null, { type: null }])[1].type : null;
                    
                    // Asegúrate de usar los hazards históricos correctamente
                    const effectiveHazard = hasHazard || hasHistoricalHazard;
                    const effectiveHazardType = hazardType || historicalHazardType;
                    
                    // Check if this cell has a bubble - incluir burbujas históricas
                    const bubbleKey = `bubble-${c}-${expectedStageIndex}`;
                    const historicalBubbleKey = bubbleKey; // Misma estructura de clave
                    const hasHistoricalBubble = historicalBubbles && historicalBubbles[historicalBubbleKey];
                    const hasBubble = (bubbles && bubbles[bubbleKey]) || hasHistoricalBubble;
                    
                    // Additional styling for hazards and bubbles - no depender de isFinished
                    const cellClass = hasBubble 
                      ? 'bg-purple-100 dark:bg-purple-900 relative' // Quitar el border-2 border-dashed border-purple-500
                      : effectiveHazardType === 'stall' 
                        ? 'bg-amber-100 dark:bg-amber-900 relative' 
                        : effectiveHazardType === 'forward' 
                          ? 'bg-blue-100 dark:bg-blue-900 relative'
                          : '';

                    // Modificar la definición de la celda de tabla para incluir la condición isFinished
                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-16 transition-colors duration-300 relative',
                          // CAMBIO: No mostrar hazards cuando isFinished es true
                          !isFinished && (hasBubble || effectiveHazard) ? cellClass :
                          isFinished ? 'bg-background' :
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          isPastStage ? 'bg-secondary text-secondary-foreground' :
                          'bg-background'
                        )}
                      >
                        {/* CAMBIO: No mostrar contenido de hazards o bubbles cuando isFinished es true */}
                        {!isFinished && hasBubble ? (
                          <div className="flex flex-col items-center justify-center h-full w-full">
                            {/* Reducir tamaño del icono de bubble ya que CircleDashed es visualmente más grande */}
                            <HAZARD_ICONS.bubble className="h-4 w-4 mb-1 text-purple-700 dark:text-purple-300" aria-hidden="true" />
                            <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">BUBBLE</span>
                          </div>
                        ) : !isFinished && effectiveHazard ? (
                          <div className="flex flex-col items-center justify-center h-full w-full">
                            {effectiveHazardType === 'stall' ? (
                              <>
                                <HAZARD_ICONS.stall className="h-5 w-5 mb-1 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">STALL</span>
                              </>
                            ) : (
                              <>
                                {/* Reducir tamaño del icono de forward ya que ArrowRightCircle es visualmente más grande */}
                                <HAZARD_ICONS.forward className="h-4 w-4 mb-1 text-blue-700 dark:text-blue-300" aria-hidden="true" />
                                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">FORWARD</span>
                              </>
                            )}
                          </div>
                        ) : (
                          // Solo mostrar etapas normales si no hay hazard o burbuja, o si la simulación ha terminado
                          currentStageData && !isFinished && (
                            <div className="flex flex-col items-center justify-center h-full w-full">
                              <currentStageData.icon className="h-5 w-5 mb-1" aria-hidden="true" />
                              <span className="text-xs">{currentStageData.name}</span>
                            </div>
                          )
                        )}
                        
                        {/* CAMBIO: No mostrar conectores visuales cuando isFinished es true */}
                        {!isFinished && effectiveHazardType === 'stall' && generatesBubble(instIndex, c, bubbles, instructionStages, historicalBubbles) && (
                          <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2">
                            <div className="w-5 h-2 bg-purple-400 dark:bg-purple-600 rounded-full">
                              <div className="absolute right-0 top-1/2 transform translate-x-full -translate-y-1/2 w-2 h-2 bg-purple-400 dark:bg-purple-600 rounded-full"></div>
                            </div>
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Función para verificar si un stall genera una burbuja en el siguiente ciclo
const generatesBubble = (
  instIndex: number, 
  cycleIndex: number, 
  bubbles: Record<string, boolean>,
  instructionStages: Record<number, number | null>,
  historicalBubbles?: Record<string, any> // Parámetro para burbujas históricas
) => {
  // Obtener el stage actual de esta instrucción
  const currentStage = instructionStages[instIndex];
  if (currentStage === null) return false;
  
  // Verificar si hay una burbuja en el siguiente ciclo en el siguiente stage
  const bubbleKey = `bubble-${cycleIndex + 1}-${currentStage + 1}`;
  
  // Comprobar tanto en burbujas actuales como históricas
  return (bubbles && bubbles[bubbleKey]) || 
         (historicalBubbles && historicalBubbles[bubbleKey]);
};

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
import { Download, Code2, Cpu, MemoryStick, CheckSquare, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState, useStallInformation } from '@/context/SimulationContext'; // Import context hook

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

const STALL_STAGE = { name: 'STALL', icon: Pause };

export function PipelineVisualization() {
  // Get state from context
  const {
    instructions,
    currentCycle: cycle,
    maxCycles, // Max cycles determines the number of columns
    isRunning,
    instructionStages, // Use the pre-calculated stages
    isFinished, // Use the finished flag from context
  } = useSimulationState();

  // Get stall-specific information
  const { isStallEnabled, pipelineMatrix } = useStallInformation();

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
                    // Determinar qué etapa mostrar para esta instrucción en este ciclo
                    let currentStageData = null;
                    let isActualCurrentStage = false;
                    let isPastStage = false;

                    if (isStallEnabled && pipelineMatrix.length > 0) {
                      // Usar la matriz de pipeline cuando el manejo de stalls está habilitado
                      const stageValue = pipelineMatrix[instIndex]?.[c - 1]; // c es 1-based, array es 0-based
                      
                      if (stageValue === "STALL") {
                        currentStageData = STALL_STAGE;
                      } else if (stageValue && stageValue !== "") {
                        const stageIndex = STAGES.findIndex(stage => stage.name === stageValue);
                        currentStageData = stageIndex >= 0 ? STAGES[stageIndex] : null;
                      }
                      
                      // Verificar si es la etapa actual
                      isActualCurrentStage = c === cycle && instructionStages[instIndex] !== null && currentStageData !== null;
                      isPastStage = (currentStageData && c < cycle) ?? false;
                    } else {
                      // Lógica original para modo default
                      const expectedStageIndex = c - instIndex - 1;
                      const currentStageIndex = instructionStages[instIndex];

                      const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                      currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;

                      isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && c === cycle;
                      isPastStage = isInPipelineAtThisCycle && c < cycle;
                    }

                    // Solo animar si la simulación está corriendo Y no ha terminado
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    // Resaltar estáticamente si es la etapa actual pero pausada/detenida (y no completada)
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;
                    
                    // Estilo especial para celdas de stall
                    const isStallCell = currentStageData?.name === 'STALL';

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          // 1. Si la simulación está completada, resetear todas las celdas al fondo por defecto
                          isFinished ? 'bg-background' :
                          // 2. Estilo especial para celdas de stall
                          isStallCell ? (
                            shouldAnimate ? 'bg-yellow-200 text-yellow-800 animate-pulse-bg' :
                            shouldHighlightStatically ? 'bg-yellow-200 text-yellow-800' :
                            isPastStage ? 'bg-yellow-100 text-yellow-700' :
                            'bg-yellow-50 text-yellow-600'
                          ) :
                          // 3. Si es la etapa actual y está corriendo, animar
                          shouldAnimate ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          // 4. Si es la etapa actual pero pausada/detenida, resaltar estáticamente
                          shouldHighlightStatically ? 'bg-accent text-accent-foreground' :
                          // 5. Si es una etapa pasada en el pipeline, usar secundario
                          isPastStage ? 'bg-secondary text-secondary-foreground' :
                          // 6. De otra manera (etapa futura o celda vacía), usar fondo por defecto
                          'bg-background'
                        )}
                      >
                        {/* Mostrar icono/nombre si hay datos de etapa y la simulación no ha terminado */}
                        {currentStageData && !isFinished && (
                           <div className="flex flex-col items-center justify-center">
                             <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                             <span className="text-xs">{currentStageData.name}</span>
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
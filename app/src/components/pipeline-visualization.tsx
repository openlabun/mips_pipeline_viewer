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
import { Download, Code2, Cpu, MemoryStick, CheckSquare, MinusCircle } from 'lucide-react'; // Asegúrate de tener MinusCircle
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

const STALL_STAGE_DISPLAY = { name: 'STALL', icon: MinusCircle }; // Para mostrar STALL

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle, // El ciclo actual de la simulación
    maxCycles,
    isRunning,
    instructionStages, // Ahora es Record<number, { stage: number | null; isStalled?: boolean }>
    isFinished,
    stalledInstructionIndex, // Necesitamos esto del contexto
  } = useSimulationState();

  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : (instructions.length > 0 ? instructions.length + STAGES.length + 5 : 12);
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

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
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                  </TableCell>
                  {cycleNumbers.map((c) => { // 'c' es la columna del ciclo que estamos renderizando
                    const stageInfoForCurrentCycle = instructionStages[instIndex]; // Información del estado actual de la instrucción
                    
                    let cellContent = null; // Lo que se mostrará dentro de la celda (ícono y nombre de etapa)
                    let cellBgClass = 'bg-background'; // Clase de fondo por defecto
                    let cellTextClass = 'text-foreground'; // Clase de texto por defecto

                    // Determinar qué mostrar y cómo colorear, principalmente para la columna del CICLO ACTUAL de la simulación
                    if (c === cycle) { // Esta celda representa el estado actual de la instrucción en el ciclo actual de la simulación
                      if (stageInfoForCurrentCycle && stageInfoForCurrentCycle.stage !== null) {
                        const currentStageIndex = stageInfoForCurrentCycle.stage;
                        const isStalled = !!stageInfoForCurrentCycle.isStalled;

                        if (isStalled && currentStageIndex < STAGES.length) { // Si está stalleada
                          cellContent = STALL_STAGE_DISPLAY;
                          cellBgClass = 'bg-stall';
                          cellTextClass = 'text-stall-foreground';
                        } else if (currentStageIndex < STAGES.length) { // Si está en una etapa normal
                          cellContent = STAGES[currentStageIndex];
                          if (isRunning && !isFinished) {
                            cellBgClass = 'bg-accent animate-pulse-bg'; // Animación si está corriendo
                            cellTextClass = 'text-accent-foreground';
                          } else if (!isFinished) {
                            cellBgClass = 'bg-accent'; // Resaltado estático si está pausada
                            cellTextClass = 'text-accent-foreground';
                          }
                        }
                        // Si isFinished es true, cellBgClass se queda como 'bg-background' por defecto
                        if (isFinished) {
                            cellBgClass = 'bg-background';
                            cellTextClass = 'text-foreground'; // o text-muted-foreground
                            // Si la instrucción completó su paso por esta etapa antes de finalizar, mostrarla como pasada
                            if (currentStageIndex >= STAGES.length || currentStageIndex > (c - (instIndex +1)) ) { // Ya salió o la etapa es posterior a la columna
                                cellContent = null; // No mostrar nada si ya salió
                            } else if (c - (instIndex + 1) < STAGES.length && c - (instIndex+1) >=0) {
                                // Mostrar la etapa ideal pasada si la simulación terminó
                                cellContent = STAGES[c-(instIndex+1)];
                                cellBgClass = 'bg-secondary';
                                cellTextClass = 'text-secondary-foreground';
                            } else {
                                cellContent = null;
                            }
                        }
                      }
                    } else if (c < cycle) { // Para celdas de ciclos PASADOS (el rastro)
                      // Mostrar la etapa "ideal" por la que la instrucción habría pasado
                      const idealStageIndexInPast = c - (instIndex + 1); // k + S + 1 = c => S = c - k - 1
                      if (idealStageIndexInPast >= 0 && idealStageIndexInPast < STAGES.length) {
                        // Verificar si la instrucción realmente alcanzó esta etapa antes de que el ciclo actual la superara
                        if (stageInfoForCurrentCycle && stageInfoForCurrentCycle.stage !== null && 
                           (stageInfoForCurrentCycle.stage > idealStageIndexInPast || 
                           (stageInfoForCurrentCycle.stage === idealStageIndexInPast && c === cycle -1) || // Estuvo aquí el ciclo pasado
                           (stageInfoForCurrentCycle.stage === STAGES.length && idealStageIndexInPast < STAGES.length) // Ya terminó
                           )) {
                            cellContent = STAGES[idealStageIndexInPast];
                            cellBgClass = 'bg-secondary';
                            cellTextClass = 'text-secondary-foreground';
                        } else if (stageInfoForCurrentCycle && stageInfoForCurrentCycle.isStalled && stageInfoForCurrentCycle.stage === idealStageIndexInPast) {
                            // Si se quedó stalleada en una etapa que coincide con esta celda pasada
                            // Esto es más complejo de rastrear visualmente con precisión sin historial.
                            // Por ahora, las pasadas solo se marcan como secundarias.
                             cellContent = STAGES[idealStageIndexInPast];
                             cellBgClass = 'bg-secondary';
                             cellTextClass = 'text-secondary-foreground';
                        }
                      }
                    }
                    // Para celdas de ciclos FUTUROS (c > cycle), no se muestra nada y el fondo es normal.

                    // --- CONSOLE.LOGS PARA DEPURACIÓN VISUAL ---
                    if (c === cycle) { // Solo nos interesa el ciclo actual para depurar el estado "vivo"
                        if (instIndex === stalledInstructionIndex && stageInfoForCurrentCycle?.isStalled) {
                            console.log(`VIS: Cycle ${c}, Inst ${instIndex} (STALLED): stageInfo=`, stageInfoForCurrentCycle, `cellContent=`, cellContent);
                        } else if (instIndex === stalledInstructionIndex && !(stageInfoForCurrentCycle?.isStalled)) {
                            console.log(`VIS: Cycle ${c}, Inst ${instIndex} (EXPECTED STALL BUT isStalled=false): stageInfo=`, stageInfoForCurrentCycle);
                        }
                        // Log general para la columna actual
                        // if (instIndex === 0) { // O cualquier condición para no llenar la consola
                        //     console.log(`VIS: Cycle ${c}, Inst ${instIndex}: stageInfo=`, stageInfoForCurrentCycle, `cellContent=`, cellContent, `bg=${cellBgClass}`);
                        // }
                    }
                    // --- FIN CONSOLE.LOGS ---

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-16 h-14 transition-colors duration-300',
                          cellBgClass, // Clase de fondo determinada por la lógica
                          cellTextClass // Clase de texto determinada por la lógica
                        )}
                      >
                        {cellContent && !isFinished && ( // No mostrar contenido si está finalizado, a menos que sea rastro de etapa pasada
                           <div className="flex flex-col items-center justify-center">
                             <cellContent.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                             <span className="text-xs">{cellContent.name}</span>
                           </div>
                         )}
                         {cellContent && isFinished && c < cycle && cellBgClass === 'bg-secondary' && ( // Mostrar rastro si está finalizado
                            <div className="flex flex-col items-center justify-center">
                             <cellContent.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                             <span className="text-xs">{cellContent.name}</span>
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
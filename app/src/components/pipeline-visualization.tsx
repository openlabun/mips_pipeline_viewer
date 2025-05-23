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
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  Code2, 
  Cpu, 
  MemoryStick, 
  CheckSquare, 
  AlertTriangle, 
  ArrowRight,
  Zap,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';

const STAGES = [
  { name: 'IF', icon: Download, description: 'Instruction Fetch' },
  { name: 'ID', icon: Code2, description: 'Instruction Decode' },
  { name: 'EX', icon: Cpu, description: 'Execute' },
  { name: 'MEM', icon: MemoryStick, description: 'Memory Access' },
  { name: 'WB', icon: CheckSquare, description: 'Write Back' },
] as const;

// Componente para mostrar paths de forwarding como flechas
const ForwardingArrow: React.FC<{
  fromStage: number;
  toStage: number;
  register: number;
  className?: string;
}> = ({ fromStage, toStage, register, className }) => {
  return (
    <div className={cn("absolute inset-0 pointer-events-none z-20", className)}>
      <div className="relative w-full h-full">
        {/* Flecha visual simplificada */}
        <div className="absolute top-1/2 left-1/4 right-1/4 h-0.5 bg-blue-500 transform -translate-y-1/2">
          <div className="absolute right-0 top-1/2 w-0 h-0 border-l-2 border-l-blue-500 border-t border-b border-transparent transform -translate-y-1/2" />
        </div>
        {/* Etiqueta del registro */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white text-xs px-1 rounded">
          R{register}
        </div>
      </div>
    </div>
  );
};

// Componente para mostrar información detallada de una instrucción
const InstructionTooltip: React.FC<{
  hex: string;
  decoded: any;
  isStall?: boolean;
}> = ({ hex, decoded, isStall }) => {
  if (isStall) {
    return (
      <div className="text-xs space-y-1">
        <div className="font-medium text-orange-600">STALL (Bubble)</div>
        <div className="text-muted-foreground">Pipeline paused due to hazard</div>
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <div className="font-medium">{hex}</div>
      <div className="text-muted-foreground">
        {decoded.isLoad && <Badge variant="outline" className="text-xs mr-1">Load</Badge>}
        {decoded.isStore && <Badge variant="outline" className="text-xs mr-1">Store</Badge>}
        Type: {decoded.type}
      </div>
      {decoded.readsFrom.length > 0 && (
        <div>Reads: R{decoded.readsFrom.join(', R')}</div>
      )}
      {decoded.writesTo.length > 0 && (
        <div>Writes: R{decoded.writesTo.join(', R')}</div>
      )}
    </div>
  );
};

export function PipelineVisualization() {
  const {
    instructions,
    instructionStates,
    currentCycle,
    maxCycles,
    isRunning,
    isFinished,
    forwardingPaths,
    stallsThisCycle,
    stallsEnabled,
    forwardingEnabled,
    loadUseHazards,
    rawHazards,
    // Nuevos estados acumulativos
    totalStallsInserted,
    instructionsWithLoadUseHazards,
    instructionsWithRawHazards
  } = useSimulationState();

  // Derivar el estado de si la simulación ha comenzado
  const hasStarted = currentCycle > 0;

  // Generar columnas para mostrar - necesitamos más columnas para acomodar stalls
  const totalCyclesToDisplay = Math.max(maxCycles, currentCycle + 5);
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // Crear una matriz que represente el estado REAL del pipeline
  // Esta vez usaremos el estado actual de las instrucciones, no una fórmula
  const pipelineMatrix: { [key: string]: { [cycle: number]: any } } = {};

  // Inicializar la matriz
  instructions.forEach((hex, instIndex) => {
    pipelineMatrix[instIndex] = {};
  });

  // Llenar la matriz con el estado actual REAL de las instrucciones
  instructionStates.forEach(instState => {
    if (instState.isStall) {
      // Manejar bubbles/stalls - Ahora duplicamos la etapa IF
      const stallKey = `stall-${instState.index}`;
      if (!pipelineMatrix[stallKey]) {
        pipelineMatrix[stallKey] = {};
      }
      
      if (instState.currentStage !== null) {
        // Duplicar la etapa IF en el ciclo actual si hay stall
        if (instState.currentStage === 0) { // Si es IF
          pipelineMatrix[stallKey][currentCycle] = {
            stage: instState.currentStage,
            isStall: true,
            isActive: true,
            isPast: false,
            isFuture: false,
            hex: instState.hex,
            decoded: instState.decoded,
            isStallDuplicate: true // Marcar como duplicado de stall
          };
        }

        // La instrucción original se mueve al siguiente ciclo
        pipelineMatrix[stallKey][currentCycle + 1] = {
          stage: instState.currentStage,
          isStall: true,
          isActive: true,
          isPast: false,
          isFuture: false,
          hex: instState.hex,
          decoded: instState.decoded,
          hasStall: true // Marcar que tiene stall
        };
      }
    } else {
      // Manejar instrucciones normales con ajuste por stalls
      if (instState.currentStage !== null && instState.index >= 0) {
        const cycleOffset = instState.stallsInserted || 0;
        pipelineMatrix[instState.index][currentCycle + cycleOffset] = {
          stage: instState.currentStage,
          isStall: false,
          isActive: true,
          isPast: false,
          isFuture: false,
          hex: instState.hex,
          decoded: instState.decoded,
          hasForwarding: forwardingPaths.some(path => 
            (path.from.instructionIndex === instState.index && path.from.stage === instState.currentStage) ||
            (path.to.instructionIndex === instState.index && path.to.stage === instState.currentStage)
          )
        };
      }
    }
  });

  // Para ciclos pasados, necesitamos reconstruir el historial
  // Esto es una aproximación - en una implementación completa mantendríamos historial
  for (let cycle = 1; cycle < currentCycle; cycle++) {
    instructions.forEach((hex, instIndex) => {
      // Aproximación: calcular dónde habría estado esta instrucción en ciclos pasados
      // considerando que podría haber habido stalls
      const expectedStage = cycle - instIndex - 1;
      if (expectedStage >= 0 && expectedStage < STAGES.length) {
        // Solo mostrar si no hay información más reciente
        if (!pipelineMatrix[instIndex][cycle]) {
          pipelineMatrix[instIndex][cycle] = {
            stage: expectedStage,
            isStall: false,
            isActive: false,
            isPast: true,
            isFuture: false,
            hex: hex,
            decoded: null // No necesitamos decodificación para estados pasados
          };
        }
      }
    });
  }

  // Para ciclos futuros, mostrar proyecciones (si no hay más stalls)
  for (let cycle = currentCycle + 1; cycle <= totalCyclesToDisplay; cycle++) {
    instructions.forEach((hex, instIndex) => {
      const expectedStage = cycle - instIndex - 1;
      if (expectedStage >= 0 && expectedStage < STAGES.length) {
        if (!pipelineMatrix[instIndex][cycle]) {
          pipelineMatrix[instIndex][cycle] = {
            stage: expectedStage,
            isStall: false,
            isActive: false,
            isPast: false,
            isFuture: true,
            hex: hex,
            decoded: null
          };
        }
      }
    });
  }

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pipeline Progress</span>
          <div className="flex gap-2">
            {stallsEnabled && (
              <Badge variant="outline" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Stalls: {stallsEnabled ? 'ON' : 'OFF'}
              </Badge>
            )}
            {forwardingEnabled && (
              <Badge variant="outline" className="text-xs">
                <Zap className="w-3 h-3 mr-1" />
                Forwarding: {forwardingEnabled ? 'ON' : 'OFF'}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Legend actualizada */}
        <div className="mb-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500 rounded"></div>
            <span>Etapa Actual</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-yellow-200 rounded"></div>
            <span>Forwarding</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-200 rounded"></div>
            <span>Stall</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-secondary rounded"></div>
            <span>Etapa Pasada</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              MIPS instruction pipeline visualization
              {stallsEnabled && " with hazard detection"}
              {forwardingEnabled && " and forwarding"}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px] sticky left-0 bg-card z-10 border-r">
                  Instruction
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className={cn(
                    "text-center w-20",
                    c === currentCycle && !isFinished && "bg-accent/20"
                  )}>
                    <div className="flex flex-col items-center">
                      <span>Cycle {c}</span>
                      {c === currentCycle && !isFinished && (
                        <Clock className="w-3 h-3 mt-1 text-accent" />
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Instrucciones normales */}
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`} className="even:bg-muted/5">
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r p-2">
                    <div className="space-y-1">
                      <div className="font-medium">{inst}</div>
                      <div className="text-xs text-muted-foreground">
                        Inst {instIndex + 1}
                      </div>
                      {/* Indicador de tipo de instrucción */}
                      {instructionStates.some(is => 
                        is.index === instIndex && is.decoded.isLoad
                      ) && (
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 mt-1 sm">
                          LOAD
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const cellState = pipelineMatrix[instIndex]?.[c];
                    
                    if (!cellState) {
                      return (
                        <TableCell key={`inst-${instIndex}-cycle-${c}`} className="text-center w-20 h-16 border-l border-muted/20" />
                      );
                    }

                    const currentStageData = STAGES[cellState.stage];
                    const isCurrentCycle = c === currentCycle;
                    const isActiveCycle = cellState.isActive && isCurrentCycle;
                    const isPastCycle = cellState.isPast;
                    const isFutureCycle = cellState.isFuture;
                    
                    // Verificar si hay forwarding desde/hacia esta célula
                    const hasForwardingFrom = forwardingPaths.some(path => 
                      path.from.instructionIndex === instIndex && 
                      path.from.stage === cellState.stage &&
                      isCurrentCycle
                    );
                    
                    const hasForwardingTo = forwardingPaths.some(path => 
                      path.to.instructionIndex === instIndex && 
                      path.to.stage === cellState.stage &&
                      isCurrentCycle
                    );

                    // Verificar si esta instrucción tiene un hazard
                    const hasLoadUseHazard = loadUseHazards.includes(instIndex) && isCurrentCycle && cellState.stage === 1;
                    const hasRawHazard = rawHazards.includes(instIndex) && isCurrentCycle && cellState.stage === 1;

                    // Estado específico para instrucción bloqueada por hazard
                    const isBlockedByHazard = (hasLoadUseHazard || hasRawHazard) && isCurrentCycle;

                    // Condición mejorada para determinar si la instrucción está activa en el ciclo actual
                    const isActiveStage = isCurrentCycle && cellState.isActive;

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-20 h-16 relative transition-all duration-300 border-l border-muted/20',
                          // Coloreado actualizado para matching con la referencia
                          isFinished ? 'bg-background' :
                          cellState.hasStall ? 'bg-red-200' :
                          cellState.hasForwarding ? 'bg-yellow-200' :
                          isActiveStage ? 'bg-blue-500 text-white shadow-sm' :
                          isPastCycle ? 'bg-secondary/60' :
                          'bg-background',
                          // Animación solo para etapas activas sin stall
                          isActiveStage && isRunning && !cellState.hasStall && 'animate-[pulse_2s_ease-in-out_infinite]'
                        )}
                        style={{
                          // Asegurarse de que no haya problemas con la animación en filas pares
                          animationDelay: isActiveStage && isRunning ? `${instIndex * 0.1}s` : '0s'
                        }}
                      >
                        {currentStageData && !isFinished && (
                          <div className="flex flex-col items-center justify-center h-full relative">
                            <currentStageData.icon className={cn(
                              "w-5 h-5 mb-1",
                              isActiveStage && "text-white", // Asegurar que el icono sea visible en la etapa actual
                              isFutureCycle && "opacity-40",
                              isBlockedByHazard && "text-red-600"
                            )} aria-hidden="true" />
                            <span className={cn(
                              "text-xs font-medium",
                              isActiveStage && "text-white font-bold", // Texto más destacado en la etapa actual
                              isFutureCycle && "opacity-40",
                              isBlockedByHazard && "font-bold"
                            )}>
                              {currentStageData.name}
                              {isActiveStage && <span className="ml-1">C{c}</span>} {/* Mostrar número de ciclo en la etapa activa */}
                            </span>
                            
                            {/* Indicadores de hazard */}
                            {hasLoadUseHazard && (
                              <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
                                <div className="absolute -top-1 -right-1 bg-purple-500 text-white text-xs px-1 py-0.5 rounded leading-none">
                                  Load-Use
                                </div>
                              </div>
                            )}
                            
                            {hasRawHazard && !hasLoadUseHazard && (
                              <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
                                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-1 py-0.5 rounded leading-none">
                                  RAW
                                </div>
                              </div>
                            )}
                            
                            {/* Indicadores de forwarding con mejor visibilidad */}
                            {hasForwardingFrom && (
                              <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs px-1 rounded-full leading-none shadow-sm">
                                →
                              </div>
                            )}
                            {hasForwardingTo && (
                              <div className="absolute -top-1 -left-1 bg-green-500 text-white text-xs px-1 rounded-full leading-none shadow-sm">
                                ←
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {/* Fila separada para mostrar stalls cuando ocurren */}
              {Object.keys(pipelineMatrix).some(key => key.startsWith('stall-')) && (
                <TableRow className="border-t-2 border-dashed border-orange-300 bg-orange-50/50">
                  <TableCell className="font-mono sticky left-0 bg-orange-50 z-10 border-r p-2">
                    <div className="space-y-1">
                      <div className="font-medium text-orange-600 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        BUBBLES
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pipeline Stalls
                      </div>
                    </div>
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    // Buscar si hay algún stall en este ciclo
                    const stallInThisCycle = Object.keys(pipelineMatrix).find(key => 
                      key.startsWith('stall-') && pipelineMatrix[key][c]?.isStall
                    );
                    
                    const cellState = stallInThisCycle ? pipelineMatrix[stallInThisCycle][c] : null;
                    
                    return (
                      <TableCell key={`stall-cycle-${c}`} className={cn(
                        'text-center w-20 h-16 border-l border-muted/20',
                        cellState ? 'bg-orange-200' : 'bg-orange-50/20'
                      )}>
                        {cellState && (
                          <div className="flex flex-col items-center justify-center h-full">
                            <AlertTriangle className="w-5 h-5 mb-1 text-orange-600" />
                            <span className="text-xs font-medium text-orange-600">NOP</span>
                            <div className="absolute bottom-0 right-0 text-xs opacity-50 text-orange-500">
                              C{c}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Estadísticas de hazards - Actualizado para mostrar tanto actuales como acumulados */}
        {(stallsEnabled || forwardingEnabled) && hasStarted && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Hazards Detectados</div>
              <div className="flex justify-between items-baseline">
                <div className="text-2xl font-bold text-orange-600 flex items-baseline gap-2">
                  {stallsThisCycle.length}
                  <span className="text-xs text-muted-foreground">actuales</span>
                </div>
                <div className="text-xl font-medium text-orange-600 flex items-baseline gap-1">
                  {totalStallsInserted}
                  <span className="text-xs text-muted-foreground">total</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                  <div className="text-xs text-purple-700">
                    {loadUseHazards.length} <span className="opacity-75">actual</span>
                  </div>
                </div>
                <div className="text-xs text-purple-700 font-medium">
                  {instructionsWithLoadUseHazards.size} <span className="opacity-75">total Load-Use</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                  <div className="text-xs text-red-700">
                    {rawHazards.length} <span className="opacity-75">actual</span>
                  </div>
                </div>
                <div className="text-xs text-red-700 font-medium">
                  {instructionsWithRawHazards.size} <span className="opacity-75">total RAW</span>
                </div>
              </div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Forwarding Activo</div>
              <div className="text-2xl font-bold text-blue-600">
                {forwardingPaths.length}
              </div>
              <div className="text-xs text-muted-foreground">paths actuales</div>
              {stallsEnabled && (
                <div className="text-xs text-green-600 mt-2">
                  {forwardingPaths.length > 0 ? 
                    `Evitando ${forwardingPaths.length} stalls en este ciclo` : 
                    'Sin forwarding activo'}
                </div>
              )}
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Progreso</div>
              <div className="text-2xl font-bold text-green-600">
                {Math.round((currentCycle / Math.max(maxCycles, 1)) * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">completado</div>
              <div className="text-xs mt-2">
                Ciclo <span className="font-medium">{currentCycle}</span> de {maxCycles}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
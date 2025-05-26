import * as React from 'react';
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
import { Download, Code2, Cpu, MemoryStick, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState, useForwards } from '@/context/SimulationContext';

const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;

export function PipelineVisualization({
  useForwarding: propUseForwarding,
  useStalls,
}: {
  useForwarding: boolean;
  useStalls: boolean;
}) {
  // Forzar useForwarding a true, independientemente del valor de la prop
  const useForwarding = true;
  
  const {
    instructions,
    instructionsWithStalls,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
  } = useSimulationState();
  
  // Selecciona el arreglo correcto de instrucciones según las configuraciones
  const displayedInstructions = useStalls && !useForwarding && instructionsWithStalls 
    ? instructionsWithStalls 
    : instructions;

  // Obtener los forwards ya que useForwarding siempre es true
  const forwards = useForwards();
  
  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
        <div className="text-sm text-green-600 font-medium">
          Forwarding activo {forwards.length > 0 ? `(${forwards.length} paths)` : '(sin paths detectados)'}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">
                  Instruction
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedInstructions.map((inst, instIndex) => {
                const isStall = inst === '00000000';

                return (
                  <TableRow key={`inst-${instIndex}`}>
                    <TableCell
                      className={cn(
                        'font-mono sticky left-0 bg-card z-10 border-r',
                        isStall ? 'bg-gray-300 text-gray-600 font-semibold' : '',
                        isFinished && 'bg-white text-transparent'
                      )}
                      title={isStall ? 'STALL' : ''}
                    >
                      {!isFinished ? (isStall ? 'Stall' : inst) : ''}
                    </TableCell>

                    {cycleNumbers.map((c) => {
                      const expectedStageIndex = c - instIndex - 1;
                      const currentStageIndex = instructionStages[instIndex];
                      const isInPipelineAtThisCycle =
                        expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                      const currentStageData = isInPipelineAtThisCycle
                        ? STAGES[expectedStageIndex]
                        : null;
                      const isActualCurrentStage =
                        currentStageIndex !== null &&
                        expectedStageIndex === currentStageIndex &&
                        c === cycle;

                      const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                      const shouldHighlightStatically =
                        isActualCurrentStage && !isRunning && !isFinished;
                      const isPastStage = isInPipelineAtThisCycle && c < cycle;

                      // Detectar forwards (siempre activo)
                      const isForwardSource = forwards.some(f => 
                        f.fromInst === instIndex && f.fromStage === expectedStageIndex
                      );

                      const isForwardTarget = forwards.some(f => 
                        f.toInst === instIndex && f.toStage === expectedStageIndex
                      );

                      const forwardInfo = forwards.find(
                        (f) =>
                          (f.fromInst === instIndex && f.fromStage === expectedStageIndex) ||
                          (f.toInst === instIndex && f.toStage === expectedStageIndex)
                      );

                      if (isFinished) {
                        return (
                          <TableCell
                            key={`inst-${instIndex}-cycle-${c}`}
                            className="text-center w-16 h-14 bg-white transition-colors duration-300"
                          />
                        );
                      }

                      if (isStall) {
                        if (expectedStageIndex === 0) {
                          const cellClass = shouldAnimate
                            ? 'bg-accent text-accent-foreground animate-pulse-bg'
                            : shouldHighlightStatically
                            ? 'bg-accent text-accent-foreground'
                            : isPastStage
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-background';
                          return (
                            <TableCell
                              key={`inst-${instIndex}-cycle-${c}`}
                              className={cn(
                                'text-center w-16 h-14 transition-colors duration-300',
                                cellClass
                              )}
                              title="STALL - IF stage"
                            >
                              <div className="flex flex-col items-center justify-center">
                                <Download className="w-4 h-4 mb-1" aria-hidden="true" />
                                <span className="text-xs">IF</span>
                              </div>
                            </TableCell>
                          );
                        } else if (expectedStageIndex > 0 && expectedStageIndex < STAGES.length) {
                          return (
                            <TableCell
                              key={`inst-${instIndex}-cycle-${c}`}
                              className="text-center w-16 h-14 transition-colors duration-300 bg-gray-300 text-gray-600 font-semibold"
                              title="STALL"
                            >
                              STALL
                            </TableCell>
                          );
                        } else {
                          return (
                            <TableCell
                              key={`inst-${instIndex}-cycle-${c}`}
                              className="text-center w-16 h-14 transition-colors duration-300 bg-background"
                            />
                          );
                        }
                      }

                      // Para instrucciones normales
                      const cellClass = shouldAnimate
                        ? 'bg-accent text-accent-foreground animate-pulse-bg'
                        : shouldHighlightStatically
                        ? 'bg-accent text-accent-foreground'
                        : isPastStage
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-background';

                      return (
                        <TableCell
                          key={`inst-${instIndex}-cycle-${c}`}
                          className={cn(
                            'text-center w-16 h-14 transition-colors duration-300',
                            cellClass,
                            isForwardSource && 'border-b-4 border-yellow-500',
                            isForwardTarget && 'border-t-4 border-green-500'
                          )}
                          title={
                            isForwardSource
                              ? `Forward source (reg $${forwardInfo?.reg})`
                              : isForwardTarget
                              ? `Forward target (reg $${forwardInfo?.reg})`
                              : ''
                          }
                        >
                          {currentStageData && (
                            <div className="flex flex-col items-center justify-center relative">
                              <currentStageData.icon
                                className="w-4 h-4 mb-1"
                                aria-hidden="true"
                              />
                              <span className="text-xs">{currentStageData.name}</span>
                              {isForwardSource && (
                                <span
                                  className="absolute right-1 top-1 text-yellow-600 text-lg font-bold"
                                  title={`Forward source (reg $${forwardInfo?.reg})`}
                                >
                                  ↘
                                </span>
                              )}
                              {isForwardTarget && (
                                <span
                                  className="absolute left-1 bottom-1 text-green-600 text-lg font-bold"
                                  title={`Forward target (reg $${forwardInfo?.reg})`}
                                >
                                  ↖
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
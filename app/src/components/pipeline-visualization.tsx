'use client';

import * as React from 'react';
// ... (importaciones)
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableCaption,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Download, Code2, Cpu, MemoryStick, CheckSquare, LucideProps,
  AlertTriangle, Zap, ThumbsUp, ThumbsDown, GitBranch, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';
import { Badge } from '@/components/ui/badge';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';

type StageNameUnion = "IF" | "ID" | "EX" | "MEM" | "WB";
type IconComponentType = ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>;

const STAGE_ICONS: Readonly<Record<StageNameUnion, IconComponentType>> = {
  IF: Download, ID: Code2, EX: Cpu, MEM: MemoryStick, WB: CheckSquare,
};
const STAGES_ARRAY = Object.keys(STAGE_ICONS) as StageNameUnion[]; // Para obtener índice por nombre

type CellDisplayType = 'current' | 'completed' | 'stall' | 'forwarding' | 'branch-hit' | 'branch-miss' | 'flushed' | 'empty';

const CELL_STYLE_MAP: Readonly<Record<CellDisplayType, string>> = {
  current: 'bg-primary text-primary-foreground',
  completed: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 opacity-80',
  stall: 'bg-red-500 text-white',
  forwarding: 'bg-green-500 text-white',
  'branch-hit': 'bg-sky-500 text-white',
  'branch-miss': 'bg-amber-500 text-white',
  flushed: 'bg-gray-400 dark:bg-gray-600 text-gray-100 dark:text-gray-300',
  empty: 'bg-background',
};

interface CellRenderState {
  displayType: CellDisplayType;
  stageName: StageNameUnion | null;
  icon?: IconComponentType;
  isPulsing: boolean;
  // hazardInfo?: any;
}

export function PipelineVisualization() {
  const {
    instructions, currentCycle, maxCycles: contextMaxCyclesFromCtx, isRunning, instructionStages,
    isFinished, hazards, forwardings, stalls, registerUsage, stallsEnabled,
    forwardingEnabled, branchPredictionMode, currentDataStallCycles,
    branchMispredictActiveStallCycles,
  } = useSimulationState();

  // Usar el maxCycles del contexto si está disponible y es mayor, sino calcularlo
  const finalMaxCycles = React.useMemo(() => {
    if (instructions.length === 0) return 0;
    let calculatedMax = 0;
    // El cálculo de maxCycles en el contexto debería ser la fuente de verdad si es preciso
    // Si no, el cálculo local es un fallback
    if (contextMaxCyclesFromCtx && contextMaxCyclesFromCtx > 0) {
        calculatedMax = contextMaxCyclesFromCtx;
    } else {
        // Fallback a un cálculo local si el contexto no lo provee bien
        const numStages = STAGES_ARRAY.length;
        for (let i = 0; i < instructions.length; i++) {
            let entryCycleToIF = i + 1;
            for (let k = 0; k < i; k++) {
                entryCycleToIF += (stalls[k] || 0) + (hazards[k]?.type === 'Control' ? hazards[k].stallCycles : 0);
            }
            let completionCycleForI = entryCycleToIF + (numStages - 1);
            if (stallsEnabled && stalls[i] && (hazards[i]?.type === 'RAW' || hazards[i]?.type === 'WAW')) {
                completionCycleForI += stalls[i];
            }
            if (completionCycleForI > calculatedMax) calculatedMax = completionCycleForI;
        }
    }
    // Asegurar que mostramos al menos hasta el ciclo actual si la simulación no ha terminado
    // o si el cálculo es menor por alguna razón.
    return Math.max(calculatedMax, currentCycle, instructions.length > 0 ? STAGES_ARRAY.length : 0);
  }, [instructions, stalls, hazards, stallsEnabled, currentCycle, contextMaxCyclesFromCtx]);


  const totalCyclesToDisplay = finalMaxCycles;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);
  const branchMissCount = Object.values(hazards).filter(h => h?.type === 'Control').length; // Añadir '?' por si hazards[i] es undefined

  const getCellStateForDisplay = (instIndex: number, displayCycleNum: number): CellRenderState => {
    const regUsageInfo = registerUsage[instIndex];
    const hazardInfo = hazards[instIndex]; // Hazard de esta instrucción
    // Para ciclos pasados, necesitamos saber la etapa en la que *estaba* la instrucción.
    // `instructionStages` solo nos da el estado del *currentCycle* del contexto.
    // Esta es la limitación principal.
    // La reconstrucción aquí será una aproximación.

    let displayType: CellDisplayType = 'empty';
    let cellStageName: StageNameUnion | null = null;
    let cellIcon: IconComponentType | undefined = undefined;
    const isPulsing = isRunning && !isFinished && displayCycleNum === currentCycle;

    // 1. Reconstruir la etapa teórica de `instIndex` en `displayCycleNum`
    let theoreticalStageName: StageNameUnion | null = null;
    let isDataStallActiveForThisInstHere = false;
    let isFlushedThisCycle = false;

    if (instructions.length > 0 && instIndex < instructions.length) {
        let entryCycleToIF = instIndex + 1;
        for (let k = 0; k < instIndex; k++) {
            entryCycleToIF += (stalls[k] || 0) + (hazards[k]?.type === 'Control' ? hazards[k].stallCycles : 0);
        }

        for (let k = 0; k < instIndex; k++) { /* ... lógica de isFlushedThisCycle ... */
            const prevBranchHazard = hazards[k]; const prevRegUsage = registerUsage[k];
            if (prevBranchHazard?.type === 'Control' && prevRegUsage?.isConditionalBranch) {
                let prevBranchEXResCycle = k + 1 + STAGES_ARRAY.indexOf('EX') +
                    Array.from({length: k}).reduce((acc, _, prev_k_idx) => acc + (stalls[prev_k_idx] || 0) + (hazards[prev_k_idx]?.type === 'Control' ? hazards[prev_k_idx].stallCycles : 0), 0) +
                    (stalls[k] || 0);
                if (displayCycleNum > prevBranchEXResCycle && displayCycleNum <= prevBranchEXResCycle + prevBranchHazard.stallCycles) {
                    isFlushedThisCycle = true; break;
                }
            }
        }
        
        if (!isFlushedThisCycle) {
            const dataStallsByThisInst = (stallsEnabled && stalls[instIndex] && (hazardInfo?.type === 'RAW' || hazardInfo?.type === 'WAW')) ? stalls[instIndex] : 0;
            const idStageIdx = STAGES_ARRAY.indexOf('ID');
            const cycleWhenEnteringID = entryCycleToIF + idStageIdx;

            if (dataStallsByThisInst > 0 && displayCycleNum > cycleWhenEnteringID && displayCycleNum <= cycleWhenEnteringID + dataStallsByThisInst) {
                isDataStallActiveForThisInstHere = true;
                theoreticalStageName = 'ID';
            } else {
                let stageIdxInDisplayCycle = displayCycleNum - entryCycleToIF;
                if (displayCycleNum > cycleWhenEnteringID + dataStallsByThisInst) {
                    stageIdxInDisplayCycle -= dataStallsByThisInst;
                }
                if (stageIdxInDisplayCycle >= 0 && stageIdxInDisplayCycle < STAGES_ARRAY.length) {
                    theoreticalStageName = STAGES_ARRAY[stageIdxInDisplayCycle];
                }
            }
        }
    }

    // Aplicar estado basado en la reconstrucción y el ciclo actual
    if (isFlushedThisCycle) {
        displayType = 'flushed';
        cellIcon = XCircle;
    } else if (theoreticalStageName) {
        cellStageName = theoreticalStageName;
        cellIcon = STAGE_ICONS[theoreticalStageName];

        if (displayCycleNum === currentCycle) { // CICLO ACTUAL Y ACTIVO
            displayType = 'current'; // Etapa activa normal
            if (regUsageInfo?.isConditionalBranch && theoreticalStageName === 'EX') {
                displayType = hazardInfo?.type === 'Control' ? 'branch-miss' : 'branch-hit';
                cellIcon = hazardInfo?.type === 'Control' ? ThumbsDown : ThumbsUp;
            } else if (isDataStallActiveForThisInstHere && theoreticalStageName === 'ID') {
                displayType = 'stall';
                cellIcon = AlertTriangle;
            } else if (forwardings[instIndex]?.some(f => f.toStage === theoreticalStageName) && theoreticalStageName === 'EX') {
                displayType = 'forwarding';
            }
        } else if (displayCycleNum < currentCycle) { // CICLOS PASADOS
            if (isDataStallActiveForThisInstHere && theoreticalStageName === 'ID') {
                displayType = 'stall'; // Un stall que ocurrió en el pasado
                cellIcon = AlertTriangle;
            } else {
                 // MODIFICACIÓN: Mostrar forwarding/hit/miss para ciclos pasados también
                if (regUsageInfo?.isConditionalBranch && theoreticalStageName === 'EX') {
                    displayType = hazardInfo?.type === 'Control' ? 'branch-miss' : 'completed'; // O 'branch-miss' si quieres el color crítico
                    // Si fue miss, el color crítico podría tener más sentido que 'completed'
                    // cellIcon = hazardInfo?.type === 'Control' ? ThumbsDown : STAGE_ICONS.EX;
                    if (hazardInfo?.type === 'Control') cellIcon = ThumbsDown; else cellIcon = ThumbsUp; // Mostrar resultado
                } else if (forwardings[instIndex]?.some(f => f.toStage === theoreticalStageName) && theoreticalStageName === 'EX') {
                    displayType = 'forwarding'; // Forwarding que ocurrió en el pasado
                } else {
                    displayType = 'completed';
                }
            }
        } else { // CICLOS FUTUROS (displayCycleNum > currentCycle)
            displayType = 'empty'; // Dejar vacío para el futuro por ahora
            cellStageName = null;
            cellIcon = undefined;
        }
    } else { // Si no hay theoreticalStageName y no fue flusheada
        displayType = 'empty';
    }
    
    // El `instructionStages` del contexto es la verdad absoluta para el `currentCycle`
    // Sobrescribir si `displayCycleNum === currentCycle` y el contexto tiene una etapa diferente (raro con la simplificación)
    if (displayCycleNum === currentCycle) {
        const stageFromContext = instructionStages[instIndex] as StageNameUnion | null;
        if (stageFromContext && stageFromContext !== cellStageName) { // Si el contexto tiene algo y es diferente
            // Esto podría indicar un problema en la reconstrucción si el contexto es correcto.
            // Por ahora, confiamos en la reconstrucción para la lógica de visualización,
            // pero si el contexto es la fuente de verdad para el ciclo actual:
            // cellStageName = stageFromContext;
            // cellIcon = STAGE_ICONS[stageFromContext];
            // displayType = 'current'; // Resetear displayType a 'current' y re-evaluar casos críticos
            // ... (re-evaluar branch/stall/forwarding basado en stageFromContext) ...
        } else if (!stageFromContext && cellStageName) {
            // La reconstrucción dice que hay etapa, pero el contexto dice que no.
            // Esto significa que la instrucción ya salió o fue flusheada ANTES de este ciclo.
            displayType = 'empty';
            cellStageName = null;
            cellIcon = undefined;
        }
    }


    return { displayType, stageName: cellStageName, icon: cellIcon, isPulsing: isPulsing && displayType !== 'empty' && displayType !== 'completed' && displayType !== 'flushed' };
  };

  // ... (resto del componente JSX)
  // En el renderizado de TableCell, usar cell.displayType para obtener la clase de CELL_STYLE_MAP
  // y cell.icon, cell.stageName para el contenido.
  // Ejemplo:
  // const cellStyle = CELL_STYLE_MAP[cell.displayType];
  // const IconToRender = cell.icon;
  // ...


  return (
    <Card className='w-full overflow-hidden'>
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
        <CardDescription className="flex items-center gap-2 pt-1">
          {branchPredictionMode !== 'none' && (
            <> <GitBranch className="w-4 h-4 text-muted-foreground" /> <span className="text-xs text-muted-foreground">Branch Prediction: {branchPredictionMode}</span>
              {branchMissCount > 0 && (<Badge variant="destructive" className="ml-auto text-xs"> {branchMissCount} Misses </Badge>)} </>
          )}
          {!stallsEnabled && <span className='ml-2 text-xs font-normal text-muted-foreground'>(Ideal Pipeline)</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto pb-4'>
          <Table className='min-w-max'>
            <TableCaption className="mt-4">
              MIPS pipeline visualization. Cycle: {currentCycle}
              {isFinished && " (Finished)"}. Total cycles displayed: {totalCyclesToDisplay}.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[150px] min-w-[150px] sticky left-0 bg-card z-20 border-r'>Inst (Hex)</TableHead>
                <TableHead className='w-[80px] min-w-[80px] sticky left-[150px] bg-card z-20 border-r'>Type</TableHead>
                <TableHead className='w-[250px] min-w-[250px] sticky left-[230px] bg-card z-20 border-r'>Info</TableHead>
                {cycleNumbers.map((c) => (<TableHead key={`cycle-${c}`} className='text-center min-w-[4.5rem] w-18'>{c}</TableHead>))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => {
                const regUsageInfo = registerUsage[instIndex];
                const hazardInfo = hazards[instIndex];
                const dataStallCount = (stallsEnabled && stalls[instIndex] && (hazardInfo?.type === 'RAW' || hazardInfo?.type === 'WAW')) ? stalls[instIndex] : 0;
                return (
                  <TableRow key={`inst-${instIndex}`} className='h-20'>
                    <TableCell className='font-mono text-xs sticky left-0 bg-card z-10 border-r'>{`I${instIndex}: ${inst}`}</TableCell>
                    <TableCell className='sticky left-[150px] bg-card z-10 border-r text-xs'>
                      {regUsageInfo && (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">{regUsageInfo.type}</Badge>
                          {regUsageInfo.isLoad && <Badge variant="outline" className="bg-purple-100 border-purple-300 text-purple-700 text-[10px] px-1.5 py-0.5">LOAD</Badge>}
                          {regUsageInfo.isStore && <Badge variant="outline" className="bg-orange-100 border-orange-300 text-orange-700 text-[10px] px-1.5 py-0.5">STORE</Badge>}
                          {regUsageInfo.isBranch && <Badge variant="outline" className="bg-sky-100 border-sky-300 text-sky-700 text-[10px] px-1.5 py-0.5">BRANCH</Badge>}
                          {regUsageInfo.isJump && <Badge variant="outline" className="bg-lime-100 border-lime-300 text-lime-700 text-[10px] px-1.5 py-0.5">JUMP</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className='sticky left-[230px] bg-card z-10 border-r text-xs'>
                      {stallsEnabled && hazardInfo && hazardInfo.type !== 'NONE' && (
                        <div className='flex flex-col gap-1 items-start max-w-[230px] overflow-hidden'>
                          <div className='flex items-center gap-1 flex-wrap'>
                            <Badge className={cn('px-1.5 py-0.5 text-[10px]', hazardInfo.type === 'RAW' && 'border-red-500 bg-red-100 text-red-700', hazardInfo.type === 'WAW' && 'border-yellow-500 bg-yellow-100 text-yellow-700', hazardInfo.type === 'Control' && 'border-amber-500 bg-amber-100 text-amber-700')}>{hazardInfo.type}</Badge>
                            {hazardInfo.type !== 'Control' && forwardings[instIndex]?.length > 0 && (<Badge className='px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 border-green-500'>FORWARD</Badge>)}
                            {dataStallCount > 0 && (hazardInfo.type === 'RAW' || hazardInfo.type === 'WAW') && (<Badge className='px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 border-red-500'>DATA STALL ({dataStallCount})</Badge>)}
                            {hazardInfo.type === 'Control' && hazardInfo.stallCycles > 0 && (<Badge className='px-1.5 py-0.5 text-[10px] bg-yellow-100 text-yellow-700 border-yellow-500'>MISPREDICT ({hazardInfo.stallCycles} stall)</Badge>)}
                          </div>
                          <p className="text-muted-foreground text-[10px] leading-tight whitespace-normal break-words">{hazardInfo.description}</p>
                          {hazardInfo.type !== 'Control' && forwardings[instIndex]?.map((fw, idx) => (<span key={idx} className='text-[10px] border px-1 py-0 bg-gray-100 rounded-sm whitespace-nowrap'>{fw.fromStage}(I{fw.from}){fw.register}→{fw.toStage}</span>))}
                        </div>
                      )}
                      {!stallsEnabled && <p className="text-muted-foreground text-[10px]">Ideal Pipeline</p>}
                    </TableCell>

                    {cycleNumbers.map((c) => {
                      const cell = getCellStateForDisplay(instIndex, c);
                      let cellContentNode: JSX.Element | string = '';
                      let animationClass = '';

                      if (cell.isPulsing) animationClass = 'animate-pulse-bg';

                      const cellStyle = CELL_STYLE_MAP[cell.displayType]; // Usar displayType para el estilo
                      const IconToRender = cell.icon;

                      if (IconToRender && cell.stageName) {
                        cellContentNode = (
                          <div className='flex flex-col items-center justify-center h-full'>
                            <IconToRender className={cn('w-4 h-4 mb-0.5', (cell.displayType === 'branch-hit' || cell.displayType === 'branch-miss') && 'w-5 h-5')} />
                            <span className='text-[10px] leading-none'>{cell.stageName}</span>
                            {cell.displayType === 'forwarding' && <Zap className='w-3 h-3 text-white absolute top-1 right-1' />}
                          </div>
                        );
                      } else if (cell.displayType === 'stall' && IconToRender) {
                        cellContentNode = (
                          <div className='flex flex-col items-center justify-center h-full'>
                            <IconToRender className='w-4 h-4 mb-0.5' />
                            <span className='text-[10px] leading-none text-inherit'>STALL</span>
                          </div>
                        );
                      } else if (cell.displayType === 'flushed' && IconToRender) {
                        cellContentNode = (
                          <div className='flex flex-col items-center justify-center h-full'>
                            <IconToRender className='w-4 h-4 mb-0.5 opacity-70' />
                            <span className='text-[10px] leading-none opacity-70'>FLUSH</span>
                          </div>
                        );
                      }

                      return (
                        <TableCell
                          key={`inst-${instIndex}-cycle-${c}`}
                          className={cn(
                            'text-center w-18 min-w-[4.5rem] h-14 transition-colors duration-100 relative',
                            cellStyle, // Aplicar el estilo calculado
                            animationClass,
                            (cell.isPulsing) ? 'ring-2 ring-offset-1 ring-primary dark:ring-offset-background' : ''
                          )}
                        >
                          {cellContentNode}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {/* Leyenda Actualizada */}
        <div className='flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs items-center'>
          <span className='font-semibold'>Legend:</span>
          <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP.current.split(' ')[0])}></div>Current</div>
          <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP.completed.split(' ')[0])}></div>Completed</div>
          {stallsEnabled && (
            <>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP.stall.split(' ')[0])}></div>Data Stall</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP.forwarding.split(' ')[0])}></div>Forwarding</div>
            </>
          )}
          {branchPredictionMode !== 'none' && (
            <>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP["branch-hit"].split(' ')[0])}></div>Branch Hit</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP["branch-miss"].split(' ')[0])}></div>Branch Miss</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_STYLE_MAP.flushed.split(' ')[0])}></div>Flush</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
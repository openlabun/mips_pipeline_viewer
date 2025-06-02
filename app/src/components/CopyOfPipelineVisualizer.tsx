'use client';

import type * as React from 'react';
// ... (tus importaciones existentes) ...
import { useSimulationState, type HazardType } from '@/context/SimulationContext';
// ... (resto de tus importaciones) ...
import {
  Download, Code2, Cpu, MemoryStick, CheckSquare,
  AlertTriangle, Zap, ThumbsUp, ThumbsDown, GitBranch, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableCaption } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';


const STAGES = [
  { name: 'IF', icon: Download, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' },
  { name: 'ID', icon: Code2, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  { name: 'EX', icon: Cpu, color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' },
  { name: 'MEM', icon: MemoryStick, color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' },
  { name: 'WB', icon: CheckSquare, color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400' },
] as const;

const CELL_COLORS = {
  stall: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  mispredictStall: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  forwarding: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  branchHit: 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
  branchMiss: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  flushed: 'bg-gray-200 dark:bg-gray-700/30 text-gray-500 dark:text-gray-400', // Para NOPs/Flushed
  empty: 'bg-background',
};

// ... (CellState interface como la tenías, puede que necesitemos añadir 'flushed') ...
interface CellState {
  type: 'normal' | 'stall' | 'mispredictStall' | 'forwarding' | 'branch-hit' | 'branch-miss' | 'empty' | 'flushed';
  stage: (typeof STAGES)[number] | null;
  isCurrentCell: boolean;
  forwardingInfo?: any[];
  hazardInfo?: any;
}


export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle,
    maxCycles: contextMaxCycles, // Renombrar para evitar confusión
    isRunning,
    instructionStages, // Este es el estado de las etapas en el `currentCycle`
    isFinished,
    hazards,
    forwardings,
    stalls,
    registerUsage,
    stallsEnabled,
    forwardingEnabled,
    branchPredictionMode,
    // Necesitaremos una forma de saber el historial de etapas o reconstruirlo
    // O que el contexto provea una matriz `stageHistory[instIndex][cycleNum] = stageName | null | 'stall' | 'flushed'`
  } = useSimulationState();

  // 1. CÁLCULO MEJORADO DE totalCyclesToDisplay
  const calculateTotalPipelineCycles = () => {
    if (instructions.length === 0) return 0;

    let maxCompletionCycle = 0;

    for (let i = 0; i < instructions.length; i++) {
      // Ciclo en que la instrucción i entra a IF
      let entryCycleToIF = i + 1; // Base

      // Sumar stalls de datos de instrucciones anteriores
      for (let k = 0; k < i; k++) {
        if (stallsEnabled && stalls[k] && (hazards[k]?.type === 'RAW' || hazards[k]?.type === 'WAW')) {
          entryCycleToIF += stalls[k];
        }
      }
      // Sumar stalls de control (mispredict) de instrucciones anteriores
      // Esta es una simplificación, ya que un mispredict afecta el *fetch* de las siguientes.
      // Una forma más precisa sería que el `SimulationContext` calcule el `maxCycles` correctamente.
      for (let k = 0; k < i; k++) {
        if (hazards[k]?.type === 'Control') {
          entryCycleToIF += hazards[k].stallCycles;
        }
      }
      
      // Ciclo en que la instrucción i termina WB
      let completionCycleForI = entryCycleToIF + (STAGES.length - 1);
      // Añadir stalls causados POR la propia instrucción i (para datos)
      if (stallsEnabled && stalls[i] && (hazards[i]?.type === 'RAW' || hazards[i]?.type === 'WAW')) {
        completionCycleForI += stalls[i];
      }
      // Si la propia instrucción i es un branch que falla, sus propios stalls de control ya están en hazards[i].stallCycles
      // y afectarían a las siguientes, pero el ciclo de finalización de esta no cambia por su propio mispredict stall.

      if (completionCycleForI > maxCompletionCycle) {
        maxCompletionCycle = completionCycleForI;
      }
    }
    // Si el contexto ya provee un maxCycles preciso, usarlo.
    if (contextMaxCycles > 0 && contextMaxCycles >= maxCompletionCycle) {
        return contextMaxCycles;
    }
    return Math.max(maxCompletionCycle, instructions.length > 0 ? STAGES.length : 0, cycle); // Asegurar al menos el ciclo actual o la profundidad del pipeline
  };

  const totalCyclesToDisplay = calculateTotalPipelineCycles();
  const cycleNumbers = Array.from(
    { length: totalCyclesToDisplay },
    (_, i) => i + 1
  );

  const branchMissCount = Object.values(hazards).filter(h => h.type === 'Control').length;

  // 2. LÓGICA DE getCellState MEJORADA (INTENTO DE RECONSTRUCCIÓN)
  // Esta función es la más crítica y compleja para la visualización histórica.
  // Lo ideal sería que `SimulationContext` proveyera un historial.
  const getCellStateForCycle = (instIndex: number, targetCycleNum: number): CellState => {
    const regUsageInfo = registerUsage[instIndex];
    const hazardInfo = hazards[instIndex]; // Hazard de esta instrucción
    const dataStallsByThisInst = (stallsEnabled && stalls[instIndex] && (hazardInfo?.type === 'RAW' || hazardInfo?.type === 'WAW')) ? stalls[instIndex] : 0;

    // Determinar si la instrucción `instIndex` está activa en `targetCycleNum` y en qué etapa.

    // Ciclo de entrada a IF para `instIndex`, considerando stalls *anteriores*
    let entryCycleToIF = instIndex + 1;
    for (let k = 0; k < instIndex; k++) {
      if (stallsEnabled && stalls[k] && (hazards[k]?.type === 'RAW' || hazards[k]?.type === 'WAW')) {
        entryCycleToIF += stalls[k];
      }
      if (hazards[k]?.type === 'Control') {
        // Un mispredict de una instrucción anterior k retrasa el fetch de las siguientes
        entryCycleToIF += hazards[k].stallCycles;
      }
    }
    
    // ¿En qué etapa estaría la instrucción `instIndex` en `targetCycleNum`?
    let stageIdxInTargetCycle = targetCycleNum - entryCycleToIF;

    // Aplicar stalls causados por la *propia* instrucción `instIndex` (data stalls)
    // Estos stalls ocurren *después* de que la instrucción entra a ID, antes de EX.
    // Si targetCycleNum es > (entryCycleToIF + 1 (para ID)) y < (entryCycleToIF + 1 + dataStallsByThisInst)
    // entonces es un data stall causado por esta instrucción.
    const idExitCycle = entryCycleToIF + 1; // Sale de ID (o entra a EX sin stall)
    if (dataStallsByThisInst > 0 && targetCycleNum > idExitCycle && targetCycleNum <= idExitCycle + dataStallsByThisInst) {
      // Esta instrucción está causando un data stall en este `targetCycleNum`
      // Ella misma estaría "congelada" en ID o justo antes de EX
      const stageBeforeStall = STAGES.find(s => s.name === "ID"); // O la etapa que se stallea
      return { type: 'stall', stage: stageBeforeStall, isCurrentCell: targetCycleNum === cycle, hazardInfo };
    }
    // Ajustar stageIdxInTargetCycle si ya pasamos los data stalls de esta instrucción
    if (targetCycleNum > idExitCycle + dataStallsByThisInst) {
        stageIdxInTargetCycle -= dataStallsByThisInst;
    }


    // ---- Lógica para celdas de control (Branch Miss/Hit/Flush) ----
    // Esto ocurre si la instrucción ANTERIOR (k) fue un branch que falló y `instIndex` > k
    // y `targetCycleNum` cae dentro de los ciclos de penalización de ese branch k.
    for (let k = 0; k < instIndex; k++) {
        const prevBranchHazard = hazards[k];
        if (prevBranchHazard?.type === 'Control' && regUsage[k]?.isConditionalBranch) {
            // Ciclo en que el branch k se resuelve (EX)
            let prevBranchEXEntryCycle = k + 1;
            for(let prev_k=0; prev_k < k; prev_k++) { /* Sumar stalls anteriores a k */
                if(stallsEnabled && stalls[prev_k] && (hazards[prev_k]?.type==='RAW' || hazards[prev_k]?.type==='WAW')) prevBranchEXEntryCycle += stalls[prev_k];
                if(hazards[prev_k]?.type==='Control') prevBranchEXEntryCycle += hazards[prev_k].stallCycles;
            }
            prevBranchEXEntryCycle += 1; // para ID
            const stallsByK = (stallsEnabled && stalls[k] && (hazards[k]?.type==='RAW' || hazards[k]?.type==='WAW')) ? stalls[k] : 0;
            prevBranchEXEntryCycle += stallsByK; // para EX (después de sus propios data stalls)
            prevBranchEXEntryCycle += 1; // Llegada a EX

            const mispredictStallStartCycle = prevBranchEXEntryCycle + 1; // Stall empieza después de que EX detecta
            const mispredictStallEndCycle = mispredictStallStartCycle + prevBranchHazard.stallCycles -1;

            if (targetCycleNum >= mispredictStallStartCycle && targetCycleNum <= mispredictStallEndCycle) {
                // Esta instrucción (instIndex) está siendo flusheada/stallada por el mispredict de la instrucción k
                return { type: 'flushed', stage: null, isCurrentCell: targetCycleNum === cycle, hazardInfo: prevBranchHazard };
            }
        }
    }


    if (stageIdxInTargetCycle < 0 || stageIdxInTargetCycle >= STAGES.length) {
      return { type: 'empty', stage: null, isCurrentCell: false };
    }

    const stageData = STAGES[stageIdxInTargetCycle];
    const isCurrentCell = targetCycleNum === cycle;

    // Branch Hit/Miss para la *propia* instrucción `instIndex` si está en EX
    if (regUsageInfo?.isConditionalBranch && stageData.name === 'EX') {
      if (hazardInfo?.type === 'Control') { // Este hazard es de ESTA instrucción
        return { type: 'branch-miss', stage: stageData, isCurrentCell, hazardInfo };
      } else {
        return { type: 'branch-hit', stage: stageData, isCurrentCell };
      }
    }

    // Forwarding
    const { isForwarding, details: fwdDetails } = getForwardingInfoForCell(instIndex, stageData.name);
    if (isForwarding && stageData.name === "EX") { // Típicamente forwarding a EX
      return { type: 'forwarding', stage: stageData, isCurrentCell, forwardingInfo: fwdDetails };
    }

    return { type: 'normal', stage: stageData, isCurrentCell };
  };


  return (
    <Card className='w-full overflow-hidden'>
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
        <CardDescription className="flex items-center gap-2 pt-1">
            {branchPredictionMode !== 'none' && (
                <>
                    <GitBranch className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Branch Prediction: {branchPredictionMode}</span>
                    {branchMissCount > 0 && (
                        <Badge variant="destructive" className="ml-auto text-xs">
                            {branchMissCount} Misses
                        </Badge>
                    )}
                </>
            )}
            {!stallsEnabled && <span className='ml-2 text-xs font-normal text-muted-foreground'>(Ideal Pipeline)</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto pb-4'> {/* Añadir padding-bottom para scrollbar */}
          <Table className='min-w-[calc(var(--min-col-width)*10)]'> {/* Ejemplo de min-width */}
            <TableCaption className="mt-4">
              MIPS pipeline visualization. Cycle: {cycle}
              {isFinished && " (Finished)"}. Total cycles shown: {totalCyclesToDisplay}.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[150px] min-w-[150px] sticky left-0 bg-card z-20 border-r'>Inst (Hex)</TableHead>
                <TableHead className='w-[80px] min-w-[80px] sticky left-[150px] bg-card z-20 border-r'>Type</TableHead>
                <TableHead className='w-[250px] min-w-[250px] sticky left-[230px] bg-card z-20 border-r'>
                  Info
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className='text-center min-w-[4.5rem] w-18'> {/* Ajustar ancho */}
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => {
                const regUsageInfo = registerUsage[instIndex];
                const hazardInfo = hazards[instIndex];
                const dataStallCount = (stallsEnabled && stalls[instIndex] && (hazardInfo?.type === 'RAW' || hazardInfo?.type === 'WAW')) ? stalls[instIndex] : 0;

                return (
                  <TableRow key={`inst-${instIndex}`} className='h-20'>
                    <TableCell className='font-mono text-xs sticky left-0 bg-card z-10 border-r'>
                      {`I${instIndex}: ${inst}`}
                    </TableCell>
                    <TableCell className='sticky left-[150px] bg-card z-10 border-r text-xs'>
                      {/* ... (renderizado de badges de tipo como antes) ... */}
                       {regUsageInfo && (
                        <>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">{regUsageInfo.type}</Badge>
                          {regUsageInfo.isLoad && <Badge variant="outline" className="mt-1 bg-purple-100 border-purple-300 text-purple-700 text-[10px] px-1.5 py-0.5">LOAD</Badge>}
                          {regUsageInfo.isStore && <Badge variant="outline" className="mt-1 bg-orange-100 border-orange-300 text-orange-700 text-[10px] px-1.5 py-0.5">STORE</Badge>}
                          {regUsageInfo.isBranch && <Badge variant="outline" className="mt-1 bg-sky-100 border-sky-300 text-sky-700 text-[10px] px-1.5 py-0.5">BRANCH</Badge>}
                          {regUsageInfo.isJump && <Badge variant="outline" className="mt-1 bg-lime-100 border-lime-300 text-lime-700 text-[10px] px-1.5 py-0.5">JUMP</Badge>}
                        </>
                      )}
                    </TableCell>
                    <TableCell className='sticky left-[230px] bg-card z-10 border-r text-xs'>
                      {/* ... (renderizado de badges de hazard/forwarding/stall como antes, usando dataStallCount y hazardInfo) ... */}
                      {stallsEnabled && hazardInfo && hazardInfo.type !== 'NONE' && (
                        <div className='flex flex-col gap-1 items-start max-w-[230px] overflow-hidden'>
                          <div className='flex items-center gap-1 flex-wrap'>
                            <Badge className={cn('px-1.5 py-0.5 text-[10px]', hazardInfo.type==='RAW'&&'border-red-500 bg-red-100 text-red-700', hazardInfo.type==='WAW'&&'border-yellow-500 bg-yellow-100 text-yellow-700', hazardInfo.type==='Control'&&'border-amber-500 bg-amber-100 text-amber-700')}>{hazardInfo.type}</Badge>
                            {hazardInfo.type!=='Control' && forwardings[instIndex]?.length>0 && (<Badge className='px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 border-green-500'>FORWARD</Badge>)}
                            {dataStallCount>0 && (hazardInfo.type==='RAW'||hazardInfo.type==='WAW') && (<Badge className='px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 border-red-500'>DATA STALL ({dataStallCount})</Badge>)}
                            {hazardInfo.type==='Control' && hazardInfo.stallCycles>0 && (<Badge className='px-1.5 py-0.5 text-[10px] bg-yellow-100 text-yellow-700 border-yellow-500'>MISPREDICT ({hazardInfo.stallCycles} stall)</Badge>)}
                          </div>
                          <p className="text-muted-foreground text-[10px] leading-tight whitespace-normal break-words">{hazardInfo.description}</p>
                          {hazardInfo.type!=='Control' && forwardings[instIndex]?.map((fw,idx)=>(<span key={idx} className='text-[10px] border px-1 py-0 bg-gray-100 rounded-sm whitespace-nowrap'>{fw.fromStage}(I{fw.from}){fw.register}→{fw.toStage}</span>))}
                        </div>
                      )}
                       {!stallsEnabled && <p className="text-muted-foreground text-[10px]">Ideal Pipeline</p>}
                    </TableCell>

                    {cycleNumbers.map((c) => {
                      const cell = getCellStateForCycle(instIndex, c);
                      let cellContent: JSX.Element | string = '';
                      let cellStyleClass = cell.stage ? cell.stage.color : CELL_COLORS.empty;
                      let animationClass = '';

                      if (cell.isCurrentCell && isRunning && !isFinished) {
                        animationClass = 'animate-pulse-bg'; // Pulso genérico para la celda actual
                      }
                      
                      // Aplicar colores específicos de estado
                      if (cell.type === 'stall') cellStyleClass = CELL_COLORS.stall;
                      else if (cell.type === 'mispredictStall' || cell.type === 'flushed') cellStyleClass = CELL_COLORS.mispredictStall; // O CELL_COLORS.flushed
                      else if (cell.type === 'forwarding') cellStyleClass = CELL_COLORS.forwarding;
                      else if (cell.type === 'branch-hit') cellStyleClass = CELL_COLORS.branchHit;
                      else if (cell.type === 'branch-miss') cellStyleClass = CELL_COLORS.branchMiss;
                      else if (cell.type === 'empty') cellStyleClass = CELL_COLORS.empty;
                      // Si es 'normal', ya tiene el color de la etapa de `cell.stage.color`

                      if (cell.stage) {
                        let iconToUse = cell.stage.icon;
                        if (cell.type === 'branch-hit') iconToUse = ThumbsUp;
                        else if (cell.type === 'branch-miss') iconToUse = ThumbsDown;
                        
                        cellContent = (
                          <div className='flex flex-col items-center justify-center h-full'>
                            <iconToUse className={cn('w-4 h-4 mb-0.5', cell.type==='branch-hit' || cell.type==='branch-miss' ? 'w-5 h-5': '')} />
                            <span className='text-[10px] leading-none'>{cell.stage.name}</span>
                            {cell.type === 'forwarding' && <Zap className='w-3 h-3 text-green-500 absolute top-1 right-1' />}
                          </div>
                        );
                      } else if (cell.type === 'stall' || cell.type === 'mispredictStall') {
                        cellContent = (
                          <div className='flex flex-col items-center justify-center h-full'>
                            <AlertTriangle className='w-4 h-4 mb-0.5' />
                            <span className='text-[10px] leading-none'>STALL</span>
                          </div>
                        );
                      } else if (cell.type === 'flushed') {
                        cellContent = (
                           <div className='flex flex-col items-center justify-center h-full'>
                            <XCircle className='w-4 h-4 mb-0.5 opacity-60' />
                            <span className='text-[10px] leading-none opacity-60'>FLUSH</span>
                          </div>
                        );
                      }


                      return (
                        <TableCell
                          key={`inst-${instIndex}-cycle-${c}`}
                          className={cn(
                            'text-center w-18 min-w-[4.5rem] h-14 transition-colors duration-200 relative',
                            cellStyleClass,
                            animationClass,
                            cell.isCurrentCell && cell.type !=='empty' ? 'ring-2 ring-offset-1 ring-primary dark:ring-offset-background' : '' // Resaltar celda actual
                          )}
                        >
                          {cellContent}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* ... (Leyenda actualizada como la tenías o similar) ... */}
        <div className='flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs items-center'>
          <span className='font-semibold'>Legend:</span>
          {STAGES.map(s => ( <div key={s.name} className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', s.color.split(' ')[0])}></div>{s.name}</div> ))}
          {stallsEnabled && (
            <>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_COLORS.stall.split(' ')[0])}></div>Data Stall</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_COLORS.forwarding.split(' ')[0])}></div>Forwarding</div>
            </>
          )}
           {branchPredictionMode !== 'none' && (
            <>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_COLORS.branchHit.split(' ')[0])}></div>Branch Hit</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_COLORS.branchMiss.split(' ')[0])}></div>Branch Miss</div>
              <div className='flex items-center'><div className={cn('w-3 h-3 mr-1 rounded-sm', CELL_COLORS.flushed.split(' ')[0])}></div>Flush/Mispredict</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
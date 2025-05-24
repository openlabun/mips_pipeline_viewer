// src/components/pipeline-visualization.tsx
"use client";

import type * as React from "react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Download,
  Code2,
  Cpu,
  MemoryStick,
  CheckSquare,
  CornerDownLeft,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulationState } from "@/context/SimulationContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// Función para decodificar instrucciones para mostrar información del registro
function decodeRegisterInfo(hex: string): string {
  try {
    const instr = parseInt(hex, 16);
    const opcode = (instr >>> 26) & 0x3f;

    if (opcode === 0x00) {
      // Tipo R
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      const rd = (instr >>> 11) & 0x1f;
      return `rs:$${rs}, rt:$${rt}, rd:$${rd}`;
    } else if (opcode === 0x23) {
      // lw
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      return `rs:$${rs}, rt:$${rt} (destino)`;
    } else if (opcode === 0x2b) {
      // sw
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      return `rs:$${rs}, rt:$${rt} (datos)`;
    } else {
      // Otros I-type
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      return `rs:$${rs}, rt:$${rt} (destino)`;
    }
  } catch {
    return "";
  }
}

// Función para obtener una descripción amigable de la instrucción
function getInstructionDescription(hex: string): string {
  try {
    const instr = parseInt(hex, 16);
    const opcode = (instr >>> 26) & 0x3f;

    if (opcode === 0x00) {
      // Tipo R
      const funct = instr & 0x3f;
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      const rd = (instr >>> 11) & 0x1f;

      if (funct === 0x20) return `add $${rd}, $${rs}, $${rt}`;
      if (funct === 0x22) return `sub $${rd}, $${rs}, $${rt}`;
      return "Instrucción tipo R";
    } else if (opcode === 0x23) {
      // lw
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      const offset = instr & 0xffff;
      return `lw $${rt}, ${offset}($${rs})`;
    } else if (opcode === 0x2b) {
      // sw
      const rs = (instr >>> 21) & 0x1f;
      const rt = (instr >>> 16) & 0x1f;
      const offset = instr & 0xffff;
      return `sw $${rt}, ${offset}($${rs})`;
    }

    return "Instrucción MIPS";
  } catch {
    return "Instrucción desconocida";
  }
}

// Función auxiliar para detectar riesgos de datos
function hasDataHazard(prevHex: string, currHex: string): boolean {
  const decode = (hex: string) => {
    const instr = parseInt(hex, 16);
    const op = (instr >>> 26) & 0x3f;
    if (op === 0x00) {
      return {
        type: "R" as const,
        rs: (instr >>> 21) & 0x1f,
        rt: (instr >>> 16) & 0x1f,
        rd: (instr >>> 11) & 0x1f,
      };
    }
    return {
      type: "I" as const,
      op,
      rs: (instr >>> 21) & 0x1f,
      rt: (instr >>> 16) & 0x1f,
    };
  };

  const p = decode(prevHex);
  const c = decode(currHex);

  let prevDst: number | null = null;
  if (p.type === "R") prevDst = p.rd;
  else if (p.op === 0x23) prevDst = p.rt; // lw
  else if (p.op !== 0x2b) prevDst = p.rt; // I-tipo salvo sw

  const currSrc: number[] = [];
  if (c.type === "R") currSrc.push(c.rs, c.rt);
  else if (c.op === 0x23) currSrc.push(c.rs); // lw
  else if (c.op === 0x2b) currSrc.push(c.rs, c.rt); // sw
  else currSrc.push(c.rs);

  return prevDst !== null && currSrc.includes(prevDst);
}

// Función para detectar posibles forwardings
function detectForwarding(
  prevHex: string,
  currHex: string,
  prevStage: number,
  currStage: number,
  fromIdx: number,
  toIdx: number,
  cycle: number
) {
  if (currStage !== 2) return null; // Solo forwardear a EX
  if (prevStage !== 2 && prevStage !== 3) return null; // Solo desde EX o MEM

  const prev = decodeInstruction(prevHex);
  const curr = decodeInstruction(currHex);

  // Destino de la instrucción anterior
  let prevDest: number | null = null;
  if (prev.type === "R") prevDest = prev.rd;
  else if (prev.opcode === 0x23) prevDest = prev.rt; // lw
  else if (prev.opcode !== 0x2b) prevDest = prev.rt; // I-tipo con destino

  if (prevDest === null) return null;

  // Ver qué registro necesita forwarding
  let targetReg: "rs" | "rt" | null = null;
  
  if (curr.rs === prevDest) {
    targetReg = "rs";
  } else if ((curr.type === "R" || curr.opcode === 0x2b) && curr.rt === prevDest) {
    targetReg = "rt";
  } else {
    return null; // No hay necesidad de forwarding
  }

  // Caso especial: no forwardear desde EX para operaciones lw
  if (prev.opcode === 0x23 && prevStage === 2) {
    return null;
  }

  return {
    from: fromIdx,
    to: toIdx,
    source: prevStage === 2 ? "EX" : "MEM",
    target: targetReg,
    cycle
  };
}

// Función para decodificar la instrucción
function decodeInstruction(hex: string) {
  const instr = parseInt(hex, 16);
  const opcode = (instr >>> 26) & 0x3f;

  if (opcode === 0x00) {
    return {
      type: "R" as const,
      opcode,
      rs: (instr >>> 21) & 0x1f,
      rt: (instr >>> 16) & 0x1f,
      rd: (instr >>> 11) & 0x1f,
    };
  }
  return {
    type: "I" as const,
    opcode,
    rs: (instr >>> 21) & 0x1f,
    rt: (instr >>> 16) & 0x1f,
  };
}

const STAGES = [
  { name: "IF", icon: Download, description: "Búsqueda de instrucción" },
  { name: "ID", icon: Code2, description: "Decodificación de instrucción" },
  { name: "EX", icon: Cpu, description: "Ejecución" },
  { name: "MEM", icon: MemoryStick, description: "Acceso a memoria" },
  { name: "WB", icon: CheckSquare, description: "Escritura de resultados" },
] as const;

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle: cycle,
    maxCycles,
    isRunning,
    instructionStages,
    isFinished,
    mode,
    forwardingPaths,
  } = useSimulationState();

  const [showHelp, setShowHelp] = useState(false);

  const totalCycles = Math.max(maxCycles, 0);
  const cycleNums = Array.from({ length: totalCycles }, (_, i) => i + 1);

  // Función de detección de stalls
  const stalls = instructions.map((_, i) => {
    if (
      mode !== "stall" ||
      i === 0 ||
      isFinished ||
      instructionStages[i] !== 1 || // curr en ID
      instructionStages[i - 1] !== 2 // prev en EX
    )
      return null;

    return hasDataHazard(instructions[i - 1], instructions[i]) ? i : null;
  });

  const stallDetected = stalls.some((s) => s !== null);

  // Obtener forwarding activos para el ciclo actual desde el estado
  const savedForwardings = forwardingPaths.filter((fw) => fw.cycle === cycle);
  
  // Función para detectar posibles forwardings en el ciclo actual
  // cuando navegamos con flechas
  const detectDynamicForwardings = () => {
    if (mode !== "forwarding" || isFinished) return [];
    
    const detected = [];
    
    for (let i = 1; i < instructions.length; i++) {
      const currStage = instructionStages[i];
      
      if (currStage === 2) { // La instrucción está en etapa EX
        for (let j = 0; j < i; j++) {
          const prevStage = instructionStages[j];
          
          if ((prevStage === 2 || prevStage === 3) && 
              hasDataHazard(instructions[j], instructions[i])) {
            
            const fwInfo = detectForwarding(
              instructions[j],
              instructions[i],
              prevStage,
              currStage,
              j,
              i,
              cycle
            );
            
            if (fwInfo) {
              detected.push(fwInfo);
            }
          }
        }
      }
    }
    
    return detected;
  };
  
  // Combinamos forwardings guardados con los detectados dinámicamente
  const currentForwardings = savedForwardings.length > 0 
    ? savedForwardings 
    : detectDynamicForwardings();
    
  const hasForwarding = currentForwardings.length > 0;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Visualización del Pipeline</CardTitle>
          <CardDescription>
            Diagrama que muestra cómo fluyen las instrucciones por las etapas
            del pipeline
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHelp(!showHelp)}
        >
          {showHelp ? "Ocultar ayuda" : "Mostrar ayuda"}
        </Button>
      </CardHeader>
      <CardContent>
        {showHelp && (
          <div className="mb-6 p-4 bg-muted/50 rounded-md">
            <h3 className="font-medium mb-2">Guía de visualización:</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-1 text-sm">
                  Etapas del pipeline:
                </h4>
                <ul className="space-y-1">
                  {STAGES.map((stage, i) => (
                    <li key={i} className="flex items-center text-sm">
                      <stage.icon className="w-4 h-4 mr-1" />
                      <span className="font-mono mr-1">
                        {stage.name}
                      </span> - {stage.description}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium mb-1 text-sm">Colores:</h4>
                <ul className="space-y-2">
                  <li className="flex items-center text-sm">
                    <div className="w-4 h-4 bg-yellow-200 mr-2"></div>
                    <span>Amarillo - Stall (detención)</span>
                  </li>
                  <li className="flex items-center text-sm">
                    <div className="w-4 h-4 bg-green-200 mr-2"></div>
                    <span>Verde - Recibe forwarding</span>
                  </li>
                  <li className="flex items-center text-sm">
                    <div className="w-4 h-4 bg-blue-200 mr-2"></div>
                    <span>Azul claro - Fuente de forwarding</span>
                  </li>
                  <li className="flex items-center text-sm">
                    <div className="w-4 h-4 bg-blue-500 mr-2"></div>
                    <span>Azul - Instrucción actual</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {stallDetected && mode === "stall" && (
          <div className="mb-4 p-4 bg-yellow-100/80 border border-yellow-200 text-yellow-800 rounded-md flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
            <div>
              <p className="font-medium">Stall detectado en ciclo {cycle}</p>
              <p className="text-sm">
                Una instrucción necesita datos que aún no están disponibles. El
                pipeline se detiene temporalmente.
              </p>
            </div>
          </div>
        )}

        {hasForwarding && mode === "forwarding" && (
          <div className="mb-4 p-4 bg-green-100/80 border border-green-200 text-green-800 rounded-md">
            <div className="flex items-center mb-2">
              <ArrowRight className="h-5 w-5 mr-2" />
              <h3 className="font-medium">
                Forwarding activo en ciclo {cycle}
              </h3>
            </div>
            <ul className="space-y-1 pl-7">
              {currentForwardings.map((fw, idx) => (
                <li key={idx} className="text-sm list-disc">
                  De instrucción {fw.from + 1} ({fw.source}) a instrucción{" "}
                  {fw.to + 1} (registro {fw.target})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              Visualización de instrucciones MIPS a través del pipeline
              {mode === "stall" && " con detección de stalls"}
              {mode === "forwarding" && " con forwarding de datos"}
            </TableCaption>

            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px] sticky left-0 bg-card z-10 border-r">
                  Instrucción
                </TableHead>
                {cycleNums.map((c) => (
                  <TableHead
                    key={`cycle-${c}`}
                    className={cn(
                      "text-center w-16",
                      c === cycle && "bg-accent/20 font-medium"
                    )}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {instructions.map((inst, i) => (
                <TableRow key={`inst-${i}`} className="hover:bg-muted/30">
                  {/* Instrucción con tooltip mostrando descripción más amigable */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TableCell className="sticky left-0 bg-card z-10 border-r">
                          <div className="font-mono">{inst}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {decodeRegisterInfo(inst)}
                          </div>
                          <Badge variant="outline" className="mt-1">
                            Instrucción {i + 1}
                          </Badge>
                        </TableCell>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="font-medium">
                          {getInstructionDescription(inst)}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {cycleNums.map((c) => {
                    const expected = c - i - 1;
                    const currStage = instructionStages[i];

                    const inPipe = expected >= 0 && expected < STAGES.length;
                    const stageData = inPipe ? STAGES[expected] : null;

                    const isCurr =
                      currStage !== null &&
                      expected === currStage &&
                      c === cycle;

                    const stalled =
                      stalls.includes(i) && currStage === 1 && c >= cycle;

                    // Forwarding activo para esta instrucción y ciclo
                    // Comprobamos tanto los forwardings guardados como los detectados dinámicamente
                    const isForwardTarget =
                      mode === "forwarding" &&
                      currentForwardings.some(
                        (fw) => fw.to === i && fw.cycle === c
                      );

                    const isForwardSource =
                      mode === "forwarding" &&
                      currentForwardings.some(
                        (fw) => fw.from === i && fw.cycle === c
                      );

                    const animate = isCurr && isRunning && !isFinished;
                    const highlight = isCurr && !isRunning && !isFinished;
                    const past = inPipe && c < cycle;

                    return (
                      <TableCell
                        key={`cell-${i}-${c}`}
                        className={cn(
                          "text-center w-16 h-14 transition-colors duration-300",
                          isFinished
                            ? "bg-background"
                            : stalled
                            ? "bg-yellow-200 text-yellow-900 font-bold"
                            : isForwardTarget
                            ? "bg-green-200 text-green-900 font-bold"
                            : isForwardSource
                            ? "bg-blue-200 text-blue-900 font-bold"
                            : animate
                            ? "bg-blue-500 text-white animate-pulse"
                            : highlight
                            ? "bg-blue-500 text-white"
                            : past
                            ? "bg-secondary text-secondary-foreground"
                            : c === cycle
                            ? "bg-accent/10"
                            : "bg-background"
                        )}
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex flex-col items-center justify-center h-full">
                                {stageData && !isFinished && (
                                  <>
                                    <stageData.icon className="w-4 h-4 mb-1" />
                                    <span className="text-xs">
                                      {stageData.name}
                                    </span>
                                  </>
                                )}
                                {stalled && (
                                  <div className="flex items-center">
                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                    <span className="text-xs">STALL</span>
                                  </div>
                                )}
                                {isForwardTarget && mode === "forwarding" && (
                                  <CornerDownLeft className="w-4 h-4 ml-1" />
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {stalled ? (
                                <p>Stall: esperando datos</p>
                              ) : stageData ? (
                                <p>{stageData.description}</p>
                              ) : (
                                <p>Fuera de pipeline</p>
                              )}
                              {isForwardTarget && (
                                <p>Recibiendo dato via forwarding</p>
                              )}
                              {isForwardSource && (
                                <p>Enviando dato via forwarding</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
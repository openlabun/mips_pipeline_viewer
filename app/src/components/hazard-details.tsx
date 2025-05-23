"use client";

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Zap, ArrowRight, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useSimulationState } from '@/context/SimulationContext';

const HazardDetails: React.FC = () => {
  const {
    currentCycle,
    loadUseHazards,
    rawHazards,
    stallsThisCycle,
    forwardingPaths,
    instructionStates,
    stallsEnabled,
    forwardingEnabled,
    // Nuevos estados acumulativos
    totalStallsInserted,
    instructionsWithLoadUseHazards,
    instructionsWithRawHazards
  } = useSimulationState();

  const hasHazards = loadUseHazards.length > 0 || rawHazards.length > 0 || forwardingPaths.length > 0;

  if (!stallsEnabled || currentCycle === 0) {
    return null;
  }

  // Añadir una sección de estadísticas en este componente si es apropiado
  const showStats = () => (
    <div className="bg-muted/30 p-3 rounded-md mt-4">
      <h4 className="text-sm font-medium mb-2">Estadísticas acumulativas</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="font-medium">Total stalls insertados:</span> {totalStallsInserted}
        </div>
        <div>
          <span className="font-medium">Load-Use hazards:</span> {instructionsWithLoadUseHazards.size}
        </div>
        <div>
          <span className="font-medium">RAW hazards:</span> {instructionsWithRawHazards.size}
        </div>
        <div>
          <span className="font-medium">Instrucciones afectadas:</span> {
            new Set([...instructionsWithLoadUseHazards, ...instructionsWithRawHazards]).size
          }
        </div>
      </div>
    </div>
  );

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          Detalles de Hazards (Ciclo {currentCycle})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasHazards ? (
          <div className="flex items-center justify-center p-4 text-muted-foreground">
            <Info className="w-4 h-4 mr-2" />
            No hay hazards detectados en este ciclo
          </div>
        ) : (
          <ScrollArea className="h-[300px] rounded-md border p-4">
            {/* Load-Use Hazards */}
            {loadUseHazards.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium flex items-center mb-2 text-purple-700">
                  <AlertTriangle className="w-4 h-4 mr-1 text-purple-500" />
                  Load-Use Hazards
                </h3>
                <p className="text-xs mb-3 text-muted-foreground">
                  Ocurren cuando una instrucción usa un registro que está siendo cargado por un LOAD previo.
                  El dato no está disponible hasta que la instrucción de LOAD llegue a la etapa MEM.
                  <strong className="block mt-1">Estos hazards siempre requieren un stall, incluso con forwarding.</strong>
                </p>
                
                <div className="space-y-2">
                  {loadUseHazards.map((instIdx) => {
                    const inst = instructionStates.find(i => i.index === instIdx);
                    const loadInst = instructionStates.find(i => 
                      i.decoded.isLoad && 
                      i.decoded.writesTo.some(reg => inst?.decoded.readsFrom.includes(reg))
                    );
                    
                    if (!inst || !loadInst) return null;
                    
                    return (
                      <div key={`load-use-${instIdx}`} className="bg-purple-50 p-2 rounded-md border border-purple-200">
                        <div className="flex items-center text-xs mb-1">
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 mr-2">Inst {loadInst.index + 1}</Badge>
                          <span className="font-mono">{loadInst.hex}</span>
                          <span className="mx-2 text-purple-400">→</span>
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 mr-2">Inst {inst.index + 1}</Badge>
                          <span className="font-mono">{inst.hex}</span>
                        </div>
                        <div className="text-xs text-purple-700">
                          <span className="font-medium">Registros en conflicto:</span> 
                          {loadInst.decoded.writesTo.filter(reg => 
                            inst.decoded.readsFrom.includes(reg)
                          ).map(reg => `$${reg}`).join(', ')}
                        </div>
                        <div className="text-xs mt-1 text-purple-900 bg-purple-100 px-2 py-1 rounded">
                          Solución: Stall de pipeline (no se puede resolver con forwarding)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* RAW Hazards */}
            {rawHazards.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium flex items-center mb-2 text-red-700">
                  <AlertTriangle className="w-4 h-4 mr-1 text-red-500" />
                  RAW Hazards (Read-After-Write)
                </h3>
                <p className="text-xs mb-3 text-muted-foreground">
                  Ocurren cuando una instrucción lee un registro que aún está siendo calculado por una instrucción anterior.
                  {forwardingEnabled && 
                    " Con forwarding, algunos RAW hazards pueden resolverse sin stalls, pero no todos."}
                </p>
                
                <div className="space-y-2">
                  {rawHazards.map((instIdx) => {
                    const inst = instructionStates.find(i => i.index === instIdx);
                    const conflictInsts = instructionStates.filter(i => 
                      i.index < instIdx && 
                      i.decoded.writesTo.some(reg => inst?.decoded.readsFrom.includes(reg))
                    );
                    
                    if (!inst || conflictInsts.length === 0) return null;
                    
                    // Revisar si este hazard tiene forwarding
                    const hasForwarding = forwardingPaths.some(path => 
                      path.to.instructionIndex === instIdx
                    );
                    
                    return (
                      <div key={`raw-${instIdx}`} className="bg-red-50 p-2 rounded-md border border-red-200">
                        <div className="flex items-center text-xs mb-1">
                          <Badge variant="outline" className="bg-red-100 text-red-800 mr-2">Conflicto</Badge>
                          <span className="font-mono">{inst.hex}</span>
                          <span className="mx-2 text-red-400">depende de</span>
                          {conflictInsts.map((confInst, idx) => (
                            <React.Fragment key={idx}>
                              <Badge variant="outline" className="bg-red-100 text-red-800 mr-1">Inst {confInst.index + 1}</Badge>
                              <span className="font-mono mr-2">{confInst.hex}</span>
                            </React.Fragment>
                          ))}
                        </div>
                        <div className="text-xs text-red-700">
                          <span className="font-medium">Registros en conflicto:</span> 
                          {inst.decoded.readsFrom.filter(reg => 
                            conflictInsts.some(ci => ci.decoded.writesTo.includes(reg))
                          ).map(reg => `$${reg}`).join(', ')}
                        </div>
                        <div className={`text-xs mt-1 px-2 py-1 rounded ${
                          hasForwarding ? 'text-blue-900 bg-blue-100' : 'text-red-900 bg-red-100'
                        }`}>
                          Solución: {hasForwarding ? 'Resuelta con forwarding' : 'Stall de pipeline'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Forwarding Paths */}
            {forwardingPaths.length > 0 && (
              <div>
                <h3 className="text-sm font-medium flex items-center mb-2 text-blue-700">
                  <Zap className="w-4 h-4 mr-1 text-blue-500" />
                  Forwarding Activo
                </h3>
                <p className="text-xs mb-3 text-muted-foreground">
                  El forwarding adelanta resultados de la ALU antes de que lleguen a Write Back, evitando stalls.
                </p>
                
                <div className="space-y-2">
                  {forwardingPaths.map((path, idx) => {
                    const fromInst = instructionStates.find(i => i.index === path.from.instructionIndex);
                    const toInst = instructionStates.find(i => i.index === path.to.instructionIndex);
                    
                    if (!fromInst || !toInst) return null;
                    
                    return (
                      <div key={`forward-${idx}`} className="bg-blue-50 p-2 rounded-md border border-blue-200">
                        <div className="flex items-center gap-1 text-xs mb-1">
                          <span>Desde</span>
                          <Badge variant="outline" className="bg-blue-100 text-blue-800">
                            Inst {path.from.instructionIndex + 1}
                          </Badge>
                          <span className="font-mono">{fromInst.hex}</span>
                          <ArrowRight className="w-3 h-3 mx-1 text-blue-500" />
                          <span>a</span>
                          <Badge variant="outline" className="bg-blue-100 text-blue-800">
                            Inst {path.to.instructionIndex + 1}
                          </Badge>
                          <span className="font-mono">{toInst.hex}</span>
                        </div>
                        <div className="text-xs text-blue-700">
                          <span className="font-medium">Registro forwardeado:</span> ${path.register}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        )}
        
        {/* Añadir la sección de estadísticas al final */}
        {showStats()}
      </CardContent>
    </Card>
  );
};

export { HazardDetails };

'use client';

import { AlertTriangle, Zap } from 'lucide-react';
import { disassembleInstruction } from '@/context/SimulationContext';
import { useRef } from 'react';

export type RegisterName = 'IF/ID' | 'ID/EX' | 'EX/MEM' | 'MEM/WB';
export type HistoryEntry = { hex: string | null; idx: number | null };
export type HistoryDict = Record<RegisterName, HistoryEntry[]>;

type HazardType = 'RAW' | 'WAW' | 'NONE';

const stageDetails: Record<RegisterName, { name: string }> = {
  'IF/ID': { name: 'IF/ID Register' },
  'ID/EX': { name: 'ID/EX Register' },
  'EX/MEM': { name: 'EX/MEM Register' },
  'MEM/WB': { name: 'MEM/WB Register' },
};

export function PipelineHistory({
  history,
  hazards,
  forwardings,
}: {
  history: HistoryDict;
  hazards: Record<number, { type: HazardType }>;
  forwardings: Record<number, Array<any>>;
  stalls: Record<number, number>;
}) {
  const registers = Object.keys(history) as RegisterName[];

  const scrollRefs: Record<RegisterName, React.RefObject<HTMLDivElement | null>> = {
    'IF/ID': useRef<HTMLDivElement>(null),
    'ID/EX': useRef<HTMLDivElement>(null),
    'EX/MEM': useRef<HTMLDivElement>(null),
    'MEM/WB': useRef<HTMLDivElement>(null),
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>, source: RegisterName) => {
    const targetScrollTop = e.currentTarget.scrollTop;
    registers.forEach((reg) => {
      if (reg !== source) {
        const ref = scrollRefs[reg].current;
        if (ref && ref.scrollTop !== targetScrollTop) {
          ref.scrollTop = targetScrollTop;
        }
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {registers.map((reg) => (
        <div key={reg} className="flex flex-col">
          <h3 className="font-semibold text-center mb-2">{stageDetails[reg].name}</h3>
          <div
            ref={scrollRefs[reg]}
            onScroll={(e) => handleScroll(e, reg)}
            className="h-64 rounded-md border bg-muted/20 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20"
          >
            <div className="p-2 space-y-1">
              {history[reg].map((entry, index) => {
                const tag = entry.idx != null ? `[${entry.idx}] ` : '';
                const hz = entry.idx != null ? hazards[entry.idx] : undefined;
                const hasFwd = entry.idx != null ? (forwardings[entry.idx]?.length ?? 0) > 0 : false;

                const showHazard = reg === 'IF/ID' && hz?.type && hz.type !== 'NONE';
                const showForward = reg === 'EX/MEM' && hasFwd;

                const rowTone =
                  showForward
                    ? 'bg-green-50'
                    : showHazard && hz?.type === 'RAW'
                      ? 'bg-rose-50'
                      : showHazard && hz?.type === 'WAW'
                        ? 'bg-amber-50'
                        : 'bg-background';

                return (
                  <div
                    key={index}
                    className={`grid grid-cols-[1.5rem_1fr] items-center font-mono text-xs p-1.5 rounded-sm transition-colors duration-300 ${rowTone}`}
                  >
                    <span className="text-[10px] text-muted-foreground">{index + 1}</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {entry.hex ? `${tag}${disassembleInstruction(entry.hex)}` : 'empty'}
                      </span>

                      <div className="flex items-center gap-1 shrink-0 w-[140px] justify-end">
                        {showHazard && hz?.type === 'RAW' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-rose-100 text-rose-700 border-rose-200 transition-all duration-300">
                            <AlertTriangle className="w-3 h-3" /> RAW
                          </span>
                        ) : (
                          <span className="h-5 px-1.5 rounded-full border border-transparent opacity-0" />
                        )}

                        {showForward ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-green-100 text-green-700 border-green-200 transition-all duration-300">
                            <Zap className="w-3 h-3" /> fwd
                          </span>
                        ) : (
                          <span className="h-5 px-1.5 rounded-full border border-transparent opacity-0" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// src/components/ForwardingArrow.tsx
"use client";

import React, { useEffect, useState } from "react";

type ForwardingArrowProps = {
  from: [number, number];
  to: [number, number];
  curvature?: number;
  dashed?: boolean;
  animate?: boolean;
  blinkArrowhead?: boolean; // Nueva prop para el parpadeo
};

export const ForwardingArrow: React.FC<ForwardingArrowProps> = ({
  from,
  to,
  curvature = 80,
  dashed = false,
  animate = false,
  blinkArrowhead = false,
}) => {
  const [start, setStart] = useState<[number, number] | null>(null);
  const [end, setEnd] = useState<[number, number] | null>(null);

  useEffect(() => {
    const getCellCenter = ([row, col]: [number, number]) => {
      const cell = document.querySelector(
        `[data-row="${row}"][data-col="${col}"]`
      ) as HTMLElement;
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      const parentRect = cell.offsetParent?.getBoundingClientRect();
      return [
        rect.left - (parentRect?.left ?? 0) + rect.width / 2,
        rect.top - (parentRect?.top ?? 0) + rect.height / 2,
      ];
    };

    const startPoint = getCellCenter(from);
    const endPoint = getCellCenter(to);

    if (startPoint && endPoint) {
      setStart(startPoint as [number, number]);
      setEnd(endPoint as [number, number]);
    }
  }, [from, to]);

  if (!start || !end) return null;

  const [x1, y1] = start;
  const [x2, y2] = end;

  // Cálculo de la curva
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const controlX = (x1 + x2) / 2 - (dy / distance) * curvature;
  const controlY = (y1 + y2) / 2 + (dx / distance) * curvature;
  const path = `M ${x1},${y1} Q ${controlX},${controlY} ${x2},${y2}`;

  // Estilos dinámicos
  const pathStyle: React.CSSProperties = {
    strokeWidth: 2,
    fill: "none",
    markerEnd: "url(#arrowhead)",
  };

  if (dashed) {
    pathStyle.strokeDasharray = "5, 5";
  }

  if (animate) {
    pathStyle.animation = "dash-animation 2s linear infinite";
  }

  return (
    <>
      <path
        d={path}
        className="text-destructive stroke-current"
        style={pathStyle}
      />
      {/* Definiciones globales de animaciones */}
      <style>
        {`
          @keyframes dash-animation {
            from { stroke-dashoffset: 10; }
            to { stroke-dashoffset: 0; }
          }
          @keyframes blink-animation {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}
      </style>
    </>
  );
};

// ArrowHeadDefs con animación de parpadeo
export const ArrowHeadDefs = () => (
  <defs>
    <marker
      id="arrowhead"
      markerWidth="10"
      markerHeight="7"
      refX="10"
      refY="3.5"
      orient="auto"
      className={`text-destructive ${true ? "animate-blink" : ""}`}
    >
      <polygon 
        points="0 0, 10 3.5, 0 7" 
        fill="currentColor" 
        stroke="currentColor"
      />
    </marker>
    <style>
      {`
        .animate-blink {
          animation: blink-animation 1s ease-in-out infinite;
        }
      `}
    </style>
  </defs>
);
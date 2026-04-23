import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  children: ReactNode;
  content: string;
  position?: "top" | "right" | "bottom" | "left";
}

export function Tooltip({ children, content, position = "right" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setVisible(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible]);

  const positionClasses = {
    top: "tooltip-top",
    right: "tooltip-right",
    bottom: "tooltip-bottom",
    left: "tooltip-left",
  };

  return (
    <div className="tooltip-wrapper" ref={triggerRef}>
      <div
        className="tooltip-trigger"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {children}
      </div>
      {visible && (
        <div
          ref={tooltipRef}
          className={`tooltip-box ${positionClasses[position]}`}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  );
}

export function InfoTooltip({ content, position = "right" }: { content: string; position?: TooltipProps["position"] }) {
  return (
    <Tooltip content={content} position={position}>
      <Info size={14} className="info-tooltip-icon" aria-label="More information" />
    </Tooltip>
  );
}

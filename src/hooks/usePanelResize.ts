import {
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";

export interface UsePanelResizeOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** When true, width is computed from the right edge (project tree style). */
  fromRightEdge?: boolean;
}

export interface UsePanelResizeResult {
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
  isResizing: boolean;
  startResize: (event: ReactMouseEvent) => void;
}

/**
 * Horizontal panel resize with localStorage persistence.
 * Dispatches window `resize` so xterm.js can re-measure.
 */
export function usePanelResize({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  fromRightEdge = false,
}: UsePanelResizeOptions): UsePanelResizeResult {
  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseInt(saved, 10) : defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handleMouseMove = (event: MouseEvent) => {
      const rawWidth = fromRightEdge ? window.innerWidth - event.clientX : event.clientX;
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, rawWidth));
      setWidth(nextWidth);
      localStorage.setItem(storageKey, nextWidth.toString());
      window.dispatchEvent(new Event("resize"));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [fromRightEdge, isResizing, maxWidth, minWidth, storageKey]);

  return { width, setWidth, isResizing, startResize };
}

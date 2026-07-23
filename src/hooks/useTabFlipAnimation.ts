import { useLayoutEffect, useRef } from "react";

/** FLIP animation for tab bar reorder. */
export function useTabFlipAnimation(openTabIds: string[]) {
  const lastTabPositions = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    const tabElements = document.querySelectorAll(".tab");
    const newPositions: Record<string, number> = {};

    tabElements.forEach((element) => {
      const sessionId = element.getAttribute("data-id");
      const htmlElement = element as HTMLElement;
      if (!sessionId) return;

      newPositions[sessionId] = htmlElement.getBoundingClientRect().left;
      const oldLeft = lastTabPositions.current[sessionId];

      if (
        oldLeft !== undefined &&
        oldLeft !== newPositions[sessionId] &&
        !htmlElement.classList.contains("dragging")
      ) {
        const deltaX = oldLeft - newPositions[sessionId];
        htmlElement.style.transition = "none";
        htmlElement.style.transform = `translate3d(${deltaX}px, 0, 0)`;
        htmlElement.offsetHeight;
        htmlElement.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
        htmlElement.style.transform = "translate3d(0, 0, 0)";

        const cleanup = (event: TransitionEvent) => {
          if (event.propertyName === "transform") {
            htmlElement.style.transition = "";
            htmlElement.style.transform = "";
            htmlElement.removeEventListener("transitionend", cleanup);
          }
        };
        htmlElement.addEventListener("transitionend", cleanup);
      }
    });

    lastTabPositions.current = newPositions;
  }, [openTabIds]);
}

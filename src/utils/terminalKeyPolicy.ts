export type CtrlCAction = "copy" | "interrupt" | "suppress";

export const resolveCtrlCAction = (
  hasSelection: boolean,
  inputBuffer: string,
  isRepeat: boolean,
): CtrlCAction => {
  if (hasSelection) return "copy";
  if (!isRepeat && inputBuffer.length > 0) return "interrupt";
  return "suppress";
};

import { shouldUseNativeTerminal, type ClaudeTerminalMode } from "./terminalMode.ts";

export type TerminalWriteCommand = "write_to_terminal" | "write_to_compat_terminal";

export const resolveTerminalWriteCommand = (
  agentType: string,
  mode: ClaudeTerminalMode,
): TerminalWriteCommand => {
  return shouldUseNativeTerminal(agentType, mode)
    ? "write_to_compat_terminal"
    : "write_to_terminal";
};

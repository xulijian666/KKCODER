export function hasSessionDialogue(sessionId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(`kkcoder_session_has_dialogue_${sessionId}`) === "true";
}

export function shouldResumeSession(
  sessionId: string,
  newSessionIds: string[],
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return !newSessionIds.includes(sessionId) && hasSessionDialogue(sessionId, storage);
}

export type ResearchTurn = { role: "user" | "assistant"; content: string };

/** Keep complete recent exchanges. Never truncate a number or claim mid-answer. */
export function prepareResearchConversation(history: ResearchTurn[], question: string) {
  const current: ResearchTurn = { role: "user", content: question.trim() };
  if (!current.content || current.content.length > 2000) throw new Error("Keep questions between 1 and 2,000 characters.");
  const messages: ResearchTurn[] = [current];
  let size = current.content.length;
  let included = 0;
  for (let index = history.length - 2; index >= 0; index -= 2) {
    const pair = history.slice(index, index + 2);
    const pairSize = pair.reduce((sum, turn) => sum + turn.content.length, 0);
    if (pair[0]?.role !== "user" || pair[1]?.role !== "assistant" || messages.length + 2 > 11 || size + pairSize > 16000) break;
    messages.unshift(...pair.map(({ role, content }) => ({ role, content })));
    size += pairSize;
    included += 2;
  }
  return { messages, omittedMessages: history.length - included };
}

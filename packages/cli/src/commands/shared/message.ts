export interface ParsedMessage {
  readonly subject: string;
  readonly description: string;
}

export const parseMessage = (message: string): ParsedMessage => {
  const normalized = message.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const [firstLine = "", ...rest] = normalized.split("\n");
  const description = rest.join("\n").replace(/^\n+/, "").trimEnd();

  return {
    subject: firstLine.trim(),
    description,
  };
};

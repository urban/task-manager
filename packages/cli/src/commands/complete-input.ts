import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { CommandFailure } from "../domain/Errors";
import { resolveTextInput } from "./shared/input";

export interface CompletionResultInput {
  readonly summary: string;
  readonly details: string;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
}

interface ParsedResultMessage {
  readonly summary: string;
  readonly details: string;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
}

interface ResultMessageAccumulator {
  readonly section: "details" | "decisions" | "verification";
  readonly detailLines: ReadonlyArray<string>;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
}

const emptyParsedResultMessage: ParsedResultMessage = {
  summary: "",
  details: "",
  decisions: [],
  verification: [],
};

const resultMessageSection = (line: string): ResultMessageAccumulator["section"] | undefined => {
  const normalized = line.trim().toLowerCase();
  if (normalized === "decisions:") {
    return "decisions";
  }
  if (normalized === "verification:") {
    return "verification";
  }
  return undefined;
};

const parseBullet = (line: string): string | undefined => {
  const trimmed = line.trimStart();
  const value = trimmed.startsWith("- ")
    ? trimmed.slice(2).trim()
    : trimmed.startsWith("* ")
      ? trimmed.slice(2).trim()
      : undefined;

  return value === undefined || value === "" ? undefined : value;
};

const cleanTextItems = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items.map((item) => item.trim()).filter((item) => item !== "");

const vagueResultSummaries = new Set([
  "complete",
  "completed",
  "done",
  "finished",
  "fixed",
  "implemented",
  "it works",
  "should work",
  "works",
]);

const isVagueResultSummary = (summary: string): boolean =>
  vagueResultSummaries.has(
    summary
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, ""),
  );

const parseResultMessage = (message: string): ParsedResultMessage => {
  const normalized = message.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const [firstLine = "", ...bodyLines] = normalized.split("\n");
  const initial: ResultMessageAccumulator = {
    section: "details",
    detailLines: [],
    decisions: [],
    verification: [],
  };

  const parsed = bodyLines.reduce<ResultMessageAccumulator>((accumulator, line) => {
    const section = resultMessageSection(line);
    if (section !== undefined) {
      return {
        ...accumulator,
        section,
      };
    }

    if (accumulator.section === "details") {
      return {
        ...accumulator,
        detailLines: [...accumulator.detailLines, line],
      };
    }

    const bullet = parseBullet(line);
    if (bullet === undefined) {
      return accumulator;
    }

    return accumulator.section === "decisions"
      ? {
          ...accumulator,
          decisions: [...accumulator.decisions, bullet],
        }
      : {
          ...accumulator,
          verification: [...accumulator.verification, bullet],
        };
  }, initial);

  return {
    summary: firstLine.trim(),
    details: parsed.detailLines.join("\n").replace(/^\n+/, "").trimEnd(),
    decisions: cleanTextItems(parsed.decisions),
    verification: cleanTextItems(parsed.verification),
  };
};

export const resolveCompletionResultInput = Effect.fnUntraced(function* (input: {
  readonly summary: Option.Option<string>;
  readonly details: Option.Option<string>;
  readonly decision: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
  readonly resultMessage: Option.Option<string>;
  readonly resultMessageFile: Option.Option<string>;
  readonly allowNoVerification: boolean;
}) {
  const messageInput = yield* resolveTextInput(
    input.resultMessage,
    input.resultMessageFile,
    "result-message",
  );
  if (
    Option.isSome(messageInput) &&
    (Option.isSome(input.summary) ||
      Option.isSome(input.details) ||
      input.decision.length > 0 ||
      input.verification.length > 0)
  ) {
    return yield* new CommandFailure({
      message:
        "Do not combine --summary, --details, --decision, or --verification with --result-message/--result-message-file.",
    });
  }

  const parsedMessage = Option.match(messageInput, {
    onNone: () => emptyParsedResultMessage,
    onSome: parseResultMessage,
  });
  const summary = Option.match(input.summary, {
    onNone: () => parsedMessage.summary,
    onSome: (value) => value.trim(),
  });
  const details = Option.match(input.details, {
    onNone: () => parsedMessage.details,
    onSome: (value) => value.trimEnd(),
  });
  const decisions = cleanTextItems([...parsedMessage.decisions, ...input.decision]);
  const verification = cleanTextItems([...parsedMessage.verification, ...input.verification]);

  if (summary === "") {
    return yield* new CommandFailure({
      message:
        "Result summary is required. Pass --summary <text> or provide a non-empty first line in --result-message.",
    });
  }

  if (summary.includes("\n") || summary.includes("\r")) {
    return yield* new CommandFailure({
      message: "Result summary must be a single line.",
    });
  }

  if (isVagueResultSummary(summary)) {
    return yield* new CommandFailure({
      message: "Result summary must describe what changed, not just say it is done.",
    });
  }

  if (verification.length === 0 && !input.allowNoVerification) {
    return yield* new CommandFailure({
      message:
        "Verification evidence is required. Pass --verification <text> or include Verification bullets in --result-message, or use --allow-no-verification.",
    });
  }

  return {
    summary,
    details,
    decisions,
    verification,
  } satisfies CompletionResultInput;
});

import * as Config from "effect/Config";
import * as Flag from "effect/unstable/cli/Flag";

export const agentFlag = Flag.string("agent").pipe(
  Flag.withDescription("Agent Identity (or TM_AGENT)"),
  Flag.withFallbackConfig(Config.string("TM_AGENT")),
  Flag.optional,
);

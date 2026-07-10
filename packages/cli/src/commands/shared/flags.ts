import * as Config from "effect/Config";
import * as Flag from "effect/unstable/cli/Flag";

export const actorFlag = Flag.string("actor").pipe(
  Flag.withDescription("Actor Identity (or TM_ACTOR)"),
  Flag.withFallbackConfig(Config.string("TM_ACTOR")),
  Flag.optional,
);

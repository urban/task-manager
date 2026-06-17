#!/usr/bin/env bun
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CliOutput from "effect/unstable/cli/CliOutput";

import { run } from "./main";

const appLayer = Layer.mergeAll(
  BunServices.layer,
  CliOutput.layer(
    CliOutput.defaultFormatter({
      colors: false,
    }),
  ),
);

// @effect-diagnostics-next-line strictEffectProvide:off
run.pipe(Effect.provide(appLayer), BunRuntime.runMain);

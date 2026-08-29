#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect, Layer } from "effect";

import { AppLive } from "./app-live";
import { run } from "./cli-application";

const application = Effect.scoped(
  Effect.gen(function* () {
    const context = yield* Layer.build(AppLive);
    return yield* Effect.provideContext(run, context);
  }),
);

BunRuntime.runMain(application);

#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";

import { AppLive } from "./app-live";
import { run } from "./cli-application";

// @effect-diagnostics-next-line strictEffectProvide:off
const application = run.pipe(Effect.provide(AppLive));

BunRuntime.runMain(application);

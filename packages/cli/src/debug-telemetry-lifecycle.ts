import { Context, Effect, Exit, MutableRef, Scope } from "effect";

import * as Session from "./debug-telemetry-session";

type Immutable<T> = T extends globalThis.Function
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Immutable<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;

type DebugTelemetryLifecycleShape = {
  readonly activate: Effect.Effect<Session.DebugTelemetrySession>;
  readonly finalize: Effect.Effect<void>;
};

const DebugTelemetryLifecycleBase: Context.ServiceClass<
  DebugTelemetryLifecycle,
  "@urban/task-manager-cli/debug-activation/DebugTelemetryLifecycle",
  DebugTelemetryLifecycleShape
> = Context.Service<DebugTelemetryLifecycle, DebugTelemetryLifecycleShape>()(
  "@urban/task-manager-cli/debug-activation/DebugTelemetryLifecycle",
);

export class DebugTelemetryLifecycle extends DebugTelemetryLifecycleBase {}

type DebugTelemetryLifecycleState =
  | { readonly kind: "inactive" }
  | {
      readonly kind: "active";
      readonly scope: Scope.Closeable;
      readonly session: Session.DebugTelemetrySession;
    }
  | { readonly kind: "finalized" };

export const debugFinalizationDeadline = "250 millis";

export const makeDebugTelemetryLifecycle = (
  ...[factory]: readonly [Immutable<Session.DebugTelemetrySessionFactory["Service"]>]
): DebugTelemetryLifecycle["Service"] => {
  const state = MutableRef.make<DebugTelemetryLifecycleState>({ kind: "inactive" });
  const activate = Effect.gen(function* () {
    const current = MutableRef.get(state);
    if (current.kind === "active") {
      return current.session;
    }
    const scope = yield* Scope.make();
    const acquired = yield* factory.acquire.pipe(Scope.provide(scope), Effect.exit);
    if (Exit.isFailure(acquired)) {
      yield* Scope.close(scope, acquired).pipe(Effect.ignoreCause);
      return yield* acquired;
    }
    MutableRef.set(state, { kind: "active", scope, session: acquired.value });
    return acquired.value;
  });
  const finalize = Effect.suspend(() => {
    const current = MutableRef.get(state);
    MutableRef.set(state, { kind: "finalized" });
    if (current.kind !== "active") {
      return Effect.void;
    }
    return current.session.forceFlushAndShutdown.pipe(
      Effect.onExit((...[exit]: readonly [Immutable<Exit.Exit<void>>]) =>
        Scope.close(current.scope, exit).pipe(Effect.ignoreCause),
      ),
      Effect.ignoreCause,
      Effect.interruptible,
      Effect.timeoutOption(debugFinalizationDeadline),
      Effect.asVoid,
      Effect.withTracerEnabled(false),
    );
  });
  return DebugTelemetryLifecycle.of({ activate, finalize });
};

import { Context, Effect, Exit, MutableRef, Semaphore } from "effect";

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
      readonly session: Session.DebugTelemetrySession;
    }
  | { readonly kind: "finalized" };

export const debugFinalizationDeadline = "250 millis";

export const makeDebugTelemetryLifecycle = (
  ...[factory]: readonly [Immutable<Session.DebugTelemetrySessionFactory["Service"]>]
): DebugTelemetryLifecycle["Service"] => {
  const state = MutableRef.make<DebugTelemetryLifecycleState>({ kind: "inactive" });
  const mutex = Semaphore.makeUnsafe(1);
  const unavailableSession: Session.DebugTelemetrySession = {
    observe: <A, E, R>(...[effect]: readonly [() => Effect.Effect<A, E, R>]) =>
      Effect.suspend(effect),
    forceFlushAndShutdown: Effect.void,
  };
  const activate = mutex.withPermit(
    Effect.suspend(() => {
      const current = MutableRef.get(state);
      if (current.kind === "active") {
        return Effect.succeed(current.session);
      }
      if (current.kind === "finalized") {
        return Effect.succeed(unavailableSession);
      }
      return factory.acquire.pipe(
        Effect.exit,
        Effect.map(
          (...[acquired]: readonly [Immutable<Exit.Exit<Session.DebugTelemetrySession>>]) => {
            const session = Exit.isSuccess(acquired) ? acquired.value : unavailableSession;
            MutableRef.set(state, { kind: "active", session });
            return session;
          },
        ),
      );
    }),
  );
  const finalize = mutex.withPermit(
    Effect.suspend(() => {
      const current = MutableRef.get(state);
      MutableRef.set(state, { kind: "finalized" });
      if (current.kind !== "active") {
        return Effect.void;
      }
      return current.session.forceFlushAndShutdown.pipe(
        Effect.ignoreCause,
        Effect.interruptible,
        Effect.timeoutOption(debugFinalizationDeadline),
        Effect.asVoid,
        Effect.withTracerEnabled(false),
      );
    }),
  );
  return DebugTelemetryLifecycle.of({ activate, finalize });
};

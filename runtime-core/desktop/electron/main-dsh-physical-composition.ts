import { types } from "node:util";
import { readOriginalMainDshBootstrapAuthority } from "./main-dsh-bootstrap-authority.js";
import { readOriginalDshBudgetRuntimeBinding } from "./harness-optimization-service.js";
import { captureDispatchBusinessData } from "../../src/runtime/conversation-activity/dispatch-business-data.js";
import { assertStandardIpcPromise } from "../../src/runtime/verification/native-ipc-promise.js";
import { retainSourceErrorTails } from "../../src/runtime/verification/source-error-tails.js";
import { createIntrinsicSet } from "../../src/runtime/verification/intrinsic-async-collection.js";
import type { OriginalMainPhysicalCompositionView } from "./main-room-root-admission.js";

const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor,
  own = Object.hasOwn,
  define = Object.defineProperty;
const freeze = Object.freeze,
  NativePromise = Promise,
  then = Promise.prototype.then;
const isProxy = types.isProxy,
  isPromise = types.isPromise;
interface Row {
  realm: object;
  store: object;
  runtime: object;
  source: object;
  native: ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
  budget: ReturnType<typeof readOriginalDshBudgetRuntimeBinding>;
  assert: Function;
  draft: Function;
  calls: ReturnType<typeof createIntrinsicSet<object>>;
  tails: ReturnType<typeof createIntrinsicSet<object>>;
  unknown: ReturnType<typeof createIntrinsicSet<unknown>>;
}
const rows = createIntrinsicSet<Row>(),
  unfinished = createIntrinsicSet<object>();
const denied = () => Error("DSH_ORIGINAL_PHYSICAL_COMPOSITION_REQUIRED");
function find(
  realm: unknown,
  store: unknown,
  runtime: unknown,
  source: unknown,
): Row | undefined {
  const all = rows.snapshot();
  for (let i = 0; i < all.length; i++) {
    const row = all[i]!;
    if (
      row.realm === realm &&
      row.store === store &&
      row.runtime === runtime &&
      row.source === source
    )
      return row;
  }
}
function inventory(row: Row, value: unknown): void {
  retainSourceErrorTails(value, (raw, kind) => {
    if (kind === "unknown") {
      row.unknown.add(raw);
      return;
    }
    if (!isPromise(raw) || isProxy(raw) || row.calls.has(raw as object)) return;
    row.calls.add(raw as object);
    const tail = { raw };
    row.tails.add(tail);
    try {
      assertStandardIpcPromise(raw, "DSH_COMPOSITION_SDK_UNCONFIRMED");
      apply(then, raw, [
        (value: unknown) => finish(value),
        (error: unknown) => finish(error),
      ]);
    } catch (error) {
      row.unknown.add(raw);
      inventory(row, error);
      row.tails.delete(tail);
    }
    function finish(value: unknown) {
      try {
        inventory(row, value);
      } finally {
        row.tails.delete(tail);
      }
    }
  });
}
function invoke<T>(
  row: Row,
  fn: Function,
  args: unknown[],
  voidResult = false,
): T {
  const call = {};
  row.calls.add(call);
  try {
    const raw = apply(fn, undefined, args);
    define(call, "raw", { value: raw });
    if (voidResult && raw !== undefined) {
      inventory(row, raw);
      row.unknown.add(raw);
      throw denied();
    }
    return raw as T;
  } catch (error) {
    define(call, "error", { value: error });
    inventory(row, error);
    throw error;
  } finally {
    // The caller still owns the returned stack value while it validates it;
    // unknowns and discovered SDK tails have their own strong inventories.
    row.calls.delete(call);
  }
}
function current(row: Row): OriginalMainPhysicalCompositionView {
  if (row.tails.size || row.unknown.size) throw denied();
  invoke(row, row.native.assertCurrent, [], true);
  invoke(row, row.budget.assertCurrent, [], true);
  const raw = invoke<unknown>(row, row.assert, [
    row.realm,
    row.store,
    row.runtime,
    row.source,
  ]);
  let view: OriginalMainPhysicalCompositionView;
  try {
    view = captureDispatchBusinessData(raw, (value) =>
      inventory(row, value),
    ) as unknown as OriginalMainPhysicalCompositionView;
  } catch (error) {
    inventory(row, raw);
    inventory(row, error);
    throw error;
  }
  if (
    view.kind !== "original_main_physical_composition_v1" ||
    (view.profile !== "isolated_native_fixture" &&
      view.profile !== "installed_production") ||
    typeof view.productionQualified !== "boolean"
  )
    throw denied();
  invoke(row, row.native.assertLocal, [], true);
  invoke(row, row.budget.assertLocal, [], true);
  if (row.tails.size || row.unknown.size) throw denied();
  return freeze(view);
}
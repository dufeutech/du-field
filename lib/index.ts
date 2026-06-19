/**
 * du-field — a semantic input runtime. Public API + composition root.
 *
 * `createRuntime()` wires the registry (types + widgets), i18n, state, inference,
 * and an explicit-context provider into one object. `start()` additionally defines
 * the `<ui-field>` custom element bound to a default runtime. The domain core
 * stays pure; this file is the only place the pieces are assembled.
 */

export * from './core/contracts';

import type {
  Context,
  Dictionary,
  Registry,
  I18n,
  StatePort,
  Field,
  FieldConfig,
  Aggregate,
} from './core/contracts';
import type { AggregateOptions } from './app/aggregate';

import { createRegistry } from './registry/registry';
import { createI18n } from './i18n/i18n';
import { defaultDictionary } from './i18n/dictionary';
import { primitiveTypes } from './core/types/primitives';
import { semanticTypes } from './core/types/semantic';
import { moneyLocationTypes } from './core/types/money_location';
import { collectionTypes } from './core/types/collections';
import { createMemoryState } from './state/memory';
import { createField as createFieldImpl } from './app/field';
import { createAggregate } from './app/aggregate';
import { ambientContext } from './app/context';
import { inferType, inferUse } from './app/inference';
import { defaultWidgets } from './widget/widgets';
import { defineUiField } from './widget/element';
import { defineUiForm } from './widget/form_element';

export interface RuntimeOptions {
  /** Author dictionary merged over the built-in English defaults. */
  dictionary?: Dictionary;
  defaultLocale?: string;
  /** External state plugin; defaults to the built-in in-memory store. */
  state?: StatePort;
  /** Base context overrides applied before ambient sampling. */
  context?: Partial<Context>;
}

export interface Runtime {
  registry: Registry;
  i18n: I18n;
  state: StatePort;
  /** Build an explicit Context (ambient sample + overrides). */
  context(overrides?: Partial<Context>): Context;
  createField(config: FieldConfig, ctx?: Context): Field;
  createAggregate(fields: Field[], options?: AggregateOptions): Aggregate;
}

/** Assemble a runtime: registry + i18n + state + inference + context. */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const registry = createRegistry();
  for (const t of primitiveTypes) registry.registerType(t);
  for (const t of semanticTypes) registry.registerType(t);
  for (const t of moneyLocationTypes) registry.registerType(t);
  for (const t of collectionTypes) registry.registerType(t);
  for (const w of defaultWidgets) registry.register('widget', w.use, w);

  const dictionary: Dictionary = {
    ...defaultDictionary,
    ...(options.dictionary ?? {}),
  };
  const i18n = createI18n(dictionary, {
    defaultLocale: options.defaultLocale ?? 'en',
  });
  const state = options.state ?? createMemoryState();

  const baseCtx = options.context ?? {};
  const context = (overrides: Partial<Context> = {}): Context =>
    ambientContext({ ...baseCtx, ...overrides });

  const deps = {
    registry,
    state,
    inferType,
    inferUse: (typeName: string) => inferUse(typeName, registry),
  };

  return {
    registry,
    i18n,
    state,
    context,
    createField(config: FieldConfig, ctx?: Context): Field {
      return createFieldImpl(config, deps, ctx ?? context());
    },
    createAggregate(fields: Field[], opts?: AggregateOptions): Aggregate {
      return createAggregate(fields, opts);
    },
  };
}

let defaultRuntime: Runtime | undefined;

/** Create a default runtime and register the `<ui-field>` element. */
export function start(options?: RuntimeOptions): Runtime {
  const runtime = createRuntime(options);
  defineUiField(runtime);
  defineUiForm(runtime);
  defaultRuntime = runtime;
  return runtime;
}

/** The runtime created by the most recent start(), if any. */
export function getRuntime(): Runtime | undefined {
  return defaultRuntime;
}

// --- building blocks for advanced/standalone use ---
export { createRegistry } from './registry/registry';
export { createI18n, buildKey, buildTextBundle } from './i18n/i18n';
export { defaultDictionary } from './i18n/dictionary';
export { createMemoryState } from './state/memory';
export { createNanoState } from './state/nanostores';
export type { NanoStatePort } from './state/nanostores';

// --- author-facing facade (the minimal, nanostores-default entry point) ---
export { du, Du } from './api/du';
export type {
  DuConfig,
  DuFieldOptions,
  DuFieldHandle,
  DuFormOptions,
  DuFormHandle,
} from './api/du';
export { createField } from './app/field';
export { createAggregate } from './app/aggregate';
export { ambientContext } from './app/context';
export { compile } from './app/pipeline';
export { inferType, inferUse, humanize, inferLabelKey } from './app/inference';
export { defaultWidgets } from './widget/widgets';
export { defineUiField } from './widget/element';
export { defineUiForm } from './widget/form_element';
export { parseCondition } from './app/expression';
export { requiredIf, visibleIf, hiddenIf, validIf } from './app/dependency';
export { primitiveTypes } from './core/types/primitives';
export { semanticTypes } from './core/types/semantic';
export { moneyLocationTypes } from './core/types/money_location';
export { collectionTypes } from './core/types/collections';
export type { AggregateOptions, AggregateRuntime } from './app/aggregate';
export type { CompiledCondition } from './app/expression';
export type { FieldDeps } from './app/field';
export type { ElementRuntime } from './widget/element';

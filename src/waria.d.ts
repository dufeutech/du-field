/**
 * Dev-playground-only shim for the external component library.
 *
 * `@dufeut/waria` is a sibling repo, aliased to its source in vite.config.ts for
 * `npm run dev`. It is not in node_modules, so the type checker has nothing to
 * resolve — this minimal declaration covers the surface the playground uses. The
 * published library imports no waria code, so this affects the playground only.
 */
declare module '@dufeut/waria' {
  export const App: {
    init(): void;
    start(args?: unknown): void;
  };
  export const Router: unknown;
}

// Reach into app.js and get a real function out of it.
//
// app.js is one ~42,000-line IIFE with no exports, so nothing in it can be
// imported. Thirty-eight of the pre-Vitest tests solved that by finding a
// function's source by brace-matching and rebuilding it with `new Function`,
// each with its own copy of the matcher. This is that, once.
//
// It tests SHIPPED CODE, which a re-implementation in a test file does not —
// tests/README.md warns about exactly that drift. It is still a bridge, not a
// destination: as each domain moves to src/ its tests switch to real imports
// and stop calling this. See docs/ for the extraction order.
//
// The catch worth knowing: an extracted function is severed from the IIFE's
// closure, so every free variable it references has to be handed back in via
// `deps`. That is a feature — it forces a test to state a function's real
// dependencies out loud, and a function needing fifteen of them is telling you
// it should be several functions.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sources = new Map();
function sourceOf(file) {
  if (!sources.has(file)) sources.set(file, readFileSync(join(ROOT, file), "utf8"));
  return sources.get(file);
}

/**
 * The source text of one top-level declaration, brace-matched from its opening
 * `{` to the matching `}`.
 *
 * @param {string} decl  e.g. `function progressionAttempt(` or `const LIFT_ID_GROUPS =`
 * @param {string} [file="app.js"]
 * @returns {string}
 */
export function declSource(decl, file = "app.js") {
  const src = sourceOf(file);
  const at = src.indexOf(decl);
  if (at < 0) {
    throw new Error(
      `load-fn: "${decl}" not found in ${file}. It was probably renamed — ` +
      `update the caller rather than deleting the test.`
    );
  }
  if (src.indexOf(decl, at + 1) >= 0) {
    throw new Error(
      `load-fn: "${decl}" appears more than once in ${file}; the match is ` +
      `ambiguous. Pass a longer, unique prefix.`
    );
  }
  // Two kinds of declaration, and guessing wrong is silent: a `const x = new
  // Map();` has no brace of its own, so brace-matching would run on to some
  // unrelated block far below and swallow it.
  const isBlock = /^\s*(?:async\s+)?(?:function|class)\b/.test(decl);
  if (isBlock) {
    const open = src.indexOf("{", at);
    if (open < 0) throw new Error(`load-fn: no body found for "${decl}" in ${file}`);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return src.slice(at, i + 1);
      }
    }
    throw new Error(`load-fn: unbalanced braces after "${decl}" in ${file}`);
  }
  // Statement form: run to the first `;` that is not nested inside brackets or
  // a string. Covers `const q = new Map();`, `const MS = [1, 2];`, `let n = 0;`.
  let depth = 0;
  let quote = null;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ";" && depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`load-fn: no statement terminator after "${decl}" in ${file}`);
}

/**
 * Rebuild one or more declarations from app.js as live values, injecting
 * whatever they close over.
 *
 * @param {string|string[]} decls  declaration prefixes, in dependency order
 * @param {object} [deps]          free variables the code references
 * @param {object} [opts]
 * @param {string} [opts.file="app.js"]
 * @param {string[]} [opts.expose] names to return; defaults to the names parsed
 *                                 out of `decls`
 * @returns {object} the requested names
 *
 * @example
 *   const { progressionAttempt } = loadFns("function progressionAttempt(", {
 *     readinessScore: () => 0, READINESS_QS: [], READY_LOW_MAX: 0,
 *   });
 */
export function loadFns(decls, deps = {}, opts = {}) {
  const list = Array.isArray(decls) ? decls : [decls];
  const file = opts.file || "app.js";
  const bodies = list.map((d) => declSource(d, file));

  const names = opts.expose || list.map((d) => {
    const m = d.match(/(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/);
    if (!m) {
      throw new Error(
        `load-fn: cannot infer a name from "${d}". Pass opts.expose.`
      );
    }
    return m[1];
  });

  const depNames = Object.keys(deps);
  const body = `${bodies.join("\n;\n")}\n; return { ${names.join(", ")} };`;
  let factory;
  try {
    factory = new Function(...depNames, body);
  } catch (err) {
    throw new Error(
      `load-fn: could not compile ${list.join(", ")} from ${file}: ${err.message}`
    );
  }
  let built;
  try {
    built = factory(...depNames.map((n) => deps[n]));
  } catch (err) {
    throw new Error(
      `load-fn: building ${list.join(", ")} from ${file} threw: ${err.message}\n` +
      `  deps supplied: ${depNames.length ? depNames.join(", ") : "(none)"}`
    );
  }

  // A missing dep does NOT fail here — the extracted body compiles fine and only
  // blows up when the free name is first evaluated, i.e. when the function is
  // called. A bare "READINESS_QS is not defined" from inside a `new Function`
  // has no file, no line and no hint about what to inject, which is precisely
  // the kind of uninformative failure this codebase is already full of. So the
  // returned functions carry the dep list with them.
  const enrich = (name, fn) => {
    const wrapped = function (...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        if (err instanceof ReferenceError) {
          throw new Error(
            `load-fn: ${name}() from ${file} referenced something it was not given: ` +
            `${err.message}\n` +
            `  deps supplied: ${depNames.length ? depNames.join(", ") : "(none)"}\n` +
            `  Pass it in the deps object, or load the declaration that defines it.`
          );
        }
        throw err;
      }
    };
    // Keep the shape a caller might reasonably inspect.
    Object.defineProperty(wrapped, "name", { value: name, configurable: true });
    Object.defineProperty(wrapped, "length", { value: fn.length, configurable: true });
    return wrapped;
  };

  const out = {};
  for (const [name, value] of Object.entries(built)) {
    out[name] = typeof value === "function" ? enrich(name, value) : value;
  }
  return out;
}

/** Convenience for the common single-function case. */
export function loadFn(decl, deps = {}, opts = {}) {
  const name = opts.expose?.[0]
    || decl.match(/(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/)?.[1];
  return loadFns(decl, deps, opts)[name];
}

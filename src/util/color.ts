/**
 * Tiny ANSI colour helper. No dependencies.
 *
 * Colour is disabled when any of the following holds:
 *   - `NO_COLOR` is set (https://no-color.org)
 *   - `--no-color` was passed (caller calls `setColorEnabled(false)`)
 *   - `TERM=dumb`
 *   - stdout is not a TTY and `FORCE_COLOR` is not set
 */

const env = process.env;
const ESC = String.fromCharCode(27); // \x1b

let enabled =
  !("NO_COLOR" in env) &&
  env["TERM"] !== "dumb" &&
  (Boolean(env["FORCE_COLOR"]) || process.stdout.isTTY === true);

/** Force colour on or off explicitly (used by the `--no-color` flag and tests). */
export function setColorEnabled(value: boolean): void {
  enabled = value;
}

export function colorEnabled(): boolean {
  return enabled;
}

function wrap(open: number, close: number) {
  return (s: string | number): string =>
    enabled ? `${ESC}[${open}m${s}${ESC}[${close}m` : String(s);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

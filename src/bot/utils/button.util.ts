import type { Markup } from 'telegraf';

/**
 * Bot API 9.4 (2026-02-09) added a `style` field to inline keyboard buttons, letting bots
 * color them "primary" (blue), "success" (green) or "danger" (red) — no Premium required.
 * The installed telegraf/@telegraf/types version predates this, so it's not in the button
 * type yet; this just tacks the field onto the plain object telegraf already builds.
 * EXPERIMENTAL: unverified against this Bot API version — if Telegram silently ignores it,
 * buttons still work exactly as before, just uncolored.
 */
export type ButtonStyle = 'primary' | 'success' | 'danger';

export function styled<B extends ReturnType<typeof Markup.button.callback>>(
  button: B,
  style: ButtonStyle,
): B {
  return { ...button, style };
}

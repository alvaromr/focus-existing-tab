// The one place that writes to the console. `warn`: an expected race, such as a tab closed while
// the extension acted on it. `error`: anything else.
const PREFIX = '[Focus Existing Tab]';

export const log = {
  /** @param {string} context what the extension was doing @param {unknown} cause */
  warn: (context, cause) => console.warn(PREFIX, `${context}:`, cause),
  /** @param {string} context what the extension was doing @param {unknown} cause */
  error: (context, cause) => console.error(PREFIX, `${context}:`, cause),
};

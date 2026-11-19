// The one place that writes to the console. `warn`: an expected race, such as a tab closed while
// the extension acted on it. `error`: anything else.
const PREFIX = '[Focus Existing Tab]';

export const log = {
  warn: (context, cause) => console.warn(PREFIX, `${context}:`, cause),
  error: (context, cause) => console.error(PREFIX, `${context}:`, cause),
};

const COLOR_ON = '#2563eb';
const COLOR_OFF = '#6b7280';
const MAX_SHOWN = 9999;

/** Text and background colour of the toolbar badge. */
export function badgeOf(config, avoided) {
  if (!config.enabled) return { text: 'OFF', color: COLOR_OFF };
  const text = !config.showBadge || avoided <= 0 ? '' : avoided > MAX_SHOWN ? `${MAX_SHOWN}+` : String(avoided);
  return { text, color: COLOR_ON };
}

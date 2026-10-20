// Commented-out (unreleased) rules content the app includes anyway: playtest
// content for the user's own table, not official. Each entry is the comment
// starting with `start`, cut off before the first facet above `maxLevel`.
// Shared by parse-rules and the tests that read the markdown, so both see the
// same text.
export const UNRELEASED_INCLUDES = [{ start: '### Darkness', maxLevel: 2 }];

export function includeUnreleased(text) {
  for (const { start, maxLevel } of UNRELEASED_INCLUDES) {
    const at = text.indexOf(`<!--${start}`);
    if (at < 0) {
      console.warn(`parse-rules: commented-out block "${start}" not found`);
      continue;
    }
    const end = text.indexOf('-->', at);
    let body = text.slice(at + 4, end);
    const tooHigh = [...body.matchAll(/^#{2,6} .*< *lvl (\d+) *>/gm)].find((m) => Number(m[1]) > maxLevel);
    if (tooHigh) body = body.slice(0, tooHigh.index).replace(/\\column\s*$/, '');
    text = `${text.slice(0, at)}${body}\n${text.slice(end + 3)}`;
  }
  return text;
}

const DEFAULT_PATTERN = "error|fail|exception|panic|warn|traceback|✗";
const MAX_LINE = 300;

export function tail(text: string, max: number): string {
  return text.length <= max ? text : `...${text.slice(-max)}`;
}

export function matchingLines(output: string, pattern = DEFAULT_PATTERN, limit = 20): string[] {
  const re = new RegExp(pattern, "i");
  return output
    .split("\n")
    .filter((l) => re.test(l))
    .slice(0, limit)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}...` : l));
}

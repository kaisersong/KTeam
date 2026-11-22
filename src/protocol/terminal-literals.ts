const sedPrintScript = /^(?:(?:[0-9]+|\$|\/(?:\\[^\r\n]|[^/\\'\r\n])+\/)(?:,(?:[0-9]+|\$|\/(?:\\[^\r\n]|[^/\\'\r\n])+\/))?)?p$/;
const sedPrintPrefix = /^sed[ \t]+-n[ \t]+('[^'\r\n]*')(?=[\s;|&<>)]|$)/;

export function sedPrintOperands(segment: string): string | undefined {
  const match = sedPrintPrefix.exec(segment);
  if (match && sedPrintScript.test(match[1]!.slice(1, -1))) return segment.slice(match[0].length);
}

/** Replace only a quoted print program in command position. Keep its filenames,
 * redirections and process substitutions visible to the path scanner. */
export function maskSedPrintScripts(command: string): string {
  return command.replace(
    /(?:^|[;|&\n]|[<>]\(|\$\()[ \t]*sed[ \t]+-n[ \t]+('[^'\r\n]*')(?=[\s;|&<>)]|$)|'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]/g,
    (literal, script: string | undefined) =>
      script && sedPrintScript.test(script.slice(1, -1)) ? literal.slice(0, -script.length) + "'p'" : literal,
  );
}

export function isLiteralEcho(segment: string): boolean {
  return /^echo(?:[ \t]+(?:'[^'\r\n]*'|"[^"\\$`\r\n]*"|[^\s"'\\$`;|&<>()[\]{}*?!#]+))*[ \t]*$/.test(segment);
}

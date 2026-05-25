/**
 * Recognize the canonical CHT `resolvedIf` pattern:
 *
 *   function (contact, report, event, dueDate) {
 *     return isFormArraySubmittedInWindow(
 *       contact.reports,
 *       FORMS.SOMETHING,
 *       Utils.addDate(dueDate, -event.start).getTime(),
 *       Utils.addDate(dueDate, event.end + 1).getTime()
 *     );
 *   }
 *
 * Lifted as: "Resolves when form FORMS.SOMETHING is submitted within event
 * window." The form constant name is editable in the UI.
 */

export type ResolvedIfPattern =
  | { kind: 'submitted_in_window'; formsRef: string }
  | { kind: 'identifier'; name: string }
  | { kind: 'raw'; text: string };

export function parseResolvedIf(source: string): ResolvedIfPattern {
  const trimmed = source.trim();

  // Pattern 1: bare identifier like `checkTaskResolvedForHomeVisit`.
  if (/^[a-zA-Z_$][\w$]*$/.test(trimmed)) {
    return { kind: 'identifier', name: trimmed };
  }

  // Pattern 2: the canonical isFormArraySubmittedInWindow shape.
  // Find `isFormArraySubmittedInWindow(`.
  const callIdx = trimmed.indexOf('isFormArraySubmittedInWindow');
  if (callIdx >= 0) {
    const parenStart = trimmed.indexOf('(', callIdx);
    if (parenStart >= 0) {
      const args = readArgList(trimmed, parenStart);
      if (args && args.length >= 2) {
        const formsRef = args[1]?.trim() ?? '';
        return { kind: 'submitted_in_window', formsRef };
      }
    }
  }

  return { kind: 'raw', text: trimmed };
}

export function serializeResolvedIf(pattern: ResolvedIfPattern): string {
  switch (pattern.kind) {
    case 'identifier':
      return pattern.name;
    case 'submitted_in_window':
      return `function (contact, report, event, dueDate) {
      return isFormArraySubmittedInWindow(
        contact.reports,
        ${pattern.formsRef},
        Utils.addDate(dueDate, -event.start).getTime(),
        Utils.addDate(dueDate, event.end + 1).getTime()
      );
    }`;
    case 'raw':
      return pattern.text;
  }
}

/** Read a balanced ( ... ) argument list starting at `start` (an open paren). */
function readArgList(src: string, start: number): string[] | null {
  if (src[start] !== '(') return null;
  let depth = 0;
  let i = start;
  let argStart = start + 1;
  const args: string[] = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0 && c === ')') {
        args.push(src.slice(argStart, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(argStart, i));
      argStart = i + 1;
    }
    i++;
  }
  return null;
}

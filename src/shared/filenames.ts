// These rules apply to both filenames and individual folder names on Windows.
export function filenameProblem(name: string): string | null {
  if (!name || name === '.' || name === '..') return 'Enter a filename.';
  if (/[<>:"/\\|?*]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32))
    return 'Names cannot contain path separators or Windows reserved characters.';
  if (/[. ]$/.test(name)) return 'Names cannot end in a dot or space.';
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name))
    return 'This is a reserved Windows name.';
  if (name.length > 255) return 'A name must be at most 255 characters.';
  return null;
}

export function folderProblem(value: string): string | null {
  if (!value) return 'Enter a folder path beneath Root Footage.';
  if (value.length > 1500) return 'A folder path must be at most 1,500 characters.';
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.' || part === '..')
      return 'Use folder names beneath Root Footage, without empty, . or .. segments.';
    const problem = filenameProblem(part);
    if (problem) return `Invalid folder “${part}”: ${problem}`;
  }
  return null;
}

let sessionToken: string | null = null;
let clipReviewAvailable = false;
async function session() {
  const response = await fetch('/api/session');
  if (!response.ok)
    throw new Error('Cannot connect to Footage Organizer. Start the local app and reload.');
  const data = await response.json();
  sessionToken = data.token;
  clipReviewAvailable = data.features?.includes('clip-review-v1') ?? false;
}
export async function api<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!sessionToken) await session();
  if (!clipReviewAvailable && url !== '/shutdown')
    throw new Error(
      'The app has been updated. Stop and relaunch Footage Organizer, then reload this page to enable clip review.',
    );
  const response = await fetch(`/api${url}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Organizer-Token': sessionToken! },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(problem.error || 'The request could not be completed.');
  }
  return response.json() as Promise<T>;
}
export function download(name: string, value: unknown, type = 'application/json') {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
    type,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

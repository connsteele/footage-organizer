const pendingSaves = new Set<() => Promise<void>>();

export function registerPendingSave(save: () => Promise<void>) {
  pendingSaves.add(save);
  return () => {
    pendingSaves.delete(save);
  };
}

export async function saveBeforeStop() {
  await Promise.all([...pendingSaves].map((save) => save()));
}

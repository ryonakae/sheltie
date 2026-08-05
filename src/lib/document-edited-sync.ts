export function createDocumentEditedSync(
  update: (edited: boolean) => Promise<void>,
): (edited: boolean) => Promise<void> {
  let pending = Promise.resolve();

  return (edited) => {
    const execution = pending.then(() => update(edited));
    pending = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  };
}

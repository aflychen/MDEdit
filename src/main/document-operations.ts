export class DocumentOperationQueue {
  private pending: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.pending.catch(() => undefined).then(operation)
    this.pending = work
    return work
  }
}

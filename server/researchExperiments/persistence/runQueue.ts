/**
 * 进程内实验任务队列。
 *
 * 目标不是替代生产级任务系统，而是先切断「tRPC 长请求直接等于实验执行生命周期」
 * 这条路径：创建 Run 后立即返回，实际执行由有界并发队列推进。
 *
 * 边界：当前为单进程队列；多实例部署时必须替换为持久化任务系统。该限制通过
 * `kind = "in-process"` 明示，不做跨进程假承诺。
 */

export interface ExperimentRunQueue {
  readonly kind: "in-process";
  readonly concurrency: number;
  enqueue(job: () => Promise<void>): void;
  activeCount(): number;
  queuedCount(): number;
  drain(): Promise<void>;
}

export function createExperimentRunQueue(options?: { concurrency?: number }): ExperimentRunQueue {
  const concurrency = Math.max(
    1,
    Math.floor(options?.concurrency ?? Number(process.env.EXPERIMENT_RUN_CONCURRENCY ?? 1)),
  );
  const pending: Array<() => Promise<void>> = [];
  let active = 0;
  let idleWaiters: Array<() => void> = [];

  function resolveIdleIfNeeded(): void {
    if (active === 0 && pending.length === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  function pump(): void {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      active += 1;
      void job()
        .catch((error) => {
          // 任务主体负责把失败写回 Run；这里只防止队列吞掉未处理 rejection。
          console.error(
            "[researchExperiments.runQueue] background job rejected:",
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => {
          active -= 1;
          pump();
          resolveIdleIfNeeded();
        });
    }
    resolveIdleIfNeeded();
  }

  return {
    kind: "in-process",
    concurrency,
    enqueue(job) {
      pending.push(job);
      pump();
    },
    activeCount: () => active,
    queuedCount: () => pending.length,
    drain() {
      if (active === 0 && pending.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };
}

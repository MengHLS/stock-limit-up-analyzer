/**
 * 成交明细的「证券名称 + 代码」字典（只读查询）。
 *
 * 为什么需要它：闭环回测结果里 `trades[].securityId` 是 Research canonical identity
 * `sec_<uuid>`，直接印在表格里用户看不懂。名称与代码必须由服务端解析
 * （`researchRun.securityLabels`：identifier history → limit_up_records），
 * 前端**不做**任何身份翻译。
 *
 * 为什么会话级缓存：同一次回测的成交标的集合在一次页面停留内不会变，
 * `staleTime` 设 5 分钟可避免切换标签页 / 重渲染时反复往返。
 * 🔴 查询失败**不抛错**：名称属展示增强，失败就在表格里回退显示原始 securityId，
 *    绝不让「查不到名字」把整块回测结果带崩。
 */

import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { trpc } from "@/lib/trpc";

/** 服务端返回的单个标签（与 `shared/researchContracts.securityLabelSchema` 同形）。 */
export interface SecurityLabelView {
  securityId: string;
  code: string | null;
  name: string | null;
  exchange: string | null;
}

/**
 * 单次查询的分片大小。
 *
 * 旧实现硬截断到前 80 个 identity，导致 1,000+ 笔的留档里大量证券退化成
 * `sec_<uuid>`。现在不再截断：按服务端契约的上限（500）分片，每片一个查询。
 *
 * 🔴 分片**不是**为了绕开 URL 长度：这些 identity 每个 ~68 字符，塞进 GET query
 * string 会撞上 Node 的请求行上限。该查询在 `main.tsx` 里被 `splitLink` 单独路由到
 * POST 批处理，入参走请求体 ⇒ 长度不再是约束，分片只为对齐服务端 500 的上限。
 */
const LABEL_QUERY_CHUNK_SIZE = 500;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LABEL_QUERY_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + LABEL_QUERY_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * 分片结果的小型外部 store。
 *
 * 为什么不用 `useQueries`：本机 tRPC v11 + react-query v5 的 `useQueries` 动态列表
 * 实测只会停在 `pending`（查询键算得出来、请求却发不出去）。改成「每片一个官方
 * `useQuery` 子组件 + 模块级缓存」后，批处理链路完全交给 tRPC，行为与单查询一致。
 *
 * 用 `useSyncExternalStore` 而不是把回调塞进 React state：回调在渲染/提交期写入不会
 * 触发「渲染中 setState」警告，且多个年份区块共享同一片缓存时不重复请求。
 */
interface ChunkState {
  data: Record<string, SecurityLabelView> | null;
  isLoading: boolean;
}

const EMPTY_CHUNK_STATE: ChunkState = { data: null, isLoading: false };

const chunkStore = (() => {
  const states = new Map<string, ChunkState>();
  const listeners = new Map<string, Set<() => void>>();

  const emit = (chunkKey: string) => {
    const set = listeners.get(chunkKey);
    if (set === undefined) return;
    for (const listener of set) listener();
  };

  return {
    subscribe(chunkKey: string, listener: () => void): () => void {
      const set = listeners.get(chunkKey) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(chunkKey, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(chunkKey);
      };
    },
    get(chunkKey: string): ChunkState {
      return states.get(chunkKey) ?? EMPTY_CHUNK_STATE;
    },
    set(chunkKey: string, next: ChunkState): void {
      const prev = states.get(chunkKey);
      if (
        prev !== undefined &&
        prev.data === next.data &&
        prev.isLoading === next.isLoading
      ) {
        return;
      }
      states.set(chunkKey, next);
      emit(chunkKey);
    },
  };
})();

export function useSecurityLabels(securityIds: readonly string[]): {
  /** `securityId → 标签`；未加载完成或查询失败时为 null（调用方回退显示原始 id）。 */
  labels: Record<string, SecurityLabelView> | null;
  isLoading: boolean;
} {
  // 稳定 key：trade 列表每次渲染都可能产生新数组，用拼接串做依赖避免无限重查。
  const key = useMemo(
    () => Array.from(new Set(securityIds.filter(id => id.length > 0))).sort().join("|"),
    [securityIds],
  );
  const ids = useMemo(() => (key.length === 0 ? [] : key.split("|")), [key]);
  const chunks = useMemo(() => chunkIds(ids), [ids]);
  const chunkKeys = useMemo(
    () => chunks.map(chunk => chunk.join("|")),
    [chunks],
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = chunkKeys.map(chunkKey =>
        chunkStore.subscribe(chunkKey, listener),
      );
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [chunkKeys],
  );

  const cachedRef = useRef<{
    keys: readonly string[];
    states: ChunkState[];
    snapshot: {
      labels: Record<string, SecurityLabelView> | null;
      isLoading: boolean;
    };
  } | null>(null);
  const getSnapshot = useCallback((): {
    labels: Record<string, SecurityLabelView> | null;
    isLoading: boolean;
  } => {
    const states = chunkKeys.map(chunkKey => chunkStore.get(chunkKey));
    const cached = cachedRef.current;
    if (
      cached !== null &&
      cached.keys === chunkKeys &&
      cached.states.length === states.length &&
      cached.states.every((state, index) => state === states[index])
    ) {
      return cached.snapshot;
    }
    const merged: Record<string, SecurityLabelView> = {};
    let isLoading = false;
    for (const state of states) {
      if (state.isLoading) isLoading = true;
      if (state.data === null) continue;
      for (const [securityId, label] of Object.entries(state.data)) {
        merged[securityId] = label;
      }
    }
    const snapshot = {
      labels: Object.keys(merged).length > 0 ? merged : null,
      isLoading: ids.length > 0 && isLoading,
    };
    cachedRef.current = { keys: chunkKeys, states, snapshot };
    return snapshot;
  }, [chunkKeys, ids.length]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 为一批 identity 启动分片查询（本身不渲染 UI）。
 *
 * 用官方 `useQuery` 而不是手搓 `useQueries`：查询键 / 批处理链路由 tRPC 自己拼，
 * 不会再出现「查询键算得出来但请求发不出去」这类只在运行时暴露的坑。每片独立
 * 缓存，切年 / 翻页都不重查。
 */
export function SecurityLabelChunks({
  securityIds,
}: {
  securityIds: readonly string[];
}) {
  const key = useMemo(
    () => Array.from(new Set(securityIds.filter(id => id.length > 0))).sort().join("|"),
    [securityIds],
  );
  const chunks = useMemo(
    () => chunkIds(key.length === 0 ? [] : key.split("|")),
    [key],
  );
  return createElement(
    Fragment,
    null,
    chunks.map(chunk =>
      createElement(SecurityLabelChunk, {
        key: chunk.join("|"),
        securityIds: chunk,
      }),
    ),
  );
}

function SecurityLabelChunk({
  securityIds,
}: {
  securityIds: readonly string[];
}) {
  const chunkKey = securityIds.join("|");
  const input = useMemo(() => ({ securityIds: [...securityIds] }), [chunkKey]);
  const query = trpc.researchRun.securityLabels.useQuery(input, {
    enabled: securityIds.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const data = (query.data as Record<string, SecurityLabelView> | undefined) ?? null;

  useEffect(() => {
    chunkStore.set(chunkKey, { data, isLoading: query.isLoading });
  }, [chunkKey, data, query.isLoading]);

  return null;
}

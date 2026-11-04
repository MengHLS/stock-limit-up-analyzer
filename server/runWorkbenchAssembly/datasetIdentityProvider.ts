import { eq } from "drizzle-orm";
import { researchSecurityIdentifierHistory } from "../../drizzle/schema";
import { getDb } from "../db";
import type { FirstLimitPullbackEvent } from "../datasetRegistry/types";
import { identifierRowToSecurityIdentifier } from "../historicalState/mappers";
import { canonicalCode, parseSecurityCode } from "../security/code";
import { resolveSecurityIdByEngineKey } from "../security/engineKeyBridge";
import type { SecurityIdentifier } from "../security/types";
import { RegistryDatasetBridgeError } from "./bridgeError";

/**
 * 载入 primary 标识全量，用于 symbol（代码域）→ canonical `sec_<uuid>` 桥接。
 *
 * 该表当前只有数千行；一次载入比按 symbol 分批查询更稳定，也不会引入批大小差异。
 */
export async function loadPrimaryIdentifiers(): Promise<
  readonly SecurityIdentifier[]
> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .where(eq(researchSecurityIdentifierHistory.identifierType, "primary"));
  return rows.map(identifierRowToSecurityIdentifier);
}

/**
 * 事件 → canonical `securityId`，asOf 使用事件自己的 tradeDate。
 *
 * 逐事件解析是身份正确性的硬要求：同一代码可能在不同历史区间属于不同证券。
 * 任一事件无法唯一解析时直接抛 `RegistryDatasetBridgeError`，绝不退回代码冒充身份。
 */
export function resolveSecurityIdsByEvent(
  events: readonly FirstLimitPullbackEvent[],
  identifiers: readonly SecurityIdentifier[]
): Map<string, string> {
  const byEngineKey = indexIdentifiersByEngineKey(identifiers);
  return resolveSecurityIdsByEventFromIndex(events, byEngineKey);
}

function indexIdentifiersByEngineKey(
  identifiers: readonly SecurityIdentifier[]
): Map<string, SecurityIdentifier[]> {
  const byEngineKey = new Map<string, SecurityIdentifier[]>();
  for (const identifier of identifiers) {
    let engineKey: string;
    try {
      engineKey = canonicalCode({
        digits: identifier.code,
        exchange: identifier.exchange,
      });
    } catch {
      continue;
    }
    const list = byEngineKey.get(engineKey);
    if (list === undefined) byEngineKey.set(engineKey, [identifier]);
    else list.push(identifier);
  }
  return byEngineKey;
}

function resolveSecurityIdsByEventFromIndex(
  events: readonly FirstLimitPullbackEvent[],
  byEngineKey: ReadonlyMap<string, readonly SecurityIdentifier[]>
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const event of events) {
    let engineKey: string;
    try {
      engineKey = canonicalCode(parseSecurityCode(event.symbol));
    } catch {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `直读桥：事件 ${event.eventId} 的 symbol=${JSON.stringify(event.symbol)} 不是合法完整代码，` +
          `无法桥接到 canonical securityId（回落重建并如实记录）。`
      );
    }
    const segments = byEngineKey.get(engineKey);
    const lookup =
      segments === undefined
        ? ({ ok: false, reason: "NO_IDENTIFIER" } as const)
        : resolveSecurityIdByEngineKey(segments, engineKey, event.tradeDate);
    if (!lookup.ok) {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `直读桥：事件 ${event.eventId}（symbol=${event.symbol}）在 ${event.tradeDate} ` +
          `无法解析到唯一 canonical securityId（${lookup.reason}${
            lookup.reason === "AMBIGUOUS" ? ` / matches=${lookup.matches}` : ""
          }）。` +
          `🔴 不退回用代码冒充身份（那会让留档/成交明细键域与重建路径不一致）⇒ 回落重建并如实记录。`
      );
    }
    resolved.set(event.eventId, lookup.securityId);
  }
  return resolved;
}

/**
 * 一次导出生命周期内复用的身份解析器。
 *
 * Identifier History 是跨区小表，但全表读一次约 19s；导出按 5,000 事件分页，
 * 如果每页重读，73k 事件会把同一份不可变版本数据读约 15 次。本工厂把
 * 「载入 primary 标识」限制为一次，同时按 engineKey 建一次索引，分页只做 PIT 匹配。
 */
export function createCachedDatasetIdentityResolver(
  options: {
    loadIdentifiers?: () => Promise<readonly SecurityIdentifier[]>;
  } = {}
): (
  datasetVersionId: number,
  events: readonly FirstLimitPullbackEvent[]
) => Promise<Map<string, string>> {
  const loadIdentifiers = options.loadIdentifiers ?? loadPrimaryIdentifiers;
  let cached: { byEngineKey: Map<string, SecurityIdentifier[]> } | undefined;
  let pending:
    | Promise<{ byEngineKey: Map<string, SecurityIdentifier[]> }>
    | undefined;

  const load = (): Promise<{
    byEngineKey: Map<string, SecurityIdentifier[]>;
  }> => {
    if (cached) return Promise.resolve(cached);
    pending ??= loadIdentifiers()
      .then(identifiers => {
        const value = {
          byEngineKey: indexIdentifiersByEngineKey(identifiers),
        };
        cached = value;
        return value;
      })
      .finally(() => {
        // A failed load must not poison later retries with a rejected promise.
        pending = undefined;
      });
    return pending;
  };

  return async (_datasetVersionId, events) => {
    return resolveSecurityIdsByEventFromIndex(
      events,
      (await load()).byEngineKey
    );
  };
}

export async function resolveDatasetEventIdentities(
  _datasetVersionId: number,
  events: readonly FirstLimitPullbackEvent[]
): Promise<Map<string, string>> {
  const identifiers = await loadPrimaryIdentifiers();
  return resolveSecurityIdsByEvent(events, identifiers);
}

export interface DatasetIdentityProvider {
  resolveSecurityIdsByEvent(
    datasetVersionId: number,
    events: readonly FirstLimitPullbackEvent[]
  ): Promise<Map<string, string>>;
}

export const defaultDatasetIdentityProvider: DatasetIdentityProvider = {
  resolveSecurityIdsByEvent: resolveDatasetEventIdentities,
};

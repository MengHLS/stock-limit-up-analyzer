/**
 * Dataset Provider Registry.
 *
 * 实验核心只依赖 registry + 契约，不再知道某个 datasetCode 用哪张表、如何读。
 * 当前第一个 provider 仍复用既有 `createRegistryExperimentDatasetPort` 的行为；
 * 新增 Dataset 时只需注册新的 provider，不修改 Runner / Experiment Port。
 */

import type {
  ExperimentDescriptor,
  ExperimentDatasetRequirement,
  ExperimentDatasetVersionOption,
  ExperimentEvaluationWindow,
} from "@shared/researchExperimentsContracts";
import {
  createRegistryExperimentDatasetPort,
  type ExperimentAccessStats,
  type ExperimentDatasetPort,
} from "./datasetPort";
import type { ExperimentDatasetFacts } from "./types";
import type { ExperimentDatasetAccess } from "@shared/researchExperimentsContracts";
import type { ResearchDatasetReader } from "../researchRuntime/datasetReader";

export interface ExperimentDatasetProvider {
  readonly datasetCode: string;
  getVersionFacts(datasetVersionId: number): Promise<ExperimentDatasetFacts | null>;
  listVersionOptions(filter?: {
    datasetCode?: string;
  }): Promise<ExperimentDatasetVersionOption[]>;
  createAccess(args: {
    descriptor: ExperimentDescriptor;
    requirement: ExperimentDatasetRequirement;
    facts: ExperimentDatasetFacts;
    evaluationWindow?: ExperimentEvaluationWindow | null;
  }): {
    access: ExperimentDatasetAccess;
    stats: ExperimentAccessStats;
    freezeSelection: (eventIds: readonly string[]) => void;
  };
}

export class ExperimentDatasetProviderRegistry {
  private readonly providers = new Map<string, ExperimentDatasetProvider>();

  register(provider: ExperimentDatasetProvider): void {
    if (this.providers.has(provider.datasetCode)) {
      throw new Error(`Dataset Provider 已注册，禁止覆盖：${provider.datasetCode}`);
    }
    this.providers.set(provider.datasetCode, provider);
  }

  has(datasetCode: string): boolean {
    return this.providers.has(datasetCode);
  }

  require(datasetCode: string): ExperimentDatasetProvider {
    const provider = this.providers.get(datasetCode);
    if (provider === undefined) {
      throw new Error(
        `Dataset Provider 未注册：${datasetCode}（已注册：${this.list().map((p) => p.datasetCode).join(", ") || "无"}）`,
      );
    }
    return provider;
  }

  list(): ExperimentDatasetProvider[] {
    return [...this.providers.values()].sort((a, b) =>
      a.datasetCode.localeCompare(b.datasetCode),
    );
  }
}

export function createRegistryProtocolDatasetProvider(deps: {
  datasetCode: string;
  reader: Pick<
    ResearchDatasetReader,
    "getVersionContext" | "loadEventPage" | "loadPrefixBars" | "loadPostBars"
  >;
  listVersionOptions?: (filter?: {
    datasetCode?: string;
  }) => Promise<ExperimentDatasetVersionOption[]>;
  eventScanLimit?: number;
  eventPageSize?: number;
  barBatchSize?: number;
}): ExperimentDatasetProvider {
  const port = createRegistryExperimentDatasetPort({
    reader: deps.reader,
    ...(deps.listVersionOptions !== undefined
      ? { listVersionOptions: deps.listVersionOptions }
      : {}),
    ...(deps.eventScanLimit !== undefined ? { eventScanLimit: deps.eventScanLimit } : {}),
    ...(deps.eventPageSize !== undefined ? { eventPageSize: deps.eventPageSize } : {}),
    ...(deps.barBatchSize !== undefined ? { barBatchSize: deps.barBatchSize } : {}),
  });
  return {
    datasetCode: deps.datasetCode,
    async getVersionFacts(datasetVersionId) {
      const facts = await port.getVersionFacts(datasetVersionId);
      return facts?.datasetCode === deps.datasetCode ? facts : null;
    },
    async listVersionOptions(filter) {
      if (filter?.datasetCode !== undefined && filter.datasetCode !== deps.datasetCode) {
        return [];
      }
      return port.listVersionOptions(filter);
    },
    createAccess(args) {
      return port.createAccess(args);
    },
  };
}

export function createProviderExperimentDatasetPort(deps: {
  registry: ExperimentDatasetProviderRegistry;
}): ExperimentDatasetPort {
  return {
    async getVersionFacts(datasetVersionId) {
      for (const provider of deps.registry.list()) {
        const facts = await provider.getVersionFacts(datasetVersionId);
        if (facts !== null) return facts;
      }
      return null;
    },
    async listVersionOptions(filter) {
      const options: ExperimentDatasetVersionOption[] = [];
      for (const provider of deps.registry.list()) {
        options.push(...(await provider.listVersionOptions(filter)));
      }
      return options.sort((a, b) =>
        a.datasetCode === b.datasetCode
          ? b.datasetVersionId - a.datasetVersionId
          : a.datasetCode.localeCompare(b.datasetCode),
      );
    },
    createAccess(args) {
      const requirement = args.requirement ?? args.descriptor.datasetRequirement;
      return deps.registry.require(requirement.datasetCode).createAccess({
        ...args,
        requirement,
      });
    },
  };
}

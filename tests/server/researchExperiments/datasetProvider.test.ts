import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  ExperimentDatasetFacts,
} from "@shared/researchExperimentsContracts";
import type { ExperimentDefinition } from "@shared/researchExperimentsContracts";
import {
  ExperimentDatasetProviderRegistry,
  createRegistryProtocolDatasetProvider,
  createProviderExperimentDatasetPort,
  type ExperimentDatasetProvider,
} from "../../../server/researchExperiments/datasetProvider";
import type { ExperimentAccessStats } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";

function facts(datasetVersionId: number, datasetCode: string): ExperimentDatasetFacts {
  return {
    datasetVersionId,
    datasetCode,
    datasetName: datasetCode,
    datasetVersionLabel: "v1",
    status: "READY",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    totalEvents: 0,
    postRelativeDayRange: null,
  };
}

function fakeProvider(
  datasetCode: string,
  datasetVersionId: number,
): ExperimentDatasetProvider {
  const versionFacts = facts(datasetVersionId, datasetCode);
  return {
    datasetCode,
    async getVersionFacts(id) {
      return id === datasetVersionId ? versionFacts : null;
    },
    async listVersionOptions(filter) {
      return filter?.datasetCode === undefined || filter.datasetCode === datasetCode
        ? [
            {
              datasetVersionId,
              datasetCode,
              datasetName: datasetCode,
              version: "v1",
              status: "READY",
              startDate: versionFacts.startDate,
              endDate: versionFacts.endDate,
              totalEvents: 0,
            },
          ]
        : [];
    },
    createAccess(args) {
      const stats: ExperimentAccessStats = {
        eventCount: 0,
        eventPageCount: 0,
        barQueryCount: 0,
        prefixRowCount: 0,
        postRowCount: 0,
        maxPostRelativeDayRead: null,
        eventScanTruncated: false,
        eventScanPolicy: "PLATFORM_LIMIT",
        eventScanLimit: 20_000,
        selectionFrozen: false,
        selectedEventCount: 0,
      };
      const access = {
        facts: args.facts,
        async events() {
          return [];
        },
        eventPages: async function* () {
          return;
        },
        async feature() {
          return [];
        },
        async observation() {
          return [];
        },
      };
      return {
        access,
        stats,
        freezeSelection() {},
      };
    },
  };
}

describe("Experiment Dataset Provider Registry", () => {
  it("Registry Provider 不得把别的 datasetCode 版本冒领为自己的版本", async () => {
    const context: ResearchDatasetVersionContext = {
      datasetVersionId: 41,
      datasetId: 51,
      datasetCode: "actual_ds",
      datasetName: "actual",
      versionLabel: "v1",
      status: "READY",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      totalEvents: 0,
      horizons: [],
      pathRelativeDayRange: null,
      postRelativeDayRange: null,
      decisionOffsetDays: null,
    };
    const provider = createRegistryProtocolDatasetProvider({
      datasetCode: "expected_ds",
      reader: new InMemoryResearchDatasetReader({
        context,
        events: [],
        prefixBars: [],
        postBars: [],
      }),
    });
    expect(await provider.getVersionFacts(context.datasetVersionId)).toBeNull();
  });

  it("按 datasetCode 路由，禁止重复注册，未注册立即拒绝", async () => {
    const registry = new ExperimentDatasetProviderRegistry();
    registry.register(fakeProvider("primary_ds", 1));
    registry.register(fakeProvider("aux_ds", 2));
    expect(() => registry.register(fakeProvider("primary_ds", 3))).toThrow(/禁止覆盖/u);
    expect(() => registry.require("missing_ds")).toThrow(/未注册/u);

    const port = createProviderExperimentDatasetPort({ registry });
    expect(await port.getVersionFacts(2)).toMatchObject({ datasetCode: "aux_ds" });
    expect(await port.getVersionFacts(999)).toBeNull();
    expect((await port.listVersionOptions()).map((item) => item.datasetCode)).toEqual([
      "aux_ds",
      "primary_ds",
    ]);
  });

  it("Runner 可同时注入 primary 与 auxiliary Dataset，并返回完整 bindings", async () => {
    const registry = new ExperimentDatasetProviderRegistry();
    registry.register(fakeProvider("primary_ds", 1));
    registry.register(fakeProvider("aux_ds", 2));
    const port = createProviderExperimentDatasetPort({ registry });
    const definition: ExperimentDefinition = {
      descriptor: {
        id: "demo/multi-dataset",
        name: "multi",
        version: "1.0.0",
        description: "multi dataset",
        source: "test",
        parameters: [],
        datasetRequirement: {
          datasetCode: "primary_ds",
          requiredColumns: { events: ["x"] },
          decisionOffsetDays: null,
          usesForwardData: false,
        },
        auxiliaryDatasetRequirements: [
          {
            alias: "aux",
            requirement: {
              datasetCode: "aux_ds",
              requiredColumns: { events: ["x"] },
              decisionOffsetDays: null,
              usesForwardData: false,
            },
          },
        ],
        pageKey: "demo/multi-dataset",
        pageTitle: "multi",
      },
      resultSchema: z.object({ auxCount: z.number().int() }),
      async run(context) {
        const rows = await context.datasets.aux!.events();
        return {
          sampleSummary: {
            candidateCount: 0,
            eligibleCount: 0,
            excludedCount: 0,
            excludedByReason: {},
          },
          customPayload: { auxCount: rows.length },
        };
      },
    };
    const experimentRegistry = new ExperimentRegistry();
    experimentRegistry.register(definition);
    const runner = createExperimentRunner({
      registry: experimentRegistry,
      datasetPort: port,
    });
    const outcome = await runner.run({
      experimentId: "demo/multi-dataset",
      datasetVersionId: 1,
      auxiliaryDatasetVersionIds: { aux: 2 },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.result?.metadata.datasetBindings).toEqual([
      { alias: "primary", datasetVersionId: 1, datasetCode: "primary_ds", datasetVersionLabel: "v1" },
      { alias: "aux", datasetVersionId: 2, datasetCode: "aux_ds", datasetVersionLabel: "v1" },
    ]);
  });
});

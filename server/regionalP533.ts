import {
  getPropagationRegion,
  resolveRegionalPathSamples,
  type RegionalPathSample,
  type SampledRegionDefinition,
} from '../src/propagation/regionalDestinations';
import {P533_SUPPORTED_BANDS} from '../src/propagation/domain';
import {
  buildRegionalP533CircuitRequest,
  getRegionalP533Assumptions,
  getRegionalP533UnsupportedBands,
  isRegionalP533RequestDateValid,
  summarizeRegionalP533Samples,
  toRegionalP533SampleResult,
  type RegionalP533BandResult,
  type RegionalP533Request,
  type RegionalP533Result,
} from '../src/propagation/regionalP533';
import {executeP533Circuit} from './p533Engine';
import type {P533CircuitExecution} from '../src/propagation/p533';

export async function executeRegionalP533(request: RegionalP533Request): Promise<RegionalP533Result> {
  const started = Date.now();
  const region = getPropagationRegion(request.regionId);
  const assumptions = getRegionalP533Assumptions(request.referenceProfile);
  const base = {
    regionId: request.regionId,
    regionLabel: region?.label ?? request.regionId,
    operatingLocation: request.operatingLocation,
    stationProfile: request.stationProfile,
    assumptions,
    modeledAtUtc: new Date().toISOString(),
    ssn: request.ssn,
    unsupportedBands: getRegionalP533UnsupportedBands(),
    provenance: { sourceState: 'modeled' as const, model: 'ITU-R P.533' as const, recommendation: 'P.533-14' as const, engine: 'ITU-R-HF v14.3' as const, assetProvenance: null },
  };
  if (!region) return { ...base, status: 'unavailable', bandResults: [], reason: 'Unknown propagation region.', sampleCount: 0, executionCount: 0, elapsedMs: Date.now() - started };
  if (region.kind === 'local_nvis') return { ...base, status: 'not_applicable', bandResults: [], reason: 'Local / NVIS requires a separate evaluator and is not a long-path P.533 regional result.', sampleCount: 0, executionCount: 0, elapsedMs: Date.now() - started };
  if (!isRegionalP533RequestDateValid(request.modelDateTimeUtc) || !Number.isFinite(request.ssn) || request.ssn < 0 || request.ssn > 400) {
    return { ...base, status: 'unavailable', bandResults: [], reason: 'Regional P.533 model date/time or SSN is invalid.', sampleCount: 0, executionCount: 0, elapsedMs: Date.now() - started };
  }
  const paths = resolveRegionalPathSamples(request.operatingLocation, region as SampledRegionDefinition);
  if (paths.status !== 'resolved') return { ...base, status: 'unavailable', bandResults: [], reason: paths.reason ?? 'Regional path samples are unavailable.', sampleCount: 0, executionCount: 0, elapsedMs: Date.now() - started };

  const bandResults: RegionalP533BandResult[] = [];
  let executionCount = 0;
  let assetProvenance = null;
  for (const band of P533_SUPPORTED_BANDS) {
    const samples = [];
    for (const sample of paths.samples) {
      const execution = await executeSample(request, sample, band);
      executionCount += 1;
      if (execution.ok) assetProvenance = execution.result.assetProvenance;
      samples.push(toRegionalP533SampleResult(region.id, sample, band, request.stationProfile, assumptions, execution));
    }
    bandResults.push({ band, modelFrequencyMHz: samples[0]?.modelFrequencyMHz ?? 0, samples, summary: summarizeRegionalP533Samples(samples) });
  }
  const failures = bandResults.reduce((count, band) => count + band.summary.failedSampleCount, 0);
  return { ...base, provenance: { ...base.provenance, assetProvenance }, status: failures === 0 ? 'complete' : failures === executionCount ? 'unavailable' : 'partial', bandResults, sampleCount: paths.samples.length, executionCount, elapsedMs: Date.now() - started };
}

async function executeSample(request: RegionalP533Request, sample: RegionalPathSample, band: typeof P533_SUPPORTED_BANDS[number]): Promise<P533CircuitExecution> {
  return executeP533Circuit(buildRegionalP533CircuitRequest(request, sample, band));
}
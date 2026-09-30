'use strict';

const {createHash} = require('node:crypto');
const {classificationMetrics, recallAtK, summarizeNonnegative, sumSafe, wilsonInterval} = require('./metrics');
const {QUESTION_VERSION, passageQuestions} = require('../models/questions');
const {routeDecision} = require('../models/policy');

const TASKS = Object.fromEntries(Object.entries(passageQuestions()).map(([name, question]) => [name, Object.keys(question.criteria)]));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const SPLITS = ['train', 'validation', 'test'];
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const keys = (object, required) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === required.length && required.every(key => Object.hasOwn(object, key));
const id = value => typeof value === 'string' && ID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const unique = values => new Set(values).size === values.length;
const QUESTION_SHA256 = digest(passageQuestions());
const POLICY_VERSION = routeDecision({type: 'choice', choice: 'insufficient', probabilities: {}, confidence: 0},
  {mode: 'shadow', highRisk: true}).policyVersion;
const POLICY_SHA256 = digest({version: POLICY_VERSION, source: routeDecision.toString()});

// Clone data before the first callback/await. Never hash a caller-owned object and
// later score from that same mutable reference. Functions are allowed only as
// model runners; all other non-JSON values and accessors are rejected.
function snapshot(value) {
  const seen = new WeakSet();
  let nodes = 0, bytes = 0;
  function copy(input, depth = 0, runner = false) {
    if (++nodes > 250000 || depth > 20) fail('snapshot_too_large');
    if (runner && typeof input === 'function') return input;
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isSafeInteger(input)) return input;
    if (typeof input === 'string') {
      bytes += Buffer.byteLength(input, 'utf8');
      if (bytes > 32000000 || input.length > 4096) fail('snapshot_too_large');
      return input;
    }
    if (!input || typeof input !== 'object' ||
        (Array.isArray(input) ? Object.getPrototypeOf(input) !== Array.prototype :
          Object.getPrototypeOf(input) !== Object.prototype) ||
        Reflect.ownKeys(input).some(key => typeof key === 'symbol') || seen.has(input))
      fail('invalid_snapshot_value');
    seen.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      if (input.length > 100000 || Object.keys(descriptors).length !== input.length + 1 ||
          Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))
        fail('invalid_snapshot_array');
      const out = Array.from({length: input.length}, (_, index) => {
        const descriptor = descriptors[index];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
          fail('invalid_snapshot_accessor');
        return copy(descriptor.value, depth + 1);
      });
      return Object.freeze(out);
    }
    const out = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) ||
          !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        fail('invalid_snapshot_accessor');
      bytes += Buffer.byteLength(key, 'utf8');
      if (bytes > 32000000) fail('snapshot_too_large');
      out[key] = copy(descriptor.value, depth + 1, key === 'run');
    }
    return Object.freeze(out);
  }
  return copy(value);
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('invalid_canonical_value');
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }

function validateManifest(manifest) {
  if (!keys(manifest, ['version', 'status', 'corpusId', 'corpusSha256', 'labelsSha256', 'eligibility',
    'exclusions', 'evidenceCutoffAt', 'reviewProtocol', 'retrievalConfig', 'claims', 'documents', 'cases', 'labels']) ||
      manifest.version !== 2 || !['incomplete', 'frozen'].includes(manifest.status) || !id(manifest.corpusId) ||
      !Array.isArray(manifest.claims) || !Array.isArray(manifest.documents) ||
      !Array.isArray(manifest.cases) || !Array.isArray(manifest.labels) ||
      !Array.isArray(manifest.exclusions) || manifest.exclusions.length > 100000 ||
      manifest.claims.length > 10000 || manifest.documents.length > 50000 || manifest.cases.length > 100000 ||
      manifest.labels.length !== manifest.cases.length) fail('invalid_manifest');
  if (!keys(manifest.eligibility, ['version', 'registrySha256']) || manifest.eligibility.version !== 'pilot-eligibility-v1' ||
      !keys(manifest.reviewProtocol, ['version', 'blinding', 'sha256']) ||
      manifest.reviewProtocol.version !== 'blind-two-reviewer-v1' ||
      manifest.reviewProtocol.blinding !== 'model-identity-and-output' ||
      !keys(manifest.retrievalConfig, ['version', 'sha256', 'cutoff']) ||
      manifest.retrievalConfig.version !== 'retrieval-v1' || manifest.retrievalConfig.cutoff !== 30)
    fail('invalid_manifest_metadata');
  if (manifest.status === 'frozen' && (!sha(manifest.corpusSha256) || !sha(manifest.labelsSha256) ||
      !sha(manifest.eligibility.registrySha256) || !sha(manifest.reviewProtocol.sha256) ||
      !sha(manifest.retrievalConfig.sha256) ||
      typeof manifest.evidenceCutoffAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.evidenceCutoffAt) ||
      !Number.isFinite(Date.parse(manifest.evidenceCutoffAt)) ||
      new Date(manifest.evidenceCutoffAt).toISOString().replace('.000Z', 'Z') !== manifest.evidenceCutoffAt ||
      !manifest.cases.length)) fail('invalid_manifest_hash');
  if (manifest.status === 'incomplete' && (manifest.corpusSha256 !== null || manifest.labelsSha256 !== null ||
      manifest.eligibility.registrySha256 !== null || manifest.reviewProtocol.sha256 !== null ||
      manifest.retrievalConfig.sha256 !== null || manifest.evidenceCutoffAt !== null ||
      manifest.exclusions.length || manifest.claims.length || manifest.documents.length ||
      manifest.cases.length || manifest.labels.length)) fail('incomplete_manifest_must_be_empty');
  for (const exclusion of manifest.exclusions)
    if (!keys(exclusion, ['caseId', 'reason', 'replacementCaseId']) || !id(exclusion.caseId) ||
        !['duplicate', 'technically_invalid'].includes(exclusion.reason) || !id(exclusion.replacementCaseId) ||
        exclusion.caseId === exclusion.replacementCaseId) fail('invalid_exclusion');
  if (!unique(manifest.exclusions.map(x => x.caseId)) ||
      !unique(manifest.exclusions.map(x => x.replacementCaseId))) fail('duplicate_exclusion');
  for (const entry of [...manifest.claims, ...manifest.documents])
    if (!keys(entry, ['id', 'sha256']) || !id(entry.id) || !sha(entry.sha256)) fail('invalid_asset');
  if (!unique(manifest.claims.map(x => x.id)) || !unique(manifest.documents.map(x => x.id))) fail('duplicate_asset');
  const claims = new Set(manifest.claims.map(x => x.id));
  const documents = new Set(manifest.documents.map(x => x.id));
  const claimHash = new Map(manifest.claims.map(x => [x.id, x.sha256]));
  const documentHash = new Map(manifest.documents.map(x => [x.id, x.sha256]));
  for (const item of manifest.cases) {
    if (!keys(item, ['id', 'claimId', 'documentId', 'passageId', 'passageSha256', 'familyId', 'sourceChainId']) ||
        ![item.id, item.claimId, item.documentId, item.passageId, item.familyId, item.sourceChainId].every(id) ||
        !sha(item.passageSha256) || !claims.has(item.claimId) || !documents.has(item.documentId)) fail('invalid_case');
  }
  if (!unique(manifest.cases.map(x => x.id)) ||
      !unique(manifest.cases.map(x => `${x.claimId}\u0000${x.documentId}\u0000${x.passageId}`)) ||
      !unique(manifest.cases.map(x => `${claimHash.get(x.claimId)}\u0000${x.passageSha256}`))) fail('duplicate_case');
  const claimFamilies = new Map(), documentChains = new Map(), hashFamilies = new Map(),
    hashChains = new Map(), passageHashes = new Map();
  for (const item of manifest.cases) {
    if (claimFamilies.has(item.claimId) && claimFamilies.get(item.claimId) !== item.familyId) fail('inconsistent_family');
    if (documentChains.has(item.documentId) && documentChains.get(item.documentId) !== item.sourceChainId) fail('inconsistent_chain');
    if (hashFamilies.has(claimHash.get(item.claimId)) && hashFamilies.get(claimHash.get(item.claimId)) !== item.familyId)
      fail('inconsistent_family');
    if (hashChains.has(documentHash.get(item.documentId)) && hashChains.get(documentHash.get(item.documentId)) !== item.sourceChainId)
      fail('inconsistent_chain');
    if (passageHashes.has(item.passageId) && passageHashes.get(item.passageId) !== item.passageSha256)
      fail('inconsistent_passage');
    claimFamilies.set(item.claimId, item.familyId);
    documentChains.set(item.documentId, item.sourceChainId);
    hashFamilies.set(claimHash.get(item.claimId), item.familyId);
    hashChains.set(documentHash.get(item.documentId), item.sourceChainId);
    passageHashes.set(item.passageId, item.passageSha256);
  }
  const caseIds = new Set(manifest.cases.map(x => x.id));
  for (const exclusion of manifest.exclusions)
    if (caseIds.has(exclusion.caseId) || !caseIds.has(exclusion.replacementCaseId)) fail('invalid_exclusion');
  for (const label of manifest.labels) {
    if (!keys(label, ['caseId', 'relevance', 'relation', 'evidence_type', 'criticalCounterevidence', 'criticalCase', 'reviewers', 'adjudication']) ||
        !caseIds.has(label.caseId) || !Object.entries(TASKS).every(([task, classes]) => classes.includes(label[task])) ||
        typeof label.criticalCounterevidence !== 'boolean' || typeof label.criticalCase !== 'boolean' ||
        !Array.isArray(label.reviewers) || label.reviewers.length !== 2 ||
        !unique(label.reviewers.map(r => r.id)) ||
        label.reviewers.some(r => !keys(r, ['id', 'reviewMinutes', 'labelSha256']) || !id(r.id) || !uint(r.reviewMinutes) ||
          r.reviewMinutes > 10000 || !sha(r.labelSha256)) ||
        !keys(label.adjudication, ['status', 'reviewerId', 'reviewMinutes', 'disagreement']) ||
        !['agreed', 'adjudicated', 'unresolved'].includes(label.adjudication.status) ||
        (label.adjudication.reviewerId !== null && !id(label.adjudication.reviewerId)) ||
        !uint(label.adjudication.reviewMinutes) || label.adjudication.reviewMinutes > 10000 ||
        typeof label.adjudication.disagreement !== 'boolean' ||
        (label.adjudication.disagreement === (label.reviewers[0].labelSha256 === label.reviewers[1].labelSha256)) ||
        (label.adjudication.status === 'adjudicated' && (!label.adjudication.disagreement || !label.adjudication.reviewerId ||
          label.reviewers.some(r => r.id === label.adjudication.reviewerId))) ||
        (label.adjudication.status === 'agreed' && (label.adjudication.disagreement || label.adjudication.reviewerId !== null)) ||
        (manifest.status === 'frozen' && label.adjudication.status === 'unresolved') ||
        (label.criticalCounterevidence && label.relation !== 'contradicts')) fail('invalid_label');
  }
  if (!unique(manifest.labels.map(x => x.caseId))) fail('duplicate_label');
  if (manifest.status === 'frozen' && digest(manifest.labels) !== manifest.labelsSha256) fail('invalid_manifest_hash');
  return digest(manifest);
}

function validateSplit(split, manifest, manifestSha256) {
  if (!keys(split, ['version', 'status', 'manifestSha256', 'ratios', 'assignments']) || split.version !== 2 ||
      !['incomplete', 'frozen'].includes(split.status) || !keys(split.ratios, SPLITS) ||
      split.ratios.train !== 60 || split.ratios.validation !== 20 || split.ratios.test !== 20 ||
      !keys(split.assignments, SPLITS) || SPLITS.some(s => !Array.isArray(split.assignments[s]) ||
        split.assignments[s].length > 100000 || split.assignments[s].some(x => !id(x)))) fail('invalid_split');
  if (split.status === 'frozen' && (!sha(split.manifestSha256) || split.manifestSha256 !== manifestSha256)) fail('split_hash_mismatch');
  if (split.status === 'incomplete' && (split.manifestSha256 !== null || SPLITS.some(s => split.assignments[s].length)))
    fail('incomplete_split_must_be_empty');
  const assigned = SPLITS.flatMap(s => split.assignments[s].map(caseId => ({caseId, split: s})));
  if (assigned.length !== manifest.cases.length || !unique(assigned.map(x => x.caseId))) fail('split_case_mismatch');
  const byId = new Map(manifest.cases.map(c => [c.id, c]));
  const family = new Map(), chain = new Map(), passage = new Map();
  for (const row of assigned) {
    const item = byId.get(row.caseId);
    if (!item) fail('split_case_mismatch');
    for (const [map, key] of [[family, item.familyId], [chain, item.sourceChainId],
      [passage, item.passageSha256]]) {
      if (map.has(key) && map.get(key) !== row.split) fail('split_leakage');
      map.set(key, row.split);
    }
  }
  if (split.status === 'frozen' && family.size >= 5) {
    const counts = Object.fromEntries(SPLITS.map(s => [s, [...family.values()].filter(v => v === s).length]));
    if (SPLITS.some(s => Math.abs(counts[s] - family.size * split.ratios[s] / 100) >=
      (family.size % 5 === 0 ? 0.5 : 1.01))) fail('split_ratio_mismatch');
  }
  return digest(split);
}

function validateEvaluationMetadataSnapshot({manifest, split}) {
  const manifestSha256 = validateManifest(manifest);
  const splitSha256 = validateSplit(split, manifest, manifestSha256);
  return {manifest, split, manifestSha256, splitSha256};
}

function validateEvaluationMetadata(input) {
  return validateEvaluationMetadataSnapshot(snapshot(input));
}

function corpusReady(manifest) {
  return manifest.claims.length >= 50 && manifest.documents.length >= 100 &&
    manifest.labels.length >= 300 && manifest.labels.filter(label => label.criticalCase).length >= 50;
}

function retrievalSnapshotSha256(manifest) {
  if (!sha(manifest.corpusSha256) || !sha(manifest.retrievalConfig.sha256) ||
      manifest.retrievalConfig.cutoff !== 30) fail('invalid_retrieval_snapshot');
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const documents = manifest.documents.map(({id: assetId, sha256}) => ({id: assetId, sha256})).sort(byId);
  const passageById = new Map(manifest.cases.map(item => [item.passageId, item.passageSha256]));
  const passages = [...passageById].map(([assetId, sha256]) => ({id: assetId, sha256})).sort(byId);
  return digest({version: 1, corpusSha256: manifest.corpusSha256, documents, passages,
    retrievalConfig: manifest.retrievalConfig, evidenceCutoffAt: manifest.evidenceCutoffAt});
}

function validateModels(models, manifest) {
  if (!Array.isArray(models) || !models.length || models.length > 20 || !unique(models.map(m => m?.id))) fail('invalid_models');
  for (const model of models) {
    if (!keys(model, ['id', 'modelVersion', 'policyVersion', 'policySha256', 'questionVersion',
      'questionSha256', 'retrievalConfigSha256', 'mode', 'maxCostMicrodollarsPerCall', 'timeoutMs', 'run']) ||
        !id(model.id) || model.modelVersion !== 'jev-1.13.0' ||
        model.policyVersion !== POLICY_VERSION || model.policySha256 !== POLICY_SHA256 ||
        model.questionVersion !== QUESTION_VERSION || model.questionSha256 !== QUESTION_SHA256 ||
        model.retrievalConfigSha256 !== manifest.retrievalConfig.sha256 || model.mode !== 'cache' ||
        !uint(model.maxCostMicrodollarsPerCall) || !uint(model.timeoutMs) || model.timeoutMs < 1 ||
        model.timeoutMs > 30000 || typeof model.run !== 'function') fail('invalid_model');
  }
}

function validUsage(result, reserve) {
  return keys(result.usage, ['inputTokens', 'outputTokens', 'costMicrodollars']) &&
    Object.values(result.usage).every(uint) && result.usage.costMicrodollars <= reserve &&
    uint(result.latencyMs) && result.latencyMs <= 3600000;
}

function normalizeClassification(result, reserve) {
  if (!keys(result, ['status', 'predictions', 'latencyMs', 'usage']) ||
      !['ok', 'abstained', 'error'].includes(result.status) ||
      !validUsage(result, reserve) ||
      (result.status === 'ok' && (!keys(result.predictions, Object.keys(TASKS)) ||
        !Object.entries(TASKS).every(([task, classes]) => classes.includes(result.predictions[task])))) ||
      (result.status !== 'ok' && result.predictions !== null)) fail('invalid_runner_result');
  return result;
}

function normalizeRetrieval(result, reserve, query) {
  if (!keys(result, ['status', 'querySha256', 'retrievalSnapshotSha256', 'cutoff',
    'rankedPassageIds', 'latencyMs', 'usage']) ||
      !['ok', 'abstained', 'error'].includes(result.status) ||
      result.querySha256 !== query.sha256 || result.retrievalSnapshotSha256 !== query.retrievalSnapshotSha256 ||
      result.cutoff !== 30 || !validUsage(result, reserve) ||
      !Array.isArray(result.rankedPassageIds) || result.rankedPassageIds.length > 30 ||
      result.rankedPassageIds.some(x => !id(x)) || !unique(result.rankedPassageIds) ||
      (result.status !== 'ok' && result.rankedPassageIds.length !== 0)) fail('invalid_runner_result');
  return result;
}

async function runEvaluation(input) {
  const {manifest, split, models, budget, live = false} = snapshot(input);
  if (live !== false) fail('live_evaluation_not_supported');
  const {manifestSha256: manifestHash, splitSha256: splitHash} = validateEvaluationMetadataSnapshot({manifest, split});
  if (manifest.status !== 'frozen' || split.status !== 'frozen') fail('incomplete_corpus');
  const retrievalSnapshotHash = retrievalSnapshotSha256(manifest);
  validateModels(models, manifest);
  if (!keys(budget, ['maxMicrodollars', 'maxCalls']) || !uint(budget.maxMicrodollars) ||
      !uint(budget.maxCalls) || budget.maxCalls > 10000) fail('invalid_budget');
  const labelByCase = new Map(manifest.labels.map(x => [x.caseId, x]));
  const caseById = new Map(manifest.cases.map(x => [x.id, x]));
  const claimById = new Map(manifest.claims.map(x => [x.id, x]));
  const firstCaseByClaim = new Map();
  for (const item of manifest.cases) if (!firstCaseByClaim.has(item.claimId)) firstCaseByClaim.set(item.claimId, item);
  const classificationResults = [], retrievalResults = [];
  let remaining = budget.maxMicrodollars, calls = 0;
  async function perform(model, stage, payload, entry, normalize) {
    if (calls >= budget.maxCalls || remaining < model.maxCostMicrodollarsPerCall) {
      entry.status = 'budget_exhausted';
      return;
    }
    calls++;
    remaining -= model.maxCostMicrodollarsPerCall;
    let timer;
    const controller = new AbortController();
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => model.run(Object.freeze({stage, ...payload, signal: controller.signal}))),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, model.timeoutMs);
        })
      ]);
      if (raw === null || raw === undefined) return;
      const value = normalize(snapshot(raw), model.maxCostMicrodollarsPerCall);
      entry.status = value.status;
      entry.latencyMs = value.latencyMs;
      entry.usage = {...value.usage};
      if (stage === 'classification') entry.predictions = value.predictions === null ? null : {...value.predictions};
      else entry.rankedPassageIds = [...value.rankedPassageIds];
      remaining += model.maxCostMicrodollarsPerCall - value.usage.costMicrodollars;
    } catch { entry.status = 'error'; }
    finally { clearTimeout(timer); }
  }
  for (const model of [...models].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    for (const part of SPLITS) {
      const claimIds = [...new Set(split.assignments[part].map(caseId => caseById.get(caseId).claimId))].sort();
      for (const claimId of claimIds) {
        const first = firstCaseByClaim.get(claimId);
        const query = {id: claimId, claimId, familyId: first.familyId,
          claimSha256: claimById.get(claimId).sha256, evidenceCutoffAt: manifest.evidenceCutoffAt,
          retrievalConfigSha256: manifest.retrievalConfig.sha256,
          retrievalSnapshotSha256: retrievalSnapshotHash, cutoff: 30};
        const pinnedQuery = Object.freeze({...query, sha256: digest(query)});
        const entry = {modelId: model.id, split: part, queryId: claimId, querySha256: pinnedQuery.sha256,
          status: 'missing', rankedPassageIds: [], latencyMs: null, usage: null};
        await perform(model, 'retrieval', {query: pinnedQuery}, entry,
          (raw, reserve) => normalizeRetrieval(raw, reserve, pinnedQuery));
        retrievalResults.push(entry);
      }
      for (const caseId of [...split.assignments[part]].sort()) {
        const entry = {modelId: model.id, split: part, caseId, status: 'missing', predictions: null,
          latencyMs: null, usage: null};
        await perform(model, 'classification', {case: caseById.get(caseId)}, entry, normalizeClassification);
        classificationResults.push(entry);
      }
    }
  }
  const reports = models.map(model => {
    const bySplit = Object.fromEntries(SPLITS.map(part => {
      const rows = classificationResults.filter(r => r.modelId === model.id && r.split === part);
      const queryRows = retrievalResults.filter(r => r.modelId === model.id && r.split === part);
      const counts = Object.fromEntries(['ok', 'abstained', 'missing', 'error', 'budget_exhausted'].map(s => [s, rows.filter(r => r.status === s).length]));
      const retrievalCounts = Object.fromEntries(['ok', 'abstained', 'missing', 'error', 'budget_exhausted']
        .map(s => [s, queryRows.filter(r => r.status === s).length]));
      const metrics = Object.fromEntries(Object.entries(TASKS).map(([task, classes]) => [task,
        classificationMetrics(rows.map(r => ({expected: labelByCase.get(r.caseId)[task],
          predicted: r.status === 'ok' ? r.predictions[task] : 'unknown'})), classes)]));
      const queryByClaim = new Map(queryRows.map(r => [r.queryId, r]));
      const selectedCases = split.assignments[part].map(caseId => caseById.get(caseId));
      const relevant = selectedCases.filter(c => labelByCase.get(c.id).relevance === 'direct');
      const critical = selectedCases.filter(c => labelByCase.get(c.id).criticalCounterevidence);
      const found = c => {
        const query = queryByClaim.get(c.claimId);
        return query?.status === 'ok' && query.rankedPassageIds.includes(c.passageId);
      };
      const retrieved = relevant.filter(found).length;
      const criticalFound = critical.filter(found).length;
      const relevantByClaim = new Map();
      for (const item of relevant) {
        if (!relevantByClaim.has(item.claimId)) relevantByClaim.set(item.claimId, []);
        relevantByClaim.get(item.claimId).push(item.passageId);
      }
      const claimIds = [...relevantByClaim.keys()].sort();
      const perClaimRecall = claimIds.map(claimId => {
        const query = queryByClaim.get(claimId);
        return recallAtK({expected: relevantByClaim.get(claimId),
          retrieved: query?.status === 'ok' ? query.rankedPassageIds : [], k: 30});
      });
      const usage = rows.map(r => r.usage).filter(Boolean);
      const retrievalUsage = queryRows.map(r => r.usage).filter(Boolean);
      const reviewMinutes = sumSafe(rows.flatMap(r => {
        const label = labelByCase.get(r.caseId);
        return [...label.reviewers.map(reviewer => reviewer.reviewMinutes), label.adjudication.reviewMinutes];
      }), 'review minutes');
      return [part, {classification: {counts,
        failureRate: rows.length ? (counts.missing + counts.error + counts.budget_exhausted) / rows.length : null,
        abstentionRate: rows.length ? counts.abstained / rows.length : null,
        coverage: rows.length ? counts.ok / rows.length : null,
        coverageInterval: wilsonInterval({successes: counts.ok, total: rows.length}), reviewMinutes,
        tasks: metrics,
        latencyMs: summarizeNonnegative(rows.map(r => r.latencyMs).filter(v => v !== null), 'latency'),
        usage: {inputTokens: sumSafe(usage.map(u => u.inputTokens), 'input tokens'),
          outputTokens: sumSafe(usage.map(u => u.outputTokens), 'output tokens'),
          costMicrodollars: sumSafe(usage.map(u => u.costMicrodollars), 'cost')}},
        retrieval: {counts: retrievalCounts,
          failureRate: queryRows.length ? (retrievalCounts.missing + retrievalCounts.error +
            retrievalCounts.budget_exhausted) / queryRows.length : null,
          abstentionRate: queryRows.length ? retrievalCounts.abstained / queryRows.length : null,
          coverage: queryRows.length ? retrievalCounts.ok / queryRows.length : null,
          relevant: relevant.length, foundAt30: retrieved, claimsWithRelevant: claimIds.length,
          macroRecallAt30: perClaimRecall.length ? perClaimRecall.reduce((a, b) => a + b, 0) / perClaimRecall.length : null,
          recallAt30: relevant.length ? retrieved / relevant.length : null,
          interval: wilsonInterval({successes: retrieved, total: relevant.length}),
          critical: {total: critical.length, foundAt30: criticalFound,
            recallAt30: critical.length ? criticalFound / critical.length : null,
            interval: wilsonInterval({successes: criticalFound, total: critical.length})},
          latencyMs: summarizeNonnegative(queryRows.map(r => r.latencyMs).filter(v => v !== null), 'latency'),
          usage: {inputTokens: sumSafe(retrievalUsage.map(u => u.inputTokens), 'input tokens'),
            outputTokens: sumSafe(retrievalUsage.map(u => u.outputTokens), 'output tokens'),
            costMicrodollars: sumSafe(retrievalUsage.map(u => u.costMicrodollars), 'cost')}}}];
    }));
    return {id: model.id, modelVersion: model.modelVersion, policyVersion: model.policyVersion,
      questionVersion: model.questionVersion, splits: bySplit};
  });
  const reviewMinutes = sumSafe(manifest.labels.flatMap(label => [
    ...label.reviewers.map(r => r.reviewMinutes), label.adjudication.reviewMinutes]), 'review minutes');
  const allResults = [...retrievalResults, ...classificationResults];
  const modelPins = models.map(model => {
    const {run, ...configuration} = model;
    return {...configuration, configurationSha256: digest(configuration)};
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const provenance = {manifestSha256: manifestHash, labelsSha256: manifest.labelsSha256,
    splitSha256: splitHash, corpusSha256: manifest.corpusSha256, budgetSha256: digest(budget),
    eligibilitySha256: digest(manifest.eligibility), exclusionsSha256: digest(manifest.exclusions),
    evidenceCutoffAt: manifest.evidenceCutoffAt, reviewProtocolSha256: digest(manifest.reviewProtocol),
    retrievalConfigSha256: manifest.retrievalConfig.sha256,
    retrievalSnapshotSha256: retrievalSnapshotHash, modelPins};
  const isCorpusReady = corpusReady(manifest);
  const componentGates = reports.map(model => {
    const test = model.splits.test;
    const retrievalEvaluated = isCorpusReady && test.retrieval.relevant > 0 &&
      test.retrieval.critical.total >= 50 && test.retrieval.counts.ok > 0 &&
      Object.entries(test.retrieval.counts).every(([status, count]) => status === 'ok' || count === 0);
    return {modelId: model.id,
      retrieval: {evaluated: retrievalEvaluated, passed: retrievalEvaluated &&
        test.retrieval.macroRecallAt30 >= 0.95 && test.retrieval.critical.recallAt30 === 1},
      classification: {evaluated: false, passed: false,
        reason: 'validation_calibration_and_filter_suppression_audit_not_registered'},
      wholeCaseAccuracy: {evaluated: false, passed: false, reason: 'task13a_not_run'}};
  }).sort((a, b) => a.modelId.localeCompare(b.modelId, 'en'));
  const report = {version: 2, status: 'development_only', provenance, budget: {maxMicrodollars: budget.maxMicrodollars,
    maxCalls: budget.maxCalls, calls, reservedOrSpentMicrodollars: budget.maxMicrodollars - remaining,
    actualRecordedMicrodollars: sumSafe(allResults.filter(r => r.usage).map(r => r.usage.costMicrodollars), 'actual cost'),
    unreconciledCalls: allResults.filter(r => ['error', 'missing'].includes(r.status) && r.usage === null).length},
  corpus: {claims: manifest.claims.length, documents: manifest.documents.length, pairs: manifest.cases.length,
    reviewMinutes, disagreements: manifest.labels.filter(l => l.adjudication.disagreement).length,
    criticalCases: manifest.labels.filter(l => l.criticalCase).length},
  gates: {corpusReady: isCorpusReady, splitDefinition: '60/20/20', components: componentGates},
  models: reports.sort((a, b) => a.id.localeCompare(b.id, 'en')),
  results: {retrieval: retrievalResults, classification: classificationResults}};
  return {...report, reportSha256: digest(report)};
}

module.exports = {runEvaluation, validateManifest, validateSplit, validateEvaluationMetadata,
  corpusReady, snapshot, digest,
  evaluatorPins: Object.freeze({modelVersion: 'jev-1.13.0', policyVersion: POLICY_VERSION,
    policySha256: POLICY_SHA256, questionVersion: QUESTION_VERSION, questionSha256: QUESTION_SHA256})};

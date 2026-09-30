'use strict';

const Z = 1.959963984540054;
const integer = (n, name) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`Invalid ${name}`);
  return n;
};
const finite = (n, name) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new TypeError(`Invalid ${name}`);
  return n;
};
const ratio = (n, d) => d === 0 ? null : n / d;

function wilsonInterval({successes, total}) {
  integer(successes, 'successes'); integer(total, 'total');
  if (successes > total) throw new TypeError('Successes exceed total');
  if (!total) return null;
  const p = successes / total, z2 = Z * Z, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius = Z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / denominator;
  return {lower: Math.max(0, center - radius), upper: Math.min(1, center + radius)};
}

function recallAtK({expected, retrieved, k = 30}) {
  if (!Array.isArray(expected) || !Array.isArray(retrieved) ||
      !Number.isSafeInteger(k) || k < 1 || k > 1000 ||
      [...expected, ...retrieved].some(id => typeof id !== 'string' || !id)) throw new TypeError('Invalid recall input');
  const truth = new Set(expected);
  if (!truth.size) return null;
  const found = new Set(retrieved.slice(0, k));
  return [...truth].filter(id => found.has(id)).length / truth.size;
}

function classificationMetrics(rows, classes) {
  if (!Array.isArray(rows) || !Array.isArray(classes) || !classes.length ||
      new Set(classes).size !== classes.length || classes.some(c => typeof c !== 'string' || !c))
    throw new TypeError('Invalid classification input');
  const matrix = Object.fromEntries(classes.map(c => [c, Object.fromEntries([...classes, 'unknown'].map(p => [p, 0]))]));
  for (const row of rows) {
    if (!row || !Object.hasOwn(matrix, row.expected) ||
        !Object.hasOwn(matrix[row.expected], row.predicted)) throw new TypeError('Invalid classification row');
    matrix[row.expected][row.predicted]++;
  }
  const perClass = Object.fromEntries(classes.map(c => {
    const tp = matrix[c][c];
    const support = Object.values(matrix[c]).reduce((a, b) => a + b, 0);
    const predicted = classes.reduce((a, actual) => a + matrix[actual][c], 0);
    const precision = ratio(tp, predicted), recall = ratio(tp, support);
    return [c, {support, predicted, precision, recall,
      f1: support === 0 ? null : (precision === null || precision + recall === 0 ? 0 :
        2 * precision * recall / (precision + recall)),
      precisionInterval: wilsonInterval({successes: tp, total: predicted}),
      recallInterval: wilsonInterval({successes: tp, total: support})}];
  }));
  const values = key => Object.values(perClass).filter(v => v.support > 0).map(v => v[key] ?? 0);
  const precision = values('precision'), recall = values('recall'), f1 = values('f1');
  const correct = classes.reduce((n, c) => n + matrix[c][c], 0);
  const unknown = classes.reduce((n, c) => n + matrix[c].unknown, 0);
  return {total: rows.length, correct, unknown, matrix, perClass,
    accuracy: ratio(correct, rows.length), accuracyInterval: wilsonInterval({successes: correct, total: rows.length}),
    macroPrecision: ratio(precision.reduce((a, b) => a + b, 0), precision.length),
    macroRecall: ratio(recall.reduce((a, b) => a + b, 0), recall.length),
    macroF1: ratio(f1.reduce((a, b) => a + b, 0), f1.length),
    coverage: ratio(rows.length - unknown, rows.length), unknownRate: ratio(unknown, rows.length)};
}

function summarizeNonnegative(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`Invalid ${name}`);
  values.forEach(v => finite(v, name));
  if (!values.length) return {count: 0, min: null, max: null, mean: null, p50: null, p95: null};
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total)) throw new TypeError(`Invalid ${name} total`);
  return {count: values.length, min: sorted[0], max: sorted.at(-1), mean: total / values.length,
    p50: sorted[Math.ceil(values.length * .5) - 1], p95: sorted[Math.ceil(values.length * .95) - 1]};
}

function sumSafe(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`Invalid ${name}`);
  return values.reduce((sum, value) => {
    integer(value, name);
    const next = sum + value;
    if (!Number.isSafeInteger(next)) throw new TypeError(`${name} overflow`);
    return next;
  }, 0);
}

module.exports = {wilsonInterval, recallAtK, classificationMetrics, summarizeNonnegative, sumSafe};

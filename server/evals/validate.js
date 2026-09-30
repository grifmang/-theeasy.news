'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {constants: fsConstants} = require('node:fs');
const {validateEvaluationMetadata, corpusReady} = require('./run');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ERROR_MESSAGES = Object.freeze({
  usage: 'Expected exactly two absolute JSON file paths: manifest and split.',
  invalid_path: 'Input paths must be regular, non-symlink JSON files.',
  file_too_large: 'Each input file must be 8 MiB or smaller.',
  invalid_json: 'Input file is not valid JSON metadata.',
  invalid_metadata: 'Metadata failed structural validation.'
});

function readJsonFile(filePath) {
  let resolvedPath;
  try { resolvedPath = path.resolve(filePath); }
  catch { throw new Error('invalid_path'); }
  if (!path.isAbsolute(filePath)) throw new Error('invalid_path');

  let fd;
  try {
    const before = fs.lstatSync(resolvedPath);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('invalid_path');
    if (before.size > MAX_FILE_BYTES) throw new Error('file_too_large');
    if (fs.realpathSync(resolvedPath) !== resolvedPath) throw new Error('invalid_path');
    fd = fs.openSync(resolvedPath, fsConstants.O_RDONLY);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error('invalid_path');
    if (opened.size > MAX_FILE_BYTES) throw new Error('file_too_large');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) throw new Error('file_too_large');
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8', 0, bytesRead)); }
    catch { throw new Error('invalid_json'); }
    return parsed;
  } catch (error) {
    if (['invalid_path', 'file_too_large', 'invalid_json'].includes(error?.message)) throw error;
    throw new Error('invalid_path');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function summarize(manifest, split) {
  const {manifest: safeManifest, split: safeSplit, manifestSha256, splitSha256} =
    validateEvaluationMetadata({manifest, split});
  return {
    status: 'valid',
    version: safeManifest.version,
    manifestStatus: safeManifest.status,
    splitStatus: safeSplit.status,
    manifestSha256,
    splitSha256,
    counts: {
      claims: safeManifest.claims.length,
      documents: safeManifest.documents.length,
      cases: safeManifest.cases.length,
      labels: safeManifest.labels.length,
      critical: safeManifest.labels.filter(label => label.criticalCase).length,
      disagreements: safeManifest.labels.filter(label => label.adjudication.disagreement).length,
      exclusions: safeManifest.exclusions.length,
      splits: {
        train: safeSplit.assignments.train.length,
        validation: safeSplit.assignments.validation.length,
        test: safeSplit.assignments.test.length
      }
    },
    corpusReady: corpusReady(safeManifest)
  };
}

function main(argv) {
  if (argv.length !== 2 || argv.some(value => !path.isAbsolute(value))) throw new Error('usage');
  const manifest = readJsonFile(argv[0]);
  const split = readJsonFile(argv[1]);
  try { return summarize(manifest, split); }
  catch { throw new Error('invalid_metadata'); }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`);
  } catch (error) {
    const code = ERROR_MESSAGES[error?.message] ? error.message : 'invalid_metadata';
    process.stderr.write(`${JSON.stringify({status: 'error', code, message: ERROR_MESSAGES[code]})}\n`);
    process.exitCode = 1;
  }
}

module.exports = {main, summarize, MAX_FILE_BYTES};

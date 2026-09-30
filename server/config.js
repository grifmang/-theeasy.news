const path = require('path');

function boolean(env, key) {
  if (env[key] === undefined) return false;
  if (env[key] !== 'true' && env[key] !== 'false') throw new Error(`Invalid ${key}: use true or false`);
  return env[key] === 'true';
}

function money(env, key) {
  if (env[key] === undefined) return 0;
  if (typeof env[key] !== 'string' || !/^\d+$/.test(env[key]) || !Number.isSafeInteger(Number(env[key]))) {
    throw new Error(`Invalid ${key}: use nonnegative integer microdollars`);
  }
  return Number(env[key]);
}
function boundedInteger(env,key,fallback,max) {
  if(env[key]===undefined)return fallback;
  const value=money(env,key);
  if(value>max)throw new Error(`Invalid ${key}`);
  return value;
}

// Pure validation: no filesystem changes, credentials in return value, or calls.
function loadConfig(env = process.env) {
  const mode = env.NODE_ENV === undefined ? 'development' : env.NODE_ENV;
  if (!['development','test','production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  const dbPath = env.DB_PATH;
  if (typeof dbPath !== 'string' || !dbPath || dbPath.includes('\0') ||
      (!path.isAbsolute(dbPath) && !(mode === 'test' && dbPath === ':memory:'))) {
    throw new Error('DB_PATH must be an absolute path (:memory: is test-only)');
  }
  const generationEnabled = boolean(env, 'GENERATION_ENABLED');
  const ingestionEnabled = boolean(env, 'INGESTION_ENABLED');
  const maintenanceMode = boolean(env, 'MAINTENANCE_MODE');
  const htmlExtractionEnabled = boolean(env, 'HTML_EXTRACTION_ENABLED');
  const pdfExtractionEnabled = boolean(env, 'PDF_EXTRACTION_ENABLED');
  const classificationEnabled = boolean(env, 'CLASSIFICATION_ENABLED');
  const analysisVerificationEnabled = boolean(env, 'ANALYSIS_VERIFICATION_ENABLED');
  const publicationExportEnabled = boolean(env, 'PUBLICATION_EXPORT_ENABLED');
  const publicReadEnabled = boolean(env, 'PUBLIC_READ_ENABLED');
  const publicationExportPath=env.PUBLICATION_EXPORT_PATH;
  if(publicReadEnabled&&env.DEPLOYMENT_ENV!=='staging')
    throw new Error('Public reads require DEPLOYMENT_ENV=staging');
  if(publicReadEnabled&&!publicationExportEnabled)
    throw new Error('Public reads require private publication export');
  if(publicationExportEnabled&&env.DEPLOYMENT_ENV!=='staging')
    throw new Error('Private publication export requires DEPLOYMENT_ENV=staging');
  if(publicationExportEnabled&&mode==='production'&&process.platform==='win32')
    throw new Error('Private publication export requires enforced private ACLs on Windows');
  if(publicationExportEnabled&&
    (typeof publicationExportPath!=='string'||!path.isAbsolute(publicationExportPath)||
      publicationExportPath.includes('\0')))
    throw new Error('PUBLICATION_EXPORT_PATH must be an absolute private directory');
  if(publicationExportPath!==undefined&&
    (typeof publicationExportPath!=='string'||!path.isAbsolute(publicationExportPath)||
      publicationExportPath.includes('\0')))
    throw new Error('Invalid PUBLICATION_EXPORT_PATH');
  const autoPublishEnabled = boolean(env, 'AUTO_PUBLISH_ENABLED');
  if (autoPublishEnabled) throw new Error('Automatic publication is forbidden in this release');
  const dailyBudgetMicros = money(env, 'DAILY_BUDGET_MICROS');
  const monthlyBudgetMicros = money(env, 'MONTHLY_BUDGET_MICROS');
  if (dailyBudgetMicros > monthlyBudgetMicros) throw new Error('Daily budget exceeds monthly budget');
  const categoryDailyMicros={classification:boundedInteger(env,'CLASSIFICATION_DAILY_BUDGET_MICROS',dailyBudgetMicros,dailyBudgetMicros)};
  const categoryMonthlyMicros={classification:boundedInteger(env,'CLASSIFICATION_MONTHLY_BUDGET_MICROS',monthlyBudgetMicros,monthlyBudgetMicros)};
  const maxConcurrentCalls=boundedInteger(env,'MAX_CONCURRENT_MODEL_CALLS',1,100);
  const maxInputTokens=boundedInteger(env,'MAX_INPUT_TOKENS',64000,64000);
  const maxOutputTokens=boundedInteger(env,'MAX_OUTPUT_TOKENS',4096,4096);
  const reasoningMicros=boundedInteger(env,'REASONING_BUDGET_MICROS',0,monthlyBudgetMicros);
  const toolMicros=boundedInteger(env,'TOOL_BUDGET_MICROS',0,monthlyBudgetMicros);
  if(classificationEnabled) {
    if(typeof env.TYPESAFE_API_KEY!=='string' || !env.TYPESAFE_API_KEY.trim()) throw new Error('TYPESAFE_API_KEY required for classification');
    if(!dailyBudgetMicros || !monthlyBudgetMicros) throw new Error('Positive budget required for classification');
  }
  if(analysisVerificationEnabled) {
    if(env.DEPLOYMENT_ENV!=='staging') throw new Error('Analysis verification requires DEPLOYMENT_ENV=staging');
    if(typeof env.TYPESAFE_API_KEY!=='string'||!env.TYPESAFE_API_KEY||
      env.TYPESAFE_API_KEY.length>4096||/\s/.test(env.TYPESAFE_API_KEY))
      throw new Error('Valid TYPESAFE_API_KEY required for analysis verification');
    if(!dailyBudgetMicros||!monthlyBudgetMicros||!categoryDailyMicros.classification||
      !categoryMonthlyMicros.classification) throw new Error('Positive global and classification budgets required for analysis verification');
    if(maxConcurrentCalls!==1) throw new Error('Analysis verification requires MAX_CONCURRENT_MODEL_CALLS=1');
    if(maxInputTokens!==64000||!maxOutputTokens)
      throw new Error('Analysis verification requires MAX_INPUT_TOKENS=64000 and positive output token bound');
  }
  if (generationEnabled) {
    for (const key of ['TYPESAFE_API_KEY','OPENAI_API_KEY']) {
      if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`${key} required for generation`);
    }
    if (!dailyBudgetMicros || !monthlyBudgetMicros) throw new Error('Positive budget required for generation');
  }
  const budgetFailClosedPath=env.BUDGET_FAIL_CLOSED_PATH;
  if((classificationEnabled||generationEnabled)&&mode==='production'&&
    (typeof budgetFailClosedPath!=='string'||!path.isAbsolute(budgetFailClosedPath)||budgetFailClosedPath.includes('\0')))
    throw new Error('BUDGET_FAIL_CLOSED_PATH must be an absolute private directory for paid work');
  if(budgetFailClosedPath!==undefined&&
    (typeof budgetFailClosedPath!=='string'||!path.isAbsolute(budgetFailClosedPath)||budgetFailClosedPath.includes('\0')))
    throw new Error('Invalid BUDGET_FAIL_CLOSED_PATH');
  if(analysisVerificationEnabled&&mode!=='test'&&budgetFailClosedPath===undefined)
    throw new Error('BUDGET_FAIL_CLOSED_PATH must be an absolute private directory for analysis verification');
  return Object.freeze({ dbPath, mode, maintenanceMode, ingestionEnabled, htmlExtractionEnabled, pdfExtractionEnabled,
    generationEnabled, classificationEnabled, analysisVerificationEnabled, publicationExportEnabled,
    publicReadEnabled,
    publicationExportPath,autoPublishEnabled,dailyBudgetMicros, monthlyBudgetMicros,
    categoryDailyMicros,categoryMonthlyMicros,maxConcurrentCalls,maxInputTokens,maxOutputTokens,reasoningMicros,toolMicros,
    budgetFailClosedPath });
}

module.exports = { loadConfig };

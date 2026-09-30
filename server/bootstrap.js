const Database = require('better-sqlite3');
const {loadConfig} = require('./config');
const {SCHEMA_VERSION,configureDatabaseConnection} = require('./storage');
const {createApp} = require('./app');
const {createLocalArchive} = require('./evidence/archive');
const {createJevTransport}=require('./models/jev-transport');
const {runNextClaimJob}=require('./claim-worker');
const {createBudgetGuard}=require('./models/budget-guard');
const {startWorkerLoop}=require('./worker-loop');
const {createSourceRegistry}=require('./discovery/registry');
const {runNextFetch}=require('./discovery/fetch-worker');
const {createHtmlExtractionService}=require('./evidence/html-service');
const {createPdfExtractionService}=require('./evidence/pdf-service');
const {createAssertionDecisionAdapter}=require('./analysis/jev-adapter');
const {runNextVerificationJob}=require('./analysis/worker');
const {createLocalPublicationExport}=require('./publication/local-export');
const {runNextPublicationDelivery,FATAL_EXPORT_CODES}=require('./publication/outbox');
const path=require('node:path');

async function startService(env = process.env,services={}) {
  const config = loadConfig(env);
  const rawPort = env.PORT === undefined ? '4000' : env.PORT;
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort) || Number(rawPort)>65535) throw new Error('Invalid PORT');
  const port = Number(rawPort);
  if (port===0 && config.mode!=='test') throw new Error('PORT 0 is test-only');
  if(config.maintenanceMode) return require('./maintenance').startMaintenance({port,host:env.HOST||'0.0.0.0'});
  if (config.generationEnabled) throw new Error('Generation worker is not yet available');
  const paidWorkerEnabled=config.classificationEnabled||config.analysisVerificationEnabled;
  const budgetGuard=paidWorkerEnabled?(config.mode==='test'&&services.budgetGuard||
    (config.budgetFailClosedPath?createBudgetGuard(config.budgetFailClosedPath):null)):null;
  if(paidWorkerEnabled&&!budgetGuard)throw new Error('Paid worker requires a budget fail-closed guard');
  const archive = env.ARCHIVE_PATH ? createLocalArchive(env.ARCHIVE_PATH) : undefined;
  if(config.htmlExtractionEnabled&&!archive) throw new Error('HTML extraction requires a private archive');
  if(config.pdfExtractionEnabled&&!archive) throw new Error('PDF extraction requires a private archive');
  let sourceRegistry;
  if(config.ingestionEnabled) {
    if(!archive||typeof env.SOURCE_POLICIES_JSON!=='string'||env.SOURCE_POLICIES_JSON.length>65536) throw new Error('Ingestion requires archive and approved source policies');
    try {
      const policies=JSON.parse(env.SOURCE_POLICIES_JSON);
      if(!Array.isArray(policies)||!policies.length||policies.length>100) throw new Error();
      sourceRegistry=createSourceRegistry(policies);
    } catch {throw new Error('Invalid ingestion source policies');}
  }
  const db = configureDatabaseConnection(new Database(config.dbPath,{fileMustExist:true}));
  let server,worker,analysisWorker,fetchWorker,publicationWorker,publicationSink,htmlExtraction,pdfExtraction;
  let publicReadFatal=false;
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
    if (db.prepare('SELECT MAX(version) version FROM rebuild_migrations').get().version!==SCHEMA_VERSION) throw new Error('Run explicit database migration before startup');
    for (const table of ['users','articles','authors','saved_articles']) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    db.pragma('journal_mode = WAL');
    let sinkId=null;
    if(config.publicationExportEnabled){
      publicationSink=config.mode==='test'&&services.publicationSink||
        createLocalPublicationExport(config.publicationExportPath,{
          dbPath:config.dbPath,archivePath:env.ARCHIVE_PATH,
          budgetPath:config.budgetFailClosedPath,
          frontendPath:path.resolve(__dirname,'../theeasynews'),
          buildPath:path.resolve(__dirname,'../theeasynews/build')});
      sinkId=publicationSink.bind(db,services.clock?.()??Date.now());
      publicationSink.inspectMax(db);
      if(config.publicReadEnabled)publicationSink.assertBound();
    }
    // Reconcile restart evidence against the migrated ledger before starting paid work.
    // Keep the operator API available when tripped so exposure can be restored.
    if(budgetGuard)budgetGuard.check(db,services.clock||Date.now);
    if(config.htmlExtractionEnabled) htmlExtraction=await createHtmlExtractionService({db,archive,runtime:{
      bundleDirectory:env.HTML_PARSER_BUNDLE,digestFile:env.HTML_PARSER_DIGEST_FILE,scratchParent:env.HTML_PARSER_SCRATCH
    }});
    const classificationClient=config.classificationEnabled?(services.classificationClient || createJevTransport({apiKey:env.TYPESAFE_API_KEY})):null;
    if(config.pdfExtractionEnabled) pdfExtraction=await createPdfExtractionService({db,archive,runtime:{
      bundleDirectory:env.PDF_PARSER_BUNDLE,digestFile:env.PDF_PARSER_DIGEST_FILE,scratchParent:env.PDF_PARSER_SCRATCH
    }});
    const budgetLimits={dailyMicros:config.dailyBudgetMicros,monthlyMicros:config.monthlyBudgetMicros,
      categoryDailyMicros:config.categoryDailyMicros,categoryMonthlyMicros:config.categoryMonthlyMicros,
      maxConcurrentCalls:config.maxConcurrentCalls,maxInputTokens:config.maxInputTokens,
      maxOutputTokens:config.maxOutputTokens,reasoningMicros:config.reasoningMicros,toolMicros:config.toolMicros};
    const analysisClient=config.analysisVerificationEnabled?
      (config.mode==='test'&&services.analysisClient||createJevTransport({apiKey:env.TYPESAFE_API_KEY})):null;
    const decisionAdapter=analysisClient?createAssertionDecisionAdapter({db,client:analysisClient,
      limits:budgetLimits,guard:budgetGuard,clock:services.clock||Date.now}):null;
    const {budgetFailClosedPath:guardPath,...appConfig}=config;
    const publicReadAdmission={isAvailable:()=>{
      if(!config.publicReadEnabled||publicReadFatal||!publicationSink)return false;
      try{publicationSink.assertBound();return true;}
      catch{publicReadFatal=true;return false;}
    }};
    const app = createApp({db,services:{archive,sourceRegistry,htmlExtraction,pdfExtraction,budgetLimits,
      budgetGuard,publicReadAdmission,clock:services.clock||Date.now},config:{...appConfig,googleClientId:env.GOOGLE_CLIENT_ID,
      allowedOrigins:env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()) : []}});
    server = await new Promise((resolve,reject)=>{
      const listening=app.listen(port,env.HOST || '0.0.0.0');
      listening.once('error',reject);
      listening.once('listening',()=>{listening.removeListener('error',reject);resolve(listening);});
    });
    if(classificationClient) worker=startWorkerLoop({
      runNext:({signal})=>{
        if(budgetGuard.fatal)throw new Error('Fatal budget guard state');
        return runNextClaimJob({db,client:classificationClient,signal,clock:services.clock || Date.now,
          limits:budgetLimits,guard:budgetGuard});
      },
      onError:()=>{
        if(budgetGuard.fatal){console.error('Budget guard fatal; classification worker stopped');worker?.stop();}
        else console.error('Classification worker failed; no sensitive details logged');
      }
    });
    if(decisionAdapter) analysisWorker=startWorkerLoop({
      runNext:async({signal})=>{
        if(budgetGuard.fatal)throw new Error('Fatal budget guard state');
        const result=await runNextVerificationJob(db,{decisionAdapter,clock:services.clock||Date.now,
          signal,leaseMs:30000});
        if(budgetGuard.fatal)throw new Error('Fatal budget guard state');
        return result;
      },
      onError:()=>{
        if(budgetGuard.fatal){console.error('Budget guard fatal; analysis verification worker stopped');analysisWorker?.stop();}
        else console.error('Analysis verification worker failed; no sensitive details logged');
      }
    });
    if(sourceRegistry) fetchWorker=startWorkerLoop({
      runNext:({signal})=>runNextFetch({db,registry:sourceRegistry,archive,signal,clock:services.clock||Date.now,
        resolver:services.fetchTransport?.resolver,request:services.fetchTransport?.request}),
      onError:()=>console.error('Ingestion worker failed; no sensitive details logged')
    });
    if(publicationSink){
      let reconciliationRequired=false;
      publicationWorker=startWorkerLoop({
        runNext:({signal})=>{
          if(reconciliationRequired)return null;
          try{return runNextPublicationDelivery(db,{sink:publicationSink,sinkId,
            clock:services.clock||Date.now,signal});}
          catch(error){
            if(FATAL_EXPORT_CODES.has(error.code)){
              reconciliationRequired=true;
              publicReadFatal=true;
            }
            throw error;
          }
        },
        onError:()=>{
          if(reconciliationRequired){console.error('Private publication export requires reconciliation');
            publicationWorker?.stop();}
          else console.error('Private publication export failed; no sensitive details logged');
        }
      });
    }
    let stopping;
    function stop() {
      if (!stopping) stopping = (async()=>{
        const workerStopped=Promise.allSettled([worker?.stop(),analysisWorker?.stop(),fetchWorker?.stop(),publicationWorker?.stop(),
          htmlExtraction?.stop(),pdfExtraction?.stop()]);
        const httpStopped=new Promise((resolve,reject)=>{
        const deadline=setTimeout(()=>server.closeAllConnections(),10000);
        deadline.unref();
        server.close(error=>{
          clearTimeout(deadline);
          if(error) reject(error); else resolve();
        });
        server.closeIdleConnections();
        });
        const [,httpResult]=await Promise.allSettled([workerStopped,httpStopped]);
        publicationSink?.release?.();
        if(db.open) db.close();
        if(httpResult.status==='rejected')throw new Error('HTTP shutdown failed');
      })();
      return stopping;
    }
    return {app,server,db,stop};
  } catch(error) {
    await Promise.allSettled([pdfExtraction?.stop(),htmlExtraction?.stop(),worker?.stop(),
      analysisWorker?.stop(),fetchWorker?.stop(),publicationWorker?.stop()]);
    if(server?.listening) await new Promise(resolve=>server.close(resolve));
    publicationSink?.release?.();
    if(db.open) db.close();
    throw error;
  }
}
module.exports = {startService};

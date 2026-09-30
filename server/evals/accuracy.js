'use strict';

const {wilsonInterval}=require('./metrics');

const LABELS=Object.freeze(['supported','contradicted','mixed','insufficient_evidence','not_fact_checkable']);
const RESOLVED=new Set(['supported','contradicted','mixed']);
const ABSTAINED=new Set(['insufficient_evidence','not_fact_checkable']);
const DIMENSIONS=Object.freeze([
  'disposition','identityTimeScope','evidenceCompleteness','citationMeaningAttribution','uncertainty'
]);
const CRITICAL_ERRORS=new Set([
  'fabricated_evidence','incorrect_person_linkage','material_quote_reversal',
  'allegation_promoted_to_finding','decisive_counterevidence_omitted',
  'archive_time_leakage','protected_identity_exposed'
]);
const ratio=(n,d)=>d===0?null:n/d;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exactKeys=(value,allowed)=>plain(value)&&Object.keys(value).length===allowed.length&&
  Object.keys(value).every(key=>allowed.includes(key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const same=(a,b)=>a===b||(typeof a==='number'&&typeof b==='number'&&
  Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Number.EPSILON*4);
const boundedRatio=value=>value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1);

function validateCase(row,index){
  const required=['familyId','referenceLabel','outputLabel','dimensions','criticalErrors','referenceResolvable'];
  if(!exactKeys(row,required)||!id(row.familyId)||!LABELS.includes(row.referenceLabel)||
    !(row.outputLabel===null||LABELS.includes(row.outputLabel))||
    !exactKeys(row.dimensions,DIMENSIONS)||DIMENSIONS.some(key=>typeof row.dimensions[key]!=='boolean')||
    !Array.isArray(row.criticalErrors)||row.criticalErrors.length>CRITICAL_ERRORS.size||
    new Set(row.criticalErrors).size!==row.criticalErrors.length||
    row.criticalErrors.some(code=>!CRITICAL_ERRORS.has(code))||
    typeof row.referenceResolvable!=='boolean'||
    (row.referenceResolvable!==RESOLVED.has(row.referenceLabel)))
    throw new TypeError(`Invalid accuracy case at index ${index}`);
}

function scoreAccuracy(cases){
  if(!Array.isArray(cases)||cases.length>100000)throw new TypeError('Invalid accuracy cases');
  cases.forEach(validateCase);
  const families=new Set(cases.map(row=>row.familyId));
  if(families.size!==cases.length)throw new TypeError('Duplicate claim family');
  const scored=cases.map(row=>{
    const dimensionsPass=DIMENSIONS.every(key=>row.dimensions[key]);
    const passed=row.outputLabel!==null&&row.outputLabel===row.referenceLabel&&
      dimensionsPass&&row.criticalErrors.length===0;
    return {...row,passed};
  });
  const passed=scored.filter(row=>row.passed).length;
  const criticalErrors=scored.reduce((sum,row)=>sum+row.criticalErrors.length,0);
  const perDisposition=Object.fromEntries(LABELS.map(label=>{
    const rows=scored.filter(row=>row.referenceLabel===label);
    const successes=rows.filter(row=>row.passed).length;
    return [label,{total:rows.length,passed:successes,accuracy:ratio(successes,rows.length),
      interval:wilsonInterval({successes,total:rows.length})}];
  }));
  const evaluatedClasses=Object.values(perDisposition).filter(value=>value.total>0);
  const resolvable=scored.filter(row=>row.referenceResolvable);
  const correctlyResolved=resolvable.filter(row=>row.passed&&RESOLVED.has(row.outputLabel)).length;
  const attempted=scored.filter(row=>RESOLVED.has(row.outputLabel));
  const correctAttempts=attempted.filter(row=>row.passed).length;
  const referenceAbstentions=scored.filter(row=>ABSTAINED.has(row.referenceLabel));
  const appropriateAbstentions=referenceAbstentions.filter(row=>row.passed).length;
  const abstentions=scored.filter(row=>row.outputLabel===null||ABSTAINED.has(row.outputLabel)).length;
  return {
    total:scored.length,passed,accuracy:ratio(passed,scored.length),
    interval:wilsonInterval({successes:passed,total:scored.length}),
    independentFamilies:families.size,criticalErrors,
    macroAccuracy:evaluatedClasses.length?
      evaluatedClasses.reduce((sum,value)=>sum+value.accuracy,0)/evaluatedClasses.length:null,
    correctResolutionCoverage:ratio(correctlyResolved,resolvable.length),
    attemptedResolutionPrecision:ratio(correctAttempts,attempted.length),
    rawAbstentionRate:ratio(abstentions,scored.length),
    appropriateAbstentionRecall:ratio(appropriateAbstentions,referenceAbstentions.length),
    referenceResolvable:resolvable.length,correctlyResolved,attemptedResolutions:attempted.length,
    perDisposition
  };
}

function evaluateAccuracyGate(report){
  if(!plain(report))throw new TypeError('Invalid accuracy report');
  const reasons=[];
  let consistent=Number.isSafeInteger(report.total)&&report.total>=0&&
    Number.isSafeInteger(report.passed)&&report.passed>=0&&report.passed<=report.total&&
    Number.isSafeInteger(report.independentFamilies)&&report.independentFamilies===report.total&&
    Number.isSafeInteger(report.criticalErrors)&&report.criticalErrors>=0&&
    Number.isSafeInteger(report.referenceResolvable)&&report.referenceResolvable>=0&&
    Number.isSafeInteger(report.correctlyResolved)&&report.correctlyResolved>=0&&
    report.correctlyResolved<=report.referenceResolvable&&
    Number.isSafeInteger(report.attemptedResolutions)&&report.attemptedResolutions>=0&&
    report.attemptedResolutions<=report.total&&boundedRatio(report.accuracy)&&
    boundedRatio(report.macroAccuracy)&&boundedRatio(report.correctResolutionCoverage)&&
    boundedRatio(report.attemptedResolutionPrecision)&&boundedRatio(report.rawAbstentionRate)&&
    boundedRatio(report.appropriateAbstentionRecall)&&
    same(report.accuracy,ratio(report.passed,report.total))&&
    same(report.correctResolutionCoverage,ratio(report.correctlyResolved,report.referenceResolvable));
  if(consistent){
    const expectedInterval=wilsonInterval({successes:report.passed,total:report.total});
    consistent=expectedInterval===null?report.interval===null:
      plain(report.interval)&&same(report.interval.lower,expectedInterval.lower)&&
      same(report.interval.upper,expectedInterval.upper);
  }
  if(consistent){
    consistent=plain(report.perDisposition)&&Object.keys(report.perDisposition).length===LABELS.length&&
      LABELS.every(label=>Object.hasOwn(report.perDisposition,label));
    if(consistent){
      let total=0,passed=0;const classAccuracies=[];
      for(const label of LABELS){
        const value=report.perDisposition[label];
        if(!plain(value)||!Number.isSafeInteger(value.total)||value.total<0||
          !Number.isSafeInteger(value.passed)||value.passed<0||value.passed>value.total||
          !same(value.accuracy,ratio(value.passed,value.total))){consistent=false;break;}
        const interval=wilsonInterval({successes:value.passed,total:value.total});
        if(interval===null?value.interval!==null:!plain(value.interval)||
          !same(value.interval.lower,interval.lower)||!same(value.interval.upper,interval.upper)){
          consistent=false;break;
        }
        total+=value.total;passed+=value.passed;
        if(value.total>0)classAccuracies.push(value.accuracy);
      }
      const macro=classAccuracies.length?
        classAccuracies.reduce((sum,value)=>sum+value,0)/classAccuracies.length:null;
      consistent=consistent&&total===report.total&&passed===report.passed&&same(report.macroAccuracy,macro);
    }
  }
  if(!consistent)reasons.push('report_inconsistent');
  if(report.protocolValid!==true)reasons.push('protocol_invalid');
  if(report.referenceReviewComplete!==true)reasons.push('reference_review_incomplete');
  if(report.classCoverageValid!==true)reasons.push('class_coverage_incomplete');
  if(!Number.isSafeInteger(report.total)||report.total<200)reasons.push('fewer_than_200_cases');
  if(!Number.isSafeInteger(report.independentFamilies)||report.independentFamilies<200)
    reasons.push('fewer_than_200_independent_families');
  if(typeof report.accuracy!=='number'||!Number.isFinite(report.accuracy)||report.accuracy<0.95)
    reasons.push('observed_accuracy_below_95_percent');
  if(!plain(report.interval)||typeof report.interval.lower!=='number'||
    !Number.isFinite(report.interval.lower)||report.interval.lower<0.90)
    reasons.push('wilson_lower_bound_below_90_percent');
  if(typeof report.macroAccuracy!=='number'||!Number.isFinite(report.macroAccuracy)||
    report.macroAccuracy<0.90)reasons.push('macro_accuracy_below_90_percent');
  if(typeof report.correctResolutionCoverage!=='number'||
    !Number.isFinite(report.correctResolutionCoverage)||report.correctResolutionCoverage<0.70)
    reasons.push('resolution_coverage_below_70_percent');
  if(!Number.isSafeInteger(report.criticalErrors)||report.criticalErrors!==0)
    reasons.push('critical_errors_present');
  return {pass:reasons.length===0,reasons};
}

module.exports={scoreAccuracy,evaluateAccuracyGate,accuracyContract:Object.freeze({
  labels:LABELS,dimensions:DIMENSIONS,criticalErrors:Object.freeze([...CRITICAL_ERRORS])
})};

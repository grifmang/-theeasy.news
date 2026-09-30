const VERSION='nfkc-case-punctuation-space-v1';
function normalizePassage(value){
  if(typeof value!=='string'||Buffer.byteLength(value)>4194304)
    throw new Error('Invalid passage normalization size');
  return value.normalize('NFKC').toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/gu,' ');
}
module.exports={VERSION,normalizePassage};

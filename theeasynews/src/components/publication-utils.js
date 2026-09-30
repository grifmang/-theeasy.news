export const cleanReason=value=>value.trim().length>0&&value.length<=500&&
  [...value].every(character=>character.charCodeAt(0)>31&&character.charCodeAt(0)!==127);

export function requestKey(){
  if(!globalThis.crypto?.randomUUID)throw new Error('A secure browser context is required to record publication decisions.');
  return globalThis.crypto.randomUUID().replace(/-/g,'');
}

export function errorText(error){
  if(error?.status===401)return 'Your session expired. Sign in again, then reload publication state.';
  if(error?.status===403)return 'Publication access was denied. Ask an editor or publication owner to check your access.';
  if(error?.status===409)return 'Publication state changed. Review the refreshed state before making another decision.';
  if(error?.status===422)return 'Publication is blocked by current evidence, coverage, or content. Resolve the reported limits before publishing.';
  if(error?.status===404)return 'This publication record is unavailable. Refresh the selected report.';
  return 'The request could not be confirmed. Retry the same decision or refresh its current state.';
}

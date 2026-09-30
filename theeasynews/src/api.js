const API = process.env.REACT_APP_API_URL || '';
let csrf = null;
export function acceptSession(session) { csrf = session?.csrfToken || null; }
export async function apiRequest(path, {method='GET',body,signal} = {}) {
  if(typeof path!=='string' || !path.startsWith('/api/') || path.includes('\\')) throw new Error('Invalid API path');
  const headers = {};
  if(body!==undefined) headers['Content-Type']='application/json';
  if(!['GET','HEAD'].includes(method) && csrf) headers['X-CSRF-Token']=csrf;
  const response=await fetch(`${API}${path}`,{method,credentials:'include',headers,signal,
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok) {
    if(response.status===401) acceptSession(null);
    const error=new Error(data.error || 'Request failed'); error.status=response.status; throw error;
  }
  return data;
}
export async function restoreSession() {
  try {const session=await apiRequest('/api/session'); acceptSession(session); return session;}
  catch(error) {if(error.status===401) {acceptSession(null);return null;} throw error;}
}

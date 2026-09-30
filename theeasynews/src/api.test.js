import { vi } from 'vitest';
import { apiRequest, acceptSession, restoreSession } from './api';
beforeEach(()=>{acceptSession(null);});
afterEach(()=>vi.restoreAllMocks());
test('authenticated writes use cookies and in-memory csrf, not bearer tokens',async()=>{
  acceptSession({userId:1,csrfToken:'csrf-fixture'});
  global.fetch=vi.fn(async(url,options)=>{
    expect(url).toBe('/api/save');
    expect(options.credentials).toBe('include');
    expect(options.headers['X-CSRF-Token']).toBe('csrf-fixture');
    expect(options.headers.Authorization).toBeUndefined();
    return {ok:true,json:async()=>({message:'Saved'})};
  });
  expect(await apiRequest('/api/save',{method:'POST',body:{articleId:1}})).toEqual({message:'Saved'});
});
test('failed saves throw rather than appear successful',async()=>{
  global.fetch=vi.fn(async()=>({ok:false,status:403,json:async()=>({error:'Denied'})}));
  await expect(apiRequest('/api/save',{method:'POST',body:{articleId:1}})).rejects.toThrow('Denied');
});
test('expired server session restores as anonymous',async()=>{
  global.fetch=vi.fn(async()=>({ok:false,status:401,json:async()=>({error:'Expired'})}));
  expect(await restoreSession()).toBeNull();
});
test('does not send cookie credentials to arbitrary URLs',async()=>{
  await expect(apiRequest('https://evil.example/api')).rejects.toThrow('API path');
});

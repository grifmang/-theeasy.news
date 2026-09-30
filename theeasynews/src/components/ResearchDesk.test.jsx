import { vi } from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import App from '../App';

const ok = data => ({ok:true, json:async()=>data});
beforeEach(()=>{
  window.history.replaceState({}, '', '/editor');
  global.fetch=vi.fn(async url=>{
    const routes={
      '/api/session':{userId:7,csrfToken:'fixture'},
      '/api/categories':{categories:[]},
      '/api/v1/editor/topics':{items:[{id:1,title:'Historical claims',slug:'historical'}]},
      '/api/v1/editor/topics/1/claims':{items:[{id:2,wording:'A disputed statement',state:{status:'unreviewed',restricted:false}}]},
      '/api/v1/editor/topics/1/documents':{items:[{id:3,title:'Preserved source',source:'Archive',url:'https://example.org/source'}]},
      '/api/v1/editor/topics/1/fetch-jobs':{items:[{id:6,state:'fetched',url:'https://records.example.org/a'}]},
      '/api/v1/editor/fetch-jobs/6':{job:{id:6,state:'fetched',url:'https://records.example.org/a'},receipt:{mime:'text/plain',retention:'private',sha256:'fixture-digest',retrieved_at:'2026-09-22T00:00:00.000Z'}},
      '/api/v1/editor/fetch-jobs/6/extract':{id:3},
      '/api/v1/editor/claims/2':{claim:{id:2,wording:'A disputed statement',attribution:'Original speaker',origin_url:'https://example.org/claim'},state:{status:'unreviewed',restricted:false,eventId:1},context:null,research:{relationships:[],relationshipHistory:[],searchAttempts:[],searchOutcomes:{},coverage:Object.fromEntries(['origin','context','support','counterevidence','source_independence','identity'].map(dimension=>[dimension,{dimension,state:'unknown',id:null,contextVersionId:null}]))}},
      '/api/v1/editor/claims/2/jobs':{items:[{id:4,state:'done',status:'done',model:'jev-1.13.0'}]},
      '/api/v1/editor/claims/2/assessments':{items:[]},
      '/api/v1/editor/jobs/4':{job:{id:4,status:'done',model:'jev-1.13.0'},input:{claim:'A disputed statement',passage:'The actual source passage'},permission:{allowed:false,reason:'permission_required'},decision:{currentEligibilityIssue:null,routing:{publicationAllowed:false},result:{answers:{relation:{choice:'mentions_only',confidence:0.98}}}}},
      '/api/v1/editor/documents/3':{document:{id:3,kind:'web'},source:{title:'Preserved source',url:'https://example.org/source',source:'Archive',evidence:'Original text, not a generated summary.',published_at:null},originals:[],retrievals:[]},
      '/api/v1/editor/documents/3/passages':{items:[{id:5,quote:'Original text',locator:'Paragraph 1'}]}
    };
    if(!(url in routes)) throw new Error(`Unexpected URL: ${url}`);
    return ok(routes[url]);
  });
});
afterEach(()=>{window.history.replaceState({}, '', '/');vi.restoreAllMocks();});
test('research desk shows fetch status and receipt without claiming verification',async()=>{
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/Fetch 6/}));
  expect(await screen.findByText(/Download status: fetched/)).toBeInTheDocument();
  expect(screen.getByText(/not a factual assessment/)).toBeInTheDocument();
  expect(screen.getByText(/fixture-digest/)).toBeInTheDocument();
});
test('extracting a receipt opens the resulting research document',async()=>{
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/Fetch 6/}));
  fireEvent.click(await screen.findByRole('button',{name:'Extract preserved text'}));
  expect(await screen.findByRole('heading',{name:'Preserved source text'})).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/v1/editor/fetch-jobs/6/extract',expect.objectContaining({method:'POST',credentials:'include'}));
});
test('refreshing retrieval also refreshes stale sidebar status',async()=>{
  const originalFetch=global.fetch;let listReads=0;
  global.fetch=vi.fn((url,options)=>url==='/api/v1/editor/topics/1/fetch-jobs'
    ?Promise.resolve(ok({items:[{id:6,state:++listReads===1?'queued':'fetched',url:'https://records.example.org/a'}]}))
    :originalFetch(url,options));
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/Fetch 6 — queued/}));
  fireEvent.click(await screen.findByRole('button',{name:'Refresh retrieval'}));
  expect(await screen.findByRole('button',{name:/Fetch 6 — fetched/})).toBeInTheDocument();
});

test('editor route exposes attributed claims and saved model recommendations without writes',async()=>{
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/A disputed statement/}));
  expect(await screen.findByText('Original speaker')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button',{name:/Job 4/}));
  expect(await screen.findByText(/mentions_only/)).toBeInTheDocument();
  expect(screen.getByText(/not a truth verdict/i)).toBeInTheDocument();
  expect(screen.getByText(/The actual source passage/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.every(([,options])=>!options?.method || options.method==='GET')).toBe(true);
});

test('document inspection shows preserved source text and passage separately',async()=>{
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'Preserved source'}));
  expect(await screen.findByText('Original text, not a generated summary.')).toBeInTheDocument();
  expect(await screen.findByText('Original text')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Open source'})).toHaveAttribute('href','https://example.org/source');
});

test('reader denial is visible and does not expose a research pane',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn((url,options)=>url==='/api/v1/editor/topics'
    ? Promise.resolve({ok:false,status:403,json:async()=>({error:'Forbidden'})}) : previous(url,options));
  render(<App/>);
  expect(await screen.findByRole('alert')).toHaveTextContent(/editor access/i);
  expect(screen.queryByRole('button',{name:'Historical claims'})).not.toBeInTheDocument();
});

test('topic pagination appends results and uses the last record cursor',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn((url,options)=>{
    if(url==='/api/v1/editor/topics') return Promise.resolve(ok({items:Array.from({length:100},(_,i)=>({id:i+1,title:`Topic ${i+1}`}))}));
    if(url==='/api/v1/editor/topics?after=100') return Promise.resolve(ok({items:[{id:101,title:'Final topic'}]}));
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Load more topics'}));
  expect(await screen.findByRole('button',{name:'Final topic'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Topic 1'})).toBeInTheDocument();
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Load more topics'})).not.toBeInTheDocument());
});

test('topic creation sends session-bound input and opens the returned topic',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn((url,options)=>{
    if(url==='/api/v1/editor/topics' && options.method==='POST') {
      expect(options.credentials).toBe('include');
      expect(options.headers['X-CSRF-Token']).toBe('fixture');
      expect(JSON.parse(options.body)).toEqual({title:'Historical claims',slug:'historical'});
      return Promise.resolve(ok({id:1,title:'Historical claims',slug:'historical'}));
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByText('Add a topic'));
  fireEvent.change(screen.getByLabelText('Topic title'),{target:{value:'Historical claims'}});
  fireEvent.change(screen.getByLabelText('Topic slug'),{target:{value:'historical'}});
  fireEvent.click(screen.getByRole('button',{name:'Create topic'}));
  expect(await screen.findByRole('button',{name:'A disputed statement'})).toBeInTheDocument();
});

test('claim creation preserves attribution and recovers from server failure without losing input',async()=>{
  const previous=global.fetch;
  let attempts=0;
  global.fetch=vi.fn((url,options)=>{
    if(url==='/api/v1/editor/claims' && options.method==='POST') {
      expect(JSON.parse(options.body)).toEqual({topicId:1,original:'A disputed statement',attribution:'Original speaker',originUrl:'https://example.org/claim',qualifiers:{normalizedWording:'A disputed statement',observedAt:null,entities:[{name:'Named subject',identifier:null}],timeframe:'Unknown',location:'Unknown',reason:'Record this attributed claim for review.'}});
      expect(options.headers['X-CSRF-Token']).toBe('fixture');
      attempts++;
      return Promise.resolve(attempts===1?{ok:false,status:500,json:async()=>({error:'Research operation failed'})}:ok({id:2}));
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByText('Add a claim'));
  fireEvent.change(screen.getByLabelText('Original claim wording'),{target:{value:'A disputed statement'}});
  fireEvent.change(screen.getByLabelText('Attribution'),{target:{value:'Original speaker'}});
  fireEvent.change(screen.getByLabelText('Claim origin URL'),{target:{value:'https://example.org/claim'}});
  fireEvent.change(screen.getByLabelText('Normalized wording for this proposal'),{target:{value:'A disputed statement'}});
  fireEvent.change(screen.getByLabelText('Entities (one name per line)'),{target:{value:'Named subject'}});
  fireEvent.change(screen.getByLabelText('Timeframe'),{target:{value:'Unknown'}});
  fireEvent.change(screen.getByLabelText('Location'),{target:{value:'Unknown'}});
  fireEvent.change(screen.getByLabelText('Why record this claim?'),{target:{value:'Record this attributed claim for review.'}});
  expect(screen.getByLabelText('Unknown')).toBeRequired();
  fireEvent.submit(screen.getByRole('form',{name:'Create claim'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/choose whether the observation date and time are known or unknown/i);
  expect(attempts).toBe(0);
  fireEvent.click(screen.getByLabelText('Unknown'));
  fireEvent.click(screen.getByRole('button',{name:'Create claim'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
  expect(screen.getByLabelText('Original claim wording')).toHaveValue('A disputed statement');
  fireEvent.click(screen.getByRole('button',{name:'Create claim'}));
  expect(await screen.findByText('Original speaker')).toBeInTheDocument();
  expect(screen.getByText('unreviewed')).toBeInTheDocument();
});

test('append write reuses request ID after ambiguous failures and changes it with the payload',async()=>{
  const previous=global.fetch;const ids=[];
  global.fetch=vi.fn((url,options)=>{
    if(url==='/api/v1/editor/claims/2/search-attempts' && options.method==='POST') {
      ids.push(JSON.parse(options.body).requestId);
      return Promise.resolve(ids.length<4?{ok:false,status:500,json:async()=>({error:'Research operation failed'})}:ok({id:21}));
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/A disputed statement/}));
  fireEvent.click(await screen.findByText('Search attempt history (0)'));
  fireEvent.change(screen.getByLabelText('Search query'),{target:{value:'first query'}});
  fireEvent.change(screen.getByLabelText('Notes'),{target:{value:'No results yet.'}});
  const save=screen.getByRole('button',{name:'Append search attempt'});
  fireEvent.click(save);expect(await screen.findByText('Research operation failed')).toBeInTheDocument();
  fireEvent.click(save);expect(await screen.findByText('Research operation failed')).toBeInTheDocument();
  expect(ids[1]).toBe(ids[0]);
  fireEvent.change(screen.getByLabelText('Search query'),{target:{value:'changed query'}});
  fireEvent.click(save);expect(await screen.findByText('Research operation failed')).toBeInTheDocument();
  fireEvent.click(save);expect(await screen.findByText('Search attempt recorded.')).toBeInTheDocument();
  expect(ids[2]).not.toBe(ids[1]);
  expect(ids[3]).toBe(ids[2]);
});

test('unsupported fallback history ends loading and offers a retry',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn((url,options)=>{
    if(url==='/api/v1/editor/claims/2') return previous(url,options).then(async response=>{
      const data=await response.json();delete data.research;return ok(data);
    });
    if(['/api/v1/editor/claims/2/relationships','/api/v1/editor/claims/2/search-attempts','/api/v1/editor/claims/2/coverage-events'].includes(url))
      return Promise.resolve({ok:false,status:404,json:async()=>({error:'Not found'})});
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:/A disputed statement/}));
  expect(await screen.findByText('Claim research history is not supported by this API version.')).toBeInTheDocument();
  expect(screen.queryByText('Loading claim research history…')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Retry loading research history'})).toBeInTheDocument();
});

test('passage selection maps browser line endings to original UTF-16 offsets',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/documents/3') return ok({document:{id:3,kind:'report'},source:{title:'Preserved source',url:'https://example.org/source',source:'Archive',evidence:'First\r\nSecond 🧭 line',published_at:null},originals:[],retrievals:[]});
    if(url==='/api/v1/editor/documents/3/passages' && options.method==='POST') {
      expect(JSON.parse(options.body)).toEqual({start:7,end:16,locator:'Paragraph 2'});
      expect(options.headers['X-CSRF-Token']).toBe('fixture');
      return ok({id:6,document_id:3,start_offset:7,end_offset:16,locator:'Paragraph 2',quote:'Second 🧭'});
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'Preserved source'}));
  const text=await screen.findByRole('textbox',{name:'Select source text'});
  expect(text).toHaveAttribute('readonly');
  expect(screen.getByRole('button',{name:'Save passage'})).toBeDisabled();
  text.focus();text.setSelectionRange(6,15);
  fireEvent.click(screen.getByRole('button',{name:'Use selected text'}));
  fireEvent.change(screen.getByLabelText('Passage locator'),{target:{value:'Paragraph 2'}});
  fireEvent.click(screen.getByRole('button',{name:'Save passage'}));
  expect(await screen.findByText(/Passage 6 saved/)).toBeInTheDocument();
  fireEvent.select(text);
  expect(screen.getByText(/Passage 6 saved/)).toBeInTheDocument();
});

test('manual document import preserves supplied text and explicit provenance without fetching its URL',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/documents/text' && options.method==='POST') {
      expect(options.headers['X-CSRF-Token']).toBe('fixture');
      expect(JSON.parse(options.body)).toEqual({topicId:1,title:'Preserved source',source:'Original publisher',
        url:'https://example.org/source',kind:'report',originChain:'original-report',
        retrievedAt:'2020-01-01T00:00:00.000Z',publishedAt:null,text:'Original text, not a generated summary.'});
      return ok({document:{id:3}});
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByText('Import document text'));
  const values={'Document title':'Preserved source','Source publisher':'Original publisher','Source URL':'https://example.org/source',
    'Originating source chain':'original-report','Retrieved at (UTC)':'2020-01-01T00:00:00.000Z','Document text':'Original text, not a generated summary.'};
  for(const [label,value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText('Document type'),{target:{value:'report'}});
  fireEvent.click(screen.getByRole('button',{name:'Import text'}));
  expect(await screen.findByRole('textbox',{name:'Select source text'})).toHaveValue('Original text, not a generated summary.');
  expect(global.fetch.mock.calls.every(([url])=>url.startsWith('/api/'))).toBe(true);
});

test('human assessment binds the selected passage and current context without supplying reviewer identity',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/topics/1/search?q=original&limit=30') return ok({query:'original',items:[{
      id:5,document_id:3,start_offset:0,end_offset:13,quote:'Original text',locator:'Paragraph 1',title:'Preserved source',source:'Archive',kind:'report',origin_chain:'original-report'}]});
    if(url==='/api/v1/editor/claims/2/assessments' && options.method==='POST') {
      expect(JSON.parse(options.body)).toEqual({passageId:5,expectedVersionId:null,relevance:'direct',relation:'mentions_only',evidenceType:'mention',rationale:'Names the claim without establishing it.'});
      expect(options.headers['X-CSRF-Token']).toBe('fixture');
      return ok({id:8,actor_id:7});
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'A disputed statement'}));
  fireEvent.change(await screen.findByLabelText('Search saved passages'),{target:{value:'original'}});
  fireEvent.click(screen.getByRole('button',{name:'Find passages'}));
  fireEvent.click(await screen.findByRole('button',{name:/Review passage 5/}));
  expect(await screen.findByLabelText('Full preserved document')).toHaveTextContent('Original text, not a generated summary.');
  fireEvent.change(screen.getByLabelText('Relevance'),{target:{value:'direct'}});
  fireEvent.change(screen.getByLabelText('Relation to claim'),{target:{value:'mentions_only'}});
  fireEvent.change(screen.getByLabelText('Evidence type'),{target:{value:'mention'}});
  fireEvent.change(screen.getByLabelText('Assessment rationale'),{target:{value:'Names the claim without establishing it.'}});
  fireEvent.click(screen.getByRole('button',{name:'Save human assessment'}));
  expect(await screen.findByText(/Human assessment 8 saved/)).toBeInTheDocument();
  expect(screen.getByText('unreviewed')).toBeInTheDocument();
});

test('assessment refuses a search quote that does not resolve to the preserved document',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/topics/1/search?q=original&limit=30') return ok({query:'original',items:[{
      id:5,document_id:3,start_offset:0,end_offset:13,quote:'Altered quote',locator:'Paragraph 1',title:'Preserved source'}]});
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'A disputed statement'}));
  fireEvent.change(await screen.findByLabelText('Search saved passages'),{target:{value:'original'}});
  fireEvent.click(screen.getByRole('button',{name:'Find passages'}));
  fireEvent.click(await screen.findByRole('button',{name:/Review passage 5/}));
  expect(await screen.findByText(/does not match the preserved document/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Save human assessment'})).toBeDisabled();
});

test('context editing appends a version with unknown identity and observation date left null',async()=>{
  const previous=global.fetch;let saved=null;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/claims/2/context' && options.method==='POST') {
      expect(JSON.parse(options.body)).toEqual({expectedVersionId:null,normalizedWording:'A scoped disputed statement',
        observedAt:null,timeframe:'Date unknown',location:'Location unknown',reason:'Preserve uncertainty while clarifying scope.',
        entities:[{name:'Named subject',identifier:null}]});
      saved={id:10,normalizedWording:'A scoped disputed statement',entities:[{name:'Named subject',identifier:null}]};
      return ok(saved);
    }
    const result=await previous(url,options);
    if(url==='/api/v1/editor/claims/2' && saved) return ok({...await result.json(),context:saved});
    return result;
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'A disputed statement'}));
  fireEvent.click(await screen.findByText('Edit claim context'));
  const values={'Normalized wording':'A scoped disputed statement','Claim timeframe':'Date unknown','Claim location':'Location unknown',
    'Reason for context change':'Preserve uncertainty while clarifying scope.'};
  for(const [label,value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Add named entity'}));
  fireEvent.change(screen.getByLabelText('Entity 1 name'),{target:{value:'Named subject'}});
  fireEvent.click(screen.getByRole('button',{name:'Save new context version'}));
  expect(await screen.findByText('Current claim context')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit claim context'));
  expect(screen.getByRole('textbox',{name:'Normalized wording'})).toHaveValue('A scoped disputed statement');
  expect(screen.getByText('unreviewed')).toBeInTheDocument();
});

test('provider permission requires deliberate acknowledgement and binds the inspected input hash',async()=>{
  const previous=global.fetch;let allowed=false;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/jobs/4') return ok({job:{id:4,state:'queued',model:'jev-1.13.0'},
      input:{claim:'A disputed statement',passage:'Original text'},decision:null,
      permission:{provider:'typesafe',allowed,inputHash:'a'.repeat(64),eventId:allowed?12:null,reason:allowed?null:'permission_required'}});
    if(url==='/api/v1/editor/jobs/4/provider-permission') {
      expect(JSON.parse(options.body)).toEqual({allowed:true,reason:'Approved synthetic test evidence.',expectedEventId:null,expectedInputHash:'a'.repeat(64)});
      expect(options.headers['X-CSRF-Token']).toBe('fixture');allowed=true;return ok({allowed:true});
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'A disputed statement'}));
  fireEvent.click(await screen.findByRole('button',{name:/Job 4/}));
  const grant=await screen.findByRole('button',{name:'Authorize Typesafe disclosure'});
  expect(grant).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Permission reason'),{target:{value:'Approved synthetic test evidence.'}});
  expect(grant).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the prepared input/}));
  fireEvent.click(grant);
  expect(await screen.findByRole('button',{name:'Revoke Typesafe disclosure'})).toBeInTheDocument();
});

test('preparing classification opens its preview without granting provider permission',async()=>{
  const previous=global.fetch;
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/v1/editor/topics/1/search?q=original&limit=30') return ok({query:'original',items:[{
      id:5,document_id:3,start_offset:0,end_offset:13,quote:'Original text',locator:'Paragraph 1',title:'Preserved source'}]});
    if(url==='/api/v1/editor/claims/2/jobs' && options.method==='POST') {
      expect(JSON.parse(options.body)).toEqual({passageId:5,contextVersionId:null});return ok({id:4});
    }
    return previous(url,options);
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Historical claims'}));
  fireEvent.click(await screen.findByRole('button',{name:'A disputed statement'}));
  fireEvent.change(await screen.findByLabelText('Search saved passages'),{target:{value:'original'}});
  fireEvent.click(screen.getByRole('button',{name:'Find passages'}));
  fireEvent.click(await screen.findByRole('button',{name:/Review passage 5/}));
  await screen.findByLabelText('Full preserved document');
  fireEvent.click(screen.getByRole('button',{name:'Prepare JEV classification'}));
  expect(await screen.findByText('Inspect prepared model input')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([,options])=>options?.method==='POST').map(([url])=>url)).toEqual(['/api/v1/editor/claims/2/jobs']);
});

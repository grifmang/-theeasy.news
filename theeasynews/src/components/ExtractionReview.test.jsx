import {vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import ExtractionReview from './ExtractionReview';
import {apiRequest} from '../api';
vi.mock('../api',()=>({apiRequest:vi.fn()}));
const digest='a'.repeat(64);
const record={id:7,manifest_sha256:digest,original_sha256:'b'.repeat(64),extractor_version:'http-utf8-v1',
  review:{status:'unreviewed',eventId:null},manifest:{offsetUnit:'utf16',textLength:17,sourceLength:17,
    spans:[{start:0,end:17,sourceStart:0,sourceEnd:17}],pages:[],quality:{warnings:['plain_text_not_rendered']}}};
beforeEach(()=>{vi.resetAllMocks();apiRequest.mockResolvedValue(record);});
function mount(){return render(<ExtractionReview extractions={[{id:7}]}/>);}

test('shows provenance and private original link without preselecting approval',async()=>{
  mount();
  expect(await screen.findByText('Original layout has not been checked.')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Download preserved original'})).toHaveAttribute('href','/api/v1/editor/extractions/7/original');
  expect(screen.getByLabelText('Extraction decision')).toHaveValue('');
  expect(screen.getByLabelText(/I compared/)).not.toBeChecked();
  expect(screen.getByRole('button',{name:'Save extraction review'})).toBeDisabled();
});

test('acceptance requires comparison and saves the exact manifest and review version',async()=>{
  apiRequest.mockImplementation(async(path,options)=>options?.method==='POST'?{id:9,decision:'accepted'}:record);
  mount();await screen.findByText('Original layout has not been checked.');
  fireEvent.change(screen.getByLabelText('Extraction decision'),{target:{value:'accepted'}});
  fireEvent.change(screen.getByLabelText('Review notes'),{target:{value:'Names and amounts match the original.'}});
  expect(screen.getByRole('button',{name:'Save extraction review'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I compared/));
  fireEvent.click(screen.getByRole('button',{name:'Save extraction review'}));
  expect(await screen.findByText(/Review saved: accepted/)).toBeInTheDocument();
  expect(apiRequest).toHaveBeenLastCalledWith('/api/v1/editor/extractions/7/reviews',expect.objectContaining({method:'POST',body:{
    expectedManifestSha256:digest,expectedEventId:null,decision:'accepted',originalCompared:true,reason:'Names and amounts match the original.'
  }}));
  expect(screen.getByText(/Current extraction review: accepted/)).toBeInTheDocument();
});

test('stale review retains notes and requires reload before another submission',async()=>{
  apiRequest.mockImplementation(async(path,options)=>{
    if(options?.method==='POST') throw Object.assign(new Error('Changed'),{status:409});
    return record;
  });
  mount();await screen.findByText('Original layout has not been checked.');
  fireEvent.change(screen.getByLabelText('Extraction decision'),{target:{value:'rejected'}});
  fireEvent.change(screen.getByLabelText('Review notes'),{target:{value:'Missing footnote.'}});
  fireEvent.click(screen.getByRole('button',{name:'Save extraction review'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed/);
  expect(screen.getByLabelText('Review notes')).toHaveValue('Missing footnote.');
  expect(screen.getByRole('button',{name:'Save extraction review'})).toBeDisabled();
  apiRequest.mockResolvedValue({...record,review:{status:'accepted',eventId:12}});
  fireEvent.click(screen.getByRole('button',{name:'Reload extraction review'}));
  await screen.findByText(/Current extraction review: accepted/);
  expect(screen.getByRole('button',{name:'Save extraction review'})).toBeEnabled();
});

test('failed load offers retry without an actionable form',async()=>{
  apiRequest.mockRejectedValue({status:403});mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/Editor access/);
  expect(screen.queryByRole('button',{name:'Save extraction review'})).not.toBeInTheDocument();
  apiRequest.mockResolvedValue(record);
  fireEvent.click(screen.getByRole('button',{name:'Reload extraction review'}));
  await screen.findByText('Original layout has not been checked.');
});

test('missing extraction history is unverified, not accepted',()=>{
  render(<ExtractionReview extractions={[]}/>);
  expect(screen.getByText(/No extraction manifest/)).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

test('unmount aborts the pending request',async()=>{
  let signal;apiRequest.mockImplementation((path,options)=>{signal=options.signal;return new Promise(()=>{});});
  const view=mount();await waitFor(()=>expect(signal).toBeDefined());view.unmount();
  expect(signal.aborted).toBe(true);
});

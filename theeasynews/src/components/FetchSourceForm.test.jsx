import { vi } from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import FetchSourceForm from './FetchSourceForm';
import {apiRequest} from '../api';
vi.mock('../api',()=>({apiRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
test('submits URL and policy ID and reports queued, not verified',async()=>{
  apiRequest.mockResolvedValue({id:12,state:'queued'});
  const saved=vi.fn();render(<FetchSourceForm topicId={1} onSaved={saved}/>);
  fireEvent.change(screen.getByLabelText('Approved source policy ID'),{target:{value:'court-records'}});
  fireEvent.change(screen.getByLabelText('Document URL'),{target:{value:'https://records.example.org/a'}});
  fireEvent.submit(screen.getByRole('form',{name:'Fetch source document'}));
  expect(await screen.findByText(/Queued for retrieval/)).toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/editor/topics/1/fetch-jobs',expect.objectContaining({method:'POST',body:{sourceId:'court-records',url:'https://records.example.org/a'}}));
  expect(saved).toHaveBeenCalledWith({id:12,state:'queued'});
});
test('keeps input and explains disabled ingestion',async()=>{
  apiRequest.mockRejectedValue({status:503});render(<FetchSourceForm topicId={1} onSaved={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Approved source policy ID'),{target:{value:'records'}});
  fireEvent.change(screen.getByLabelText('Document URL'),{target:{value:'https://records.example.org/a'}});
  fireEvent.submit(screen.getByRole('form',{name:'Fetch source document'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/);
  expect(screen.getByLabelText('Document URL')).toHaveValue('https://records.example.org/a');
});
test('rejects credentialed URLs before sending',async()=>{
  render(<FetchSourceForm topicId={1} onSaved={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Approved source policy ID'),{target:{value:'records'}});
  fireEvent.change(screen.getByLabelText('Document URL'),{target:{value:'https://secret@records.example.org/a'}});
  fireEvent.submit(screen.getByRole('form',{name:'Fetch source document'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/HTTPS/));
  expect(apiRequest).not.toHaveBeenCalled();
});

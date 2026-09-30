import { vi } from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import FetchExtraction from './FetchExtraction';
import {apiRequest} from '../api';
vi.mock('../api',()=>({apiRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
test('HTML extraction is offered only when the server reports availability',()=>{
  const props={jobId:6,receipt:{mime:'text/html',retention:'private'},onSaved:()=>{}};
  const {rerender}=render(<FetchExtraction {...props}/>);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(<FetchExtraction {...props} extractionAvailable={true}/>);
  expect(screen.getByRole('button',{name:'Extract preserved text'})).toBeEnabled();
});
test('a busy parser explains retry without claiming extraction succeeded',async()=>{
  apiRequest.mockRejectedValue({status:429});
  render(<FetchExtraction jobId={6} receipt={{mime:'text/html',retention:'private'}} extractionAvailable={true} onSaved={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Extract preserved text'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/busy.*retry/i);
  expect(screen.getByRole('status')).toHaveTextContent('');
});
test('explicit extraction opens the returned document',async()=>{
  apiRequest.mockResolvedValue({id:3});const onSaved=vi.fn();
  render(<FetchExtraction jobId={6} receipt={{mime:'text/plain',retention:'private'}} onSaved={onSaved}/>);
  expect(apiRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Extract preserved text'}));
  expect(await screen.findByText(/Extracted for review/)).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith({id:3});
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/editor/fetch-jobs/6/extract',expect.objectContaining({method:'POST',body:{}}));
});
test.each([{mime:'application/pdf',retention:'private'},{mime:'text/plain',retention:'metadata-only'}])('unsupported receipt does not offer extraction',receipt=>{
  render(<FetchExtraction jobId={6} receipt={receipt} onSaved={()=>{}}/>);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});
test('failure is visible and allows a deliberate retry',async()=>{
  apiRequest.mockRejectedValue({status:500});
  render(<FetchExtraction jobId={6} receipt={{mime:'text/plain',retention:'private'}} onSaved={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Extract preserved text'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not confirm/);
  expect(screen.getByRole('button',{name:'Extract preserved text'})).toBeEnabled();
});

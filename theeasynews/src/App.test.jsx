import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import { GoogleOAuthProvider } from '@react-oauth/google';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ articles: [], categories: [], authors: [], total: 0, page: 1, totalPages: 1 }) })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('renders articles heading', async () => {
  render(<App />);
  const heading = await screen.findByText(/latest articles/i);
  expect(heading).toBeInTheDocument();
});

test('anonymous research desk navigation redirects to login', async () => {
  window.history.replaceState({}, '', '/editor');
  global.fetch = vi.fn(async url => url === '/api/session'
    ? { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }
    : { ok: true, json: async () => ({ categories: [] }) });
  render(<GoogleOAuthProvider clientId="fixture"><App /></GoogleOAuthProvider>);
  expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test('home navigation opens the about route', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: 'About' }));
  expect(window.location.pathname).toBe('/about');
  expect(await screen.findByRole('heading', { name: /about/i })).toBeInTheDocument();
});

test('restores server identity and clears browser credentials without trusting stale user ID',async()=>{
  localStorage.setItem('token','old-secret');localStorage.setItem('userId','999');
  global.fetch=vi.fn(async(url,options)=>{
    if(url==='/api/session') return {ok:true,json:async()=>({userId:7,csrfToken:'fixture-csrf'})};
    if(url==='/api/logout') {
      if(options.credentials!=='include' || options.headers['X-CSRF-Token']!=='fixture-csrf') throw new Error('Incorrect logout contract');
      return {ok:true,json:async()=>({message:'Logged out'})};
    }
    return {ok:true,json:async()=>({articles:[],categories:[],totalPages:1})};
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Logout'}));
  expect(await screen.findByRole('link',{name:'Login'})).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('userId')).toBeNull();
});

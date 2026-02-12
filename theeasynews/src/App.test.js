import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ articles: [], categories: [], authors: [], total: 0, page: 1, totalPages: 1 }) })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders articles heading', async () => {
  render(<App />);
  const heading = await screen.findByText(/latest articles/i);
  expect(heading).toBeInTheDocument();
});

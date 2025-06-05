import { render, screen } from '@testing-library/react';
import App from './App';

test('renders articles heading', () => {
  render(<App />);
  const heading = screen.getByText(/articles/i);
  expect(heading).toBeInTheDocument();
});

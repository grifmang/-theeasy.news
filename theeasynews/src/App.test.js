import { render, screen } from '@testing-library/react';
import App from './App';

test('shows login form initially', () => {
  render(<App />);
  const heading = screen.getByRole('heading', { name: /login/i });
  expect(heading).toBeInTheDocument();
});

import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Bluesky profile link', () => {
  render(<App />);
  const heading = screen.getByText(/follow the easy news on bluesky/i);
  expect(heading).toBeInTheDocument();
});

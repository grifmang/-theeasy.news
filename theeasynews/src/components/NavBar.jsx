import React from 'react';
import { Link } from 'react-router-dom';

const NavBar = ({ userId, onLogout }) => (
  <nav style={{ padding: '1em', background: '#eee' }}>
    <Link to="/">Home</Link> |{' '}
    {userId ? (
      <>
        <Link to="/saved">Saved</Link> |{' '}
        <button onClick={onLogout}>Logout</button>
      </>
    ) : (
      <Link to="/login">Login</Link>
    )}
    {' | '}<Link to="/bluesky">Bluesky</Link>
  </nav>
);

export default NavBar;

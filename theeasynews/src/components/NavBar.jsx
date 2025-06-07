import React from 'react';
import { Link } from 'react-router-dom';

const NavBar = ({ userId, onLogout }) => (
  <nav className="navbar">
    <Link className="logo" to="/">The Easy News</Link>
    <div className="nav-links">
      <Link to="/">Home</Link>
      {userId ? (
        <>
          <Link to="/saved">Saved</Link>
          <button onClick={onLogout}>Logout</button>
        </>
      ) : (
        <Link to="/login">Login</Link>
      )}
      <Link to="/bluesky">Bluesky</Link>
    </div>
  </nav>
);

export default NavBar;

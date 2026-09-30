import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NavBar = ({ userId, onLogout }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const readerPath = location.pathname === '/' || location.pathname.startsWith('/topics/') ||
    location.pathname.startsWith('/claims/') || location.pathname.startsWith('/analyses/') ||
    location.pathname.startsWith('/articles/') || location.pathname === '/saved';

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <nav className={`navbar${readerPath ? ' navbar--reader' : ''}`} aria-label="Main navigation">
      <Link className="logo" to="/">
        The <span className="logo-accent">Easy</span> News
      </Link>
      <button
        className="hamburger"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
      >
        {menuOpen ? '\u2715' : '\u2630'}
      </button>
      <div className={`nav-links${menuOpen ? ' open' : ''}`}>
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Public research</Link>
        {userId ? (
          <>
            <Link to="/saved" className={location.pathname === '/saved' ? 'active' : ''}>Saved</Link>
            <Link to="/editor" className={location.pathname === '/editor' ? 'active' : ''}>Research desk</Link>
            <button className="btn-logout" onClick={onLogout}>Logout</button>
          </>
        ) : (
          <Link to="/login" className={location.pathname === '/login' ? 'active' : ''}>Login</Link>
        )}
        <Link to="/authors" className={location.pathname === '/authors' ? 'active' : ''}>Authors</Link>
        <Link to="/about" className={location.pathname === '/about' ? 'active' : ''}>About</Link>
      </div>
    </nav>
  );
};

export default NavBar;

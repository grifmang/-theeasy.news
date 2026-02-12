import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NavBar = ({ userId, onLogout }) => {
  const [categories, setCategories] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const API = process.env.REACT_APP_API_URL || '';

  useEffect(() => {
    fetch(`${API}/api/categories`)
      .then(res => res.json())
      .then(data => setCategories(data.categories || []))
      .catch(() => {});
  }, [API]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
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
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Home</Link>
        {categories.map(cat => (
          <Link
            key={cat}
            to={`/category/${encodeURIComponent(cat)}`}
            className={decodeURIComponent(location.pathname) === `/category/${cat}` ? 'active' : ''}
          >
            {cat}
          </Link>
        ))}
        {userId ? (
          <>
            <Link to="/saved" className={location.pathname === '/saved' ? 'active' : ''}>Saved</Link>
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

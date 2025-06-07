import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const NavBar = ({ userId, onLogout }) => {
  const [categories, setCategories] = useState([]);
  const API = process.env.REACT_APP_API_URL || '';

  useEffect(() => {
    fetch(`${API}/api/categories`)
      .then(res => res.json())
      .then(data => setCategories(data.categories || []));
  }, [API]);

  return (
    <nav className="navbar">
      <Link className="logo" to="/">The Easy News</Link>
      <div className="nav-links">
        <Link to="/">Home</Link>
        {categories.map(cat => (
          <Link key={cat} to={`/category/${encodeURIComponent(cat)}`}>{cat}</Link>
        ))}
        {userId ? (
          <>
            <Link to="/saved">Saved</Link>
            <button onClick={onLogout}>Logout</button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
        <Link to="/authors">Authors</Link>
        <Link to="/about">About</Link>
      </div>
    </nav>
  );
};

export default NavBar;

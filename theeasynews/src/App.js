import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Authors from './components/Authors';
import About from './components/About';
import Login from './components/Login';
import Articles from './components/Articles';
import CategoryArticles from './components/CategoryArticles';
import SavedArticles from './components/SavedArticles';
import Article from './components/Article';
import NavBar from './components/NavBar';

function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem('userId'));

  const handleLogout = () => {
    localStorage.removeItem('userId');
    setUserId(null);
  };

  return (
    <Router>
      <NavBar userId={userId} onLogout={handleLogout} />
      <Routes>
        <Route path="/" element={<Articles userId={userId} />} />
        <Route path="/category/:name" element={<CategoryArticles userId={userId} />} />
        <Route path="/login" element={<Login onLogin={setUserId} />} />
        <Route path="/saved" element={<SavedArticles userId={userId} />} />
        <Route path="/authors" element={<Authors />} />
        <Route path="/about" element={<About />} />
        <Route path="/articles/:id" element={<Article />} />
      </Routes>
    </Router>
  );
}

export default App;

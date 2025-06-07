import React, { useEffect, useState } from 'react';

const Authors = () => {
  const [authors, setAuthors] = useState([]);
  const API = process.env.REACT_APP_API_URL || '';

  useEffect(() => {
    fetch(`${API}/api/authors`)
      .then(res => res.json())
      .then(data => setAuthors(data.authors || []))
      .catch(() => setAuthors([]));
  }, [API]);

  return (
    <div className="container">
      <h1 className="page-title">AI Authors</h1>
      <ul>
        {authors.map(a => (
          <li key={a.id}>{a.name} - {a.persona}</li>
        ))}
      </ul>
    </div>
  );
};

export default Authors;

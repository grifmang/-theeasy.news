import React, { useEffect, useState } from 'react';
import ArticleItem from './ArticleItem';

const SavedArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);

  useEffect(() => {
    fetch(`http://localhost:5000/api/user/${userId}/saved`)
      .then(res => res.json())
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [userId]);

  return (
    <div>
      <h2>Saved Articles</h2>
      <ul>
        {articles.map(a => (
          <ArticleItem key={a.id} article={a} userId={userId} />
        ))}
      </ul>
    </div>
  );
};

export default SavedArticles;

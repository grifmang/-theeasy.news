import React, { useEffect, useState } from 'react';
import ArticleItem from './ArticleItem';
const ArticleList = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const API = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetch(`${API}/api/articles`)
      .then(res => res.json())
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [API]);

  return (
    <div>
      <h2>Latest Articles</h2>
      <ul>
        {articles.map(a => (
          <ArticleItem key={a.id} article={a} userId={userId} />
        ))}
      </ul>
    </div>
  );
};

export default ArticleList;

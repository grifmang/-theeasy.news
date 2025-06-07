import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const Article = () => {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const API = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetch(`${API}/api/articles/${id}`)
      .then(res => res.json())
      .then(data => setArticle(data.article))
      .catch(() => {});
  }, [API, id]);

  if (!article) {
    return <div className="container">Loading...</div>;
  }

  const shareUrl = `${window.location.origin}/articles/${id}`;

  return (
    <div className="container article">
      <h1 className="page-title">{article.title}</h1>
      <p>{article.content}</p>
      <small className="article-author">By {article.author}</small>
      <div className="share-buttons">
        <FacebookShareButton url={shareUrl}>Share to Facebook</FacebookShareButton>
        <TwitterShareButton url={shareUrl}>Share to X</TwitterShareButton>
        <TelegramShareButton url={shareUrl}>Telegram</TelegramShareButton>
        <LinkedinShareButton url={shareUrl}>LinkedIn</LinkedinShareButton>
      </div>
    </div>
  );
};

export default Article;

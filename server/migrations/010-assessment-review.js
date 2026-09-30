function migrateAssessmentReview(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=10').get()) return;
  db.exec(`CREATE TABLE human_assessment_reviews (
    assessment_id INTEGER PRIMARY KEY REFERENCES research_assessments(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    context_version_id INTEGER REFERENCES claim_context_versions(id)
  );
  CREATE TRIGGER human_assessment_no_update BEFORE UPDATE ON human_assessment_reviews
    BEGIN SELECT RAISE(ABORT,'assessment review is immutable'); END;
  CREATE TRIGGER human_assessment_no_delete BEFORE DELETE ON human_assessment_reviews
    BEGIN SELECT RAISE(ABORT,'assessment review is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(10);`);
}
module.exports={migrateAssessmentReview};

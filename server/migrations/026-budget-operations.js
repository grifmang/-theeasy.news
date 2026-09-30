function migrateBudgetOperations(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=26').get()) return;
  db.exec(`CREATE TABLE model_budget_policy_events (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    effective_at TEXT NOT NULL, daily_micros INTEGER NOT NULL CHECK(daily_micros>=0),
    monthly_micros INTEGER NOT NULL CHECK(monthly_micros>=0),
    category_daily_json TEXT NOT NULL, category_monthly_json TEXT NOT NULL,
    max_concurrent_calls INTEGER NOT NULL CHECK(max_concurrent_calls>=0),
    max_input_tokens INTEGER NOT NULL CHECK(max_input_tokens>=0),
    max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens>=0),
    reasoning_micros INTEGER NOT NULL CHECK(reasoning_micros>=0),
    tool_micros INTEGER NOT NULL CHECK(tool_micros>=0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX model_budget_policy_effective ON model_budget_policy_events(effective_at,id);
  CREATE TABLE model_reservation_admissions (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_reservations(id),
    policy_version INTEGER NOT NULL CHECK(policy_version>=0), policy_json TEXT NOT NULL,
    price_version TEXT NOT NULL, model TEXT, estimated_input_tokens INTEGER CHECK(estimated_input_tokens>=0),
    estimated_output_tokens INTEGER CHECK(estimated_output_tokens>=0),
    input_micros INTEGER NOT NULL CHECK(input_micros>=0), output_micros INTEGER NOT NULL CHECK(output_micros>=0),
    reasoning_micros INTEGER NOT NULL CHECK(reasoning_micros>=0), tool_micros INTEGER NOT NULL CHECK(tool_micros>=0)
  );
  CREATE TABLE model_call_slot_events (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES model_reservations(id),
    action TEXT NOT NULL CHECK(action IN ('start','finish')),
    occurred_at TEXT NOT NULL, deadline_at TEXT, lease_until TEXT, slot_token TEXT NOT NULL,
    CHECK((action='start' AND deadline_at IS NOT NULL AND lease_until IS NOT NULL) OR
      (action='finish' AND deadline_at IS NULL AND lease_until IS NULL))
  );
  CREATE UNIQUE INDEX model_call_slot_start ON model_call_slot_events(reservation_id) WHERE action='start';
  CREATE UNIQUE INDEX model_call_slot_finish ON model_call_slot_events(reservation_id) WHERE action='finish';
  CREATE INDEX model_call_slot_active ON model_call_slot_events(action,lease_until);
  CREATE TABLE model_call_usage_events (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES model_reservations(id),
    reported_input_tokens INTEGER, reported_output_tokens INTEGER,
    attempt_number INTEGER NOT NULL CHECK(attempt_number>=1), retry_identity TEXT NOT NULL,
    policy_version INTEGER NOT NULL CHECK(policy_version>=0), price_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('valid','invalid','unknown')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(reported_input_tokens IS NULL OR reported_input_tokens>=0),
    CHECK(reported_output_tokens IS NULL OR reported_output_tokens>=0),
    CHECK(status!='valid' OR (reported_input_tokens IS NOT NULL AND reported_output_tokens IS NOT NULL))
  );
  CREATE UNIQUE INDEX model_call_usage_once ON model_call_usage_events(reservation_id);
  CREATE TABLE model_charge_reconciliations (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    settlement_id INTEGER NOT NULL UNIQUE REFERENCES model_settlements(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE model_call_recovery_events (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL UNIQUE REFERENCES model_reservations(id),
    actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE model_call_late_events (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL UNIQUE REFERENCES model_reservations(id),
    slot_token TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed')),
    reported_input_tokens INTEGER CHECK(reported_input_tokens>=0),
    reported_output_tokens INTEGER CHECK(reported_output_tokens>=0), occurred_at TEXT NOT NULL
  );
  CREATE TABLE model_call_legacy_recovery (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_reservations(id),
    kind TEXT NOT NULL CHECK(kind IN ('unfinished','completed_unknown')), marked_at TEXT NOT NULL
  );
  CREATE TABLE model_call_legacy_recovery_seal (id INTEGER PRIMARY KEY CHECK(id=1), sealed INTEGER NOT NULL CHECK(sealed IN (0,1)));
  INSERT INTO model_call_legacy_recovery_seal(id,sealed) VALUES(1,0);
  CREATE TABLE model_late_charge_holds (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES model_reservations(id),
    source TEXT NOT NULL CHECK(source IN ('late_usage','guard_restoration')),
    hold_key TEXT NOT NULL UNIQUE CHECK(length(hold_key) BETWEEN 1 AND 200),
    amount_micros INTEGER NOT NULL CHECK(typeof(amount_micros)='integer' AND amount_micros>0 AND amount_micros<=9007199254740991),
    price_version TEXT NOT NULL, policy_version INTEGER NOT NULL CHECK(policy_version>=0),
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE model_late_hold_resolutions (
    id INTEGER PRIMARY KEY, hold_id INTEGER NOT NULL UNIQUE REFERENCES model_late_charge_holds(id),
    actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK(status IN ('billed','not_billed')),
    actual_micros INTEGER NOT NULL CHECK(typeof(actual_micros)='integer' AND actual_micros>=0 AND actual_micros<=9007199254740991),
    occurred_at TEXT NOT NULL, CHECK(status!='not_billed' OR actual_micros=0)
  );
  CREATE TABLE model_budget_integrity_fault_events (
    id INTEGER PRIMARY KEY, reservation_id INTEGER REFERENCES model_reservations(id),
    kind TEXT NOT NULL CHECK(kind='late_hold_failure'), occurred_at TEXT NOT NULL
  );
  CREATE TABLE model_budget_guard_restorations (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES model_reservations(id),
    trip_name TEXT NOT NULL UNIQUE, fault_id INTEGER NOT NULL CHECK(fault_id>=0),
    hold_id INTEGER NOT NULL REFERENCES model_late_charge_holds(id),
    actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), occurred_at TEXT NOT NULL
  );
  CREATE TABLE model_budget_guard_rearms (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    trip_names_json TEXT NOT NULL, occurred_at TEXT NOT NULL
  );
  CREATE INDEX model_late_holds_page ON model_late_charge_holds(id DESC);
  CREATE TRIGGER model_late_hold_requires_final BEFORE INSERT ON model_late_charge_holds
    WHEN (NEW.source='late_usage' AND NOT EXISTS(SELECT 1 FROM model_call_late_events WHERE reservation_id=NEW.reservation_id))
      OR NOT EXISTS(SELECT 1 FROM model_settlements WHERE reservation_id=NEW.reservation_id AND status!='unknown')
    BEGIN SELECT RAISE(ABORT,'late hold requires final charge and late usage'); END;
  CREATE TABLE model_budget_clock (
    id INTEGER PRIMARY KEY CHECK(id=1), last_at TEXT NOT NULL
  );
  INSERT INTO model_budget_clock(id,last_at) VALUES(1,'1970-01-01T00:00:00.000Z');
  CREATE TABLE model_budget_pending (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_reservations(id),
    category TEXT NOT NULL, max_micros INTEGER NOT NULL CHECK(max_micros>=0),reserved_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','unknown'))
  );
  CREATE TABLE model_budget_counters (
    scope TEXT NOT NULL CHECK(scope IN ('all','category')),
    category TEXT NOT NULL, period_kind TEXT NOT NULL CHECK(period_kind IN ('outstanding','unknown','late_hold','day','month')),
    period_key TEXT NOT NULL, amount_micros INTEGER NOT NULL
      CHECK(typeof(amount_micros)='integer' AND amount_micros>=0 AND amount_micros<=9007199254740991),
    PRIMARY KEY(scope,category,period_kind,period_key)
  );
  CREATE INDEX model_budget_counters_period ON model_budget_counters(scope,period_kind,period_key,category);
  CREATE TABLE model_budget_alert_events (
    id INTEGER PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 200),
    kind TEXT NOT NULL CHECK(kind IN ('daily_exhausted','monthly_exhausted','category_daily_exhausted',
      'category_monthly_exhausted','concurrency_exhausted','unknown_price','unknown_charge',
      'overrun','stale_usage','invalid_usage','clock_rollback','late_usage','late_hold_failure')),
    category TEXT, reservation_id INTEGER REFERENCES model_reservations(id),
    occurred_at TEXT NOT NULL, detail TEXT NOT NULL CHECK(length(detail)<=200)
  );
  CREATE INDEX model_reservations_period_category ON model_reservations(reserved_at,category,id);
  CREATE TRIGGER model_settlements_final_once BEFORE INSERT ON model_settlements
    WHEN EXISTS(SELECT 1 FROM model_settlements WHERE reservation_id=NEW.reservation_id AND
      (status!='unknown' OR NEW.status='unknown'))
    BEGIN SELECT RAISE(ABORT,'reservation already settled'); END;
  INSERT INTO rebuild_migrations(version) VALUES(26);`);
  // Backfill the bounded projection from the historical v25 ledger once, inside migration.
  const bump=(scope,category,kind,key,amount)=>{
    if(!amount)return;
    db.prepare(`INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES(?,?,?,?,?) ON CONFLICT(scope,category,period_kind,period_key)
      DO UPDATE SET amount_micros=amount_micros+excluded.amount_micros`).run(scope,category,kind,key,amount);
  };
  let afterId=0;
  for(;;) {
    const rows=db.prepare(`SELECT r.*,s.status,s.actual_micros FROM model_reservations r
      LEFT JOIN model_settlements s ON s.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=r.id)
      WHERE r.id>? ORDER BY r.id LIMIT 500`).all(afterId);
    if(!rows.length)break;
    for(const row of rows) {
      if(!row.status||row.status==='unknown') {
        db.prepare('INSERT INTO model_budget_pending(reservation_id,category,max_micros,reserved_at,state) VALUES(?,?,?,?,?)')
          .run(row.id,row.category,row.max_micros,row.reserved_at,row.status==='unknown'?'unknown':'reserved');
        bump('all','','outstanding','',row.max_micros);bump('category',row.category,'outstanding','',row.max_micros);
        if(row.status==='unknown') {bump('all','','unknown','',row.max_micros);bump('category',row.category,'unknown','',row.max_micros);}
      } else for(const [kind,key] of [['day',row.reserved_at.slice(0,10)],['month',row.reserved_at.slice(0,7)]]) {
        bump('all','',kind,key,row.actual_micros);bump('category',row.category,kind,key,row.actual_micros);
      }
    }
    afterId=rows.at(-1).id;
  }
  // Eligibility is frozen at the migration boundary. New v26 attempts cannot acquire it.
  const markedAt=new Date().toISOString();
  let afterAttempt=0;
  for(;;) {
    const rows=db.prepare(`SELECT a.reservation_id,
      CASE WHEN x.reservation_id IS NULL THEN 'unfinished' ELSE 'completed_unknown' END AS kind
      FROM model_call_attempts a
      LEFT JOIN model_call_results x ON x.reservation_id=a.reservation_id
      LEFT JOIN model_settlements s ON s.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=a.reservation_id)
      WHERE a.reservation_id>? AND (
        (x.reservation_id IS NULL AND s.id IS NULL) OR
        (x.status='failed' AND x.result_json IS NULL AND x.error_code IS NOT NULL AND
          s.status='unknown' AND s.actual_micros IS NULL AND
          NOT EXISTS(SELECT 1 FROM model_settlements f WHERE f.reservation_id=a.reservation_id AND f.status!='unknown')))
      ORDER BY a.reservation_id LIMIT 500`).all(afterAttempt);
    if(!rows.length)break;
    const insert=db.prepare('INSERT INTO model_call_legacy_recovery(reservation_id,kind,marked_at) VALUES(?,?,?)');
    for(const row of rows)insert.run(row.reservation_id,row.kind,markedAt);
    afterAttempt=rows.at(-1).reservation_id;
  }
  db.exec(`UPDATE model_call_legacy_recovery_seal SET sealed=1 WHERE id=1;
    CREATE TRIGGER model_call_legacy_recovery_insert_sealed BEFORE INSERT ON model_call_legacy_recovery
      WHEN (SELECT sealed FROM model_call_legacy_recovery_seal WHERE id=1)=1
      BEGIN SELECT RAISE(ABORT,'legacy eligibility is sealed'); END;
    CREATE TRIGGER model_call_legacy_recovery_seal_no_update BEFORE UPDATE ON model_call_legacy_recovery_seal
      BEGIN SELECT RAISE(ABORT,'legacy eligibility is sealed'); END;
    CREATE TRIGGER model_call_legacy_recovery_seal_no_delete BEFORE DELETE ON model_call_legacy_recovery_seal
      BEGIN SELECT RAISE(ABORT,'legacy eligibility is sealed'); END;`);
  const lastAdmission=db.prepare('SELECT MAX(reserved_at) AS last_at FROM model_reservations').get().last_at;
  if(lastAdmission)db.prepare('UPDATE model_budget_clock SET last_at=? WHERE id=1').run(lastAdmission);
  db.exec(`CREATE TRIGGER model_reservations_budget_projection AFTER INSERT ON model_reservations BEGIN
    INSERT INTO model_budget_pending(reservation_id,category,max_micros,reserved_at)
      VALUES(NEW.id,NEW.category,NEW.max_micros,NEW.reserved_at);
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES('all','','outstanding','',NEW.max_micros)
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.max_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES('category',NEW.category,'outstanding','',NEW.max_micros)
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.max_micros;
  END;
  CREATE TRIGGER model_settlements_budget_projection AFTER INSERT ON model_settlements
    WHEN NEW.status!='unknown' BEGIN
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT max_micros FROM model_budget_pending WHERE reservation_id=NEW.reservation_id)
      WHERE scope='all' AND category='' AND period_kind='unknown' AND period_key=''
        AND (SELECT state FROM model_budget_pending WHERE reservation_id=NEW.reservation_id)='unknown';
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT max_micros FROM model_budget_pending WHERE reservation_id=NEW.reservation_id)
      WHERE scope='category' AND category=(SELECT category FROM model_reservations WHERE id=NEW.reservation_id)
        AND period_kind='unknown' AND period_key=''
        AND (SELECT state FROM model_budget_pending WHERE reservation_id=NEW.reservation_id)='unknown';
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT max_micros FROM model_reservations WHERE id=NEW.reservation_id)
      WHERE scope='all' AND category='' AND period_kind='outstanding' AND period_key='';
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT max_micros FROM model_reservations WHERE id=NEW.reservation_id)
      WHERE scope='category' AND category=(SELECT category FROM model_reservations WHERE id=NEW.reservation_id)
        AND period_kind='outstanding' AND period_key='';
    DELETE FROM model_budget_pending WHERE reservation_id=NEW.reservation_id;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'all','','day',substr(reserved_at,1,10),NEW.actual_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'all','','month',substr(reserved_at,1,7),NEW.actual_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'day',substr(reserved_at,1,10),NEW.actual_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'month',substr(reserved_at,1,7),NEW.actual_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
  END;
  CREATE TRIGGER model_settlements_unknown_projection AFTER INSERT ON model_settlements
    WHEN NEW.status='unknown' BEGIN
    UPDATE model_budget_pending SET state='unknown' WHERE reservation_id=NEW.reservation_id;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'all','','unknown','',max_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+excluded.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'unknown','',max_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+excluded.amount_micros;
  END;`);
  db.exec(`CREATE TRIGGER model_late_holds_projection AFTER INSERT ON model_late_charge_holds BEGIN
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES('all','','outstanding','',NEW.amount_micros)
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'outstanding','',NEW.amount_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES('all','','unknown','',NEW.amount_micros)
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'unknown','',NEW.amount_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      VALUES('all','','late_hold','',NEW.amount_micros)
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',category,'late_hold','',NEW.amount_micros FROM model_reservations WHERE id=NEW.reservation_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.amount_micros;
  END;
  CREATE TRIGGER model_late_hold_resolution_projection AFTER INSERT ON model_late_hold_resolutions BEGIN
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT amount_micros FROM model_late_charge_holds WHERE id=NEW.hold_id)
      WHERE scope='all' AND category='' AND period_kind IN ('outstanding','unknown','late_hold') AND period_key='';
    UPDATE model_budget_counters SET amount_micros=amount_micros-(SELECT amount_micros FROM model_late_charge_holds WHERE id=NEW.hold_id)
      WHERE scope='category' AND category=(SELECT r.category FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id WHERE h.id=NEW.hold_id)
        AND period_kind IN ('outstanding','unknown','late_hold') AND period_key='';
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'all','','day',substr(r.reserved_at,1,10),NEW.actual_micros FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id WHERE h.id=NEW.hold_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'all','','month',substr(r.reserved_at,1,7),NEW.actual_micros FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id WHERE h.id=NEW.hold_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',r.category,'day',substr(r.reserved_at,1,10),NEW.actual_micros FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id WHERE h.id=NEW.hold_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
    INSERT INTO model_budget_counters(scope,category,period_kind,period_key,amount_micros)
      SELECT 'category',r.category,'month',substr(r.reserved_at,1,7),NEW.actual_micros FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id WHERE h.id=NEW.hold_id
      ON CONFLICT(scope,category,period_kind,period_key) DO UPDATE SET amount_micros=amount_micros+NEW.actual_micros;
  END;`);
  for(const table of ['model_budget_policy_events','model_reservation_admissions','model_call_slot_events',
    'model_call_usage_events','model_budget_alert_events','model_charge_reconciliations',
    'model_call_recovery_events','model_call_late_events','model_call_legacy_recovery',
    'model_late_charge_holds','model_late_hold_resolutions','model_budget_integrity_fault_events',
    'model_budget_guard_restorations','model_budget_guard_rearms']) for(const operation of ['UPDATE','DELETE']) {
    db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT,'budget operations are immutable'); END;`);
  }
}
module.exports={migrateBudgetOperations};

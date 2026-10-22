DROP INDEX browser_task_current_scope;
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
 (device_id,task_kind,candidate_id,spec_id,input_version,settings_version,source_capture_id) NULLS NOT DISTINCT
 WHERE search_run_id IS NULL AND task_kind NOT IN ('supplier_thread','supplier_send')
 AND (state IN ('queued','delivered') OR (state='completed' AND task_kind<>'amazon_search'));

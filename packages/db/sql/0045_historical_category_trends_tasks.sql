ALTER TABLE browser_tasks DROP CONSTRAINT browser_task_kind_scope;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_kind_scope CHECK (
 (task_kind='saved_search_export' AND search_run_id IS NOT NULL)
 OR (task_kind IN ('amazon_package','amazon_search','product_database','keyword_scout','historical_data','category_trends') AND search_run_id IS NULL AND spec_id IS NULL AND source_capture_id IS NULL)
 OR (task_kind='supplier_search' AND search_run_id IS NULL AND spec_id IS NOT NULL AND source_capture_id IS NULL)
 OR (task_kind='supplier_detail' AND search_run_id IS NULL AND spec_id IS NOT NULL AND source_capture_id IS NOT NULL)
);

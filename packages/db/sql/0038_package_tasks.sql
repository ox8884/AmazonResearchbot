ALTER TABLE browser_tasks ALTER COLUMN spec_id DROP NOT NULL;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_package_without_supplier_source
 CHECK(spec_id IS NOT NULL OR source_capture_id IS NULL);

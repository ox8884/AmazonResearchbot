ALTER TABLE custom_ai_profiles DROP CONSTRAINT custom_ai_profiles_protocol_check;
ALTER TABLE custom_ai_profiles ADD CONSTRAINT custom_ai_profiles_protocol_check
 CHECK (protocol IN ('openai_chat_completions','codex_cli'));

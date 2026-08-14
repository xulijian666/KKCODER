pub fn build_claude_args(
    is_reopen: bool,
    agent_session_id: &str,
    model: Option<&str>,
    settings_file: Option<&std::path::Path>,
) -> Vec<String> {
    let session_flag = if is_reopen { "--resume" } else { "--session-id" };

    let mut args = vec![
        "--dangerously-skip-permissions".to_string(),
        session_flag.to_string(),
        agent_session_id.to_string(),
    ];
    if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
        args.push("--model".to_string());
        args.push(model.trim().to_string());
    }
    if let Some(settings_file) = settings_file {
        // 用所选供应商的临时 settings（直连），不动 ~/.claude/settings.json
        args.push("--settings".to_string());
        args.push(settings_file.display().to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::build_claude_args;

    #[test]
    fn builds_new_claude_session_arguments() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", None, None),
            vec![
                "--dangerously-skip-permissions",
                "--session-id",
                "550e8400-e29b-41d4-a716-446655440000",
            ]
        );
    }

    #[test]
    fn builds_resume_claude_session_arguments() {
        assert_eq!(
            build_claude_args(true, "550e8400-e29b-41d4-a716-446655440000", None, None),
            vec![
                "--dangerously-skip-permissions",
                "--resume",
                "550e8400-e29b-41d4-a716-446655440000",
            ]
        );
    }

    #[test]
    fn appends_model_override() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", Some("deepseek-v4-flash"), None),
            vec![
                "--dangerously-skip-permissions",
                "--session-id",
                "550e8400-e29b-41d4-a716-446655440000",
                "--model",
                "deepseek-v4-flash",
            ]
        );
    }

    #[test]
    fn ignores_blank_model_override() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", Some("  "), None),
            vec![
                "--dangerously-skip-permissions",
                "--session-id",
                "550e8400-e29b-41d4-a716-446655440000",
            ]
        );
    }

    #[test]
    fn appends_settings_override() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", None, Some(std::path::Path::new("C:\\tmp\\kk-settings.json"))),
            vec![
                "--dangerously-skip-permissions",
                "--session-id",
                "550e8400-e29b-41d4-a716-446655440000",
                "--settings",
                "C:\\tmp\\kk-settings.json",
            ]
        );
    }
}

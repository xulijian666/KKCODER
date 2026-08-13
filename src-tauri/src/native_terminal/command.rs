pub fn build_claude_args(is_reopen: bool, agent_session_id: &str, model: Option<&str>) -> Vec<String> {
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
    args
}

#[cfg(test)]
mod tests {
    use super::build_claude_args;

    #[test]
    fn builds_new_claude_session_arguments() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", None),
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
            build_claude_args(true, "550e8400-e29b-41d4-a716-446655440000", None),
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
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", Some("deepseek-v4-flash")),
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
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000", Some("  ")),
            vec![
                "--dangerously-skip-permissions",
                "--session-id",
                "550e8400-e29b-41d4-a716-446655440000",
            ]
        );
    }
}

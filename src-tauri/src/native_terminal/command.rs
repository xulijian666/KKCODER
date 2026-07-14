pub fn build_claude_args(is_reopen: bool, agent_session_id: &str) -> Vec<String> {
    let session_flag = if is_reopen { "--resume" } else { "--session-id" };

    vec![
        "--dangerously-skip-permissions".to_string(),
        session_flag.to_string(),
        agent_session_id.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::build_claude_args;

    #[test]
    fn builds_new_claude_session_arguments() {
        assert_eq!(
            build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000"),
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
            build_claude_args(true, "550e8400-e29b-41d4-a716-446655440000"),
            vec![
                "--dangerously-skip-permissions",
                "--resume",
                "550e8400-e29b-41d4-a716-446655440000",
            ]
        );
    }
}

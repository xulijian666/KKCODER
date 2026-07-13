//! Compatibility PTY byte-stream boundary protection.
//!
//! `Read::read` can split both UTF-8 code points and ANSI escape sequences.
//! Emitting either partial form through IPC can corrupt xterm's SGR state and
//! manifest as persistent colored strips along the left edge.

pub fn safe_emit_boundary(bytes: &[u8]) -> usize {
    let esc_safe = esc_safe_prefix(bytes);
    utf8_safe_prefix(&bytes[..esc_safe])
}

fn utf8_safe_prefix(bytes: &[u8]) -> usize {
    let len = bytes.len();
    for back in 1..=4usize.min(len) {
        let byte = bytes[len - back];
        if byte < 0x80 {
            return len;
        }
        if byte >= 0xC0 {
            let expected = if byte < 0xE0 {
                2
            } else if byte < 0xF0 {
                3
            } else if byte < 0xF8 {
                4
            } else {
                1
            };
            return if back >= expected { len } else { len - back };
        }
    }
    len
}

fn esc_safe_prefix(bytes: &[u8]) -> usize {
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != 0x1B {
            index += 1;
            continue;
        }
        match parse_escape_sequence(&bytes[index..]) {
            Some(consumed) => index += consumed,
            None => return index,
        }
    }
    bytes.len()
}

fn parse_escape_sequence(sequence: &[u8]) -> Option<usize> {
    debug_assert_eq!(sequence.first(), Some(&0x1B));
    let introducer = *sequence.get(1)?;
    match introducer {
        b'[' => sequence[2..]
            .iter()
            .position(|byte| (0x40..=0x7E).contains(byte))
            .map(|position| position + 3),
        b']' | b'P' | b'X' | b'^' | b'_' => {
            let mut index = 2;
            while index < sequence.len() {
                if sequence[index] == 0x07 {
                    return Some(index + 1);
                }
                if sequence[index] == 0x1B {
                    return match sequence.get(index + 1) {
                        Some(b'\\') => Some(index + 2),
                        Some(_) => Some(index),
                        None => None,
                    };
                }
                index += 1;
            }
            None
        }
        0x30..=0x7E => Some(2),
        0x20..=0x2F => {
            let mut index = 2;
            while index < sequence.len() && (0x20..=0x2F).contains(&sequence[index]) {
                index += 1;
            }
            sequence
                .get(index)
                .filter(|&&byte| (0x30..=0x7E).contains(&byte))
                .map(|_| index + 1)
        }
        _ => Some(2),
    }
}

#[cfg(test)]
mod tests {
    use super::safe_emit_boundary;

    #[test]
    fn retains_incomplete_utf8_suffix() {
        assert_eq!(safe_emit_boundary(&[b'A', 0xE4, 0xB8]), 1);
        assert_eq!(safe_emit_boundary(&[b'A', 0xE4, 0xB8, 0xAD]), 4);
    }

    #[test]
    fn retains_incomplete_csi_sequence() {
        assert_eq!(safe_emit_boundary(b"hello\x1b[41"), 5);
        assert_eq!(safe_emit_boundary(b"hello\x1b[41m"), 10);
    }

    #[test]
    fn retains_incomplete_osc_sequence() {
        assert_eq!(safe_emit_boundary(b"text\x1b]0;title"), 4);
        assert_eq!(safe_emit_boundary(b"text\x1b]0;title\x07"), 14);
    }

    #[test]
    fn reconstructs_colored_cjk_stream_at_every_split() {
        let original = b"\x1b[41m\xe4\xb8\xad\xe6\x96\x87\x1b[0m normal";
        for split_at in 0..=original.len() {
            let (first, second) = original.split_at(split_at);
            let mut pending = first.to_vec();
            let safe_first = safe_emit_boundary(&pending);
            let mut emitted = pending[..safe_first].to_vec();
            pending.drain(..safe_first);
            pending.extend_from_slice(second);
            let safe_second = safe_emit_boundary(&pending);
            emitted.extend_from_slice(&pending[..safe_second]);
            pending.drain(..safe_second);
            emitted.extend_from_slice(&pending);
            assert_eq!(emitted, original, "split_at={split_at}");
        }
    }
}

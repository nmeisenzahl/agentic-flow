# Error Handler — shared error recovery comment pattern (FR-049)
#
# Import this template in any `.md` file to get the standard error handling instructions.
# Usage: add `imports: - src/.github/workflow-templates/error-handler.md` to your `.md` frontmatter.

## Error Handling Instructions

On **any** failure during agent execution, you MUST post a human-readable recovery comment on the Feature Issue using the GitHub MCP `create_issue_comment` tool. The comment MUST include:

1. **What failed**: which step in the pipeline failed (e.g., "Failed to create task sub-issue")
2. **Error details**: the error message or HTTP status code
3. **Recovery steps**: explicit steps the human can take to retry (e.g., "Re-issue `/retry-triage` to restart the triage phase" or "Re-run the workflow from the GitHub Actions UI")

**Comment format**:
```markdown
## ⚠️ Pipeline Error

**Phase**: {phase name}
**Step**: {step that failed}
**Error**: {error message}

**Recovery**: {what the human should do to retry or fix}

_Automated recovery comment — [agentic-flow](https://github.com/nmeisenzahl/agentic-flow)_
```

After posting the recovery comment, **do not fail silently** — ensure the workflow exits with a clear error state.

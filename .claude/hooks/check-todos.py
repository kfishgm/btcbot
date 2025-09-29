# #!/usr/bin/env python3
# import sys
# import json
# import os

# def main():
#     try:
#         # Read stdin
#         input_data = sys.stdin.read()
#         hook_input = json.loads(input_data)
#         transcript_path = hook_input.get('transcript_path')

#         if not transcript_path or not os.path.exists(transcript_path):
#             sys.exit(0)

#         # Read transcript
#         with open(transcript_path, 'r') as f:
#             lines = f.readlines()

#         todos_pending = []
#         todos_in_progress = []

#         # Track all todos that were EVER incomplete (not completed)
#         all_incomplete_todos = set()
#         current_todo_contents = set()

#         # First pass: collect all todos that were ever pending or in_progress
#         for line in lines:
#             if not line.strip():
#                 continue
#             try:
#                 entry = json.loads(line)
#                 message = entry.get('message', {})
#                 content = message.get('content', [])

#                 for item in content:
#                     if item.get('type') == 'tool_use' and item.get('name') == 'TodoWrite':
#                         todos = item.get('input', {}).get('todos', [])
#                         for todo in todos:
#                             status = todo.get('status')
#                             content_text = todo.get('content', '')
#                             # Only track todos that were incomplete
#                             if status in ['pending', 'in_progress']:
#                                 all_incomplete_todos.add(content_text)
#             except:
#                 continue

#         # Second pass: find the most recent TodoWrite (from newest to oldest)
#         for line in reversed(lines):
#             if not line.strip():
#                 continue
#             try:
#                 entry = json.loads(line)

#                 # Navigate to the nested structure
#                 message = entry.get('message', {})
#                 content = message.get('content', [])

#                 # Check each content item for TodoWrite
#                 for item in content:
#                     if item.get('type') == 'tool_use' and item.get('name') == 'TodoWrite':
#                         todos = item.get('input', {}).get('todos', [])

#                         for todo in todos:
#                             status = todo.get('status')
#                             content_text = todo.get('content', 'Unknown task')

#                             # Track all current todos (any status)
#                             current_todo_contents.add(content_text)

#                             if status == 'pending':
#                                 todos_pending.append(content_text)
#                             elif status == 'in_progress':
#                                 todos_in_progress.append(content_text)

#                         # Found most recent todo list, stop searching
#                         if todos:
#                             break

#                 # If we found todos, stop looking through more lines
#                 if todos_pending or todos_in_progress:
#                     break

#             except (json.JSONDecodeError, KeyError):
#                 continue

#         # Check for missing incomplete todos
#         # These are todos that were pending/in_progress at some point but aren't in the current list at all
#         missing_incomplete = all_incomplete_todos - current_todo_contents

#         # Build response if there are incomplete todos OR missing todos
#         if todos_pending or todos_in_progress or missing_incomplete:
#             total = len(todos_pending) + len(todos_in_progress)

#             message_parts = [
#                 f"STOP! You cannot stop now. You have {total} uncompleted todo(s).",
#                 "",
#             ]

#             # Check if incomplete todos went missing
#             if missing_incomplete:
#                 message_parts.append("⚠️ CRITICAL: Some incomplete todos have disappeared!")
#                 message_parts.append(f"   {len(missing_incomplete)} todo(s) that were pending/in-progress are now missing:")
#                 for missing in list(missing_incomplete)[:3]:  # Show first 3
#                     message_parts.append(f"   • {missing}")
#                 message_parts.append("")
#                 message_parts.append("IMMEDIATE ACTIONS REQUIRED:")
#                 message_parts.append("1. Recreate these missing incomplete todos")
#                 message_parts.append("2. Then continue with your current work")
#             else:
#                 message_parts.append("IMMEDIATE ACTION REQUIRED:")

#             if todos_in_progress:
#                 message_parts.append(f"Continue working on: {todos_in_progress[0]}")
#                 message_parts.append("Complete this task, then move to the next pending todo.")
#             elif todos_pending:
#                 message_parts.append(f"Start working on: {todos_pending[0]}")
#                 message_parts.append("Begin this task immediately.")

#             # Show a few more pending todos for context
#             if len(todos_pending) > 1:
#                 message_parts.append("")
#                 message_parts.append(f"You have {len(todos_pending) - 1} more pending todos after this.")

#             message_parts.append("")
#             message_parts.append("DO NOT provide explanations or summaries.")
#             message_parts.append("DO NOT wait for user input.")
#             message_parts.append("CONTINUE WORKING IMMEDIATELY.")

#             output = {
#                 "decision": "block",
#                 "reason": "\n".join(message_parts)
#             }

#             print(json.dumps(output))

#     except Exception:
#         pass  # Silently fail to not interfere with Claude

#     sys.exit(0)

# if __name__ == "__main__":
#     main()

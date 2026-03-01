# icloud-tools: ipc-mcp-stdio.ts changes

Remove the entire "Apple Reminders tools" section (~160 lines):
- The `waitForRemindersResult` polling helper function
- All 5 MCP tool registrations: reminders_list_lists, reminders_list_items, reminders_add_item, reminders_complete_item, reminders_remove_item
- The `REMINDERS_RESULTS_DIR` constant

Keep the register_group tool and the stdio transport startup code that follows.
Reminders functionality is now provided by the icloud-tools MCP server via CalDAV.

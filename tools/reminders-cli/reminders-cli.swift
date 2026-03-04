#!/usr/bin/env swift
//
// reminders-cli — Fast Apple Reminders access via EventKit.
//
// Usage:
//   reminders-cli list_lists
//   reminders-cli list_items <list_name> [--include-completed]
//   reminders-cli add_item <list_name> <title> [--notes <text>] [--due <ISO8601>] [--priority <none|low|medium|high>] [--url <string>]
//   reminders-cli update_item <list_name> <title> [--new-title <t>] [--new-notes <n>] [--new-due <d>] [--new-priority <p>] [--new-url <u>]
//   reminders-cli complete_item <list_name> <title>
//   reminders-cli remove_item <list_name> <title>
//   reminders-cli move_item <list_name> <title> <target_list>
//
// All output is JSON to stdout. Errors set exit code 1.
//

import EventKit
import Foundation

// MARK: - Helpers

let store = EKEventStore()

func priorityToString(_ p: Int) -> String {
    switch p {
    case 1: return "high"
    case 5: return "medium"
    case 9: return "low"
    default: return "none"
    }
}

func stringToPriority(_ s: String) -> Int {
    switch s.lowercased() {
    case "high": return 1
    case "medium": return 5
    case "low": return 9
    default: return 0
    }
}

func dateToISO(_ d: Date?) -> Any {
    guard let date = d else { return NSNull() }
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: date)
}

func requestAccess() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    store.requestFullAccessToReminders { g, _ in
        granted = g
        semaphore.signal()
    }
    semaphore.wait()
    return granted
}

func findCalendar(_ name: String) -> EKCalendar? {
    store.calendars(for: .reminder).first { $0.title == name }
}

func findReminder(inCalendar cal: EKCalendar, title: String) -> EKReminder? {
    let semaphore = DispatchSemaphore(value: 0)
    var found: EKReminder?
    let predicate = store.predicateForReminders(in: [cal])
    store.fetchReminders(matching: predicate) { reminders in
        found = reminders?.first { $0.title == title }
        semaphore.signal()
    }
    semaphore.wait()
    return found
}

func fetchReminders(calendar: EKCalendar, includeCompleted: Bool) -> [EKReminder] {
    let semaphore = DispatchSemaphore(value: 0)
    var result: [EKReminder] = []

    let predicate: NSPredicate
    if includeCompleted {
        predicate = store.predicateForReminders(in: [calendar])
    } else {
        predicate = store.predicateForIncompleteReminders(
            withDueDateStarting: nil, ending: nil, calendars: [calendar]
        )
    }

    store.fetchReminders(matching: predicate) { reminders in
        result = reminders ?? []
        semaphore.signal()
    }
    semaphore.wait()
    return result
}

func reminderToDict(_ r: EKReminder) -> [String: Any] {
    var d: [String: Any] = [
        "name": r.title ?? "",
        "notes": r.notes ?? "",
        "completed": r.isCompleted,
        "priority": priorityToString(r.priority),
        "url": r.url?.absoluteString as Any? ?? NSNull(),
        "creationDate": dateToISO(r.creationDate),
        "completionDate": dateToISO(r.completionDate),
    ]
    if let dc = r.dueDateComponents, let date = Calendar.current.date(from: dc) {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        d["dueDate"] = fmt.string(from: date)
    } else {
        d["dueDate"] = NSNull()
    }
    return d
}

func jsonString(_ obj: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    return String(data: data, encoding: .utf8)!
}

func fail(_ message: String) -> Never {
    let err: [String: Any] = ["success": false, "message": message]
    print(jsonString(err))
    exit(1)
}

func succeed(_ message: String, data: Any? = nil) {
    var result: [String: Any] = ["success": true, "message": message]
    if let d = data { result["data"] = d }
    print(jsonString(result))
    exit(0)
}

// MARK: - Commands

func listLists() {
    let calendars = store.calendars(for: .reminder)
    var result: [[String: Any]] = []
    for cal in calendars {
        let all = fetchReminders(calendar: cal, includeCompleted: true)
        let incomplete = all.filter { !$0.isCompleted }.count
        let completed = all.filter { $0.isCompleted }.count
        result.append([
            "name": cal.title,
            "id": cal.calendarIdentifier,
            "count": incomplete,
            "completedCount": completed,
        ])
    }
    succeed("OK", data: result)
}

func listItems(listName: String, includeCompleted: Bool) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    let reminders = fetchReminders(calendar: cal, includeCompleted: includeCompleted)
    let items = reminders.map { reminderToDict($0) }
    succeed("OK", data: items)
}

func addItem(listName: String, title: String, notes: String?, dueDate: String?, priority: String?, url: String?) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = cal
    if let n = notes { reminder.notes = n }
    if let d = dueDate, let date = ISO8601DateFormatter().date(from: d) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: date
        )
    }
    if let p = priority { reminder.priority = stringToPriority(p) }
    if let u = url { reminder.url = URL(string: u) }
    do {
        try store.save(reminder, commit: true)
        succeed("Added \"\(title)\" to \"\(listName)\"", data: reminderToDict(reminder))
    } catch {
        fail("Failed to save: \(error.localizedDescription)")
    }
}

func updateItem(listName: String, title: String, newTitle: String?, newNotes: String?, newDueDate: String?, newPriority: String?, newUrl: String?) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    guard let reminder = findReminder(inCalendar: cal, title: title) else { fail("Reminder not found: \(title)") }

    if let t = newTitle { reminder.title = t }
    if let n = newNotes { reminder.notes = n }
    if let d = newDueDate, let date = ISO8601DateFormatter().date(from: d) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: date
        )
    }
    if let p = newPriority { reminder.priority = stringToPriority(p) }
    if let u = newUrl { reminder.url = URL(string: u) }
    do {
        try store.save(reminder, commit: true)
        succeed("Updated \"\(reminder.title ?? title)\"", data: reminderToDict(reminder))
    } catch {
        fail("Failed to update: \(error.localizedDescription)")
    }
}

func completeItem(listName: String, title: String) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    guard let reminder = findReminder(inCalendar: cal, title: title) else { fail("Reminder not found: \(title)") }

    reminder.isCompleted = true
    reminder.completionDate = Date()
    do {
        try store.save(reminder, commit: true)
        succeed("Completed \"\(title)\"", data: ["name": reminder.title ?? title, "completed": true])
    } catch {
        fail("Failed to complete: \(error.localizedDescription)")
    }
}

func removeItem(listName: String, title: String) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    guard let reminder = findReminder(inCalendar: cal, title: title) else { fail("Reminder not found: \(title)") }

    do {
        try store.remove(reminder, commit: true)
        succeed("Deleted \"\(title)\"", data: ["deleted": true])
    } catch {
        fail("Failed to delete: \(error.localizedDescription)")
    }
}

func moveItem(listName: String, title: String, targetList: String) {
    guard let srcCal = findCalendar(listName) else { fail("Source list not found: \(listName)") }
    guard let tgtCal = findCalendar(targetList) else { fail("Target list not found: \(targetList)") }
    guard let reminder = findReminder(inCalendar: srcCal, title: title) else { fail("Reminder not found: \(title)") }

    reminder.calendar = tgtCal
    do {
        try store.save(reminder, commit: true)
        succeed("Moved \"\(title)\" to \"\(targetList)\"", data: ["moved": true, "name": title])
    } catch {
        fail("Failed to move: \(error.localizedDescription)")
    }
}

// MARK: - Main

guard requestAccess() else { fail("Reminders access denied") }

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else { fail("Usage: reminders-cli <command> [args...]") }

switch args[0] {
case "list_lists":
    listLists()

case "list_items":
    guard args.count >= 2 else { fail("Usage: list_items <list_name> [--include-completed]") }
    let includeCompleted = args.contains("--include-completed")
    listItems(listName: args[1], includeCompleted: includeCompleted)

case "add_item":
    guard args.count >= 3 else { fail("Usage: add_item <list_name> <title> [--notes <text>] [--due <ISO8601>] [--priority <none|low|medium|high>] [--url <string>]") }
    var notes: String?
    var dueDate: String?
    var priority: String?
    var url: String?
    var i = 3
    while i < args.count {
        if args[i] == "--notes" && i + 1 < args.count { notes = args[i + 1]; i += 2 }
        else if args[i] == "--due" && i + 1 < args.count { dueDate = args[i + 1]; i += 2 }
        else if args[i] == "--priority" && i + 1 < args.count { priority = args[i + 1]; i += 2 }
        else if args[i] == "--url" && i + 1 < args.count { url = args[i + 1]; i += 2 }
        else { i += 1 }
    }
    addItem(listName: args[1], title: args[2], notes: notes, dueDate: dueDate, priority: priority, url: url)

case "update_item":
    guard args.count >= 3 else { fail("Usage: update_item <list_name> <title> [--new-title <t>] [--new-notes <n>] [--new-due <d>] [--new-priority <none|low|medium|high>] [--new-url <string>]") }
    var newTitle: String?
    var newNotes: String?
    var newDueDate: String?
    var newPriority: String?
    var newUrl: String?
    var i = 3
    while i < args.count {
        if args[i] == "--new-title" && i + 1 < args.count { newTitle = args[i + 1]; i += 2 }
        else if args[i] == "--new-notes" && i + 1 < args.count { newNotes = args[i + 1]; i += 2 }
        else if args[i] == "--new-due" && i + 1 < args.count { newDueDate = args[i + 1]; i += 2 }
        else if args[i] == "--new-priority" && i + 1 < args.count { newPriority = args[i + 1]; i += 2 }
        else if args[i] == "--new-url" && i + 1 < args.count { newUrl = args[i + 1]; i += 2 }
        else { i += 1 }
    }
    if newTitle == nil && newNotes == nil && newDueDate == nil && newPriority == nil && newUrl == nil { fail("No update fields provided") }
    updateItem(listName: args[1], title: args[2], newTitle: newTitle, newNotes: newNotes, newDueDate: newDueDate, newPriority: newPriority, newUrl: newUrl)

case "complete_item":
    guard args.count >= 3 else { fail("Usage: complete_item <list_name> <title>") }
    completeItem(listName: args[1], title: args[2])

case "remove_item":
    guard args.count >= 3 else { fail("Usage: remove_item <list_name> <title>") }
    removeItem(listName: args[1], title: args[2])

case "move_item":
    guard args.count >= 4 else { fail("Usage: move_item <list_name> <title> <target_list>") }
    moveItem(listName: args[1], title: args[2], targetList: args[3])

default:
    fail("Unknown command: \(args[0]). Available: list_lists, list_items, add_item, update_item, complete_item, remove_item, move_item")
}

import { spawn } from "node:child_process";

// On modern macOS, the AppleScript surface for Reminders is essentially dead
// (`count of lists` returns 0 even with TCC granted). This module talks to
// EventKit directly via JXA + ObjC bridge, which Apple's own apps use.

const PROLOGUE = `
ObjC.import('EventKit');
ObjC.import('Foundation');

function writeStdout(s) {
  var ns = $.NSString.alloc.initWithUTF8String(s);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(ns.dataUsingEncoding($.NSUTF8StringEncoding));
}

function ekAccessOk() {
  // ObjC wraps the int; coerce before comparing.
  var status = Number($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeReminder));
  // 3 = fullAccess, 4 = writeOnly (older constant: 2 = authorized in pre-Sonoma)
  return status === 3 || status === 4 || status === 2;
}

function unwrapDate(d) {
  if (!d) return null;
  try { return ObjC.unwrap(d.descriptionWithLocale(null)); } catch (e) { return null; }
}

function reminderToObj(r) {
  return {
    id: ObjC.unwrap(r.calendarItemIdentifier),
    externalId: ObjC.unwrap(r.calendarItemExternalIdentifier) || null,
    title: ObjC.unwrap(r.title) || '',
    notes: ObjC.unwrap(r.notes) || '',
    completed: r.completed === true || r.completed === 1,
    completionDate: unwrapDate(r.completionDate),
    creationDate: unwrapDate(r.creationDate),
    modificationDate: unwrapDate(r.lastModifiedDate),
    dueDate: r.dueDateComponents ? unwrapDate(r.dueDateComponents.date) : null,
    priority: Number(r.priority) || 0,
    listName: ObjC.unwrap(r.calendar.title) || '',
    listId: ObjC.unwrap(r.calendar.calendarIdentifier) || '',
  };
}

function calendarToObj(c) {
  return {
    name: ObjC.unwrap(c.title) || '',
    id: ObjC.unwrap(c.calendarIdentifier) || '',
    source: ObjC.unwrap(c.source.title) || '',
    sourceType: Number(c.source.sourceType) || 0,
    allowsContentModifications: c.allowsContentModifications === true,
  };
}

function pumpUntil(cond, maxMs) {
  var t0 = Date.now();
  while (!cond() && Date.now() - t0 < maxMs) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  }
}

var store = $.EKEventStore.alloc.init;
if (!ekAccessOk()) {
  writeStdout(JSON.stringify({ error: 'NO_ACCESS', message: 'Reminders/EventKit access not granted. Open System Settings > Privacy & Security > Reminders and enable access for the calling app, then restart it.' }));
} else {
`;

const EPILOGUE = "\n}\n";

interface JxaResult<T> {
	ok: boolean;
	data?: T;
	error?: string;
}

function runJxa<T = any>(body: string, timeoutMs = 15000): Promise<T> {
	return new Promise((resolve, reject) => {
		const script = PROLOGUE + body + EPILOGUE;
		const child = spawn("osascript", ["-l", "JavaScript", "-e", script]);
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 500);
		}, timeoutMs);
		child.stdout.on("data", (d) => {
			stdout += d.toString("utf8");
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString("utf8");
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error(`Reminders operation timed out after ${timeoutMs}ms`));
				return;
			}
			if (code !== 0) {
				reject(new Error(stderr.trim() || `osascript exit ${code}`));
				return;
			}
			const trimmed = stdout.trim();
			if (!trimmed) {
				reject(new Error("Empty response from osascript"));
				return;
			}
			try {
				const parsed = JSON.parse(trimmed) as JxaResult<T>;
				if (parsed && (parsed as any).error) {
					reject(new Error((parsed as any).message || (parsed as any).error));
					return;
				}
				resolve(parsed as unknown as T);
			} catch (err) {
				reject(new Error(`Failed to parse osascript output: ${trimmed.slice(0, 200)}`));
			}
		});
		child.stdin.end();
	});
}

function escJs(s: string): string {
	return JSON.stringify(s);
}

// =============================================================================
// Public types
// =============================================================================

export interface ReminderList {
	name: string;
	id: string;
	source: string;
	sourceType: number;
	allowsContentModifications: boolean;
}

export interface Reminder {
	id: string;
	externalId: string | null;
	title: string;
	notes: string;
	completed: boolean;
	completionDate: string | null;
	creationDate: string | null;
	modificationDate: string | null;
	dueDate: string | null;
	priority: number;
	listName: string;
	listId: string;
}

// =============================================================================
// Public API
// =============================================================================

export async function requestAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		await listLists();
		return { hasAccess: true, message: "Reminders access granted." };
	} catch (err) {
		return {
			hasAccess: false,
			message:
				err instanceof Error
					? err.message
					: "Reminders access not granted. Enable in System Settings > Privacy & Security > Reminders.",
		};
	}
}

export async function listLists(): Promise<ReminderList[]> {
	const body = `
  var cals = store.calendarsForEntityType($.EKEntityTypeReminder);
  var out = [];
  for (var i = 0; i < cals.count; i++) {
    out.push(calendarToObj(cals.objectAtIndex(i)));
  }
  writeStdout(JSON.stringify(out));
`;
	return runJxa<ReminderList[]>(body);
}

export async function listAll(opts?: {
	listName?: string;
	listId?: string;
	includeCompleted?: boolean;
	limit?: number;
}): Promise<Reminder[]> {
	const includeCompleted = opts?.includeCompleted === true;
	const limit = opts?.limit ?? 1000;
	const filter = opts?.listName
		? `if (ObjC.unwrap(c.title) !== ${escJs(opts.listName)}) continue;`
		: opts?.listId
			? `if (ObjC.unwrap(c.calendarIdentifier) !== ${escJs(opts.listId)}) continue;`
			: "";

	const body = `
  var allCals = store.calendarsForEntityType($.EKEntityTypeReminder);
  var picked = $.NSMutableArray.alloc.init;
  for (var i = 0; i < allCals.count; i++) {
    var c = allCals.objectAtIndex(i);
    ${filter}
    picked.addObject(c);
  }
  if (Number(picked.count) === 0) { writeStdout(JSON.stringify([])); }
  else {
    // Fetch everything for the picked calendars and filter completion in JS —
    // EventKit's incomplete-only factory has a colon-laden ObjC signature that
    // JXA renders inconsistently. Cheap to filter; reminders DBs are small.
    var predicate = store.predicateForRemindersInCalendars(picked);
    var includeCompleted = ${includeCompleted ? "true" : "false"};
    var done = false;
    var out = [];
    store.fetchRemindersMatchingPredicateCompletion(predicate, function(reminders) {
      var total = reminders.count;
      for (var i = 0; i < total; i++) {
        var r = reminders.objectAtIndex(i);
        var isDone = r.completed === true || r.completed === 1;
        if (!includeCompleted && isDone) continue;
        out.push(reminderToObj(r));
        if (out.length >= ${limit}) break;
      }
      done = true;
    });
    pumpUntil(function() { return done; }, 10000);
    writeStdout(JSON.stringify(out));
  }
`;
	return runJxa<Reminder[]>(body, 20000);
}

export async function search(opts: {
	searchText: string;
	includeCompleted?: boolean;
	listName?: string;
	limit?: number;
}): Promise<Reminder[]> {
	const all = await listAll({
		listName: opts.listName,
		includeCompleted: opts.includeCompleted,
		limit: 5000,
	});
	const q = opts.searchText.toLowerCase();
	const out = all.filter(
		(r) => r.title.toLowerCase().includes(q) || (r.notes && r.notes.toLowerCase().includes(q)),
	);
	return out.slice(0, opts.limit ?? 200);
}

export async function listFromList(opts: {
	listName?: string;
	listId?: string;
	includeCompleted?: boolean;
	limit?: number;
}): Promise<{ success: boolean; reminders: Reminder[]; message?: string }> {
	if (!opts.listName && !opts.listId) {
		return {
			success: false,
			reminders: [],
			message: "Either listName or listId is required.",
		};
	}
	const rems = await listAll(opts);
	return { success: true, reminders: rems };
}

export async function create(opts: {
	title: string;
	listName?: string;
	listId?: string;
	notes?: string;
	dueDate?: string; // ISO date
	priority?: number; // 0=none, 1=high, 5=medium, 9=low (EventKit convention)
}): Promise<{ success: boolean; reminder?: Reminder; message?: string }> {
	if (!opts.title || !opts.title.trim()) {
		return { success: false, message: "Reminder title cannot be empty." };
	}

	const titleLit = escJs(opts.title);
	const notesLit = escJs(opts.notes ?? "");
	const listNameLit = opts.listName ? escJs(opts.listName) : "null";
	const listIdLit = opts.listId ? escJs(opts.listId) : "null";
	const dueLit = opts.dueDate ? escJs(opts.dueDate) : "null";
	const priorityLit = String(Number.isFinite(opts.priority) ? opts.priority : 0);

	const body = `
  var cals = store.calendarsForEntityType($.EKEntityTypeReminder);
  var target = null;
  var wantName = ${listNameLit};
  var wantId = ${listIdLit};
  for (var i = 0; i < cals.count; i++) {
    var c = cals.objectAtIndex(i);
    var tName = ObjC.unwrap(c.title);
    var tId = ObjC.unwrap(c.calendarIdentifier);
    if (wantName && tName === wantName) { target = c; break; }
    if (wantId && tId === wantId) { target = c; break; }
  }
  if (!target) {
    // fall back to default reminder calendar
    target = store.defaultCalendarForNewReminders;
  }
  if (!target) {
    writeStdout(JSON.stringify({ error: 'NO_LIST', message: 'No reminders list available. Specify listName or listId.' }));
  } else {
    var rem = $.EKReminder.reminderWithEventStore(store);
    rem.title = $.NSString.stringWithUTF8String(${titleLit});
    var notesStr = ${notesLit};
    if (notesStr) rem.notes = $.NSString.stringWithUTF8String(notesStr);
    rem.calendar = target;
    rem.priority = ${priorityLit};
    var dueIso = ${dueLit};
    if (dueIso) {
      var formatter = $.NSISO8601DateFormatter.alloc.init;
      formatter.formatOptions = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 8); // year/month/day/time/dashSeparator/internetDateTime
      var date = formatter.dateFromString($.NSString.stringWithUTF8String(dueIso));
      if (date) {
        var cal = $.NSCalendar.currentCalendar;
        var units = (1 << 2) | (1 << 4) | (1 << 8) | (1 << 16) | (1 << 32) | (1 << 64); // y/m/d/h/m/s — bitmask convenience
        rem.dueDateComponents = cal.componentsFromDate(units, date);
      }
    }
    var errRef = Ref();
    var saved = store.saveReminderCommitError(rem, true, errRef);
    if (!saved) {
      writeStdout(JSON.stringify({ error: 'SAVE_FAILED', message: 'Failed to save reminder.' }));
    } else {
      writeStdout(JSON.stringify({ ok: true, reminder: reminderToObj(rem) }));
    }
  }
`;
	try {
		const res = await runJxa<{ ok: boolean; reminder?: Reminder } | Reminder[]>(
			body,
			15000,
		);
		// runJxa already rejects on `error` payloads; success path is the wrapped object.
		const wrapped = res as { ok?: boolean; reminder?: Reminder };
		if (wrapped && wrapped.ok && wrapped.reminder) {
			return { success: true, reminder: wrapped.reminder };
		}
		return { success: false, message: "Unexpected response from EventKit save." };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function open(searchText: string): Promise<{
	success: boolean;
	message: string;
	reminder?: Reminder;
}> {
	const matches = await search({ searchText, includeCompleted: false, limit: 1 });
	const script = `tell application "Reminders" to activate`;
	await new Promise<void>((resolve) => {
		const c = spawn("osascript", ["-e", script]);
		c.on("close", () => resolve());
		c.stdin.end();
	});
	if (matches.length === 0) {
		return {
			success: true,
			message: `Opened Reminders. No reminder matched "${searchText}".`,
		};
	}
	return {
		success: true,
		message: `Opened Reminders. Top match: "${matches[0].title}" in ${matches[0].listName}.`,
		reminder: matches[0],
	};
}

// =============================================================================
// Backwards-compatible default export
// =============================================================================

export default {
	requestRemindersAccess: requestAccess,
	getAllLists: async () => {
		const lists = await listLists();
		return lists.map((l) => ({ name: l.name, id: l.id }));
	},
	getAllReminders: async (listName?: string) => {
		const r = await listAll({ listName, includeCompleted: false });
		return r.map((x) => ({
			name: x.title,
			id: x.id,
			body: x.notes,
			completed: x.completed,
			dueDate: x.dueDate,
			listName: x.listName,
		}));
	},
	searchReminders: async (searchText: string) => {
		const r = await search({ searchText, includeCompleted: false });
		return r.map((x) => ({
			name: x.title,
			id: x.id,
			body: x.notes,
			completed: x.completed,
			dueDate: x.dueDate,
			listName: x.listName,
		}));
	},
	createReminder: async (
		name: string,
		listName?: string,
		notes?: string,
		dueDate?: string,
	) => {
		const res = await create({ title: name, listName, notes, dueDate });
		if (!res.success || !res.reminder)
			throw new Error(res.message ?? "Failed to create reminder");
		return {
			name: res.reminder.title,
			id: res.reminder.id,
			body: res.reminder.notes,
			completed: res.reminder.completed,
			dueDate: res.reminder.dueDate,
			listName: res.reminder.listName,
		};
	},
	openReminder: async (searchText: string) => {
		const r = await open(searchText);
		return r;
	},
	getRemindersFromListById: async (listId: string) => {
		const r = await listAll({ listId, includeCompleted: false });
		return r.map((x) => ({
			name: x.title,
			id: x.id,
			body: x.notes,
			completed: x.completed,
			dueDate: x.dueDate,
			listName: x.listName,
		}));
	},

	// New, richer surface:
	listLists,
	listAll,
	search,
	listFromList,
	create,
	open,
};

import { runAppleScript } from "run-applescript";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// Types
// =============================================================================

export interface TabRef {
	windowIndex: number;
	tabIndex: number;
	title: string;
	url: string;
	active: boolean;
}

export interface BookmarkEntry {
	title: string;
	url: string;
	folder: string;
}

export interface ReadingListEntry {
	title: string;
	url: string;
	previewText: string;
	dateAdded: string;
	dateLastViewed: string;
	read: boolean;
}

export interface HistoryEntry {
	url: string;
	title: string;
	visitTime: string;
	visitCount: number;
}

// =============================================================================
// Small helpers
// =============================================================================

function escapeApplescriptString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function execFileCapture(
	cmd: string,
	args: string[],
	opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
	return new Promise((resolve) => {
		const timeoutMs = opts.timeoutMs ?? 10000;
		const child = spawn(cmd, args);
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
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ stdout, stderr: err.message, code: -1, timedOut });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? -1, timedOut });
		});
	});
}

// =============================================================================
// AppleScript-backed live tab operations
// =============================================================================

async function listTabs(): Promise<TabRef[]> {
	const script = `
tell application "Safari"
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    set activeTab to missing value
    try
      set activeTab to id of current tab of w
    end try
    repeat with t in tabs of w
      set ti to ti + 1
      set isActive to "false"
      try
        if id of t is activeTab then set isActive to "true"
      end try
      set out to out & wi & tab & ti & tab & isActive & tab & (name of t) & tab & (URL of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;
	const raw = (await runAppleScript(script)) as string;
	const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
	const tabs: TabRef[] = [];
	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length < 5) continue;
		tabs.push({
			windowIndex: Number.parseInt(parts[0], 10),
			tabIndex: Number.parseInt(parts[1], 10),
			active: parts[2] === "true",
			title: parts[3] ?? "",
			url: parts.slice(4).join("\t"),
		});
	}
	return tabs;
}

async function currentTab(): Promise<TabRef | null> {
	const script = `
tell application "Safari"
  try
    set w to front window
    set t to current tab of w
    set wi to index of w
    set ti to index of t
    return (wi as string) & tab & (ti as string) & tab & (name of t) & tab & (URL of t)
  on error
    return ""
  end try
end tell`;
	const raw = ((await runAppleScript(script)) as string).trim();
	if (!raw) return null;
	const parts = raw.split("\t");
	if (parts.length < 4) return null;
	return {
		windowIndex: Number.parseInt(parts[0], 10),
		tabIndex: Number.parseInt(parts[1], 10),
		active: true,
		title: parts[2] ?? "",
		url: parts.slice(3).join("\t"),
	};
}

async function openUrl(opts: {
	url: string;
	where?: "newTab" | "currentTab" | "newWindow";
	background?: boolean;
}): Promise<{ success: boolean; message: string }> {
	const where = opts.where ?? "newTab";
	const safeUrl = escapeApplescriptString(opts.url);
	const activate = opts.background ? "" : "\n  activate";

	let body: string;
	if (where === "currentTab") {
		body = `
  if (count of windows) = 0 then
    make new document with properties {URL:"${safeUrl}"}
  else
    set URL of current tab of front window to "${safeUrl}"
  end if`;
	} else if (where === "newWindow") {
		body = `  make new document with properties {URL:"${safeUrl}"}`;
	} else {
		body = `
  if (count of windows) = 0 then
    make new document with properties {URL:"${safeUrl}"}
  else
    tell front window
      set newTab to make new tab with properties {URL:"${safeUrl}"}
      set current tab to newTab
    end tell
  end if`;
	}

	const script = `tell application "Safari"${activate}\n${body}\nend tell`;
	try {
		await runAppleScript(script);
		return { success: true, message: `Opened ${opts.url} (${where}).` };
	} catch (err) {
		return {
			success: false,
			message: `Failed to open URL: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

async function closeTab(opts: {
	windowIndex?: number;
	tabIndex?: number;
	urlMatch?: string;
}): Promise<{ success: boolean; message: string; closed: number }> {
	if (opts.urlMatch) {
		const safe = escapeApplescriptString(opts.urlMatch);
		const script = `
tell application "Safari"
  set closedCount to 0
  repeat with w in windows
    set toClose to {}
    repeat with t in tabs of w
      try
        if (URL of t) contains "${safe}" then set end of toClose to t
      end try
    end repeat
    repeat with t in toClose
      try
        close t
        set closedCount to closedCount + 1
      end try
    end repeat
  end repeat
  return closedCount as string
end tell`;
		try {
			const raw = ((await runAppleScript(script)) as string).trim();
			const n = Number.parseInt(raw, 10) || 0;
			return {
				success: n > 0,
				closed: n,
				message: n > 0 ? `Closed ${n} tab(s).` : `No tabs matched "${opts.urlMatch}".`,
			};
		} catch (err) {
			return {
				success: false,
				closed: 0,
				message: `Failed to close: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	if (opts.windowIndex && opts.tabIndex) {
		const script = `
tell application "Safari"
  try
    close tab ${opts.tabIndex} of window ${opts.windowIndex}
    return "1"
  on error errMsg
    return "ERROR:" & errMsg
  end try
end tell`;
		try {
			const raw = ((await runAppleScript(script)) as string).trim();
			if (raw.startsWith("ERROR:")) {
				return { success: false, closed: 0, message: raw.replace("ERROR:", "") };
			}
			return { success: true, closed: 1, message: "Closed tab." };
		} catch (err) {
			return {
				success: false,
				closed: 0,
				message: `Failed to close: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	return {
		success: false,
		closed: 0,
		message: "closeTab requires urlMatch or (windowIndex and tabIndex).",
	};
}

async function activateTab(opts: {
	windowIndex?: number;
	tabIndex?: number;
	urlMatch?: string;
}): Promise<{ success: boolean; message: string }> {
	if (opts.urlMatch) {
		const safe = escapeApplescriptString(opts.urlMatch);
		const script = `
tell application "Safari"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (URL of t) contains "${safe}" then
          set current tab of w to t
          set index of w to 1
          return "OK"
        end if
      end try
    end repeat
  end repeat
  return "NOTFOUND"
end tell`;
		try {
			const raw = ((await runAppleScript(script)) as string).trim();
			return {
				success: raw === "OK",
				message: raw === "OK" ? "Activated tab." : `No tab matched "${opts.urlMatch}".`,
			};
		} catch (err) {
			return {
				success: false,
				message: `Failed to activate: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	if (opts.windowIndex && opts.tabIndex) {
		const script = `
tell application "Safari"
  activate
  try
    set current tab of window ${opts.windowIndex} to tab ${opts.tabIndex} of window ${opts.windowIndex}
    set index of window ${opts.windowIndex} to 1
    return "OK"
  on error errMsg
    return "ERROR:" & errMsg
  end try
end tell`;
		try {
			const raw = ((await runAppleScript(script)) as string).trim();
			if (raw.startsWith("ERROR:")) {
				return { success: false, message: raw.replace("ERROR:", "") };
			}
			return { success: true, message: "Activated tab." };
		} catch (err) {
			return {
				success: false,
				message: `Failed to activate: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	return {
		success: false,
		message: "activateTab requires urlMatch or (windowIndex and tabIndex).",
	};
}

async function runJs(opts: {
	js: string;
	windowIndex?: number;
	tabIndex?: number;
}): Promise<{ success: boolean; result: string; message: string }> {
	// Safari requires Develop menu → "Allow JavaScript from Apple Events" to be enabled.
	const target =
		opts.windowIndex && opts.tabIndex
			? `tab ${opts.tabIndex} of window ${opts.windowIndex}`
			: "current tab of front window";
	const safeJs = escapeApplescriptString(opts.js);
	const script = `
tell application "Safari"
  try
    set theResult to do JavaScript "${safeJs}" in ${target}
    if theResult is missing value then return ""
    return theResult as string
  on error errMsg
    return "ERROR:" & errMsg
  end try
end tell`;
	try {
		const raw = (await runAppleScript(script)) as string;
		if (typeof raw === "string" && raw.startsWith("ERROR:")) {
			const msg = raw.replace("ERROR:", "");
			const hint = msg.toLowerCase().includes("not allowed")
				? ' (Enable Safari → Develop menu → "Allow JavaScript from Apple Events".)'
				: "";
			return { success: false, result: "", message: msg + hint };
		}
		return { success: true, result: String(raw ?? ""), message: "OK" };
	} catch (err) {
		return {
			success: false,
			result: "",
			message: `Failed to run JS: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

// =============================================================================
// Plist-backed bookmarks + reading list
// =============================================================================

const BOOKMARKS_PLIST = path.join(
	os.homedir(),
	"Library/Safari/Bookmarks.plist",
);

// JXA snippet that parses Safari's Bookmarks.plist via NSPropertyListSerialization
// and emits a clean JSON tree on stdout (skipping binary fields like icons).
const JXA_READ_BOOKMARKS = `
ObjC.import('Foundation');
function clean(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(clean);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    var out = {};
    for (var k of Object.keys(v)) {
      try {
        var cleaned = clean(v[k]);
        // probe serializability — drops NSData/icon blobs and anything else exotic
        JSON.stringify(cleaned);
        out[k] = cleaned;
      } catch (e) { /* drop unserializable */ }
    }
    return out;
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return null;
}
function writeStdout(s) {
  var ns = $.NSString.alloc.initWithUTF8String(s);
  var bytes = ns.dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(bytes);
}
var url = $.NSURL.fileURLWithPath($.NSString.stringWithUTF8String(PLIST_PATH));
var data = $.NSData.dataWithContentsOfURL(url);
var errRef = Ref();
var plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, errRef);
if (!plist) {
  writeStdout(JSON.stringify({ error: 'Failed to parse plist' }));
} else {
  var js = ObjC.deepUnwrap(plist);
  writeStdout(JSON.stringify(clean(js)));
}
`;

async function loadBookmarksPlist(): Promise<any | null> {
	try {
		await fs.access(BOOKMARKS_PLIST);
	} catch {
		return null;
	}
	const jxa = JXA_READ_BOOKMARKS.replace(
		"PLIST_PATH",
		JSON.stringify(BOOKMARKS_PLIST),
	);
	const res = await execFileCapture("osascript", ["-l", "JavaScript", "-e", jxa]);
	if (res.code !== 0 || res.timedOut) {
		throw new Error(
			`Failed to read Bookmarks.plist: ${res.stderr.trim() || `exit ${res.code}`}`,
		);
	}
	const out = res.stdout.trim();
	if (!out) return null;
	try {
		return JSON.parse(out);
	} catch (err) {
		throw new Error(
			`Failed to parse bookmarks JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

function walkBookmarks(
	node: any,
	parentPath: string,
	out: BookmarkEntry[],
): void {
	if (!node || typeof node !== "object") return;
	const type = node.WebBookmarkType;
	if (type === "WebBookmarkTypeLeaf") {
		const url = node.URLString || "";
		const title =
			(node.URIDictionary && node.URIDictionary.title) || node.Title || url;
		if (url) out.push({ title, url, folder: parentPath });
		return;
	}
	if (type === "WebBookmarkTypeList") {
		const name = node.Title || "";
		// Skip system roots and Reading List branch
		if (name === "com.apple.ReadingList") return;
		const nextPath =
			name && name !== "BookmarksBar" && name !== "BookmarksMenu"
				? parentPath
					? `${parentPath}/${name}`
					: name
				: name === "BookmarksBar"
					? "Favorites"
					: name === "BookmarksMenu"
						? "Menu"
						: parentPath;
		for (const child of node.Children || []) {
			walkBookmarks(child, nextPath, out);
		}
	}
}

async function bookmarks(opts: {
	folder?: string;
	searchText?: string;
}): Promise<BookmarkEntry[]> {
	const plist = await loadBookmarksPlist();
	if (!plist) return [];
	const all: BookmarkEntry[] = [];
	walkBookmarks(plist, "", all);

	let filtered = all;
	if (opts.folder) {
		const f = opts.folder.toLowerCase();
		filtered = filtered.filter((b) => b.folder.toLowerCase().includes(f));
	}
	if (opts.searchText) {
		const q = opts.searchText.toLowerCase();
		filtered = filtered.filter(
			(b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q),
		);
	}
	return filtered;
}

async function readingList(opts: {
	unreadOnly?: boolean;
}): Promise<ReadingListEntry[]> {
	const plist = await loadBookmarksPlist();
	if (!plist || !plist.Children) return [];

	const rlNode = plist.Children.find(
		(c: any) => c && c.Title === "com.apple.ReadingList",
	);
	if (!rlNode || !rlNode.Children) return [];

	const out: ReadingListEntry[] = [];
	for (const item of rlNode.Children) {
		if (!item || item.WebBookmarkType !== "WebBookmarkTypeLeaf") continue;
		const rl = item.ReadingList || {};
		const dateAdded = rl.DateAdded || "";
		const dateLastViewed = rl.DateLastViewed || "";
		const read = Boolean(dateLastViewed);
		if (opts.unreadOnly && read) continue;
		out.push({
			title:
				(item.URIDictionary && item.URIDictionary.title) ||
				item.Title ||
				item.URLString ||
				"",
			url: item.URLString || "",
			previewText: rl.PreviewText || "",
			dateAdded: typeof dateAdded === "string" ? dateAdded : String(dateAdded),
			dateLastViewed:
				typeof dateLastViewed === "string"
					? dateLastViewed
					: String(dateLastViewed),
			read,
		});
	}
	// Newest first
	out.sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : -1));
	return out;
}

// =============================================================================
// History (sqlite3 against a temp copy of History.db)
// =============================================================================

const HISTORY_DB = path.join(os.homedir(), "Library/Safari/History.db");

async function history(opts: {
	searchText?: string;
	limit?: number;
	sinceDays?: number;
}): Promise<HistoryEntry[]> {
	const limit = Math.max(1, Math.min(opts.limit ?? 50, 1000));

	try {
		await fs.access(HISTORY_DB);
	} catch {
		throw new Error(
			"Safari History.db not found — grant the calling app Full Disk Access in System Settings → Privacy & Security.",
		);
	}

	// Copy to temp to avoid lock contention with running Safari.
	const tmp = path.join(
		os.tmpdir(),
		`apple-mcp-safari-history-${process.pid}-${Date.now()}.db`,
	);
	try {
		await fs.copyFile(HISTORY_DB, tmp);

		const where: string[] = [];
		const params: string[] = [];
		if (opts.searchText) {
			where.push("(i.url LIKE ? OR v.title LIKE ?)");
			const q = `%${opts.searchText}%`;
			params.push(q, q);
		}
		if (opts.sinceDays && opts.sinceDays > 0) {
			// visit_time is Mac absolute time (seconds since 2001-01-01).
			// 978307200 = epoch offset; subtract sinceDays in seconds from now.
			const cutoffMacAbs = Math.floor(Date.now() / 1000) - 978307200 - opts.sinceDays * 86400;
			where.push(`v.visit_time >= ${cutoffMacAbs}`);
		}
		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

		const sql = `SELECT i.url, COALESCE(v.title,''), datetime(v.visit_time + 978307200, 'unixepoch','localtime'), i.visit_count
FROM history_items i JOIN history_visits v ON v.history_item = i.id
${whereSql}
ORDER BY v.visit_time DESC
LIMIT ${limit};`;

		const SEP = "\x1f"; // ASCII Unit Separator
		// sqlite3 CLI doesn't bind params via argv; inline-escape ? placeholders.
		let finalSql = sql;
		for (const p of params) {
			finalSql = finalSql.replace("?", `'${p.replace(/'/g, "''")}'`);
		}
		const res = await execFileCapture(
			"sqlite3",
			["-separator", SEP, tmp, finalSql],
			{ timeoutMs: 15000 },
		);
		if (res.code !== 0) {
			throw new Error(`sqlite3 failed: ${res.stderr.trim() || `exit ${res.code}`}`);
		}
		const lines = res.stdout.split(/\r?\n/).filter((l) => l.length > 0);
		return lines.map((line) => {
			const parts = line.split(SEP);
			return {
				url: parts[0] ?? "",
				title: parts[1] ?? "",
				visitTime: parts[2] ?? "",
				visitCount: Number.parseInt(parts[3] ?? "0", 10) || 0,
			};
		});
	} finally {
		fs.unlink(tmp).catch(() => {});
	}
}

export default {
	listTabs,
	currentTab,
	openUrl,
	closeTab,
	activateTab,
	runJs,
	bookmarks,
	readingList,
	history,
};

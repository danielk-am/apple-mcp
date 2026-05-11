import { runAppleScript } from "run-applescript";

// Defaults — overridable per-call
const DEFAULTS = {
	MAX_NOTES: 200,
	MAX_CONTENT_PREVIEW: 200,
};

// Delimited-string protocol: returning a list of AppleScript records over the
// run-applescript bridge is unreliable (records get flattened by `&`, and
// `set end of` truncates silently when fields fail). A plain string with
// custom separators is robust across macOS versions.
//
// Record separator: ASCII 30 (RS), Field separator: ASCII 31 (US).
// Newlines inside content are preserved as `\n` literals via AppleScript text
// item replacement (since the actual newlines are part of content).
const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

export type Note = {
	name: string;
	content: string;
	folder: string;
	account: string;
	modificationDate?: string;
};

export type Folder = {
	name: string;
	account: string;
	parent: string | null;
	noteCount: number;
};

type CreateNoteResult = {
	success: boolean;
	note?: Note;
	message?: string;
	folderName?: string;
	usedDefaultFolder?: boolean;
};

function escapeAS(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// AppleScript helper that emits one record per note, with newlines in content
// replaced by literal "\n" so each record fits on one delimited line.
// `{noteSource}` is interpolated as the AppleScript expression yielding the
// notes to iterate (e.g. `notes`, `notes of folder X`).
function buildNotesScript(opts: {
	noteSource: string;
	filterClause?: string; // AppleScript boolean expression on `currentNote`; emit only if true
	limit: number;
	contentPreview: number;
}): string {
	const filter = opts.filterClause ? `if ${opts.filterClause} then` : "";
	const endFilter = opts.filterClause ? "end if" : "";

	return `
set RS to (ASCII character 30)
set US to (ASCII character 31)
tell application "Notes"
	set out to ""
	set noteCount to 0
	set allNotes to ${opts.noteSource}
	set totalNotes to (count of allNotes)
	repeat with i from 1 to totalNotes
		if noteCount >= ${opts.limit} then exit repeat
		try
			set currentNote to item i of allNotes
			set noteName to name of currentNote
			set noteContent to plaintext of currentNote
			${filter}
			if (length of noteContent) > ${opts.contentPreview} then
				set noteContent to (characters 1 thru ${opts.contentPreview} of noteContent) as string
				set noteContent to noteContent & "..."
			end if
			-- Replace embedded newlines in content so each record is one line.
			set AppleScript's text item delimiters to (ASCII character 10)
			set parts to text items of noteContent
			set AppleScript's text item delimiters to "\\n"
			set noteContent to parts as text
			set AppleScript's text item delimiters to ""
			-- Folder + account may fail for shared notes; degrade gracefully.
			set folderName to ""
			set accountName to ""
			try
				set folderName to name of container of currentNote
			end try
			try
				set accountName to name of account of currentNote
			end try
			set modDate to ""
			try
				set modDate to (modification date of currentNote) as string
			end try
			set out to out & noteName & US & noteContent & US & folderName & US & accountName & US & modDate & RS
			set noteCount to noteCount + 1
			${endFilter}
		on error
			-- skip problematic notes
		end try
	end repeat
	return out
end tell`;
}

function parseNotes(raw: string): Note[] {
	if (!raw) return [];
	const records = raw.split(RS).filter((r) => r.length > 0);
	const out: Note[] = [];
	for (const r of records) {
		const f = r.split(US);
		out.push({
			name: f[0] ?? "",
			content: (f[1] ?? "").replace(/\\n/g, "\n"),
			folder: f[2] ?? "",
			account: f[3] ?? "",
			modificationDate: f[4] || undefined,
		});
	}
	return out;
}

async function checkNotesAccess(): Promise<boolean> {
	try {
		await runAppleScript(`tell application "Notes" to return name`);
		return true;
	} catch {
		return false;
	}
}

async function requestNotesAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const hasAccess = await checkNotesAccess();
	if (hasAccess) return { hasAccess: true, message: "Notes access granted." };
	return {
		hasAccess: false,
		message:
			"Notes access is required but not granted. Open System Settings → Privacy & Security → Automation, find the calling app, and enable Notes.",
	};
}

async function getAllNotes(opts?: {
	limit?: number;
	contentPreview?: number;
	account?: string;
}): Promise<Note[]> {
	const access = await requestNotesAccess();
	if (!access.hasAccess) throw new Error(access.message);

	const limit = opts?.limit ?? DEFAULTS.MAX_NOTES;
	const contentPreview = opts?.contentPreview ?? DEFAULTS.MAX_CONTENT_PREVIEW;

	// If account filter, narrow the source to that account's notes.
	const noteSource = opts?.account
		? `notes of account "${escapeAS(opts.account)}"`
		: "notes";

	const script = buildNotesScript({ noteSource, limit, contentPreview });
	const raw = (await runAppleScript(script)) as string;
	return parseNotes(raw);
}

async function findNote(
	searchText: string,
	opts?: { limit?: number; account?: string; contentPreview?: number },
): Promise<Note[]> {
	const access = await requestNotesAccess();
	if (!access.hasAccess) throw new Error(access.message);
	if (!searchText || !searchText.trim()) return [];

	const limit = opts?.limit ?? DEFAULTS.MAX_NOTES;
	const contentPreview = opts?.contentPreview ?? DEFAULTS.MAX_CONTENT_PREVIEW;
	const noteSource = opts?.account
		? `notes of account "${escapeAS(opts.account)}"`
		: "notes";

	// Build a case-insensitive substring match using `ignoring case` block.
	const term = escapeAS(searchText);
	const script = `
set RS to (ASCII character 30)
set US to (ASCII character 31)
tell application "Notes"
	set out to ""
	set noteCount to 0
	set allNotes to ${noteSource}
	set totalNotes to (count of allNotes)
	repeat with i from 1 to totalNotes
		if noteCount >= ${limit} then exit repeat
		try
			set currentNote to item i of allNotes
			set noteName to name of currentNote
			set noteContent to plaintext of currentNote
			set matched to false
			ignoring case
				if (noteName contains "${term}") or (noteContent contains "${term}") then set matched to true
			end ignoring
			if matched then
				if (length of noteContent) > ${contentPreview} then
					set noteContent to (characters 1 thru ${contentPreview} of noteContent) as string
					set noteContent to noteContent & "..."
				end if
				set AppleScript's text item delimiters to (ASCII character 10)
				set parts to text items of noteContent
				set AppleScript's text item delimiters to "\\n"
				set noteContent to parts as text
				set AppleScript's text item delimiters to ""
				set folderName to ""
				set accountName to ""
				try
					set folderName to name of container of currentNote
				end try
				try
					set accountName to name of account of currentNote
				end try
				set modDate to ""
				try
					set modDate to (modification date of currentNote) as string
				end try
				set out to out & noteName & US & noteContent & US & folderName & US & accountName & US & modDate & RS
				set noteCount to noteCount + 1
			end if
		on error
		end try
	end repeat
	return out
end tell`;

	const raw = (await runAppleScript(script)) as string;
	return parseNotes(raw);
}

async function listFromFolder(opts: {
	folderName: string;
	account?: string;
	limit?: number;
	contentPreview?: number;
}): Promise<{ success: boolean; notes: Note[]; message?: string }> {
	const access = await requestNotesAccess();
	if (!access.hasAccess) return { success: false, notes: [], message: access.message };

	const limit = opts.limit ?? DEFAULTS.MAX_NOTES;
	const contentPreview = opts.contentPreview ?? DEFAULTS.MAX_CONTENT_PREVIEW;
	const target = escapeAS(opts.folderName);

	// Walk accounts → folders (top-level + nested), find folder by name; if
	// `account` is supplied, restrict to that account.
	const accountFilter = opts.account
		? `if name of acct is not "${escapeAS(opts.account)}" then\n				-- skip\n			else`
		: "";
	const accountEnd = opts.account ? "end if" : "";

	const script = `
set RS to (ASCII character 30)
set US to (ASCII character 31)
tell application "Notes"
	set out to ""
	set noteCount to 0
	set foundFolder to false
	repeat with acct in accounts
		try
			${accountFilter}
			-- Search top-level folders and one level of nested folders.
			set folderQueue to {folders of acct}
			repeat
				if (count of folderQueue) is 0 then exit repeat
				set thisBatch to item 1 of folderQueue
				set folderQueue to rest of folderQueue
				repeat with f in thisBatch
					try
						if name of f is "${target}" then
							set foundFolder to true
							set folderNotes to notes of f
							set tot to (count of folderNotes)
							repeat with i from 1 to tot
								if noteCount >= ${limit} then exit repeat
								try
									set n to item i of folderNotes
									set noteName to name of n
									set noteContent to plaintext of n
									if (length of noteContent) > ${contentPreview} then
										set noteContent to (characters 1 thru ${contentPreview} of noteContent) as string
										set noteContent to noteContent & "..."
									end if
									set AppleScript's text item delimiters to (ASCII character 10)
									set parts to text items of noteContent
									set AppleScript's text item delimiters to "\\n"
									set noteContent to parts as text
									set AppleScript's text item delimiters to ""
									set modDate to ""
									try
										set modDate to (modification date of n) as string
									end try
									set out to out & noteName & US & noteContent & US & "${target}" & US & (name of acct) & US & modDate & RS
									set noteCount to noteCount + 1
								on error
								end try
							end repeat
						end if
						-- enqueue sub-folders
						try
							set sub to folders of f
							if (count of sub) > 0 then set end of folderQueue to sub
						end try
					on error
					end try
				end repeat
			end repeat
			${accountEnd}
		on error
		end try
	end repeat
	if not foundFolder then return "NOTFOUND"
	return out
end tell`;

	const raw = (await runAppleScript(script)) as string;
	if (raw === "NOTFOUND") {
		const where = opts.account ? ` in account "${opts.account}"` : "";
		return {
			success: false,
			notes: [],
			message: `Folder "${opts.folderName}" not found${where}.`,
		};
	}
	return { success: true, notes: parseNotes(raw) };
}

async function listFolders(opts?: { account?: string }): Promise<Folder[]> {
	const access = await requestNotesAccess();
	if (!access.hasAccess) throw new Error(access.message);

	const accountFilter = opts?.account
		? `if name of acct is not "${escapeAS(opts.account)}" then\n			-- skip\n		else`
		: "";
	const accountEnd = opts?.account ? "end if" : "";

	const script = `
set RS to (ASCII character 30)
set US to (ASCII character 31)
tell application "Notes"
	set out to ""
	repeat with acct in accounts
		try
			${accountFilter}
			set acctName to name of acct
			repeat with f in folders of acct
				try
					set fName to name of f
					set fCount to (count of notes of f)
					set out to out & fName & US & acctName & US & "" & US & fCount & RS
					-- one level of sub-folders
					try
						repeat with sf in folders of f
							try
								set sfName to name of sf
								set sfCount to (count of notes of sf)
								set out to out & sfName & US & acctName & US & fName & US & sfCount & RS
							end try
						end repeat
					end try
				end try
			end repeat
			${accountEnd}
		on error
		end try
	end repeat
	return out
end tell`;

	const raw = (await runAppleScript(script)) as string;
	if (!raw) return [];
	const out: Folder[] = [];
	for (const r of raw.split(RS).filter((x) => x.length > 0)) {
		const f = r.split(US);
		out.push({
			name: f[0] ?? "",
			account: f[1] ?? "",
			parent: f[2] ? f[2] : null,
			noteCount: Number.parseInt(f[3] ?? "0", 10) || 0,
		});
	}
	return out;
}

async function createNote(
	title: string,
	body: string,
	folderName = "Claude",
): Promise<CreateNoteResult> {
	try {
		const access = await requestNotesAccess();
		if (!access.hasAccess) return { success: false, message: access.message };
		if (!title || !title.trim()) {
			return { success: false, message: "Note title cannot be empty" };
		}

		const formattedBody = body.trim();
		const tmpFile = `/tmp/note-content-${Date.now()}.txt`;
		const fs = await import("node:fs");
		fs.writeFileSync(tmpFile, formattedBody, "utf8");

		const safeTitle = escapeAS(title);
		const safeFolder = escapeAS(folderName);

		const script = `
tell application "Notes"
	set targetFolder to null
	set folderFound to false
	set actualFolderName to "${safeFolder}"
	try
		set allFolders to folders
		repeat with currentFolder in allFolders
			if name of currentFolder is "${safeFolder}" then
				set targetFolder to currentFolder
				set folderFound to true
				exit repeat
			end if
		end repeat
	on error
	end try

	if not folderFound and ("${safeFolder}" is "Claude" or "${safeFolder}" is "Test-Claude") then
		try
			make new folder with properties {name:"${safeFolder}"}
			set allFolders to folders
			repeat with currentFolder in allFolders
				if name of currentFolder is "${safeFolder}" then
					set targetFolder to currentFolder
					set folderFound to true
					set actualFolderName to "${safeFolder}"
					exit repeat
				end if
			end repeat
		on error
			set actualFolderName to "Notes"
		end try
	end if

	set noteContent to read file POSIX file "${tmpFile}" as «class utf8»

	if folderFound and targetFolder is not null then
		make new note at targetFolder with properties {name:"${safeTitle}", body:noteContent}
		return "SUCCESS:" & actualFolderName & ":false"
	else
		make new note with properties {name:"${safeTitle}", body:noteContent}
		return "SUCCESS:Notes:true"
	end if
end tell`;

		const result = (await runAppleScript(script)) as string;
		try {
			fs.unlinkSync(tmpFile);
		} catch {}

		if (typeof result === "string" && result.startsWith("SUCCESS:")) {
			const parts = result.split(":");
			const usedDefaultFolder = parts[2] === "true";
			return {
				success: true,
				note: {
					name: title,
					content: formattedBody,
					folder: parts[1] || "Notes",
					account: "",
				},
				folderName: parts[1] || "Notes",
				usedDefaultFolder,
			};
		}
		return {
			success: false,
			message: `Failed to create note: ${result || "no result"}`,
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export default {
	getAllNotes,
	findNote,
	createNote,
	listFromFolder,
	listFolders,
	requestNotesAccess,
};

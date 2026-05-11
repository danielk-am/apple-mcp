import { runAppleScript } from "run-applescript";

// Configuration
const CONFIG = {
	// Maximum reminders to process (to avoid performance issues)
	MAX_REMINDERS: 50,
	// Maximum lists to process
	MAX_LISTS: 20,
	// Timeout for operations
	TIMEOUT_MS: 8000,
};

// Define types for our reminders
interface ReminderList {
	name: string;
	id: string;
}

interface Reminder {
	name: string;
	id: string;
	body: string;
	completed: boolean;
	dueDate: string | null;
	listName: string;
	completionDate?: string | null;
	creationDate?: string | null;
	modificationDate?: string | null;
	remindMeDate?: string | null;
	priority?: number;
}

/**
 * Check if Reminders app is accessible
 */
async function checkRemindersAccess(): Promise<boolean> {
	try {
		const script = `
tell application "Reminders"
    return name
end tell`;

		await runAppleScript(script);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Reminders app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Reminders app access and provide instructions if not available
 */
async function requestRemindersAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkRemindersAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Reminders access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Reminders access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Reminders'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Reminders access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

/**
 * Get all reminder lists (limited for performance)
 * @returns Array of reminder lists with their names and IDs
 */
async function getAllLists(): Promise<ReminderList[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Reminders"
    set listArray to {}
    set listCount to 0

    -- Get all lists
    set allLists to lists

    repeat with i from 1 to (count of allLists)
        if listCount >= ${CONFIG.MAX_LISTS} then exit repeat

        try
            set currentList to item i of allLists
            set listName to name of currentList
            set listId to id of currentList

            set listInfo to {name:listName, id:listId}
            set listArray to listArray & {listInfo}
            set listCount to listCount + 1
        on error
            -- Skip problematic lists
        end try
    end repeat

    return listArray
end tell`;

		const result = (await runAppleScript(script)) as any;

		// Convert AppleScript result to our format
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];

		return resultArray.map((listData: any) => ({
			name: listData.name || "Untitled List",
			id: listData.id || "unknown-id",
		}));
	} catch (error) {
		console.error(
			`Error getting reminder lists: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Get all reminders from a specific list or all lists.
 * Uses bulk property fetches (`name of every reminder`) so AppleScript stays fast
 * even on libraries with hundreds of reminders. Completed reminders are excluded
 * via a `whose` clause for both speed and relevance.
 * @param listName Optional list name to filter by
 * @returns Array of incomplete reminders
 */
async function getAllReminders(listName?: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const safeListName = listName ? listName.replace(/"/g, '\\"') : "";
		const listSelector = listName
			? `set targetLists to (every list whose name is "${safeListName}")`
			: `set targetLists to every list`;

		const script = `
tell application "Reminders"
    set output to {}
    set totalCount to 0
    ${listSelector}

    repeat with currentList in targetLists
        if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
        try
            set listNm to name of currentList
            -- whose-clause filter pushes work into the app, way faster than JS-side filtering
            set rems to (reminders of currentList whose completed is false)
            set remCount to count of rems
            if remCount > 0 then
                set perListLimit to ${CONFIG.MAX_REMINDERS} - totalCount
                if remCount > perListLimit then set remCount to perListLimit

                -- Bulk fetch (one round-trip per property, not per item)
                set rNames to name of rems
                set rIds to id of rems

                repeat with i from 1 to remCount
                    set rBody to ""
                    try
                        set rBody to body of item i of rems
                        if rBody is missing value then set rBody to ""
                    end try
                    set rDue to ""
                    try
                        set d to due date of item i of rems
                        if d is not missing value then set rDue to d as string
                    end try

                    set end of output to {nm:(item i of rNames), idd:((item i of rIds) as string), bd:rBody, due:rDue, ln:listNm}
                    set totalCount to totalCount + 1
                end repeat
            end if
        on error
            -- skip problematic lists
        end try
    end repeat

    return output
end tell`;

		const result = (await runAppleScript(script)) as any;
		const arr = Array.isArray(result) ? result : result ? [result] : [];

		return arr.map((r: any) => ({
			name: r.nm || "Untitled",
			id: r.idd || "unknown-id",
			body: r.bd || "",
			completed: false,
			dueDate: r.due && r.due !== "" ? r.due : null,
			listName: r.ln || "Unknown",
		}));
	} catch (error) {
		console.error(
			`Error getting reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Search for reminders by text in name or body.
 * Fetches all incomplete reminders via getAllReminders (which uses bulk AppleScript)
 * then filters in JS — much more reliable than AppleScript-side text matching.
 * @param searchText Text to search for in reminder names or notes
 * @returns Array of matching reminders
 */
async function searchReminders(searchText: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!searchText || searchText.trim() === "") {
			return [];
		}

		const all = await getAllReminders();
		const needle = searchText.toLowerCase();
		return all.filter(
			(r) =>
				r.name.toLowerCase().includes(needle) ||
				(r.body && r.body.toLowerCase().includes(needle)),
		);
	} catch (error) {
		console.error(
			`Error searching reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Create a new reminder (simplified for performance)
 * @param name Name of the reminder
 * @param listName Name of the list to add the reminder to (creates if doesn't exist)
 * @param notes Optional notes for the reminder
 * @param dueDate Optional due date for the reminder (ISO string)
 * @returns The created reminder
 */
async function createReminder(
	name: string,
	listName: string = "Reminders",
	notes?: string,
	dueDate?: string,
): Promise<Reminder> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Validate inputs
		if (!name || name.trim() === "") {
			throw new Error("Reminder name cannot be empty");
		}

		const cleanName = name.replace(/\"/g, '\\"');
		const cleanListName = listName.replace(/\"/g, '\\"');
		const cleanNotes = notes ? notes.replace(/\"/g, '\\"') : "";

		const script = `
tell application "Reminders"
    try
        -- Use first available list (creating/finding lists can be slow)
        set allLists to lists
        if (count of allLists) > 0 then
            set targetList to first item of allLists
            set listName to name of targetList

            -- Create a simple reminder with just name
            set newReminder to make new reminder at targetList with properties {name:"${cleanName}"}
            return "SUCCESS:" & listName
        else
            return "ERROR:No lists available"
        end if
    on error errorMessage
        return "ERROR:" & errorMessage
    end try
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result && result.startsWith("SUCCESS:")) {
			const actualListName = result.replace("SUCCESS:", "");

			return {
				name: name,
				id: "created-reminder-id",
				body: notes || "",
				completed: false,
				dueDate: dueDate || null,
				listName: actualListName,
			};
		} else {
			throw new Error(`Failed to create reminder: ${result}`);
		}
	} catch (error) {
		throw new Error(
			`Failed to create reminder: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

interface OpenReminderResult {
	success: boolean;
	message: string;
	reminder?: Reminder;
}

/**
 * Open the Reminders app and show a specific reminder (simplified)
 * @param searchText Text to search for in reminder names or notes
 * @returns Result of the operation
 */
async function openReminder(searchText: string): Promise<OpenReminderResult> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		// First search for the reminder
		const matchingReminders = await searchReminders(searchText);

		if (matchingReminders.length === 0) {
			return { success: false, message: "No matching reminders found" };
		}

		// Open the Reminders app
		const script = `
tell application "Reminders"
    activate
    return "SUCCESS"
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result === "SUCCESS") {
			return {
				success: true,
				message: "Reminders app opened",
				reminder: matchingReminders[0],
			};
		} else {
			return { success: false, message: "Failed to open Reminders app" };
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to open reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get reminders from a specific list by its AppleScript id.
 * Uses the same bulk-fetch pattern as getAllReminders for speed.
 * @param listId ID of the list to get reminders from
 * @param props Reserved for future per-property selection (currently ignored)
 * @returns Array of incomplete reminders in that list
 */
async function getRemindersFromListById(
	listId: string,
	props?: string[],
): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const safeId = listId.replace(/"/g, '\\"');

		const script = `
tell application "Reminders"
    set output to {}
    try
        set targetList to (first list whose id is "${safeId}")
        set listNm to name of targetList
        set rems to (reminders of targetList whose completed is false)
        set remCount to count of rems
        if remCount > ${CONFIG.MAX_REMINDERS} then set remCount to ${CONFIG.MAX_REMINDERS}

        if remCount > 0 then
            set rNames to name of rems
            set rIds to id of rems

            repeat with i from 1 to remCount
                set rBody to ""
                try
                    set rBody to body of item i of rems
                    if rBody is missing value then set rBody to ""
                end try
                set rDue to ""
                try
                    set d to due date of item i of rems
                    if d is not missing value then set rDue to d as string
                end try

                set end of output to {nm:(item i of rNames), idd:((item i of rIds) as string), bd:rBody, due:rDue, ln:listNm}
            end repeat
        end if
    on error errMsg
        return "ERROR:" & errMsg
    end try

    return output
end tell`;

		const result = (await runAppleScript(script)) as any;
		if (typeof result === "string" && result.startsWith("ERROR:")) {
			throw new Error(result.replace("ERROR:", ""));
		}
		const arr = Array.isArray(result) ? result : result ? [result] : [];

		return arr.map((r: any) => ({
			name: r.nm || "Untitled",
			id: r.idd || "unknown-id",
			body: r.bd || "",
			completed: false,
			dueDate: r.due && r.due !== "" ? r.due : null,
			listName: r.ln || "Unknown",
		}));
	} catch (error) {
		console.error(
			`Error getting reminders from list by ID: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

export default {
	getAllLists,
	getAllReminders,
	searchReminders,
	createReminder,
	openReminder,
	getRemindersFromListById,
	requestRemindersAccess,
};

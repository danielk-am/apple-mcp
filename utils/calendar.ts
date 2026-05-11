import { runAppleScript } from 'run-applescript';

// Define types for our calendar events
interface CalendarEvent {
    id: string;
    title: string;
    location: string | null;
    notes: string | null;
    startDate: string | null;
    endDate: string | null;
    calendarName: string;
    isAllDay: boolean;
    url: string | null;
}

// Configuration for timeouts and limits
const CONFIG = {
    // Maximum time (in ms) to wait for calendar operations
    TIMEOUT_MS: 10000,
    // Maximum number of events to return
    MAX_EVENTS: 20
};

/**
 * Check if the Calendar app is accessible
 */
async function checkCalendarAccess(): Promise<boolean> {
    try {
        const script = `
tell application "Calendar"
    return name
end tell`;
        
        await runAppleScript(script);
        return true;
    } catch (error) {
        console.error(`Cannot access Calendar app: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Request Calendar app access and provide instructions if not available
 */
async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
    try {
        // First check if we already have access
        const hasAccess = await checkCalendarAccess();
        if (hasAccess) {
            return {
                hasAccess: true,
                message: "Calendar access is already granted."
            };
        }

        // If no access, provide clear instructions
        return {
            hasAccess: false,
            message: "Calendar access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Calendar'\n3. Alternatively, open System Settings > Privacy & Security > Calendars\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again"
        };
    } catch (error) {
        return {
            hasAccess: false,
            message: `Error checking Calendar access: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Get calendar events in a specified date range
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 7 days from now)
 */
async function getEvents(
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        console.error("getEvents - Starting to fetch calendar events");
        
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }
        console.error("getEvents - Calendar access check passed");

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 7);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        // Convert ISO dates to AppleScript date literal format (locale string is most reliable)
        const startD = new Date(startDate);
        const endD = new Date(endDate);
        // End of day for the toDate to include events that day
        if (!toDate) {
            endD.setHours(23, 59, 59, 999);
        }
        const startStr = startD.toLocaleString("en-US");
        const endStr = endD.toLocaleString("en-US");
        const maxEvents = Math.min(limit, CONFIG.MAX_EVENTS);

        const script = `
tell application "Calendar"
    set output to {}
    set totalCount to 0
    set startD to date "${startStr}"
    set endD to date "${endStr}"

    repeat with cal in calendars
        if totalCount >= ${maxEvents} then exit repeat
        try
            set calNm to name of cal
            -- whose-clause filter is the key to making Calendar AppleScript usable
            set evts to (events of cal whose start date is greater than or equal to startD and start date is less than or equal to endD)
            set evtCount to count of evts
            if evtCount > 0 then
                set perCalLimit to ${maxEvents} - totalCount
                if evtCount > perCalLimit then set evtCount to perCalLimit

                -- Bulk-fetch properties (one round-trip each)
                set eTitles to summary of evts
                set eIds to uid of evts
                set eStarts to start date of evts
                set eEnds to end date of evts
                set eAllDay to allday event of evts

                repeat with i from 1 to evtCount
                    set evt to item i of evts
                    set eLoc to ""
                    try
                        set eLoc to location of evt
                        if eLoc is missing value then set eLoc to ""
                    end try
                    set eNotes to ""
                    try
                        set eNotes to description of evt
                        if eNotes is missing value then set eNotes to ""
                    end try

                    set end of output to {idd:(item i of eIds), ttl:(item i of eTitles), cal:calNm, sd:((item i of eStarts) as string), ed:((item i of eEnds) as string), allday:(item i of eAllDay), loc:eLoc, nts:eNotes}
                    set totalCount to totalCount + 1
                end repeat
            end if
        on error
            -- skip problematic calendars
        end try
    end repeat

    return output
end tell`;

        const result = await runAppleScript(script) as any;
        const arr = Array.isArray(result) ? result : result ? [result] : [];

        const events: CalendarEvent[] = arr.map((e: any) => {
            const startParsed = e.sd ? new Date(e.sd) : null;
            const endParsed = e.ed ? new Date(e.ed) : null;
            return {
                id: e.idd || `unknown-${Date.now()}`,
                title: e.ttl || "Untitled Event",
                location: e.loc || null,
                notes: e.nts || null,
                startDate: startParsed && !isNaN(startParsed.getTime()) ? startParsed.toISOString() : (e.sd || null),
                endDate: endParsed && !isNaN(endParsed.getTime()) ? endParsed.toISOString() : (e.ed || null),
                calendarName: e.cal || "Unknown Calendar",
                isAllDay: e.allday === true || e.allday === "true",
                url: null,
            };
        });

        return events;
    } catch (error) {
        console.error(`Error getting events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Search for calendar events that match the search text
 * @param searchText Text to search for in event titles
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 30 days from now)
 */
async function searchEvents(
    searchText: string, 
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }

        console.error(`searchEvents - Processing calendars for search: "${searchText}"`);

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 30);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        // Fetch events in the date range, then filter by text on the JS side.
        // AppleScript-side text filtering on summary is slow and brittle.
        const candidates = await getEvents(CONFIG.MAX_EVENTS, startDate, endDate);
        const needle = searchText.toLowerCase();
        const matches = candidates.filter((e) =>
            (e.title && e.title.toLowerCase().includes(needle)) ||
            (e.location && e.location.toLowerCase().includes(needle)) ||
            (e.notes && e.notes.toLowerCase().includes(needle))
        );

        return matches.slice(0, limit);
    } catch (error) {
        console.error(`Error searching events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Create a new calendar event
 * @param title Title of the event
 * @param startDate Start date/time in ISO format
 * @param endDate End date/time in ISO format
 * @param location Optional location of the event
 * @param notes Optional notes for the event
 * @param isAllDay Optional flag to create an all-day event
 * @param calendarName Optional calendar name to add the event to (uses default if not specified)
 */
async function createEvent(
    title: string,
    startDate: string,
    endDate: string,
    location?: string,
    notes?: string,
    isAllDay = false,
    calendarName?: string
): Promise<{ success: boolean; message: string; eventId?: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        // Validate inputs
        if (!title.trim()) {
            return {
                success: false,
                message: "Event title cannot be empty"
            };
        }

        if (!startDate || !endDate) {
            return {
                success: false,
                message: "Start date and end date are required"
            };
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return {
                success: false,
                message: "Invalid date format. Please use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)"
            };
        }

        if (end <= start) {
            return {
                success: false,
                message: "End date must be after start date"
            };
        }

        console.error(`createEvent - Attempting to create event: "${title}"`);

        const targetCalendar = calendarName || "Calendar";
        
        const script = `
tell application "Calendar"
    set startDate to date "${start.toLocaleString()}"
    set endDate to date "${end.toLocaleString()}"
    
    -- Find target calendar
    set targetCal to null
    try
        set targetCal to calendar "${targetCalendar}"
    on error
        -- Use first available calendar
        set targetCal to first calendar
    end try
    
    -- Create the event
    tell targetCal
        set newEvent to make new event with properties {summary:"${title.replace(/"/g, '\\"')}", start date:startDate, end date:endDate, allday event:${isAllDay}}
        
        if "${location || ""}" ≠ "" then
            set location of newEvent to "${(location || '').replace(/"/g, '\\"')}"
        end if
        
        if "${notes || ""}" ≠ "" then
            set description of newEvent to "${(notes || '').replace(/"/g, '\\"')}"
        end if
        
        return uid of newEvent
    end tell
end tell`;

        const eventId = await runAppleScript(script) as string;
        
        return {
            success: true,
            message: `Event "${title}" created successfully.`,
            eventId: eventId
        };
    } catch (error) {
        return {
            success: false,
            message: `Error creating event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Open a specific calendar event in the Calendar app
 * @param eventId ID of the event to open
 */
async function openEvent(eventId: string): Promise<{ success: boolean; message: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        console.error(`openEvent - Attempting to open event with ID: ${eventId}`);

        const safeId = eventId.replace(/"/g, '\\"');
        const script = `
tell application "Calendar"
    activate
    try
        -- Find the event across all calendars (uid is unique)
        set found to false
        repeat with cal in calendars
            try
                set matches to (events of cal whose uid is "${safeId}")
                if (count of matches) > 0 then
                    show (item 1 of matches)
                    set found to true
                    exit repeat
                end if
            end try
        end repeat
        if found then
            return "SUCCESS"
        else
            return "ERROR:Event not found"
        end if
    on error errMsg
        return "ERROR:" & errMsg
    end try
end tell`;

        const result = await runAppleScript(script) as string;
        if (typeof result === "string" && result.startsWith("ERROR:")) {
            return { success: false, message: result.replace("ERROR:", "") };
        }
        return {
            success: true,
            message: `Opened event ${eventId} in Calendar`
        };
    } catch (error) {
        return {
            success: false,
            message: `Error opening event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

const calendar = {
    searchEvents,
    openEvent,
    getEvents,
    createEvent,
    requestCalendarAccess
};

export default calendar;
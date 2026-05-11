import { type Tool } from "@modelcontextprotocol/sdk/types.js";

const CONTACTS_TOOL: Tool = {
    name: "contacts",
    description: "Search and retrieve contacts from Apple Contacts app",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name to search for (optional - if not provided, returns all contacts). Can be partial name to search."
        }
      }
    }
  };
  
  const NOTES_TOOL: Tool = {
    name: "notes",
    description: "Search, retrieve, and create notes in Apple Notes. Supports multi-account (iCloud + work) and folder hierarchies. Note: shared (CloudKit) notes return empty folder/account fields because AppleScript doesn't expose container for shared items.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform: 'list' (all notes), 'search' (substring match), 'listFolders' (folder hierarchy with counts), 'listFromFolder' (notes inside a named folder), or 'create'",
          enum: ["search", "list", "listFolders", "listFromFolder", "create"]
        },
        searchText: {
          type: "string",
          description: "Text to search for (required for search)"
        },
        folderName: {
          type: "string",
          description: "Folder name — required for listFromFolder; optional for create (defaults to 'Claude'). Match is case-sensitive and exact — include emoji prefix if the folder has one."
        },
        account: {
          type: "string",
          description: "Restrict to a specific account name (e.g. 'iCloud' or 'daniel.richard@a8c.com'). Optional for list, search, listFolders, listFromFolder."
        },
        title: {
          type: "string",
          description: "Title of the note to create (required for create operation)"
        },
        body: {
          type: "string",
          description: "Content of the note to create (required for create operation)"
        },
        limit: {
          type: "number",
          description: "Maximum notes to return (optional for list/search/listFromFolder, default 200)"
        },
        contentPreview: {
          type: "number",
          description: "Maximum characters of content preview per note (optional for list/search/listFromFolder, default 200)"
        }
      },
      required: ["operation"]
    }
  };
  
  const MESSAGES_TOOL: Tool = {
    name: "messages",
    description: "Interact with Apple Messages app - send, read, schedule messages and check unread messages",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform: 'send', 'read', 'schedule', or 'unread'",
          enum: ["send", "read", "schedule", "unread"]
        },
        phoneNumber: {
          type: "string",
          description: "Phone number to send message to (required for send, read, and schedule operations)"
        },
        message: {
          type: "string",
          description: "Message to send (required for send and schedule operations)"
        },
        limit: {
          type: "number",
          description: "Number of messages to read (optional, for read and unread operations)"
        },
        scheduledTime: {
          type: "string",
          description: "ISO string of when to send the message (required for schedule operation)"
        }
      },
      required: ["operation"]
    }
  };
  
  const MAIL_TOOL: Tool = {
    name: "mail",
    description: "Interact with Apple Mail app - read unread emails, search emails, and send emails",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform: 'unread', 'search', 'send', 'mailboxes', 'accounts', or 'latest'",
          enum: ["unread", "search", "send", "mailboxes", "accounts", "latest"]
        },
        account: {
          type: "string",
          description: "Email account to use (optional - if not provided, searches across all accounts)"
        },
        mailbox: {
          type: "string",
          description: "Mailbox to use (optional - if not provided, uses inbox or searches across all mailboxes)"
        },
        limit: {
          type: "number",
          description: "Number of emails to retrieve (optional, for unread, search, and latest operations)"
        },
        searchTerm: {
          type: "string",
          description: "Text to search for in emails (required for search operation)"
        },
        to: {
          type: "string",
          description: "Recipient email address (required for send operation)"
        },
        subject: {
          type: "string",
          description: "Email subject (required for send operation)"
        },
        body: {
          type: "string",
          description: "Email body content (required for send operation)"
        },
        cc: {
          type: "string",
          description: "CC email address (optional for send operation)"
        },
        bcc: {
          type: "string",
          description: "BCC email address (optional for send operation)"
        }
      },
      required: ["operation"]
    }
  };
  
  const REMINDERS_TOOL: Tool = {
    name: "reminders",
    description: "Search, list, create, and open reminders in Apple Reminders. Operations: 'list' (all incomplete reminders + lists), 'search' (substring match in title or notes), 'open' (activate Reminders app showing top match), 'create' (add to a named list), 'listById' (reminders in a specific list by EventKit calendar identifier). Built on EventKit since the legacy AppleScript surface is broken on modern macOS.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform: 'list', 'search', 'open', 'create', or 'listById'",
          enum: ["list", "search", "open", "create", "listById"]
        },
        searchText: {
          type: "string",
          description: "Text to search for in reminders (required for search and open operations)"
        },
        name: {
          type: "string",
          description: "Name of the reminder to create (required for create operation)"
        },
        listName: {
          type: "string",
          description: "Name of the list to create the reminder in (optional for create operation)"
        },
        listId: {
          type: "string",
          description: "ID of the list to get reminders from (required for listById operation)"
        },
        props: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Properties to include in the reminders (optional for listById operation)"
        },
        notes: {
          type: "string",
          description: "Additional notes for the reminder (optional for create operation)"
        },
        dueDate: {
          type: "string",
          description: "Due date for the reminder in ISO format (optional for create operation)"
        }
      },
      required: ["operation"]
    }
  };
  
  
const CALENDAR_TOOL: Tool = {
  name: "calendar",
  description: "Search, create, and open calendar events in Apple Calendar app",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "Operation to perform: 'search', 'open', 'list', or 'create'",
        enum: ["search", "open", "list", "create"]
      },
      searchText: {
        type: "string",
        description: "Text to search for in event titles, locations, and notes (required for search operation)"
      },
      eventId: {
        type: "string",
        description: "ID of the event to open (required for open operation)"
      },
      limit: {
        type: "number",
        description: "Number of events to retrieve (optional, default 10)"
      },
      fromDate: {
        type: "string",
        description: "Start date for search range in ISO format (optional, default is today)"
      },
      toDate: {
        type: "string",
        description: "End date for search range in ISO format (optional, default is 30 days from now for search, 7 days for list)"
      },
      title: {
        type: "string",
        description: "Title of the event to create (required for create operation)"
      },
      startDate: {
        type: "string",
        description: "Start date/time of the event in ISO format (required for create operation)"
      },
      endDate: {
        type: "string",
        description: "End date/time of the event in ISO format (required for create operation)"
      },
      location: {
        type: "string",
        description: "Location of the event (optional for create operation)"
      },
      notes: {
        type: "string",
        description: "Additional notes for the event (optional for create operation)"
      },
      isAllDay: {
        type: "boolean",
        description: "Whether the event is an all-day event (optional for create operation, default is false)"
      },
      calendarName: {
        type: "string",
        description: "Name of the calendar to create the event in (optional for create operation, uses default calendar if not specified)"
      }
    },
    required: ["operation"]
  }
};
  
const MAPS_TOOL: Tool = {
  name: "maps",
  description: "Search locations, manage guides, save favorites, and get directions using Apple Maps",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "Operation to perform with Maps",
        enum: ["search", "save", "directions", "pin", "listGuides", "addToGuide", "createGuide"]
      },
      query: {
        type: "string",
        description: "Search query for locations (required for search)"
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (optional for search)"
      },
      name: {
        type: "string",
        description: "Name of the location (required for save and pin)"
      },
      address: {
        type: "string",
        description: "Address of the location (required for save, pin, addToGuide)"
      },
      fromAddress: {
        type: "string",
        description: "Starting address for directions (required for directions)"
      },
      toAddress: {
        type: "string",
        description: "Destination address for directions (required for directions)"
      },
      transportType: {
        type: "string",
        description: "Type of transport to use (optional for directions)",
        enum: ["driving", "walking", "transit"]
      },
      guideName: {
        type: "string",
        description: "Name of the guide (required for createGuide and addToGuide)"
      }
    },
    required: ["operation"]
  }
};

const PHOTOS_TOOL: Tool = {
	name: "photos",
	description:
		"Browse albums, find favorites, view recent photos, and search Apple Photos library",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				description:
					"Operation to perform: 'listAlbums', 'getAlbum', 'getFavorites', 'getRecent', 'search', or 'open'",
				enum: ["listAlbums", "getAlbum", "getFavorites", "getRecent", "search", "open"],
			},
			albumName: {
				type: "string",
				description:
					"Name of the album to browse (required for getAlbum, optional for open)",
			},
			searchText: {
				type: "string",
				description:
					"Text to search for — opens Photos with that search active (required for search operation)",
			},
			limit: {
				type: "number",
				description: "Maximum number of photos to return (optional, default 50)",
			},
		},
		required: ["operation"],
	},
};

const SHORTCUTS_TOOL: Tool = {
	name: "shortcuts",
	description:
		"Run, list, and open macOS Shortcuts. Acts as a force-multiplier: any user-authored Shortcut becomes callable from here, which is how to reach HomeKit, Focus modes, Find My, Health, Screen Time, and any third-party app that exposes App Intents.",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				description:
					"Operation to perform: 'list' (shortcut names), 'listFolders', 'run' (execute by name), or 'open' (reveal in Shortcuts editor)",
				enum: ["list", "listFolders", "run", "open"],
			},
			name: {
				type: "string",
				description: "Shortcut name (required for run and open)",
			},
			folder: {
				type: "string",
				description: "Folder name to filter by (optional for list)",
			},
			input: {
				type: "string",
				description:
					"Text input to pipe to the shortcut on stdin (optional for run). The shortcut receives this as its 'Shortcut Input'.",
			},
			captureOutput: {
				type: "boolean",
				description:
					"Capture the shortcut's text output back into the response (optional for run, default true)",
			},
			timeoutMs: {
				type: "number",
				description: "Maximum runtime in ms before SIGTERM (optional for run, default 60000)",
			},
			showIdentifiers: {
				type: "boolean",
				description:
					"Include shortcut UUIDs in the list output (optional for list)",
			},
		},
		required: ["operation"],
	},
};

const SAFARI_TOOL: Tool = {
	name: "safari",
	description:
		"Control Safari: list/open/close/activate tabs, run JavaScript in a tab, read bookmarks, read the Reading List, and search browsing history. Bookmarks/Reading List come from ~/Library/Safari/Bookmarks.plist; history comes from ~/Library/Safari/History.db (requires Full Disk Access for the calling app). The runJs operation requires Safari → Develop menu → 'Allow JavaScript from Apple Events'.",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				description:
					"Operation: 'listTabs', 'currentTab', 'openUrl', 'closeTab', 'activateTab', 'runJs', 'bookmarks', 'readingList', or 'history'",
				enum: [
					"listTabs",
					"currentTab",
					"openUrl",
					"closeTab",
					"activateTab",
					"runJs",
					"bookmarks",
					"readingList",
					"history",
				],
			},
			url: {
				type: "string",
				description: "URL to open (required for openUrl)",
			},
			where: {
				type: "string",
				description:
					"Where to open the URL (optional for openUrl, default 'newTab')",
				enum: ["newTab", "currentTab", "newWindow"],
			},
			background: {
				type: "boolean",
				description:
					"Open without bringing Safari to the foreground (optional for openUrl)",
			},
			windowIndex: {
				type: "number",
				description:
					"1-based window index (optional for closeTab, activateTab, runJs)",
			},
			tabIndex: {
				type: "number",
				description:
					"1-based tab index within the window (optional for closeTab, activateTab, runJs)",
			},
			urlMatch: {
				type: "string",
				description:
					"Substring match against tab URLs (alternative to indices for closeTab and activateTab)",
			},
			js: {
				type: "string",
				description: "JavaScript source to evaluate in the target tab (required for runJs)",
			},
			folder: {
				type: "string",
				description: "Filter bookmarks by folder path substring (optional for bookmarks)",
			},
			searchText: {
				type: "string",
				description:
					"Filter bookmarks by title/URL substring (optional for bookmarks) or filter history (optional for history)",
			},
			unreadOnly: {
				type: "boolean",
				description: "Return only unread Reading List items (optional for readingList)",
			},
			limit: {
				type: "number",
				description: "Maximum results to return (optional for history, default 50, max 1000)",
			},
			sinceDays: {
				type: "number",
				description: "Only include history visits within the last N days (optional for history)",
			},
		},
		required: ["operation"],
	},
};

const tools = [CONTACTS_TOOL, NOTES_TOOL, MESSAGES_TOOL, MAIL_TOOL, REMINDERS_TOOL, CALENDAR_TOOL, MAPS_TOOL, PHOTOS_TOOL, SHORTCUTS_TOOL, SAFARI_TOOL];

export default tools;

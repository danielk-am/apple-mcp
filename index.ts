#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runAppleScript } from "run-applescript";
import tools from "./tools";


// Safe mode implementation - lazy loading of modules
let useEagerLoading = true;
let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
let safeModeFallback = false;

console.error("Starting apple-mcp server...");

// Placeholders for modules - will either be loaded eagerly or lazily
let contacts: typeof import("./utils/contacts").default | null = null;
let notes: typeof import("./utils/notes").default | null = null;
let message: typeof import("./utils/message").default | null = null;
let mail: typeof import("./utils/mail").default | null = null;
let reminders: typeof import("./utils/reminders").default | null = null;

let calendar: typeof import("./utils/calendar").default | null = null;
let maps: typeof import("./utils/maps").default | null = null;
let photos: typeof import("./utils/photos").default | null = null;
let shortcuts: typeof import("./utils/shortcuts").default | null = null;
let safari: typeof import("./utils/safari").default | null = null;

// Type map for module names to their types
type ModuleMap = {
	contacts: typeof import("./utils/contacts").default;
	notes: typeof import("./utils/notes").default;
	message: typeof import("./utils/message").default;
	mail: typeof import("./utils/mail").default;
	reminders: typeof import("./utils/reminders").default;
	calendar: typeof import("./utils/calendar").default;
	maps: typeof import("./utils/maps").default;
	photos: typeof import("./utils/photos").default;
	shortcuts: typeof import("./utils/shortcuts").default;
	safari: typeof import("./utils/safari").default;
};

// Helper function for lazy module loading
async function loadModule<
	T extends
		| "contacts"
		| "notes"
		| "message"
		| "mail"
		| "reminders"
		| "calendar"
		| "maps"
		| "photos"
		| "shortcuts"
		| "safari",
>(moduleName: T): Promise<ModuleMap[T]> {
	if (safeModeFallback) {
		console.error(`Loading ${moduleName} module on demand (safe mode)...`);
	}

	try {
		switch (moduleName) {
			case "contacts":
				if (!contacts) contacts = (await import("./utils/contacts")).default;
				return contacts as ModuleMap[T];
			case "notes":
				if (!notes) notes = (await import("./utils/notes")).default;
				return notes as ModuleMap[T];
			case "message":
				if (!message) message = (await import("./utils/message")).default;
				return message as ModuleMap[T];
			case "mail":
				if (!mail) mail = (await import("./utils/mail")).default;
				return mail as ModuleMap[T];
			case "reminders":
				if (!reminders) reminders = (await import("./utils/reminders")).default;
				return reminders as ModuleMap[T];
			case "calendar":
				if (!calendar) calendar = (await import("./utils/calendar")).default;
				return calendar as ModuleMap[T];
			case "maps":
				if (!maps) maps = (await import("./utils/maps")).default;
				return maps as ModuleMap[T];
			case "photos":
				if (!photos) photos = (await import("./utils/photos")).default;
				return photos as ModuleMap[T];
			case "shortcuts":
				if (!shortcuts) shortcuts = (await import("./utils/shortcuts")).default;
				return shortcuts as ModuleMap[T];
			case "safari":
				if (!safari) safari = (await import("./utils/safari")).default;
				return safari as ModuleMap[T];
			default:
				throw new Error(`Unknown module: ${moduleName}`);
		}
	} catch (e) {
		console.error(`Error loading module ${moduleName}:`, e);
		throw e;
	}
}

// Set a timeout to switch to safe mode if initialization takes too long
loadingTimeout = setTimeout(() => {
	console.error(
		"Loading timeout reached. Switching to safe mode (lazy loading...)",
	);
	useEagerLoading = false;
	safeModeFallback = true;

	// Clear the references to any modules that might be in a bad state
	contacts = null;
	notes = null;
	message = null;
	mail = null;
	reminders = null;
	calendar = null;
	maps = null;
	photos = null;
	shortcuts = null;
	safari = null;

	// Proceed with server setup
	initServer();
}, 5000); // 5 second timeout

// Eager loading attempt
async function attemptEagerLoading() {
	try {
		console.error("Attempting to eagerly load modules...");

		// Try to import all modules
		contacts = (await import("./utils/contacts")).default;
		console.error("- Contacts module loaded successfully");

		notes = (await import("./utils/notes")).default;
		console.error("- Notes module loaded successfully");

		message = (await import("./utils/message")).default;
		console.error("- Message module loaded successfully");

		mail = (await import("./utils/mail")).default;
		console.error("- Mail module loaded successfully");

		reminders = (await import("./utils/reminders")).default;
		console.error("- Reminders module loaded successfully");


		calendar = (await import("./utils/calendar")).default;
		console.error("- Calendar module loaded successfully");

		maps = (await import("./utils/maps")).default;
		console.error("- Maps module loaded successfully");

		photos = (await import("./utils/photos")).default;
		console.error("- Photos module loaded successfully");

		shortcuts = (await import("./utils/shortcuts")).default;
		console.error("- Shortcuts module loaded successfully");

		safari = (await import("./utils/safari")).default;
		console.error("- Safari module loaded successfully");

		// If we get here, clear the timeout and proceed with eager loading
		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}

		console.error("All modules loaded successfully, using eager loading mode");
		initServer();
	} catch (error) {
		console.error("Error during eager loading:", error);
		console.error("Switching to safe mode (lazy loading)...");

		// Clear any timeout if it exists
		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}

		// Switch to safe mode
		useEagerLoading = false;
		safeModeFallback = true;

		// Clear the references to any modules that might be in a bad state
		contacts = null;
		notes = null;
		message = null;
		mail = null;
		reminders = null;
		calendar = null;
		maps = null;
		photos = null;

		// Initialize the server in safe mode
		initServer();
	}
}

// Attempt eager loading first
attemptEagerLoading();

// Main server object
let server: Server;

// Initialize the server and set up handlers
function initServer() {
	console.error(
		`Initializing server in ${safeModeFallback ? "safe" : "standard"} mode...`,
	);

	server = new Server(
		{
			name: "Apple MCP tools",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools,
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		try {
			const { name, arguments: args } = request.params;

			if (!args) {
				throw new Error("No arguments provided");
			}

			switch (name) {
				case "contacts": {
					if (!isContactsArgs(args)) {
						throw new Error("Invalid arguments for contacts tool");
					}

					try {
						const contactsModule = await loadModule("contacts");

						if (args.name) {
							const numbers = await contactsModule.findNumber(args.name);
							return {
								content: [
									{
										type: "text",
										text: numbers.length
											? `${args.name}: ${numbers.join(", ")}`
											: `No contact found for "${args.name}". Try a different name or use no name parameter to list all contacts.`,
									},
								],
								isError: false,
							};
						} else {
							const allNumbers = await contactsModule.getAllNumbers();
							const contactCount = Object.keys(allNumbers).length;

							if (contactCount === 0) {
								return {
									content: [
										{
											type: "text",
											text: "No contacts found in the address book. Please make sure you have granted access to Contacts.",
										},
									],
									isError: false,
								};
							}

							const formattedContacts = Object.entries(allNumbers)
								.filter(([_, phones]) => phones.length > 0)
								.map(([name, phones]) => `${name}: ${phones.join(", ")}`);

							return {
								content: [
									{
										type: "text",
										text:
											formattedContacts.length > 0
												? `Found ${contactCount} contacts:\n\n${formattedContacts.join("\n")}`
												: "Found contacts but none have phone numbers. Try searching by name to see more details.",
									},
								],
								isError: false,
							};
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error accessing contacts: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "notes": {
					if (!isNotesArgs(args)) {
						throw new Error("Invalid arguments for notes tool");
					}

					try {
						const notesModule = await loadModule("notes");
						const { operation } = args;
						const formatNoteLine = (n: { name: string; folder?: string; account?: string; modificationDate?: string; content: string }) => {
							const meta: string[] = [];
							if (n.folder) meta.push(n.folder);
							if (n.account) meta.push(n.account);
							if (n.modificationDate) meta.push(n.modificationDate);
							const head = meta.length ? `${n.name}  [${meta.join(" · ")}]` : n.name;
							return `${head}\n${n.content}`;
						};

						switch (operation) {
							case "search": {
								if (!args.searchText) {
									throw new Error("Search text is required for search operation");
								}
								const found = await notesModule.findNote(args.searchText, {
									limit: args.limit,
									contentPreview: args.contentPreview,
									account: args.account,
								});
								return {
									content: [
										{
											type: "text",
											text: found.length
												? `Found ${found.length} note(s) matching "${args.searchText}":\n\n${found.map(formatNoteLine).join("\n\n")}`
												: `No notes found for "${args.searchText}".`,
										},
									],
									notes: found,
									isError: false,
								};
							}

							case "list": {
								const all = await notesModule.getAllNotes({
									limit: args.limit,
									contentPreview: args.contentPreview,
									account: args.account,
								});
								return {
									content: [
										{
											type: "text",
											text: all.length
												? `Retrieved ${all.length} note(s):\n\n${all.map(formatNoteLine).join("\n\n")}`
												: "No notes found.",
										},
									],
									notes: all,
									isError: false,
								};
							}

							case "listFolders": {
								const folders = await notesModule.listFolders({ account: args.account });
								return {
									content: [
										{
											type: "text",
											text: folders.length
												? `Found ${folders.length} folder(s):\n\n${folders.map((f) => `${f.parent ? `${f.parent} / ` : ""}${f.name}  [${f.account}]  (${f.noteCount})`).join("\n")}`
												: "No folders found.",
										},
									],
									folders,
									isError: false,
								};
							}

							case "listFromFolder": {
								if (!args.folderName) {
									throw new Error("folderName is required for listFromFolder operation");
								}
								const res = await notesModule.listFromFolder({
									folderName: args.folderName,
									account: args.account,
									limit: args.limit,
									contentPreview: args.contentPreview,
								});
								if (!res.success) {
									return {
										content: [{ type: "text", text: res.message ?? "Folder not found." }],
										isError: true,
									};
								}
								return {
									content: [
										{
											type: "text",
											text: res.notes.length
												? `Found ${res.notes.length} note(s) in "${args.folderName}":\n\n${res.notes.map(formatNoteLine).join("\n\n")}`
												: `Folder "${args.folderName}" is empty.`,
										},
									],
									notes: res.notes,
									isError: false,
								};
							}

							case "create": {
								if (!args.title || !args.body) {
									throw new Error("Title and body are required for create operation");
								}
								const result = await notesModule.createNote(
									args.title,
									args.body,
									args.folderName,
								);
								return {
									content: [
										{
											type: "text",
											text: result.success
												? `Created note "${args.title}" in folder "${result.folderName}"${result.usedDefaultFolder ? " (created new folder)" : ""}.`
												: `Failed to create note: ${result.message}`,
										},
									],
									isError: !result.success,
								};
							}

							default:
								throw new Error(`Unknown operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error accessing notes: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "messages": {
					if (!isMessagesArgs(args)) {
						throw new Error("Invalid arguments for messages tool");
					}

					try {
						const messageModule = await loadModule("message");

						switch (args.operation) {
							case "send": {
								if (!args.phoneNumber || !args.message) {
									throw new Error(
										"Phone number and message are required for send operation",
									);
								}
								await messageModule.sendMessage(args.phoneNumber, args.message);
								return {
									content: [
										{
											type: "text",
											text: `Message sent to ${args.phoneNumber}`,
										},
									],
									isError: false,
								};
							}

							case "read": {
								if (!args.phoneNumber) {
									throw new Error(
										"Phone number is required for read operation",
									);
								}
								const messages = await messageModule.readMessages(
									args.phoneNumber,
									args.limit,
								);
								return {
									content: [
										{
											type: "text",
											text:
												messages.length > 0
													? messages
															.map(
																(msg) =>
																	`[${new Date(msg.date).toLocaleString()}] ${msg.is_from_me ? "Me" : msg.sender}: ${msg.content}`,
															)
															.join("\n")
													: "No messages found",
										},
									],
									isError: false,
								};
							}

							case "schedule": {
								if (!args.phoneNumber || !args.message || !args.scheduledTime) {
									throw new Error(
										"Phone number, message, and scheduled time are required for schedule operation",
									);
								}
								const scheduledMsg = await messageModule.scheduleMessage(
									args.phoneNumber,
									args.message,
									new Date(args.scheduledTime),
								);
								return {
									content: [
										{
											type: "text",
											text: `Message scheduled to be sent to ${args.phoneNumber} at ${scheduledMsg.scheduledTime}`,
										},
									],
									isError: false,
								};
							}

							case "unread": {
								const messages = await messageModule.getUnreadMessages(
									args.limit,
								);

								// Look up contact names for all messages
								const contactsModule = await loadModule("contacts");
								const messagesWithNames = await Promise.all(
									messages.map(async (msg) => {
										// Only look up names for messages not from me
										if (!msg.is_from_me) {
											const contactName =
												await contactsModule.findContactByPhone(msg.sender);
											return {
												...msg,
												displayName: contactName || msg.sender, // Use contact name if found, otherwise use phone/email
											};
										}
										return {
											...msg,
											displayName: "Me",
										};
									}),
								);

								return {
									content: [
										{
											type: "text",
											text:
												messagesWithNames.length > 0
													? `Found ${messagesWithNames.length} unread message(s):\n` +
														messagesWithNames
															.map(
																(msg) =>
																	`[${new Date(msg.date).toLocaleString()}] From ${msg.displayName}:\n${msg.content}`,
															)
															.join("\n\n")
													: "No unread messages found",
										},
									],
									isError: false,
								};
							}

							default:
								throw new Error(`Unknown operation: ${args.operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error with messages operation: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "mail": {
					if (!isMailArgs(args)) {
						throw new Error("Invalid arguments for mail tool");
					}

					try {
						const mailModule = await loadModule("mail");

						switch (args.operation) {
							case "unread": {
								// If an account is specified, we'll try to search specifically in that account
								let emails;
								if (args.account) {
									console.error(
										`Getting unread emails for account: ${args.account}`,
									);
									// Use AppleScript to get unread emails from specific account
									const script = `
tell application "Mail"
    set resultList to {}
    try
        set targetAccount to first account whose name is "${args.account.replace(/"/g, '\\"')}"

        -- Get mailboxes for this account
        set acctMailboxes to every mailbox of targetAccount

        -- If mailbox is specified, only search in that mailbox
        set mailboxesToSearch to acctMailboxes
        ${
					args.mailbox
						? `
        set mailboxesToSearch to {}
        repeat with mb in acctMailboxes
            if name of mb is "${args.mailbox.replace(/"/g, '\\"')}" then
                set mailboxesToSearch to {mb}
                exit repeat
            end if
        end repeat
        `
						: ""
				}

        -- Search specified mailboxes
        repeat with mb in mailboxesToSearch
            try
                set unreadMessages to (messages of mb whose read status is false)
                if (count of unreadMessages) > 0 then
                    set msgLimit to ${args.limit || 10}
                    if (count of unreadMessages) < msgLimit then
                        set msgLimit to (count of unreadMessages)
                    end if

                    repeat with i from 1 to msgLimit
                        try
                            set currentMsg to item i of unreadMessages
                            set msgData to {subject:(subject of currentMsg), sender:(sender of currentMsg), ¬
                                        date:(date sent of currentMsg) as string, mailbox:(name of mb)}

                            -- Try to get content if possible
                            try
                                set msgContent to content of currentMsg
                                if length of msgContent > 500 then
                                    set msgContent to (text 1 thru 500 of msgContent) & "..."
                                end if
                                set msgData to msgData & {content:msgContent}
                            on error
                                set msgData to msgData & {content:"[Content not available]"}
                            end try

                            set end of resultList to msgData
                        on error
                            -- Skip problematic messages
                        end try
                    end repeat

                    if (count of resultList) ≥ ${args.limit || 10} then exit repeat
                end if
            on error
                -- Skip problematic mailboxes
            end try
        end repeat
    on error errMsg
        return "Error: " & errMsg
    end try

    return resultList
end tell`;

									try {
										const asResult = await runAppleScript(script);
										if (asResult && asResult.startsWith("Error:")) {
											throw new Error(asResult);
										}

										// Parse the results - similar to general getUnreadMails
										const emailData = [];
										const matches = asResult.match(/\{([^}]+)\}/g);
										if (matches && matches.length > 0) {
											for (const match of matches) {
												try {
													const props = match
														.substring(1, match.length - 1)
														.split(",");
													const email: any = {};

													props.forEach((prop) => {
														const parts = prop.split(":");
														if (parts.length >= 2) {
															const key = parts[0].trim();
															const value = parts.slice(1).join(":").trim();
															email[key] = value;
														}
													});

													if (email.subject || email.sender) {
														emailData.push({
															subject: email.subject || "No subject",
															sender: email.sender || "Unknown sender",
															dateSent: email.date || new Date().toString(),
															content:
																email.content || "[Content not available]",
															isRead: false,
															mailbox: `${args.account} - ${email.mailbox || "Unknown"}`,
														});
													}
												} catch (parseError) {
													console.error(
														"Error parsing email match:",
														parseError,
													);
												}
											}
										}

										emails = emailData;
									} catch (error) {
										console.error(
											"Error getting account-specific emails:",
											error,
										);
										// Fallback to general method if specific account fails
										emails = await mailModule.getUnreadMails(args.limit);
									}
								} else {
									// No account specified, use the general method
									emails = await mailModule.getUnreadMails(args.limit);
								}

								return {
									content: [
										{
											type: "text",
											text:
												emails.length > 0
													? `Found ${emails.length} unread email(s)${args.account ? ` in account "${args.account}"` : ""}${args.mailbox ? ` and mailbox "${args.mailbox}"` : ""}:\n\n` +
														emails
															.map(
																(email: any) =>
																	`[${email.dateSent}] From: ${email.sender}\nMailbox: ${email.mailbox}\nSubject: ${email.subject}\n${email.content.substring(0, 500)}${email.content.length > 500 ? "..." : ""}`,
															)
															.join("\n\n")
													: `No unread emails found${args.account ? ` in account "${args.account}"` : ""}${args.mailbox ? ` and mailbox "${args.mailbox}"` : ""}`,
										},
									],
									isError: false,
								};
							}

							case "search": {
								if (!args.searchTerm) {
									throw new Error(
										"Search term is required for search operation",
									);
								}
								const emails = await mailModule.searchMails(
									args.searchTerm,
									args.limit,
								);
								return {
									content: [
										{
											type: "text",
											text:
												emails.length > 0
													? `Found ${emails.length} email(s) for "${args.searchTerm}"${args.account ? ` in account "${args.account}"` : ""}${args.mailbox ? ` and mailbox "${args.mailbox}"` : ""}:\n\n` +
														emails
															.map(
																(email: any) =>
																	`[${email.dateSent}] From: ${email.sender}\nMailbox: ${email.mailbox}\nSubject: ${email.subject}\n${email.content.substring(0, 200)}${email.content.length > 200 ? "..." : ""}`,
															)
															.join("\n\n")
													: `No emails found for "${args.searchTerm}"${args.account ? ` in account "${args.account}"` : ""}${args.mailbox ? ` and mailbox "${args.mailbox}"` : ""}`,
										},
									],
									isError: false,
								};
							}

							case "send": {
								if (!args.to || !args.subject || !args.body) {
									throw new Error(
										"Recipient (to), subject, and body are required for send operation",
									);
								}
								const result = await mailModule.sendMail(
									args.to,
									args.subject,
									args.body,
									args.cc,
									args.bcc,
								);
								return {
									content: [{ type: "text", text: result }],
									isError: false,
								};
							}

							case "mailboxes": {
								if (args.account) {
									const mailboxes = await mailModule.getMailboxesForAccount(
										args.account,
									);
									return {
										content: [
											{
												type: "text",
												text:
													mailboxes.length > 0
														? `Found ${mailboxes.length} mailboxes for account "${args.account}":\n\n${mailboxes.join("\n")}`
														: `No mailboxes found for account "${args.account}". Make sure the account name is correct.`,
											},
										],
										isError: false,
									};
								} else {
									const mailboxes = await mailModule.getMailboxes();
									return {
										content: [
											{
												type: "text",
												text:
													mailboxes.length > 0
														? `Found ${mailboxes.length} mailboxes:\n\n${mailboxes.join("\n")}`
														: "No mailboxes found. Make sure Mail app is running and properly configured.",
											},
										],
										isError: false,
									};
								}
							}

							case "accounts": {
								const accounts = await mailModule.getAccounts();
								return {
									content: [
										{
											type: "text",
											text:
												accounts.length > 0
													? `Found ${accounts.length} email accounts:\n\n${accounts.join("\n")}`
													: "No email accounts found. Make sure Mail app is configured with at least one account.",
										},
									],
									isError: false,
								};
							}

							case "latest": {
								let account = args.account;
								if (!account) {
									const accounts = await mailModule.getAccounts();
									if (accounts.length === 0) {
										throw new Error(
											"No email accounts found. Make sure Mail app is configured with at least one account.",
										);
									}
									account = accounts[0]; // Use the first account if not provided
								}
								const emails = await mailModule.getLatestMails(
									account,
									args.limit,
								);
								return {
									content: [
										{
											type: "text",
											text:
												emails.length > 0
													? `Found ${emails.length} latest email(s) in account "${account}":\n\n` +
														emails
															.map(
																(email: any) =>
																	`[${email.dateSent}] From: ${email.sender}\nMailbox: ${email.mailbox}\nSubject: ${email.subject}\n${email.content.substring(0, 500)}${email.content.length > 500 ? "..." : ""}`,
															)
															.join("\n\n")
													: `No latest emails found in account "${account}"`,
										},
									],
									isError: false,
								};
							}

							default:
								throw new Error(`Unknown operation: ${args.operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error with mail operation: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "reminders": {
					if (!isRemindersArgs(args)) {
						throw new Error("Invalid arguments for reminders tool");
					}

					try {
						const remindersModule = await loadModule("reminders");

						const { operation } = args;

							if (operation === "list") {
								const lists = await remindersModule.getAllLists();
								const allReminders = await remindersModule.getAllReminders(args.listName);
								const summary = args.listName
									? `${allReminders.length} incomplete reminder(s) in list "${args.listName}"`
									: `${lists.length} list(s), ${allReminders.length} incomplete reminder(s) across all lists`;
								const grouped = new Map<string, typeof allReminders>();
								for (const r of allReminders) {
									const key = r.listName || "(no list)";
									const arr = grouped.get(key) ?? [];
									arr.push(r);
									grouped.set(key, arr);
								}
								const lines: string[] = [];
								for (const [listName, items] of grouped) {
									lines.push(`\n## ${listName} (${items.length})`);
									for (const r of items.slice(0, 20)) {
										const due = r.dueDate ? `  due ${r.dueDate}` : "";
										lines.push(`  - ${r.name}${due}`);
									}
									if (items.length > 20) lines.push(`  ... and ${items.length - 20} more`);
								}
								return {
									content: [{ type: "text", text: `${summary}.${lines.join("\n")}` }],
									lists,
									reminders: allReminders,
									isError: false,
								};
							} else if (operation === "search") {
							// Search for reminders
							const { searchText } = args;
							const results = await remindersModule.searchReminders(
								searchText!,
							);
							return {
								content: [
									{
										type: "text",
										text:
											results.length > 0
												? `Found ${results.length} reminders matching "${searchText}".`
												: `No reminders found matching "${searchText}".`,
									},
								],
								reminders: results,
								isError: false,
							};
						} else if (operation === "open") {
							// Open a reminder
							const { searchText } = args;
							const result = await remindersModule.openReminder(searchText!);
							return {
								content: [
									{
										type: "text",
										text: result.success
											? `Opened Reminders app. Found reminder: ${result.reminder?.name}`
											: result.message,
									},
								],
								...result,
								isError: !result.success,
							};
						} else if (operation === "create") {
							// Create a reminder
							const { name, listName, notes, dueDate } = args;
							const result = await remindersModule.createReminder(
								name!,
								listName,
								notes,
								dueDate,
							);
							return {
								content: [
									{
										type: "text",
										text: `Created reminder "${result.name}" ${listName ? `in list "${listName}"` : ""}.`,
									},
								],
								success: true,
								reminder: result,
								isError: false,
							};
						} else if (operation === "listById") {
							// Get reminders from a specific list by ID
							const { listId, props } = args;
							const results = await remindersModule.getRemindersFromListById(
								listId!,
								props,
							);
							return {
								content: [
									{
										type: "text",
										text:
											results.length > 0
												? `Found ${results.length} reminders in list with ID "${listId}".`
												: `No reminders found in list with ID "${listId}".`,
									},
								],
								reminders: results,
								isError: false,
							};
						}

						return {
							content: [
								{
									type: "text",
									text: "Unknown operation",
								},
							],
							isError: true,
						};
					} catch (error) {
						console.error("Error in reminders tool:", error);
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error in reminders tool: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}


				case "calendar": {
					if (!isCalendarArgs(args)) {
						throw new Error("Invalid arguments for calendar tool");
					}

					try {
						const calendarModule = await loadModule("calendar");
						const { operation } = args;

						switch (operation) {
							case "search": {
								const { searchText, limit, fromDate, toDate } = args;
								const events = await calendarModule.searchEvents(
									searchText!,
									limit,
									fromDate,
									toDate,
								);

								return {
									content: [
										{
											type: "text",
											text:
												events.length > 0
													? `Found ${events.length} events matching "${searchText}":\n\n${events
															.map(
																(event) =>
																	`${event.title} (${new Date(event.startDate!).toLocaleString()} - ${new Date(event.endDate!).toLocaleString()})\n` +
																	`Location: ${event.location || "Not specified"}\n` +
																	`Calendar: ${event.calendarName}\n` +
																	`ID: ${event.id}\n` +
																	`${event.notes ? `Notes: ${event.notes}\n` : ""}`,
															)
															.join("\n\n")}`
													: `No events found matching "${searchText}".`,
										},
									],
									isError: false,
								};
							}

							case "open": {
								const { eventId } = args;
								const result = await calendarModule.openEvent(eventId!);

								return {
									content: [
										{
											type: "text",
											text: result.success
												? result.message
												: `Error opening event: ${result.message}`,
										},
									],
									isError: !result.success,
								};
							}

							case "list": {
								const { limit, fromDate, toDate } = args;
								const events = await calendarModule.getEvents(
									limit,
									fromDate,
									toDate,
								);

								const startDateText = fromDate
									? new Date(fromDate).toLocaleDateString()
									: "today";
								const endDateText = toDate
									? new Date(toDate).toLocaleDateString()
									: "next 7 days";

								return {
									content: [
										{
											type: "text",
											text:
												events.length > 0
													? `Found ${events.length} events from ${startDateText} to ${endDateText}:\n\n${events
															.map(
																(event) =>
																	`${event.title} (${new Date(event.startDate!).toLocaleString()} - ${new Date(event.endDate!).toLocaleString()})\n` +
																	`Location: ${event.location || "Not specified"}\n` +
																	`Calendar: ${event.calendarName}\n` +
																	`ID: ${event.id}`,
															)
															.join("\n\n")}`
													: `No events found from ${startDateText} to ${endDateText}.`,
										},
									],
									isError: false,
								};
							}

							case "create": {
								const {
									title,
									startDate,
									endDate,
									location,
									notes,
									isAllDay,
									calendarName,
								} = args;
								const result = await calendarModule.createEvent(
									title!,
									startDate!,
									endDate!,
									location,
									notes,
									isAllDay,
									calendarName,
								);
								return {
									content: [
										{
											type: "text",
											text: result.success
												? `${result.message} Event scheduled from ${new Date(startDate!).toLocaleString()} to ${new Date(endDate!).toLocaleString()}${result.eventId ? `\nEvent ID: ${result.eventId}` : ""}`
												: `Error creating event: ${result.message}`,
										},
									],
									isError: !result.success,
								};
							}

							default:
								throw new Error(`Unknown calendar operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error in calendar tool: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "maps": {
					if (!isMapsArgs(args)) {
						throw new Error("Invalid arguments for maps tool");
					}

					try {
						const mapsModule = await loadModule("maps");
						const { operation } = args;

						switch (operation) {
							case "search": {
								const { query, limit } = args;
								if (!query) {
									throw new Error(
										"Search query is required for search operation",
									);
								}

								const result = await mapsModule.searchLocations(query, limit);

								return {
									content: [
										{
											type: "text",
											text: result.success
												? `${result.message}\n\n${result.locations
														.map(
															(location) =>
																`Name: ${location.name}\n` +
																`Address: ${location.address}\n` +
																`${location.latitude && location.longitude ? `Coordinates: ${location.latitude}, ${location.longitude}\n` : ""}`,
														)
														.join("\n\n")}`
												: `${result.message}`,
										},
									],
									isError: !result.success,
								};
							}

							case "save": {
								const { name, address } = args;
								if (!name || !address) {
									throw new Error(
										"Name and address are required for save operation",
									);
								}

								const result = await mapsModule.saveLocation(name, address);

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							case "pin": {
								const { name, address } = args;
								if (!name || !address) {
									throw new Error(
										"Name and address are required for pin operation",
									);
								}

								const result = await mapsModule.dropPin(name, address);

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							case "directions": {
								const { fromAddress, toAddress, transportType } = args;
								if (!fromAddress || !toAddress) {
									throw new Error(
										"From and to addresses are required for directions operation",
									);
								}

								const result = await mapsModule.getDirections(
									fromAddress,
									toAddress,
									transportType as "driving" | "walking" | "transit",
								);

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							case "listGuides": {
								const result = await mapsModule.listGuides();

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							case "addToGuide": {
								const { address, guideName } = args;
								if (!address || !guideName) {
									throw new Error(
										"Address and guideName are required for addToGuide operation",
									);
								}

								const result = await mapsModule.addToGuide(address, guideName);

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							case "createGuide": {
								const { guideName } = args;
								if (!guideName) {
									throw new Error(
										"Guide name is required for createGuide operation",
									);
								}

								const result = await mapsModule.createGuide(guideName);

								return {
									content: [
										{
											type: "text",
											text: result.message,
										},
									],
									isError: !result.success,
								};
							}

							default:
								throw new Error(`Unknown maps operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error in maps tool: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "photos": {
					if (!isPhotosArgs(args)) {
						throw new Error("Invalid arguments for photos tool");
					}

					try {
						const photosModule = await loadModule("photos");
						const { operation } = args;

						switch (operation) {
							case "listAlbums": {
								const albums = await photosModule.listAlbums();
								return {
									content: [
										{
											type: "text",
											text:
												albums.length > 0
													? `Found ${albums.length} album(s):\n\n${albums.map((a) => `${a.name} (${a.count} photo${a.count === 1 ? "" : "s"})`).join("\n")}`
													: "No albums found in Photos.",
										},
									],
									albums,
									isError: false,
								};
							}

							case "getAlbum": {
								if (!args.albumName) {
									throw new Error("albumName is required for getAlbum operation");
								}
								const photos = await photosModule.getAlbum(args.albumName, args.limit);
								return {
									content: [
										{
											type: "text",
											text:
												photos.length > 0
													? `Found ${photos.length} photo(s) in "${args.albumName}":\n\n${photos.map((p) => `${p.filename} — ${p.date}${p.description ? ` — ${p.description}` : ""}${p.favorite ? " ★" : ""}`).join("\n")}`
													: `No photos found in album "${args.albumName}".`,
										},
									],
									photos,
									isError: false,
								};
							}

							case "getFavorites": {
								const photos = await photosModule.getFavorites(args.limit);
								return {
									content: [
										{
											type: "text",
											text:
												photos.length > 0
													? `Found ${photos.length} favorite photo(s):\n\n${photos.map((p) => `${p.filename} — ${p.date}${p.description ? ` — ${p.description}` : ""}`).join("\n")}`
													: "No favorite photos found.",
										},
									],
									photos,
									isError: false,
								};
							}

							case "getRecent": {
								const photos = await photosModule.getRecent(args.limit);
								return {
									content: [
										{
											type: "text",
											text:
												photos.length > 0
													? `Found ${photos.length} recent photo(s):\n\n${photos.map((p) => `${p.filename} — ${p.date}${p.description ? ` — ${p.description}` : ""}${p.favorite ? " ★" : ""}`).join("\n")}`
													: "No recent photos found.",
										},
									],
									photos,
									isError: false,
								};
							}

							case "search": {
								if (!args.searchText) {
									throw new Error("searchText is required for search operation");
								}
								const result = await photosModule.search(args.searchText);
								return {
									content: [{ type: "text", text: result.message }],
									isError: !result.success,
								};
							}

							case "open": {
								const result = await photosModule.open(args.albumName);
								return {
									content: [{ type: "text", text: result.message }],
									isError: !result.success,
								};
							}

							default:
								throw new Error(`Unknown photos operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{
									type: "text",
									text: errorMessage.includes("access") ? errorMessage : `Error in photos tool: ${errorMessage}`,
								},
							],
							isError: true,
						};
					}
				}

				case "shortcuts": {
					if (!isShortcutsArgs(args)) {
						throw new Error("Invalid arguments for shortcuts tool");
					}

					try {
						const mod = await loadModule("shortcuts");
						const { operation } = args;

						switch (operation) {
							case "list": {
								const { shortcuts: list } = await mod.list({
									folder: args.folder,
									showIdentifiers: args.showIdentifiers,
								});
								const text = list.length === 0
									? args.folder
										? `No shortcuts found in folder "${args.folder}".`
										: "No shortcuts found."
									: `Found ${list.length} shortcut(s):\n\n${list
										.map((s) => (s.id ? `${s.name} (${s.id})` : s.name))
										.join("\n")}`;
								return {
									content: [{ type: "text", text }],
									shortcuts: list,
									isError: false,
								};
							}
							case "listFolders": {
								const { folders } = await mod.listFolders();
								return {
									content: [
										{
											type: "text",
											text: folders.length === 0
												? "No shortcut folders found."
												: `Found ${folders.length} folder(s):\n\n${folders.join("\n")}`,
										},
									],
									folders,
									isError: false,
								};
							}
							case "run": {
								if (!args.name) {
									throw new Error("name is required for run operation");
								}
								const res = await mod.run({
									name: args.name,
									input: args.input,
									captureOutput: args.captureOutput,
									timeoutMs: args.timeoutMs,
								});
								if (!res.success) {
									const detail = res.timedOut
										? "timed out"
										: res.error.trim() || `exit code ${res.exitCode}`;
									return {
										content: [
											{
												type: "text",
												text: `Shortcut "${args.name}" failed: ${detail}${res.output ? `\n\nPartial output:\n${res.output}` : ""}`,
											},
										],
										isError: true,
									};
								}
								return {
									content: [
										{
											type: "text",
											text: res.output.length > 0
												? `Shortcut "${args.name}" ran successfully.\n\nOutput:\n${res.output}`
												: `Shortcut "${args.name}" ran successfully (no output).`,
										},
									],
									output: res.output,
									isError: false,
								};
							}
							case "open": {
								if (!args.name) {
									throw new Error("name is required for open operation");
								}
								const res = await mod.open(args.name);
								return {
									content: [{ type: "text", text: res.message }],
									isError: !res.success,
								};
							}
							default:
								throw new Error(`Unknown shortcuts operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{ type: "text", text: `Error in shortcuts tool: ${errorMessage}` },
							],
							isError: true,
						};
					}
				}

				case "safari": {
					if (!isSafariArgs(args)) {
						throw new Error("Invalid arguments for safari tool");
					}

					try {
						const mod = await loadModule("safari");
						const { operation } = args;

						switch (operation) {
							case "listTabs": {
								const tabs = await mod.listTabs();
								return {
									content: [
										{
											type: "text",
											text: tabs.length === 0
												? "No Safari tabs open."
												: `Found ${tabs.length} tab(s):\n\n${tabs.map((t) => `[w${t.windowIndex} t${t.tabIndex}${t.active ? " *" : ""}] ${t.title} — ${t.url}`).join("\n")}`,
										},
									],
									tabs,
									isError: false,
								};
							}
							case "currentTab": {
								const tab = await mod.currentTab();
								return {
									content: [
										{
											type: "text",
											text: tab
												? `Current tab: ${tab.title} — ${tab.url}`
												: "No current tab.",
										},
									],
									tab,
									isError: false,
								};
							}
							case "openUrl": {
								if (!args.url) {
									throw new Error("url is required for openUrl operation");
								}
								const res = await mod.openUrl({
									url: args.url,
									where: args.where,
									background: args.background,
								});
								return {
									content: [{ type: "text", text: res.message }],
									isError: !res.success,
								};
							}
							case "closeTab": {
								const res = await mod.closeTab({
									windowIndex: args.windowIndex,
									tabIndex: args.tabIndex,
									urlMatch: args.urlMatch,
								});
								return {
									content: [{ type: "text", text: res.message }],
									closed: res.closed,
									isError: !res.success,
								};
							}
							case "activateTab": {
								const res = await mod.activateTab({
									windowIndex: args.windowIndex,
									tabIndex: args.tabIndex,
									urlMatch: args.urlMatch,
								});
								return {
									content: [{ type: "text", text: res.message }],
									isError: !res.success,
								};
							}
							case "runJs": {
								if (!args.js) {
									throw new Error("js is required for runJs operation");
								}
								const res = await mod.runJs({
									js: args.js,
									windowIndex: args.windowIndex,
									tabIndex: args.tabIndex,
								});
								return {
									content: [
										{
											type: "text",
											text: res.success
												? res.result || "(empty)"
												: `runJs failed: ${res.message}`,
										},
									],
									result: res.result,
									isError: !res.success,
								};
							}
							case "bookmarks": {
								const items = await mod.bookmarks({
									folder: args.folder,
									searchText: args.searchText,
								});
								return {
									content: [
										{
											type: "text",
											text: items.length === 0
												? "No bookmarks matched."
												: `Found ${items.length} bookmark(s):\n\n${items.map((b) => `[${b.folder || "—"}] ${b.title} — ${b.url}`).join("\n")}`,
										},
									],
									bookmarks: items,
									isError: false,
								};
							}
							case "readingList": {
								const items = await mod.readingList({
									unreadOnly: args.unreadOnly,
								});
								return {
									content: [
										{
											type: "text",
											text: items.length === 0
												? args.unreadOnly
													? "No unread Reading List items."
													: "Reading List is empty."
												: `Found ${items.length} Reading List item(s):\n\n${items.map((r) => `${r.read ? "  " : "● "}${r.title} — ${r.url}${r.previewText ? `\n    ${r.previewText.slice(0, 120)}` : ""}`).join("\n")}`,
										},
									],
									readingList: items,
									isError: false,
								};
							}
							case "history": {
								const items = await mod.history({
									searchText: args.searchText,
									limit: args.limit,
									sinceDays: args.sinceDays,
								});
								return {
									content: [
										{
											type: "text",
											text: items.length === 0
												? "No history entries matched."
												: `Found ${items.length} history entr(y/ies):\n\n${items.map((h) => `${h.visitTime} — ${h.title} — ${h.url}`).join("\n")}`,
										},
									],
									history: items,
									isError: false,
								};
							}
							default:
								throw new Error(`Unknown safari operation: ${operation}`);
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						return {
							content: [
								{ type: "text", text: `Error in safari tool: ${errorMessage}` },
							],
							isError: true,
						};
					}
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown tool: ${name}` }],
						isError: true,
					};
			}
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			};
		}
	});

	// Start the server transport
	console.error("Setting up MCP server transport...");

	(async () => {
		try {
			console.error("Initializing transport...");
			const transport = new StdioServerTransport();

			// Ensure stdout is only used for JSON messages
			console.error("Setting up stdout filter...");
			const originalStdoutWrite = process.stdout.write.bind(process.stdout);
			process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
				// Only allow JSON messages to pass through
				if (typeof chunk === "string" && !chunk.startsWith("{")) {
					console.error("Filtering non-JSON stdout message");
					return true; // Silently skip non-JSON messages
				}
				return originalStdoutWrite(chunk, encoding, callback);
			};

			console.error("Connecting transport to server...");
			await server.connect(transport);
			console.error("Server connected successfully!");
		} catch (error) {
			console.error("Failed to initialize MCP server:", error);
			process.exit(1);
		}
	})();
}

// Helper functions for argument type checking
function isContactsArgs(args: unknown): args is { name?: string } {
	return (
		typeof args === "object" &&
		args !== null &&
		(!("name" in args) || typeof (args as { name: string }).name === "string")
	);
}

function isNotesArgs(args: unknown): args is {
	operation: "search" | "list" | "listFolders" | "listFromFolder" | "create";
	searchText?: string;
	title?: string;
	body?: string;
	folderName?: string;
	account?: string;
	limit?: number;
	contentPreview?: number;
} {
	if (typeof args !== "object" || args === null) return false;
	const a = args as Record<string, unknown>;

	if (typeof a.operation !== "string") return false;
	if (!["search", "list", "listFolders", "listFromFolder", "create"].includes(a.operation))
		return false;

	if (a.operation === "search") {
		if (typeof a.searchText !== "string" || a.searchText === "") return false;
	}
	if (a.operation === "listFromFolder") {
		if (typeof a.folderName !== "string" || a.folderName === "") return false;
	}
	if (a.operation === "create") {
		if (typeof a.title !== "string" || a.title === "" || typeof a.body !== "string")
			return false;
		if (a.folderName !== undefined && (typeof a.folderName !== "string" || a.folderName === ""))
			return false;
	}
	if (a.account !== undefined && typeof a.account !== "string") return false;
	if (a.limit !== undefined && typeof a.limit !== "number") return false;
	if (a.contentPreview !== undefined && typeof a.contentPreview !== "number") return false;
	return true;
}

function isMessagesArgs(args: unknown): args is {
	operation: "send" | "read" | "schedule" | "unread";
	phoneNumber?: string;
	message?: string;
	limit?: number;
	scheduledTime?: string;
} {
	if (typeof args !== "object" || args === null) return false;

	const { operation, phoneNumber, message, limit, scheduledTime } = args as any;

	if (
		!operation ||
		!["send", "read", "schedule", "unread"].includes(operation)
	) {
		return false;
	}

	// Validate required fields based on operation
	switch (operation) {
		case "send":
		case "schedule":
			if (!phoneNumber || !message) return false;
			if (operation === "schedule" && !scheduledTime) return false;
			break;
		case "read":
			if (!phoneNumber) return false;
			break;
		case "unread":
			// No additional required fields
			break;
	}

	// Validate field types if present
	if (phoneNumber && typeof phoneNumber !== "string") return false;
	if (message && typeof message !== "string") return false;
	if (limit && typeof limit !== "number") return false;
	if (scheduledTime && typeof scheduledTime !== "string") return false;

	return true;
}

function isMailArgs(args: unknown): args is {
	operation: "unread" | "search" | "send" | "mailboxes" | "accounts" | "latest";
	account?: string;
	mailbox?: string;
	limit?: number;
	searchTerm?: string;
	to?: string;
	subject?: string;
	body?: string;
	cc?: string;
	bcc?: string;
} {
	if (typeof args !== "object" || args === null) return false;

	const {
		operation,
		account,
		mailbox,
		limit,
		searchTerm,
		to,
		subject,
		body,
		cc,
		bcc,
	} = args as any;

	if (
		!operation ||
		!["unread", "search", "send", "mailboxes", "accounts", "latest"].includes(
			operation,
		)
	) {
		return false;
	}

	// Validate required fields based on operation
	switch (operation) {
		case "search":
			if (!searchTerm || typeof searchTerm !== "string") return false;
			break;
		case "send":
			if (
				!to ||
				typeof to !== "string" ||
				!subject ||
				typeof subject !== "string" ||
				!body ||
				typeof body !== "string"
			)
				return false;
			break;
		case "unread":
		case "mailboxes":
		case "accounts":
		case "latest":
			// No additional required fields
			break;
	}

	// Validate field types if present
	if (account && typeof account !== "string") return false;
	if (mailbox && typeof mailbox !== "string") return false;
	if (limit && typeof limit !== "number") return false;
	if (cc && typeof cc !== "string") return false;
	if (bcc && typeof bcc !== "string") return false;

	return true;
}

function isRemindersArgs(args: unknown): args is {
	operation: "list" | "search" | "open" | "create" | "listById";
	searchText?: string;
	name?: string;
	listName?: string;
	listId?: string;
	props?: string[];
	notes?: string;
	dueDate?: string;
} {
	if (typeof args !== "object" || args === null) {
		return false;
	}

	const { operation } = args as any;
	if (typeof operation !== "string") {
		return false;
	}

	if (!["list", "search", "open", "create", "listById"].includes(operation)) {
		return false;
	}

	// For search and open operations, searchText is required
	if (
		(operation === "search" || operation === "open") &&
		(typeof (args as any).searchText !== "string" ||
			(args as any).searchText === "")
	) {
		return false;
	}

	// For create operation, name is required
	if (
		operation === "create" &&
		(typeof (args as any).name !== "string" || (args as any).name === "")
	) {
		return false;
	}

	// For listById operation, listId is required
	if (
		operation === "listById" &&
		(typeof (args as any).listId !== "string" || (args as any).listId === "")
	) {
		return false;
	}

	return true;
}


function isCalendarArgs(args: unknown): args is {
	operation: "search" | "open" | "list" | "create";
	searchText?: string;
	eventId?: string;
	limit?: number;
	fromDate?: string;
	toDate?: string;
	title?: string;
	startDate?: string;
	endDate?: string;
	location?: string;
	notes?: string;
	isAllDay?: boolean;
	calendarName?: string;
} {
	if (typeof args !== "object" || args === null) {
		return false;
	}

	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") {
		return false;
	}

	if (!["search", "open", "list", "create"].includes(operation)) {
		return false;
	}

	// Check that required parameters are present for each operation
	if (operation === "search") {
		const { searchText } = args as { searchText?: unknown };
		if (typeof searchText !== "string") {
			return false;
		}
	}

	if (operation === "open") {
		const { eventId } = args as { eventId?: unknown };
		if (typeof eventId !== "string") {
			return false;
		}
	}

	if (operation === "create") {
		const { title, startDate, endDate } = args as {
			title?: unknown;
			startDate?: unknown;
			endDate?: unknown;
		};

		if (
			typeof title !== "string" ||
			typeof startDate !== "string" ||
			typeof endDate !== "string"
		) {
			return false;
		}
	}

	return true;
}

function isMapsArgs(args: unknown): args is {
	operation:
		| "search"
		| "save"
		| "directions"
		| "pin"
		| "listGuides"
		| "addToGuide"
		| "createGuide";
	query?: string;
	limit?: number;
	name?: string;
	address?: string;
	fromAddress?: string;
	toAddress?: string;
	transportType?: string;
	guideName?: string;
} {
	if (typeof args !== "object" || args === null) {
		return false;
	}

	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") {
		return false;
	}

	if (
		![
			"search",
			"save",
			"directions",
			"pin",
			"listGuides",
			"addToGuide",
			"createGuide",
		].includes(operation)
	) {
		return false;
	}

	// Check that required parameters are present for each operation
	if (operation === "search") {
		const { query } = args as { query?: unknown };
		if (typeof query !== "string" || query === "") {
			return false;
		}
	}

	if (operation === "save" || operation === "pin") {
		const { name, address } = args as { name?: unknown; address?: unknown };
		if (
			typeof name !== "string" ||
			name === "" ||
			typeof address !== "string" ||
			address === ""
		) {
			return false;
		}
	}

	if (operation === "directions") {
		const { fromAddress, toAddress } = args as {
			fromAddress?: unknown;
			toAddress?: unknown;
		};
		if (
			typeof fromAddress !== "string" ||
			fromAddress === "" ||
			typeof toAddress !== "string" ||
			toAddress === ""
		) {
			return false;
		}

		// Check transportType if provided
		const { transportType } = args as { transportType?: unknown };
		if (
			transportType !== undefined &&
			(typeof transportType !== "string" ||
				!["driving", "walking", "transit"].includes(transportType))
		) {
			return false;
		}
	}

	if (operation === "createGuide") {
		const { guideName } = args as { guideName?: unknown };
		if (typeof guideName !== "string" || guideName === "") {
			return false;
		}
	}

	if (operation === "addToGuide") {
		const { address, guideName } = args as {
			address?: unknown;
			guideName?: unknown;
		};
		if (
			typeof address !== "string" ||
			address === "" ||
			typeof guideName !== "string" ||
			guideName === ""
		) {
			return false;
		}
	}

	return true;
}

function isPhotosArgs(args: unknown): args is {
	operation: "listAlbums" | "getAlbum" | "getFavorites" | "getRecent" | "search" | "open";
	albumName?: string;
	searchText?: string;
	limit?: number;
} {
	if (typeof args !== "object" || args === null) return false;

	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") return false;

	if (!["listAlbums", "getAlbum", "getFavorites", "getRecent", "search", "open"].includes(operation)) {
		return false;
	}

	if (operation === "getAlbum") {
		const { albumName } = args as { albumName?: unknown };
		if (typeof albumName !== "string" || albumName === "") return false;
	}

	if (operation === "search") {
		const { searchText } = args as { searchText?: unknown };
		if (typeof searchText !== "string" || searchText === "") return false;
	}

	const { limit } = args as { limit?: unknown };
	if (limit !== undefined && typeof limit !== "number") return false;

	return true;
}

function isShortcutsArgs(args: unknown): args is {
	operation: "list" | "listFolders" | "run" | "open";
	name?: string;
	folder?: string;
	input?: string;
	captureOutput?: boolean;
	timeoutMs?: number;
	showIdentifiers?: boolean;
} {
	if (typeof args !== "object" || args === null) return false;
	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") return false;
	if (!["list", "listFolders", "run", "open"].includes(operation)) return false;

	const a = args as Record<string, unknown>;
	if (operation === "run" || operation === "open") {
		if (typeof a.name !== "string" || a.name === "") return false;
	}
	if (a.folder !== undefined && typeof a.folder !== "string") return false;
	if (a.input !== undefined && typeof a.input !== "string") return false;
	if (a.captureOutput !== undefined && typeof a.captureOutput !== "boolean") return false;
	if (a.timeoutMs !== undefined && typeof a.timeoutMs !== "number") return false;
	if (a.showIdentifiers !== undefined && typeof a.showIdentifiers !== "boolean") return false;
	return true;
}

function isSafariArgs(args: unknown): args is {
	operation:
		| "listTabs"
		| "currentTab"
		| "openUrl"
		| "closeTab"
		| "activateTab"
		| "runJs"
		| "bookmarks"
		| "readingList"
		| "history";
	url?: string;
	where?: "newTab" | "currentTab" | "newWindow";
	background?: boolean;
	windowIndex?: number;
	tabIndex?: number;
	urlMatch?: string;
	js?: string;
	folder?: string;
	searchText?: string;
	unreadOnly?: boolean;
	limit?: number;
	sinceDays?: number;
} {
	if (typeof args !== "object" || args === null) return false;
	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") return false;
	const validOps = [
		"listTabs",
		"currentTab",
		"openUrl",
		"closeTab",
		"activateTab",
		"runJs",
		"bookmarks",
		"readingList",
		"history",
	];
	if (!validOps.includes(operation)) return false;

	const a = args as Record<string, unknown>;
	if (operation === "openUrl") {
		if (typeof a.url !== "string" || a.url === "") return false;
	}
	if (operation === "runJs") {
		if (typeof a.js !== "string" || a.js === "") return false;
	}
	if (a.where !== undefined && !["newTab", "currentTab", "newWindow"].includes(String(a.where))) return false;
	if (a.background !== undefined && typeof a.background !== "boolean") return false;
	if (a.windowIndex !== undefined && typeof a.windowIndex !== "number") return false;
	if (a.tabIndex !== undefined && typeof a.tabIndex !== "number") return false;
	if (a.urlMatch !== undefined && typeof a.urlMatch !== "string") return false;
	if (a.folder !== undefined && typeof a.folder !== "string") return false;
	if (a.searchText !== undefined && typeof a.searchText !== "string") return false;
	if (a.unreadOnly !== undefined && typeof a.unreadOnly !== "boolean") return false;
	if (a.limit !== undefined && typeof a.limit !== "number") return false;
	if (a.sinceDays !== undefined && typeof a.sinceDays !== "number") return false;
	return true;
}

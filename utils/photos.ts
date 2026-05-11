import { runAppleScript } from "run-applescript";

const CONFIG = {
	MAX_ALBUMS: 100,
	MAX_PHOTOS: 50,
	TIMEOUT_MS: 10000,
};

interface Album {
	name: string;
	id: string;
	count: number;
}

interface Photo {
	filename: string;
	id: string;
	date: string;
	description: string;
	favorite: boolean;
	keywords: string[];
	album?: string;
}

async function checkPhotosAccess(): Promise<boolean> {
	try {
		await runAppleScript(`tell application "Photos" to return name`);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Photos app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

async function requestPhotosAccess(): Promise<{
	hasAccess: boolean;
	message: string;
}> {
	try {
		const hasAccess = await checkPhotosAccess();
		if (hasAccess) {
			return { hasAccess: true, message: "Photos access is already granted." };
		}
		return {
			hasAccess: false,
			message:
				"Photos access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Photos'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog",
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Photos access: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function listAlbums(): Promise<Album[]> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) throw new Error(accessResult.message);

		const script = `
tell application "Photos"
    set albumList to {}
    set allAlbums to every album
    set albumCount to count of allAlbums
    if albumCount > ${CONFIG.MAX_ALBUMS} then set albumCount to ${CONFIG.MAX_ALBUMS}

    repeat with i from 1 to albumCount
        try
            set a to item i of allAlbums
            set aName to name of a
            set aId to id of a
            set aCount to count of every media item of a
            set end of albumList to {name:aName, id:aId, photoCount:aCount}
        on error
            -- skip problematic albums
        end try
    end repeat

    return albumList
end tell`;

		const result = (await runAppleScript(script)) as any;
		const arr = Array.isArray(result) ? result : result ? [result] : [];
		return arr.map((a: any) => ({
			name: a.name || "Untitled",
			id: a.id || "",
			count: Number(a.photoCount) || 0,
		}));
	} catch (error) {
		console.error(
			`Error listing albums: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

async function getAlbum(
	albumName: string,
	limit = CONFIG.MAX_PHOTOS,
): Promise<Photo[]> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) throw new Error(accessResult.message);

		const safeName = albumName.replace(/"/g, '\\"');
		const script = `
tell application "Photos"
    set photoList to {}
    try
        set targetAlbum to album "${safeName}"
        set allPhotos to every media item of targetAlbum
        set photoCount to count of allPhotos
        if photoCount > ${limit} then set photoCount to ${limit}

        repeat with i from 1 to photoCount
            try
                set p to item i of allPhotos
                set end of photoList to {filename:(filename of p), id:(id of p), date:(date of p as string), description:(description of p), favorite:(favorite of p)}
            on error
                -- skip problematic items
            end try
        end repeat
    on error errMsg
        return "ERROR:" & errMsg
    end try

    return photoList
end tell`;

		const result = (await runAppleScript(script)) as any;
		if (typeof result === "string" && result.startsWith("ERROR:")) {
			throw new Error(result.replace("ERROR:", ""));
		}
		const arr = Array.isArray(result) ? result : result ? [result] : [];
		return arr.map((p: any) => ({
			filename: p.filename || "unknown",
			id: p.id || "",
			date: p.date || "",
			description: p.description || "",
			favorite: p.favorite === true || p.favorite === "true",
			keywords: [],
			album: albumName,
		}));
	} catch (error) {
		throw new Error(
			`Failed to get album "${albumName}": ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function getFavorites(limit = CONFIG.MAX_PHOTOS): Promise<Photo[]> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) throw new Error(accessResult.message);

		// Try the built-in Favorites album first, fall back to filtering all media
		const script = `
tell application "Photos"
    set photoList to {}
    try
        set favAlbum to album "Favorites"
        set allPhotos to every media item of favAlbum
        set photoCount to count of allPhotos
        if photoCount > ${limit} then set photoCount to ${limit}

        repeat with i from 1 to photoCount
            try
                set p to item i of allPhotos
                set end of photoList to {filename:(filename of p), id:(id of p), date:(date of p as string), description:(description of p), favorite:true}
            on error
                -- skip
            end try
        end repeat
    on error
        -- Favorites album not present; scan all media items
        set scanLimit to ${limit * 5}
        set allPhotos to every media item
        set photoCount to count of allPhotos
        if photoCount > scanLimit then set photoCount to scanLimit
        set favCount to 0

        repeat with i from 1 to photoCount
            if favCount >= ${limit} then exit repeat
            try
                set p to item i of allPhotos
                if favorite of p is true then
                    set end of photoList to {filename:(filename of p), id:(id of p), date:(date of p as string), description:(description of p), favorite:true}
                    set favCount to favCount + 1
                end if
            on error
                -- skip
            end try
        end repeat
    end try

    return photoList
end tell`;

		const result = (await runAppleScript(script)) as any;
		const arr = Array.isArray(result) ? result : result ? [result] : [];
		return arr.map((p: any) => ({
			filename: p.filename || "unknown",
			id: p.id || "",
			date: p.date || "",
			description: p.description || "",
			favorite: true,
			keywords: [],
		}));
	} catch (error) {
		console.error(
			`Error getting favorites: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

async function getRecent(limit = 20): Promise<Photo[]> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) throw new Error(accessResult.message);

		const script = `
tell application "Photos"
    set photoList to {}
    try
        set recentAlbum to album "Recents"
        set allPhotos to every media item of recentAlbum
        set photoCount to count of allPhotos
        if photoCount > ${limit} then set photoCount to ${limit}

        repeat with i from 1 to photoCount
            try
                set p to item i of allPhotos
                set end of photoList to {filename:(filename of p), id:(id of p), date:(date of p as string), description:(description of p), favorite:(favorite of p)}
            on error
                -- skip
            end try
        end repeat
    on error errMsg
        return "ERROR:" & errMsg
    end try

    return photoList
end tell`;

		const result = (await runAppleScript(script)) as any;
		if (typeof result === "string" && result.startsWith("ERROR:")) {
			throw new Error(result.replace("ERROR:", ""));
		}
		const arr = Array.isArray(result) ? result : result ? [result] : [];
		return arr.map((p: any) => ({
			filename: p.filename || "unknown",
			id: p.id || "",
			date: p.date || "",
			description: p.description || "",
			favorite: p.favorite === true || p.favorite === "true",
			keywords: [],
		}));
	} catch (error) {
		throw new Error(
			`Failed to get recent photos: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function search(
	searchText: string,
): Promise<{ success: boolean; message: string }> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		const safeText = searchText.replace(/"/g, '\\"');
		const script = `
tell application "Photos"
    activate
    spotlight "${safeText}"
    return "SUCCESS"
end tell`;

		const result = (await runAppleScript(script)) as string;
		return {
			success: result === "SUCCESS",
			message:
				result === "SUCCESS"
					? `Opened Photos and searched for "${searchText}"`
					: "Failed to search Photos",
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to search Photos: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function open(
	albumName?: string,
): Promise<{ success: boolean; message: string }> {
	try {
		const accessResult = await requestPhotosAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		let script: string;
		if (albumName) {
			const safeName = albumName.replace(/"/g, '\\"');
			script = `
tell application "Photos"
    activate
    try
        spotlight "${safeName}"
        return "SUCCESS"
    on error errMsg
        return "ERROR:" & errMsg
    end try
end tell`;
		} else {
			script = `
tell application "Photos"
    activate
    return "SUCCESS"
end tell`;
		}

		const result = (await runAppleScript(script)) as string;
		if (typeof result === "string" && result.startsWith("ERROR:")) {
			return { success: false, message: result.replace("ERROR:", "") };
		}
		return {
			success: true,
			message: albumName
				? `Opened Photos to album "${albumName}"`
				: "Opened Photos app",
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to open Photos: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export default {
	listAlbums,
	getAlbum,
	getFavorites,
	getRecent,
	search,
	open,
	requestPhotosAccess,
};

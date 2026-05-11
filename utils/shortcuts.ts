import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60000;

interface RunResult {
	success: boolean;
	output: string;
	error: string;
	exitCode: number;
	timedOut: boolean;
}

function execShortcuts(
	args: string[],
	opts: { stdin?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
	return new Promise((resolve) => {
		const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const child = spawn("shortcuts", args);
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1000);
		}, timeoutMs);

		child.stdout.on("data", (d) => {
			stdout += d.toString("utf8");
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString("utf8");
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				success: false,
				output: stdout,
				error: err.message,
				exitCode: -1,
				timedOut,
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				success: !timedOut && code === 0,
				output: stdout,
				error: stderr,
				exitCode: code ?? -1,
				timedOut,
			});
		});

		if (opts.stdin !== undefined) {
			child.stdin.write(opts.stdin);
			child.stdin.end();
		} else {
			child.stdin.end();
		}
	});
}

function splitLines(s: string): string[] {
	return s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

async function list(opts: {
	folder?: string;
	showIdentifiers?: boolean;
}): Promise<{ shortcuts: Array<{ name: string; id?: string }>; raw: string }> {
	const args = ["list"];
	if (opts.folder) {
		args.push("--folder-name", opts.folder);
	}
	if (opts.showIdentifiers) {
		args.push("--show-identifiers");
	}

	const res = await execShortcuts(args);
	if (!res.success) {
		throw new Error(
			res.error.trim() || `shortcuts list exited with code ${res.exitCode}`,
		);
	}

	const lines = splitLines(res.output);
	const shortcuts = lines.map((line) => {
		if (!opts.showIdentifiers) return { name: line };
		// Format with --show-identifiers is "Name (UUID)"
		const m = line.match(/^(.*) \(([0-9A-Fa-f-]+)\)\s*$/);
		if (m) return { name: m[1], id: m[2] };
		return { name: line };
	});

	return { shortcuts, raw: res.output };
}

async function listFolders(): Promise<{ folders: string[]; raw: string }> {
	const res = await execShortcuts(["list", "--folders"]);
	if (!res.success) {
		throw new Error(
			res.error.trim() || `shortcuts list --folders exited with code ${res.exitCode}`,
		);
	}
	return { folders: splitLines(res.output), raw: res.output };
}

async function run(opts: {
	name: string;
	input?: string;
	captureOutput?: boolean;
	timeoutMs?: number;
}): Promise<{
	success: boolean;
	output: string;
	error: string;
	exitCode: number;
	timedOut: boolean;
}> {
	const capture = opts.captureOutput !== false;
	const args = ["run", opts.name];

	if (opts.input !== undefined) {
		args.push("--input-path", "-");
	}
	if (capture) {
		args.push("--output-path", "-", "--output-type", "public.utf8-plain-text");
	}

	const res = await execShortcuts(args, {
		stdin: opts.input,
		timeoutMs: opts.timeoutMs,
	});

	return {
		success: res.success,
		output: res.output,
		error: res.error,
		exitCode: res.exitCode,
		timedOut: res.timedOut,
	};
}

async function open(
	name: string,
): Promise<{ success: boolean; message: string }> {
	const res = await execShortcuts(["view", name]);
	if (res.success) {
		return { success: true, message: `Opened shortcut "${name}" in Shortcuts.` };
	}
	return {
		success: false,
		message: res.error.trim() || `Failed to open shortcut "${name}".`,
	};
}

export default {
	list,
	listFolders,
	run,
	open,
};

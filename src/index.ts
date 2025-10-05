import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json({ type: ["application/json", "application/x-www-form-urlencoded"] as any }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Basic in-memory state for matches
// NOTE: For production, use a store (Redis/DB)

type Move = "rock" | "paper" | "scissors";

interface MatchState {
	id: string;
	mode: "bot" | "pvp";
	playerA: number; // fid
	playerB?: number; // fid when pvp joined
	moveA?: Move;
	moveB?: Move;
	createdAt: number;
}

const matches = new Map<string, MatchState>();

function chooseBotMove(): Move {
	const choices: Move[] = ["rock", "paper", "scissors"];
	return choices[Math.floor(Math.random() * choices.length)];
}

function decideWinner(a: Move, b: Move): 0 | 1 | 2 {
	if (a === b) return 0; // draw
	if (
		(a === "rock" && b === "scissors") ||
		(a === "paper" && b === "rock") ||
		(a === "scissors" && b === "paper")
	) {
		return 1; // A wins
	}
	return 2; // B wins
}

type ButtonSpec = { label: string; action?: "post" | "url"; target?: string };

function frameMeta({ title, image, buttons, postUrl }: { title: string; image: string; buttons: ButtonSpec[]; postUrl: string; }) {
	return `<!DOCTYPE html><html><head>
	<meta property="fc:frame" content="vNext" />
	<meta property="og:title" content="${title}" />
	<meta property="og:image" content="${image}" />
	${buttons
		.map((btn, idx) => {
			const i = idx + 1;
			const base = `<meta property="fc:frame:button:${i}" content="${btn.label}" />`;
			const act = btn.action ? `<meta property="fc:frame:button:${i}:action" content="${btn.action}" />` : "";
			const tgt = btn.target ? `<meta property="fc:frame:button:${i}:target" content="${btn.target}" />` : "";
			return `${base}${act}${tgt}`;
		})
		.join("")}
	<meta property="fc:frame:post_url" content="${postUrl}" />
	</head></html>`;
}

function publicUrl(path: string) {
	const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
	return `${base}${path}`;
}

// Neynar verification middleware (SDK v2)
const config = new Configuration({
	apiKey: process.env.NEYNAR_API_KEY || "",
	baseOptions: {
		headers: {
			"x-neynar-experimental": "true",
		},
	},
});
const neynar = new NeynarAPIClient(config);

interface VerifiedAction {
	fid: number;
	buttonIndex: number;
	query?: Record<string, string>;
}

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			verifiedAction?: VerifiedAction;
		}
	}
}

async function verifyFrameAction(req: Request, res: Response, next: NextFunction) {
	try {
		const messageBytes: string | undefined = req.body?.trustedData?.messageBytes;
		if (!messageBytes) return unauthorized(res, "Missing messageBytes");
		const validation = await neynar.validateFrameAction({ messageBytesInHex: messageBytes });
		if (!validation?.valid || !validation?.action) return unauthorized(res, "Invalid signature");
		const fid = validation.action.interactor.fid;
		const buttonIndex = validation.action.tapped_button.index;
		const actionUrl = typeof validation.action.url === "string" ? validation.action.url : String(validation.action.url);
		const urlObj = new URL(actionUrl);
		const query: Record<string, string> = Object.fromEntries(new URLSearchParams(urlObj.search || ""));
		req.verifiedAction = { fid, buttonIndex, query };
		return next();
	} catch (err) {
		return unauthorized(res, "Verification error");
	}
}

function unauthorized(res: Response, title: string) {
	const html = frameMeta({
		title,
		image: publicUrl("/images/error.png"),
		buttons: [{ label: "Back" }],
		postUrl: publicUrl("/")
	});
	return res.set("Content-Type", "text/html").status(401).send(html);
}

// Initial frame view
app.get("/", (_req: Request, res: Response) => {
	const html = frameMeta({
		title: "Rock Paper Scissors",
		image: publicUrl("/images/start.png"),
		buttons: [
			{ label: "Play Bot" },
			{ label: "Create PvP" },
			{ label: "How to Play" },
			{ label: "Connect Wallet" }
		],
		postUrl: publicUrl("/action"),
	});
	res.set("Content-Type", "text/html").send(html);
});

// Handle actions (button clicks)
app.post("/action", verifyFrameAction, async (req: Request, res: Response) => {
	const { fid, buttonIndex } = req.verifiedAction!;

	// Routing by button from home
	if (buttonIndex === 1) {
		// Start bot game: ask for move
		const html = frameMeta({
			title: "Play Bot - Choose",
			image: publicUrl("/images/choose.png"),
			buttons: [
				{ label: "Rock" },
				{ label: "Paper" },
				{ label: "Scissors" },
				{ label: "Back" }
			],
			postUrl: publicUrl("/bot"),
		});
		return res.set("Content-Type", "text/html").send(html);
	}
	if (buttonIndex === 2) {
		// Create PvP lobby
		const matchId = `${Date.now()}-${fid}`;
		matches.set(matchId, {
			id: matchId,
			mode: "pvp",
			playerA: fid,
			createdAt: Date.now(),
		});
		const html = frameMeta({
			title: "PvP Lobby Created",
			image: publicUrl("/images/lobby.png"),
			buttons: [
				{ label: "Share" },
				{ label: "Cancel" },
				{ label: "Connect Wallet" },
				{ label: "Back" }
			],
			postUrl: publicUrl(`/pvp?matchId=${matchId}`),
		});
		return res.set("Content-Type", "text/html").send(html);
	}
	if (buttonIndex === 3) {
		const html = frameMeta({
			title: "How to Play",
			image: publicUrl("/images/howto.png"),
			buttons: [
				{ label: "Play Bot" },
				{ label: "Create PvP" },
				{ label: "Back" }
			],
			postUrl: publicUrl("/action"),
		});
		return res.set("Content-Type", "text/html").send(html);
	}
	if (buttonIndex === 4) {
		const baseLink = process.env.BASE_CONNECT_URL || "https://wallet.coinbase.com/"; // replace with your connect URL
		const arbLink = process.env.ARB_CONNECT_URL || "https://portal.arbitrum.io/"; // replace with your connect URL
		const html = frameMeta({
			title: "Connect Wallet",
			image: publicUrl("/images/connect.png"),
			buttons: [
				{ label: "Base", action: "url", target: baseLink },
				{ label: "Arbitrum", action: "url", target: arbLink },
				{ label: "Back" }
			],
			postUrl: publicUrl("/connect"),
		});
		return res.set("Content-Type", "text/html").send(html);
	}

	// Fallback to home
	const html = frameMeta({
		title: "Rock Paper Scissors",
		image: publicUrl("/images/start.png"),
		buttons: [
			{ label: "Play Bot" },
			{ label: "Create PvP" },
			{ label: "How to Play" },
			{ label: "Connect Wallet" }
		],
		postUrl: publicUrl("/action"),
	});
	return res.set("Content-Type", "text/html").send(html);
});

// Bot game endpoint
app.post("/bot", verifyFrameAction, async (req: Request, res: Response) => {
	const { buttonIndex } = req.verifiedAction!;

	const moveMap: Record<number, Move> = { 1: "rock", 2: "paper", 3: "scissors" };
	const playerMove = moveMap[buttonIndex];
	if (!playerMove) {
		const html = frameMeta({
			title: "Choose a move",
			image: publicUrl("/images/choose.png"),
			buttons: [
				{ label: "Rock" },
				{ label: "Paper" },
				{ label: "Scissors" },
				{ label: "Back" }
			],
			postUrl: publicUrl("/bot"),
		});
		return res.set("Content-Type", "text/html").send(html);
	}

	const botMove = chooseBotMove();
	const result = decideWinner(playerMove, botMove);

	const outcomeTitle = result === 0 ? "Draw!" : result === 1 ? "You Win!" : "Bot Wins!";
	const html = frameMeta({
		title: `Bot chose ${botMove}. ${outcomeTitle}`,
		image: publicUrl("/images/result.png"),
		buttons: [
			{ label: "Play Again" },
			{ label: "Home" },
			{ label: "Connect Wallet" }
		],
		postUrl: publicUrl("/action"),
	});
	return res.set("Content-Type", "text/html").send(html);
});

// PvP endpoint
app.post("/pvp", verifyFrameAction, async (req: Request, res: Response) => {
	const { fid, buttonIndex, query } = req.verifiedAction!;
	const matchId: string | undefined = query?.matchId;

	if (!matchId || !matches.has(matchId)) {
		const html = frameMeta({
			title: "PvP Match Not Found",
			image: publicUrl("/images/error.png"),
			buttons: [{ label: "Home" }],
			postUrl: publicUrl("/action"),
		});
		return res.set("Content-Type", "text/html").send(html);
	}

	const match = matches.get(matchId)!;
	if (!match.playerB && fid !== match.playerA) {
		match.playerB = fid;
	}

	// Moves
	if (buttonIndex >= 1 && buttonIndex <= 3) {
		const moveMap: Record<number, Move> = { 1: "rock", 2: "paper", 3: "scissors" };
		const mv = moveMap[buttonIndex];
		if (fid === match.playerA) match.moveA = mv;
		if (fid === match.playerB) match.moveB = mv;
	}

	if (!match.playerB || !match.moveA || !match.moveB) {
		const html = frameMeta({
			title: !match.playerB ? "Waiting for opponent" : "Waiting for both moves",
			image: publicUrl("/images/lobby.png"),
			buttons: [
				{ label: "Rock" },
				{ label: "Paper" },
				{ label: "Scissors" },
				{ label: "Cancel" }
			],
			postUrl: publicUrl(`/pvp?matchId=${matchId}`),
		});
		return res.set("Content-Type", "text/html").send(html);
	}

	const result = decideWinner(match.moveA, match.moveB);
	let title = "Draw!";
	if (result === 1) title = `Player ${match.playerA} wins!`;
	if (result === 2) title = `Player ${match.playerB} wins!`;

	matches.delete(matchId);

	const html = frameMeta({
		title,
		image: publicUrl("/images/result.png"),
		buttons: [
			{ label: "Rematch" },
			{ label: "Home" },
			{ label: "Connect Wallet" }
		],
		postUrl: publicUrl("/action"),
	});
	return res.set("Content-Type", "text/html").send(html);
});

// Wallet connect pseudo-flow (kept for Back)
app.post("/connect", verifyFrameAction, (req: Request, res: Response) => {
	const html = frameMeta({
		title: "Connect Wallet",
		image: publicUrl("/images/connect.png"),
		buttons: [
			{ label: "Base", action: "url", target: process.env.BASE_CONNECT_URL || "https://wallet.coinbase.com/" },
			{ label: "Arbitrum", action: "url", target: process.env.ARB_CONNECT_URL || "https://portal.arbitrum.io/" },
			{ label: "Back" }
		],
		postUrl: publicUrl("/action"),
	});
	return res.set("Content-Type", "text/html").send(html);
});

app.get("/health", (_req: Request, res: Response) => {
	res.json({ ok: true });
});

app.listen(port, () => {
	// eslint-disable-next-line no-console
	console.log(`RPS Frame server listening on :${port}`);
});

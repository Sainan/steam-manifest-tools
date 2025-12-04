const parseArguments = (base, bools = []) => {
	const res = [];
	let j = 0;
	for (let i = base; i != process.argv.length; ++i) {
		if (process.argv[i].startsWith("--")) {
			if (bools.indexOf(process.argv[i]) != -1) {
				res[process.argv[i]] = true;
			}
			else {
				console.log(`Ignoring unknown argument: ${process.argv[i]}`);
			}
		}
		else {
			res[j++] = process.argv[i];
		}
	}
	return res;
};

const tool = process.argv[2];
switch (tool) {
	default: {
		console.error(tool ? `Unknown tool: ${tool}` : "Syntax: mango <tool>");
		process.exit(1);
	} break;

	case "download-manifest": { // No need to use this manually as all commands that need a manifest will fetch it on demand.
		const [depotId, manifestId] = parseArguments(3);
		if (!depotId || !manifestId) {
			console.log("Syntax: mango download-manifest <depot id> <manifest id>");
			process.exit(1);
		}

		const { fetchManifest }  = require("./lib.js");

		(async () => {
			await fetchManifest(depotId, manifestId);
			console.log(`Saved in manifests/${depotId}_${manifestId}.manifest`);
		})();
	} break;

	case "download-chunks": {
		const args = parseArguments(3, ["--lancache"]);
		const [depotId, manifestId] = args;
		if (!depotId || !manifestId) {
			console.log("Syntax: mango download-chunks <depot id> <manifest id> [--lancache]");
			process.exit(1);
		}

		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { DEFAULT_HOSTS, fetchManifest, downloadChunks } = require("./lib.js");

		const hosts = args["--lancache"] ? ["http://lancache.steamcontent.com"] : DEFAULT_HOSTS;

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			await downloadChunks(
				manifest,
				undefined /*(num_chunks) => {}*/,
				(path, host) => { console.log(`${path}: Downloading from ${host}`); },
				(path, status, host) => { console.log(`${path}: Got ${status/*} from ${host*/}`); },
				(path, err) => { console.log(`${path}: `, err); },
				hosts
			)
			process.exit(0);
		})();
	} break;

	case "populate-chunks": {
		const [depotId, manifestId, installDir] = parseArguments(3);
		if (!depotId || !manifestId || !installDir) {
			console.log("Syntax: mango populate-chunks <depot id> <manifest id> <install dir>");
			process.exit(1);
		}

		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { fetchManifest, fetchDepotKey, populateChunks } = require("./lib.js");

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			console.log(`Fetching depot key...`);
			let depotKey = await fetchDepotKey(manifest.depot_id);
			depotKey = Buffer.from(depotKey, "hex");
			await populateChunks(manifest, depotKey, installDir, (file, file_i, num_files, chunk_i, num_chunks) => {
				if (chunk_i == 0) {
					console.log(`Processing ${file}...`);
				}
			});
			process.exit(0);
		})();
	} break;

	case "lancache": {
		const fs = require("fs");
		const fsPromises = require("fs/promises");
		const path = require("path");
		const express = require("express");
		const net = require("net");
		const sni = require("sni");

		const app = express();

		app.use((req, res, next) => {
			res.on("finish", () => {
				console.log(`${req.socket.remoteAddress} - ${req.url} - ${res.statusCode}`);
			});
			next();
		});

		app.get("/depot/:depotId/chunk/:sha", async (req, res) => {
			if (fs.existsSync(__dirname + req.url)) {
				res.sendFile(__dirname + req.url);
			}
			else if (req.host.endsWith(".steamcontent.com")) {
				const fr = await fetch(`http://${req.host}${req.url}`);
				if (fr.status == 200) {
					const buf = Buffer.from(await fr.arrayBuffer());
					await fsPromises.mkdir(path.dirname(__dirname + req.url), { recursive: true });
					await fsPromises.writeFile(__dirname + req.url, buf);
					res.send(buf).end();
				}
				else {
					res.status(fr.status).send("Upstream error").end();
				}
			}
			else {
				res.status(400).send("Don't have this chunk").end();
			}
		});

		app.get("/depot/:depotId/patch/:oldManifestId/:newManifestId", async (req, res) => {
			if (fs.existsSync(__dirname + req.url)) {
				res.sendFile(__dirname + req.url);
			}
			else if (req.host.endsWith(".steamcontent.com")) {
				const fr = await fetch(`http://${req.host}${req.url}`);
				if (fr.status == 200) {
					const buf = Buffer.from(await fr.arrayBuffer());
					//await fsPromises.mkdir(path.dirname(__dirname + req.url), { recursive: true });
					//await fsPromises.writeFile(__dirname + req.url, buf);
					res.send(buf).end();
				}
				else {
					res.status(fr.status).send("Upstream error").end();
				}
			}
			else {
				res.status(400).send("Don't have this patch").end();
			}
		});

		app.use((req, res) => {
			res.status(400).send("Don't know this endpoint").end();
		});

		app.listen(80, () => {
			console.log("Listening on port 80");
		});

		// Transparently forward traffic on port 443 to avoid breaking HTTPS connections

		net.createServer(socket => {
			socket.once("data", firstPacket => {
				const hostname = sni(firstPacket);
				if (!hostname) {
					return;
				}
				console.log(`${socket.remoteAddress} - Starting TLS proxy to ${hostname}`);
				const upstream = net.connect(443, hostname, () => {
					upstream.write(firstPacket);
					socket.pipe(upstream).pipe(socket);
				});
				upstream.on("error", () => socket.end());
			});
			socket.on("error", () => {});
		}).listen(443, () => {
			console.log("Listening on port 443");
		});
	} break;

	case "install": {
		const [depotId, manifestId, installDir] = parseArguments(3);
		if (!depotId || !manifestId) {
			console.log("Syntax: mango install <depot id> <manifest id> [install dir]");
			process.exit(1);
		}

		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { fetchManifest, fetchDepotKey, install }  = require("./lib.js");

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			console.log(`Fetching depot key...`);
			let depotKey = await fetchDepotKey(manifest.depot_id);
			depotKey = Buffer.from(depotKey, "hex");
			await install(manifest, depotKey, installDir, (file, existed) => {
				console.log(`${existed ? "Repaired" : "Created"} ${file}`);
			});
			process.exit(0);
		})();
	} break;

	case "download-and-install": {
		const args = parseArguments(3, ["--lancache"]);
		const [depotId, manifestId, installDir] = args;
		if (!depotId || !manifestId) {
			console.log("Syntax: mango download-and-install <depot id> <manifest id> [install dir] [--lancache]");
			process.exit(1);
		}

		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { DEFAULT_HOSTS, fetchManifest, fetchDepotKey, downloadAndInstall }  = require("./lib.js");

		const hosts = args["--lancache"] ? ["http://lancache.steamcontent.com"] : DEFAULT_HOSTS;

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));

			console.log(`Fetching depot key...`);
			let depotKey = await fetchDepotKey(manifest.depot_id);
			depotKey = Buffer.from(depotKey, "hex");

			let remaining_chunks;
			await downloadAndInstall(
				manifest,
				depotKey,
				(num_chunks) => {
					remaining_chunks = num_chunks;
					if (remaining_chunks == 0) {
						console.log("Done with downloading. Installing may still take a bit.");
					}
				},
				(path, host) => { console.log(`${path}: Downloading from ${host}`); },
				(path, status, host) => {
					console.log(`${path}: Got ${status/*} from ${host*/}`);
					if (status == 200 && --remaining_chunks == 0) {
						console.log("Done with downloading. Installing may still take a bit.");
					}
				},
				(path, err) => { console.log(`${path}: `, err); },
				hosts,
				installDir
			);

			process.exit(0);
		})();
	} break;

	case "to-json": {
		const args = parseArguments(3, ["--no-decrypt"]);
		const [depotId, manifestId] = args;
		if (!depotId || !manifestId) {
			console.log("Syntax: mango to-json <depot id> <manifest id> [--no-decrypt]");
			process.exit(1);
		}

		const fs = require("fs");
		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { fetchManifest, fetchDepotKey }  = require("./lib.js");

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			if (manifest.filenames_encrypted && !args["--no-decrypt"]) {
				console.log("Fetching depot key to decrypt filenames...");
				const depotKey = await fetchDepotKey(manifest.depot_id);
				ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex")); // Sets filenames_encrypted to false
				//manifest.filenames_decrypted = true; // Indicate that this transformation took place in the JSON export // Kinda pointless because some .manifest files are already decrypted by their sources
			}
			fs.writeFileSync(`${depotId}_${manifestId}.json`, JSON.stringify(manifest, null, 2));
			console.log(`Saved in ${depotId}_${manifestId}.json`);

			process.exit(0);
		})();
	} break;

	case "to-hashdeep-auditfile": {
		const [depotId, manifestId] = parseArguments(3);
		if (!depotId || !manifestId) {
			console.log("Syntax: mango to-hashdeep-auditfile <depot id> <manifest id>");
			process.exit(1);
		}

		const fs = require("fs");
		const path = require("path");
		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
		const { fetchManifest, fetchDepotKey }  = require("./lib.js");

		(async () => {
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			if (manifest.filenames_encrypted) {
				console.log("Manifest has encrypted filenames. Fetching depot key...");
				const depotKey = await fetchDepotKey(manifest.depot_id);
				ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex"));
			}

			const fh = fs.createWriteStream(`${depotId}_${manifestId}.auditfile`);
			fh.write("%%%% HASHDEEP-1.0\n");
			fh.write("%%%% size,sha1,filename\n");
			for (const file of manifest.files) {
				if ((file.flags & 64) === 0) {
					fh.write(`${file.size},${file.sha_content},${manifest.gid_manifest}${path.sep}${path.sep != '\\' ? file.filename.split('\\').join(path.sep) : file.filename.split('/').join(path.sep)}\n`);
				}
			}
			fh.end();
			fh.on("finish", () => {
				console.log(`Saved in ${depotId}_${manifestId}.auditfile`);

				process.exit(0);
			});
		})();
	} break;

	case "to-torrent": {
		const [depotId, manifestId, fileHash] = parseArguments(3);
		if (!depotId || !manifestId || !fileHash) {
			console.log("Syntax: mango to-torrent <depot id> <manifest id> <file hash>");
			process.exit(1);
		}

		const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");

		function toPieces(hexArray) {
			const bufs = hexArray.map(h => {
				if (typeof h !== "string" || h.length !== 40) {
					throw new Error(`Invalid SHA1 hex string: ${h}`);
				}
				return Buffer.from(h, "hex");
			});
			return Buffer.concat(bufs);
		}

		(async () => {
			const { fetchManifest } = require("./lib.js");
			const manifest = ContentManifest.parse(await fetchManifest(depotId, manifestId));
			const file = manifest.files.find(x => x.sha_content == fileHash);
			if (!file) {
				console.log(`No file with content hash ${fileHash} found in ${depotId}_${manifestId}.manifest`);
				process.exit(1);
			}
			for (const chunk of file.chunks) {
				chunk.offset = parseInt(chunk.offset);
			}
			file.chunks.sort((a, b) => a.offset - b.offset);
			let pieceSize = file.chunks[0].cb_original;
			for (let i = 1; i < file.chunks.length - 1; ++i) {
				if (pieceSize != file.chunks[i].cb_original) {
					console.log(`This file has non-uniformly sized chunks and is therefore unrepresentable in BitTorrent.`);
					process.exit(2);
				}
			}
			const { toTorrentFile } = await import("parse-torrent");
			const buf = toTorrentFile({
				info: {
					name: file.sha_content,
					length: parseInt(file.size),
					'piece length': pieceSize,
					pieces: toPieces(file.chunks.map(chunk => chunk.sha))
				}
			});
			const fs = require("node:fs");
			fs.writeFileSync(`${file.sha_content}.torrent`, buf);
			console.log(`Saved in ${file.sha_content}.torrent`);
			process.exit(0);
		})();
	} break;

	case "verify-chunks": {
		const [depotId] = parseArguments(3);
		if (!depotId) {
			console.log("Syntax: mango verify-chunks <depot id>");
			process.exit(1);
		}

		const { fetchDepotKey, verifyChunks } = require("./lib.js");
		(async () => {
			console.log(`Fetching depot key...`);
			let depotKey = await fetchDepotKey(depotId);
			depotKey = Buffer.from(depotKey, "hex");
			console.log(`Verifying chunks...`);
			await verifyChunks(depotId, depotKey, (file, expectedHash) => {
				console.log(`Deleted ${file}`);
			});
			process.exit(0);
		})();
	} break;
}

const manifestFile = process.argv[2];
let depotKey = process.argv[3];
if (!manifestFile || !depotKey) {
	console.log("Syntax: node install.js <manifest file> <depot key>");
	process.exit(1);
}

const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const CdnCompression = require("steam-user/components/cdn_compression");
const ContentManifest = require("steam-user/components/content_manifest");
const SteamCrypto = require("@doctormckay/steam-crypto");

const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const chunksInMemory = {};
const getChunk = async (depotId, depotKey, hash) => {
	if (!chunksInMemory[hash]) {
		while (true) {
			try {
				let data = await fsPromises.readFile(`depot/${depotId}/chunk/${hash}`);
				data = SteamCrypto.symmetricDecrypt(data, depotKey);
				data = await CdnCompression.unzip(data);
				if (sha1(data) != hash) {
					console.log(`Uh oh, depot/${depotId}/chunk/${hash} does not match the expected hash`);
				}
				chunksInMemory[hash] = data;
				break;
			} catch (e) {
				if (e.code == "ENOENT") {
					console.log(`Uh oh, depot/${depotId}/chunk/${hash} is missing`);
					chunksInMemory[hash] = new Uint8Array();
					break;
				}
				if (e.code != "EMFILE") {
					console.log(`Error reading depot/${depotId}/chunk/${hash}`);
					throw e;
				}
				await sleep(500);
			}
		}
	}
	return chunksInMemory[hash];
};

depotKey = Buffer.from(depotKey, "hex");
const data = fs.readFileSync(manifestFile);
(async () => {
	const manifest = ContentManifest.parse(data);
	ContentManifest.decryptFilenames(manifest, depotKey);
	fs.mkdirSync(`install/${manifest.depot_id}/${manifest.gid_manifest}`, { recursive: true });
	for (const file of manifest.files) {
		if (file.flags & 64) {
			continue;
		}
		if (!fs.existsSync(`install/${manifest.depot_id}/${manifest.gid_manifest}/${file.filename}`)) {
			for (const chunk of file.chunks) {
				chunk.offset = parseInt(chunk.offset);
			}
			file.chunks.sort((a, b) => a.offset - b.offset);
			const chunkPromises = [];
			for (const chunk of file.chunks) {
				chunkPromises.push(getChunk(manifest.depot_id, depotKey, chunk.sha));
			}
			const chunks = await Promise.all(chunkPromises);
			(async () => {
				const st = crypto.createHash("sha1");
				for (const chunk of chunks) {
					st.update(chunk);
				}
				const data = Buffer.concat(chunks);
				await fsPromises.mkdir(path.dirname(`install/${manifest.depot_id}/${manifest.gid_manifest}/${file.filename}`), { recursive: true });
				await fsPromises.writeFile(`install/${manifest.depot_id}/${manifest.gid_manifest}/${file.filename}`, data);
				if (st.digest("hex") == file.sha_content) {
					console.log(`install/${manifest.depot_id}/${manifest.gid_manifest}/${file.filename}: Created`);
				} else {
					console.log(`install/${manifest.depot_id}/${manifest.gid_manifest}/${file.filename}: Created; HASH MISMATCHES`);
				}
			})();
		}
	}
})();

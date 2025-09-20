const fs = require("fs");
const ContentManifest = require("steam-user/components/content_manifest");

function toPieces(hexArray) {
	const bufs = hexArray.map(h => {
		if (typeof h !== "string" || h.length !== 40) {
			throw new Error(`Invalid SHA1 hex string: ${h}`);
		}
		return Buffer.from(h, "hex");
	});
	return Buffer.concat(bufs);
}

const manifestFile = process.argv[2];
const fileHash = process.argv[3];
if (!manifestFile || !fileHash) {
	console.log("Syntax: node to-torrent.js <manifest file> <file hash>");
	process.exit(1);
}
const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
const file = manifest.files.find(x => x.sha_content == fileHash);
if (!file) {
	console.log(`No file with content hash ${fileHash} found in ${manifestFile}`);
	process.exit(1);
}
import("parse-torrent").then(({ toTorrentFile }) => {
	for (const chunk of file.chunks) {
		chunk.offset = parseInt(chunk.offset);
	}
	file.chunks.sort((a, b) => a.offset - b.offset);
	const buf = toTorrentFile({
		info: {
			name: file.sha_content,
			length: parseInt(file.size),
			'piece length': 1048576,
			pieces: toPieces(file.chunks.map(chunk => chunk.sha))
		}
	})
	fs.writeFileSync(`${file.sha_content}.torrent`, buf);
});

const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const AdmZip = require("adm-zip");
const SteamCrypto = require("@doctormckay/steam-crypto");

const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");

const compress = (buf) => {
	const zip = new AdmZip();
	zip.addFile("z", buf);
	return zip.toBuffer();
};

// https://stackoverflow.com/a/45130990
async function getFiles(dir) {
	const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(dirents.map((dirent) => {
		const res = path.resolve(dir, dirent.name);
		return dirent.isDirectory() ? getFiles(res) : res;
	}));
	return Array.prototype.concat(...files);
}

const depotId = process.argv[2];
let depotKey = process.argv[3];
const installDir = process.argv[4];
if (!depotId || !depotKey || !installDir) {
	console.log("Syntax: node populate-chunks.js <depot id> <depot key> <install dir>");
	process.exit(1);
}
depotKey = Buffer.from(depotKey, "hex");
getFiles(installDir).then(async files => {
	fs.mkdirSync(`depot/${depotId}/chunk`, { recursive: true });
	for (const file of files) {
		const data = await fsPromises.readFile(file);
		for (let offset = 0; offset < data.length; offset += 1048576) {
			const end = Math.min(offset + 1048576, data.length);
			let chunk = data.subarray(offset, end);
			const sha = sha1(chunk);
			if (!fs.existsSync(`depot/${depotId}/chunk/${sha}`)) {
				chunk = compress(chunk);
				chunk = SteamCrypto.symmetricEncrypt(chunk, depotKey);
				await fsPromises.writeFile(`depot/${depotId}/chunk/${sha}`, chunk);
			}
		}
	}
});

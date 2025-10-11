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
const getFiles = async (dir) => {
	const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(dirents.map((dirent) => {
		const res = path.resolve(dir, dirent.name);
		return dirent.isDirectory() ? getFiles(res) : res;
	}));
	return Array.prototype.concat(...files);
};

module.exports = {
	populateChunks: async (depotId, depotKey, installDir) => {
		depotKey = Buffer.from(depotKey, "hex");
		const files = await getFiles(installDir);
		fs.mkdirSync(`depot/${depotId}/chunk`, { recursive: true });
		for (const file of files) {
			const readStream = fs.createReadStream(file, { highWaterMark: 1048576 });
			for await (let chunk of readStream) {
				const sha = sha1(chunk);
				if (!fs.existsSync(`depot/${depotId}/chunk/${sha}`)) {
					chunk = compress(chunk);
					chunk = SteamCrypto.symmetricEncrypt(chunk, depotKey);
					await fsPromises.writeFile(`depot/${depotId}/chunk/${sha}`, chunk);
				}
			}
		}
	},
};

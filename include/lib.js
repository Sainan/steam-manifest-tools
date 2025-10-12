const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const AdmZip = require("adm-zip");
const ContentManifest = require("steam-user/components/content_manifest");
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
	getFiles,
	populateChunks: async (manifest, depotKey, installDir, onProgress) => {
		if (manifest.filenames_encrypted) {
			ContentManifest.decryptFilenames(manifest, depotKey);
		}
		fs.mkdirSync(`depot/${manifest.depot_id}/chunk`, { recursive: true });
		let file_i = 0;
		for (const file of manifest.files) {
			if (file.flags & 64) {
				continue;
			}
			if (fs.existsSync(path.join(installDir, file.filename))) {
				const readSteam = await fsPromises.open(path.join(installDir, file.filename), "r");
				let chunk_i = 0;
				for (const chunk of file.chunks) {
					if (!fs.existsSync(`depot/${manifest.depot_id}/chunk/${chunk.sha}`)) {
						let chunkBuf = Buffer.alloc(chunk.cb_original);
						const { bytesRead } = await readSteam.read(chunkBuf, 0, chunk.cb_original, parseInt(chunk.offset));
						if (bytesRead != chunk.cb_original) {
							break;
						}
						if (sha1(chunkBuf) == chunk.sha) {
							chunkBuf = compress(chunkBuf);
							chunkBuf = SteamCrypto.symmetricEncrypt(chunkBuf, depotKey);
							await fsPromises.writeFile(`depot/${manifest.depot_id}/chunk/${chunk.sha}`, chunkBuf);
							if (onProgress) {
								onProgress(file.filename, file_i, manifest.files.length, chunk_i++, file.chunks.length);
							}
						}
					}
				}
				await readSteam.close();
			}
			++file_i;
		}
	},
};

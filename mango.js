const tool = process.argv[2];
switch (tool) {
    default: {
        console.error(tool ? `Unknown tool: ${tool}` : "Syntax: mango <tool>");
        process.exit(1);
    } break;

    case "download-manifest": {
        const depotId = process.argv[1 + 2];
        const manifestId = process.argv[1 + 3];
        if (!depotId || !manifestId) {
            console.log("Syntax: mango download-manifest <depot id> <manifest id>");
            process.exit(1);
        }

        const fsPromises = require("fs/promises");
        const { fetchManifest }  = require(".");

        (async () => {
            const ab = await fetchManifest(depotId, manifestId);
            if (ab) {
                await fsPromises.writeFile(`${depotId}_${manifestId}.manifest`, Buffer.from(ab));
                console.log(`Saved in ${depotId}_${manifestId}.manifest`);
                process.exit(0);
            }
            else {
                console.log(`Could not find the given manifest. Double-check with https://steamdb.info/depot/${depotId}/manifests/ and report an issue in https://github.com/Sainan/k25FCdfEOoEJ42S6/issues if you're sure the manifest exists.`);
                process.exit(1);
            }
        })();
    } break;

    case "download-chunks": {
        let manifestFile = process.argv[1 + 2];
        let lancache = (process.argv[1 + 3] == "--lancache");
        if (manifestFile == "--lancache") {
            lancache = true;
            manifestFile = process.argv[1 + 3];
        }
        if (!manifestFile) {
            console.log("Syntax: mango download-chunks <manifest file> [--lancache]");
            process.exit(1);
        }
        
        const fs = require("fs");
        const ContentManifest = require("steam-user/components/content_manifest");
        const { DEFAULT_HOSTS, downloadChunks } = require(".");
        
        const hosts = lancache ? ["http://lancache.steamcontent.com"] : DEFAULT_HOSTS;
        
        const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
        downloadChunks(
            manifest,
            undefined /*(num_chunks) => {}*/,
            (path, host) => { console.log(`${path}: Downloading from ${host}`); },
            (path, status, host) => { console.log(`${path}: Got ${status/*} from ${host*/}`); },
            (path, err) => { console.log(`${path}: `, err); },
            hosts
        ).then(() => process.exit(0));
    } break;

    case "populate-chunks": {
        const manifestFile = process.argv[1 + 2];
        const installDir = process.argv[1 + 3];
        let depotKey = process.argv[1 + 4];
        if (!manifestFile || !installDir) {
            console.log("Syntax: mango populate-chunks <manifest file> <install dir> [depot key]");
            process.exit(1);
        }
        
        const fs = require("fs");
        const ContentManifest = require("steam-user/components/content_manifest");
        const { fetchDepotKey, populateChunks } = require(".");
        
        (async () => {
            const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
            if (!depotKey) {
                depotKey = await fetchDepotKey(manifest.depot_id);
            }
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
        const manifestFile = process.argv[1 + 2];
        let depotKey = process.argv[1 + 3];
        if (!manifestFile) {
            console.log("Syntax: mango install <manifest file> [depot key]");
            process.exit(1);
        }
        
        const fs = require("fs");
        const ContentManifest = require("steam-user/components/content_manifest");
        const { fetchDepotKey, install }  = require(".");
        
        (async () => {
            const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
            if (!depotKey) {
                depotKey = await fetchDepotKey(manifest.depot_id);
            }
            depotKey = Buffer.from(depotKey, "hex");
            await install(manifest, depotKey, undefined, (file, existed) => {
                console.log(`${existed ? "Repaired" : "Created"} ${file}`);
            });
            process.exit(0);
        })();
    } break;

    case "to-json": {
        const fs = require("fs");
        const ContentManifest = require("steam-user/components/content_manifest");
        
        const file = process.argv[1 + 2];
        const depotKey = process.argv[1 + 3];
        if (!file) {
            console.log("Syntax: mango to-json <manifest file> [depot key]");
            process.exit(1);
        }
        
        const buf = fs.readFileSync(file);
        const manifest = ContentManifest.parse(buf);
        if (manifest.filenames_encrypted) {
            if (depotKey) {
                ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex")); // Sets filenames_encrypted to false
                //manifest.filenames_decrypted = true; // Indicate that this transformation took place in the JSON export // Kinda pointless because some .manifest files are already decrypted by their sources
            } else {
                console.log("Manifest has encrypted filenames, suggest supplying depot key");
            }
        
        }
        fs.writeFileSync(file + ".json", JSON.stringify(manifest, null, 2));
        
        process.exit(0);
    } break;

    case "to-hashdeep-auditfile": {
        const fs = require("fs");
        const path = require("path");
        const ContentManifest = require("steam-user/components/content_manifest");
        
        const file = process.argv[1 + 2];
        let depotKey = process.argv[1 + 3];
        if (!file) {
            console.log("Syntax: mango to-hashdeep-auditfile <manifest file> [depot key]");
            process.exit(1);
        }
        
        (async () => {
            const buf = fs.readFileSync(file);
            const manifest = ContentManifest.parse(buf);
            if (manifest.filenames_encrypted) {
                if (!depotKey) {
                    console.log("Manifest has encrypted filenames. A depot key will be needed.");
                    const { fetchDepotKey } = require(".");
                    depotKey = await fetchDepotKey(manifest.depot_id);
                }
                ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex"));
            }
        
            const fh = fs.createWriteStream(`${file}.auditfile`);
            fh.write("%%%% HASHDEEP-1.0\n");
            fh.write("%%%% size,sha1,filename\n");
            for (const file of manifest.files) {
                if ((file.flags & 64) === 0) {
                    fh.write(`${file.size},${file.sha_content},${manifest.gid_manifest}${path.sep}${path.sep != '\\' ? file.filename.split('\\').join(path.sep) : file.filename.split('/').join(path.sep)}\n`);
                }
            }
            fh.end();
        
            process.exit(0);
        })();
    } break;

    case "to-torrent": {
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
        
        const manifestFile = process.argv[1 + 2];
        const fileHash = process.argv[1 + 3];
        if (!manifestFile || !fileHash) {
            console.log("Syntax: mango to-torrent <manifest file> <file hash>");
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
            process.exit(0);
        });
    } break;

    case "verify-chunks": {
        const depotId = process.argv[1 + 2];
        let depotKey = process.argv[1 + 3];
        if (!depotId) {
            console.log("Syntax: mango verify-chunks <depot id> [depot key]");
            process.exit(1);
        }

        const { fetchDepotKey, verifyChunks } = require(".");
        (async () => {
            if (!depotKey) {
                depotKey = await fetchDepotKey(depotId);
            }
            depotKey = Buffer.from(depotKey, "hex");
            console.log(`Verifying chunks...`);
            await verifyChunks(depotId, depotKey, (file, expectedHash) => {
                console.log(`Deleted ${file}`);
            });
            process.exit(0);
        })();
    } break;
}
